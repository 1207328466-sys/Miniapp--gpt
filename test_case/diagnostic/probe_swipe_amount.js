/*
 * 诊断（不以 test_ 开头，pytest 不收集）：验证「滑动」的**每次滑多少**真的能控制。
 *
 * owner 2026/10/14 问：一次滑动到底滑多少？能不能自己控制？
 * 这里在真机上量一遍（只读，只在案例库列表里上下滑，不点任何卡片）：
 *   · 用表格动作**同一套代码**（base.parseSwipeSpec + android.swipeUp），
 *     分别按「上 20%」「上 60%」各滑一次，量出屏幕实际位移；
 *   · 期望：20% 那次明显小于 60% 那次（比例大致成对）。
 *
 * 运行：node test_case/diagnostic/probe_swipe_amount.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const { swipeUp } = require("../../app_sub_function/suprecast_app/android");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

/**
 * 量"页面滚了多远"：取所有元素里最大的 scrollTop（CSS 像素）。
 *
 * 为什么不用"元素 top 的变化"：那是 swipeUp 内部的判据，容易抽到**吸顶**元素（它们永远不动），
 * 于是页面明明滚了却报"未发生位移"（2026/10/14 写这个探针时先踩了，probe 值 [123,123,123,123,123]
 * 就是同一排元素的 top）。量 scrollTop 是"页面到底滚了多少"最直接的读数。
 */
async function scrollOffset(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(() => {
    let best = 0;
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop > best) best = el.scrollTop;
    });
    return Math.round(best);
  });
}

/** 用同一个动作的解析器滑一次，返回实际滚动量（px，CSS 像素） */
async function swipeAndMeasure(page, spec, label) {
  const before = await scrollOffset(page);
  page = await swipeUp(page, { startRatio: spec.startRatio, endRatio: spec.endRatio });
  await base.sleep(900);
  const after = await scrollOffset(page);
  const moved = after - before;
  console.log(
    // ⚠️ console.log 不支持 %.2f 那种 printf 写法（会原样打出来）—— 一律用拼字符串
    "  [" + label + "] 起止=" + spec.startRatio + "->" + spec.endRatio +
      " | scrollTop " + before + " -> " + after + " | 实测滚动 ≈ " + moved + " px"
  );
  return { page, moved };
}

/** 往回滑到顶部（noMove 就当到顶了；最多 10 次）—— 让每次测量都从同一个起点开始 */
async function backToTop(page, max = 10) {
  for (let i = 0; i < max; i++) {
    const before = await scrollOffset(page);
    page = await swipeUp(page, { startRatio: 0.25, endRatio: 0.75, ignoreNoMove: true });
    await base.sleep(700);
    if ((await scrollOffset(page)) >= before) break; // 没再往回收 -> 已经在顶部
  }
  return page;
}

async function probe(page) {
  page = await caseLibrary.ensureOn(page); // 案例库列表：内容长、可滚动
  await backToTop(page);

  const small = base.parseSwipeSpec("上 20%");
  const big = base.parseSwipeSpec("上 60%");
  const def = base.parseSwipeSpec(""); // 默认（半屏）

  const view = await (await base.foreground(page)).evaluate(() => ({
    h: document.documentElement.clientHeight,
    dpr: window.devicePixelRatio,
  }));
  console.log("\n视口高度 = %d CSS px（dpr=%s）—— 「半屏」就是它的 50%%", view.h, view.dpr);

  const r1 = await swipeAndMeasure(page, small, "上 20%");
  page = await backToTop(r1.page);
  const r2 = await swipeAndMeasure(page, big, "上 60%");
  page = await backToTop(r2.page);
  const r3 = await swipeAndMeasure(page, def, "默认（半屏）");

  console.log(
    "\n[结论] 实测滚动：" + r1.moved + " px（上 20%）/ " + r3.moved +
      " px（默认半屏）/ " + r2.moved + " px（上 60%）"
  );
  const okSmallBig = r1.moved > 0 && r2.moved > r1.moved;
  const okDefaultBetween = r3.moved >= r1.moved && r3.moved <= r2.moved;
  console.log(
    "  20% 比 60% 滑得少？ " + (okSmallBig ? "是" : "否（没体现差别！）") +
      " | 默认落在两者之间（≈半屏）？ " + (okDefaultBetween ? "是" : "否")
  );
  if (!okSmallBig) throw new Error("「每次滑多少」没有生效：20% 与 60% 的实测位移没拉开差距");
  return page;
}

appTest([[probe, null]], { photosPath: null }).catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
