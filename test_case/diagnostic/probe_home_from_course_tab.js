/*
 * 诊断（不以 test_ 开头，pytest 不收集）：停在「学习中心 → 课程」时，「回到首页」还能不能走通？
 *
 * 起因（2026/10/12 一次全量跑：**22 条用例全红**）：
 *   每一条的报错都是「点击底部 tab「有问必答」后没有进入有问必答页（未出现 .search-container）」，
 *   而当时屏幕上停在**学习中心 → 课程列表**，后面所有用例都出不来 ——
 *   也就是说，一次"卡住"会把整轮测试全带红（这才是真问题，不只是某条用例写错了）。
 *
 * 做法（把现场一步步摆出来）：
 *   1. 先回首页（正例：确认当前状态能回去）
 *   2. 进「学习中心」→ 切「课程」tab（复现出事那个状态）
 *   3. 再执行「回到首页」——断言：真的回到首页信息流
 *   4. 顺带把"点底部 tab"这一步的细节打出来（tap 坐标 / 目标元素 / 点完之后前台是谁）
 *
 * 只读：只导航 + 读 DOM。
 * 运行：node test_case/diagnostic/probe_home_from_course_tab.js
 */

const { appTest } = require("../../common/app_common");
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const learnCenter = pages.learnCenter;
const qaPage = pages.qaPage;

/** 屏幕上能不能读到首页那四个筛选 tab */
async function feedVisible(page) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  return ["最新提问", "推荐", "精选问答", "我的关注"].every((t) => text.includes(t));
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);
  console.log("\n[第 1 步] 现在是首页吗：%s", (await feedVisible(page)) ? "是（正例起点 OK）" : "否");

  console.log("\n[第 2 步] 进「学习中心」→ 切「课程」tab（复现出事的状态）");
  page = await learnCenter.ensureOnColumnList(page);
  page = await learnCenter.switchToTopTab(page, { tab: "课程" });
  await base.sleep(2000);
  const courseText = await base.pageText(await base.foreground(page));
  console.log("  当前页面前 60 字：%s", JSON.stringify(courseText.slice(0, 60)));

  console.log("\n[第 3 步] 在这个状态上执行「回到首页」");
  const t0 = Date.now();
  let err = "";
  try {
    page = await qaPage.ensureOnHomeFeed(page);
  } catch (e) {
    err = e.message;
  }
  const ok = await feedVisible(page);
  console.log("  耗时 %ss；回到首页了吗：%s", ((Date.now() - t0) / 1000).toFixed(1), ok ? "是" : "**没有**");
  if (err) console.log("  过程里报的错：%s", err.split("\n")[0]);

  if (!ok) {
    // 现场取证：点一下底部 tab，把细节打出来，便于定位是"点歪了"还是"页面没切"
    const fg = await base.foreground(page);
    const info = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      for (const el of Array.from(document.querySelectorAll("wx-view, wx-text"))) {
        const t = norm(el.textContent);
        if (t !== "有问必答" && t !== "学习中心" && t !== "设计专区" && t !== "我的") continue;
        const r = el.getBoundingClientRect();
        out.push({ text: t, cls: String(el.getAttribute("class") || "").slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      }
      return out;
    });
    console.log("  页面上「底部 tab 文案」元素：");
    info.forEach((i) => console.log("    %s <%s> 位置=%s", JSON.stringify(i.text), i.cls, JSON.stringify(i.rect)));
    throw new Error(
      "复现成功：停在「学习中心 → 课程」时，「回到首页」没能把页面带回首页信息流。\n" +
        "  这正是那次 22 条全红的根因 —— 一次卡住会把整轮测试带红。"
    );
  }
  console.log("\n✅ 通过：从「学习中心 → 课程」也能回到首页");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "回到首页", title: "从学习中心课程 tab 回首页" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
