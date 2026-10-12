/*
 * 诊断（不以 test_ 开头，pytest 不收集）：停在**设计专区（案例库）**时，「回到首页」走得通吗？
 *
 * 背景（2026/10/12 一次全量跑 22 条全红）：报错都是
 *   「点击底部 tab「有问必答」后没有进入有问必答页（未出现 .search-container）」，
 * 而当时屏幕上停在**学习中心 → 课程列表**；后来我把手机停在**案例库**上试，同样点不动。
 * 手动 `adb shell input tap 122 2463` 却能切页 —— 所以要在"框架走的这条路"上把它复现出来。
 *
 * 做法：
 *   1. 先确保停在设计专区（案例库）—— 不是的话自己切过去
 *   2. 执行「回到首页」，把过程与结果都打出来
 *   3. 失败时把"底部 tab 元素的位置与类名"导出来（判据要看证据）
 *
 * 只读：只导航 + 读 DOM。
 * 运行：node test_case/diagnostic/probe_home_from_design_zone.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;
const caseLibrary = pages.caseLibrary;

async function feedVisible(page) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  return ["最新提问", "推荐", "精选问答", "我的关注"].every((t) => text.includes(t));
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);
  page = await caseLibrary.ensureOn(page); // 切到设计专区（案例库）
  await base.sleep(1500);
  console.log("\n[第 1 步] 已停在案例库；当前页面前 40 字：%s", JSON.stringify((await base.pageText(await base.foreground(page))).slice(0, 40)));

  console.log("\n[第 2 步] 执行「回到首页」");
  const t0 = Date.now();
  let err = "";
  try {
    page = await qaPage.ensureOnHomeFeed(page);
  } catch (e) {
    err = e.message;
  }
  const ok = await feedVisible(page);
  console.log("  耗时 %ss；回到首页了吗：%s", ((Date.now() - t0) / 1000).toFixed(1), ok ? "是" : "**没有**");
  if (err) console.log("  报错：%s", err.split("\n")[0]);

  if (!ok) {
    const fg = await base.foreground(page);
    const info = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = { tabs: [], hasCustomTabBar: document.querySelectorAll('[class*="custom-tab-bar"]').length };
      for (const el of Array.from(document.querySelectorAll("wx-view, wx-text"))) {
        const t = norm(el.textContent);
        if (!["有问必答", "学习中心", "设计专区", "我的"].includes(t)) continue;
        const r = el.getBoundingClientRect();
        out.tabs.push({
          text: t,
          cls: String(el.getAttribute("class") || "").slice(0, 70),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
      }
      return out;
    });
    console.log("  当前页里 custom-tab-bar 命中 %d 个；底部 tab 文案元素：", info.hasCustomTabBar);
    info.tabs.forEach((t) => console.log("    %s <%s> 位置=%s", JSON.stringify(t.text), t.cls, JSON.stringify(t.rect)));
    throw new Error("复现成功：停在案例库时「回到首页」没走通（22 条全红的同一条路）");
  }
  console.log("\n✅ 通过：从案例库也能回到首页");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "回到首页", title: "从设计专区（案例库）回首页" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
