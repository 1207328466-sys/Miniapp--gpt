/*
 * 诊断（不以 test_ 开头，pytest 不收集）：`swipeUp` 的"有没有动"到底该怎么判？
 *
 * 背景（2026/10/14）：好几处都报「滑动后页面未发生位移（探测点 [123,123,123,123,123]）」——
 * 但同一个页面，探针里又能量到真实滚动（scrollTop 0 → 161）。所以要先弄清：
 *   ① swipeUp 现在用的判据（页面中部若干元素的 top 有没有变）在案例库页上是不是**瞎的**？
 *   ② 直接量"最大的 scrollTop 变化"是不是更靠谱？
 *
 * 做法：打开案例库，**同一个滑动**同时用两个判据量一遍（只读，不点卡片）：
 *   判据A = 元素 top 探测点（swipeUp 现在用的）
 *   判据B = 最大 scrollTop 的差值
 *
 * 运行：node test_case/diagnostic/probe_swipe_judge.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const { swipeUp } = require("../../app_sub_function/suprecast_app/android");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

/** 判据A：swipeUp 内部那套（页面中部元素的 top） */
async function topsProbe(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(() => {
    const out = [];
    document.querySelectorAll("wx-view, wx-text, wx-scroll-view").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 20 && r.top > 100 && r.top < 600) out.push(Math.round(r.top));
    });
    return out.slice(0, 20);
  });
}

/** 判据B：所有元素里最大的 scrollTop（= 页面到底滚到哪了） */
async function scrollTop(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(() => {
    let best = 0;
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop > best) best = el.scrollTop;
    });
    return Math.round(best);
  });
}

async function oneSwipe(page, label, { startRatio = 0.75, endRatio = 0.55 } = {}) {
  const a0 = await topsProbe(page);
  const b0 = await scrollTop(page);
  page = await swipeUp(page, { startRatio, endRatio, ignoreNoMove: true });
  await base.sleep(900);
  const a1 = await topsProbe(page);
  const b1 = await scrollTop(page);

  const movedA = a0.length && a1.length && a1.some((v, i) => a0[i] !== undefined && Math.abs(v - a0[i]) > 5);
  console.log(
    "\n[" + label + "] 起止 " + startRatio + "->" + endRatio +
      "\n   判据A（元素 top）：" + JSON.stringify(a0.slice(0, 5)) + " → " + JSON.stringify(a1.slice(0, 5)) +
      "  => " + (movedA ? "看到位移" : "**没看到位移**") +
      "\n   判据B（scrollTop）：" + b0 + " → " + b1 + "（变化 " + (b1 - b0) + " px）"
  );
  return { page, movedA, deltaB: b1 - b0 };
}

async function probe(page) {
  page = await caseLibrary.ensureOn(page);
  console.log("\n刚到达案例库列表页，立刻滑（复现那条报错）");
  const r1 = await oneSwipe(page, "第 1 次：上 20%（刚到达）");
  page = r1.page;

  const r2 = await oneSwipe(page, "第 2 次：上 20%（紧接着再来一次）");
  page = r2.page;

  const r3 = await oneSwipe(page, "第 3 次：上 50%（默认半屏）");
  page = r3.page;

  console.log("\n[小结]");
  console.log("  第1次：判据A " + (r1.movedA ? "动" : "没动") + " / 判据B " + r1.deltaB + " px");
  console.log("  第2次：判据A " + (r2.movedA ? "动" : "没动") + " / 判据B " + r2.deltaB + " px");
  console.log("  第3次：判据A " + (r3.movedA ? "动" : "没动") + " / 判据B " + r3.deltaB + " px");
  if (r1.deltaB !== 0 && !r1.movedA) {
    console.log("  => 判据A 在这一页上是**瞎的**（页面滚了，元素 top 却没变）—— 应该改用 scrollTop");
  } else if (r1.deltaB === 0 && r2.deltaB === 0) {
    console.log("  => 这一页第 1、2 次滑动是真的没滚（不是判据问题），要继续查手势/容器");
  }
  return page;
}

appTest([[probe, null]], { photosPath: null }).catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
