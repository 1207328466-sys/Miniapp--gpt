/*
 * 小工具（故意不以 test_ 开头，pytest 不会收集）
 *
 * 用途：把首页的筛选 tab 切到指定的那一个，并在切换前后各打印一次状态。
 * 什么时候用：
 *   - 手工准备现场（"先让手机停在「我的关注」，再看用例能不能归位"）
 *   - 验收「回到首页」有没有把 tab 归位
 *   - 判据改了之后快速看一眼现在的实际值
 *
 * 运行：
 *   node test_case/diagnostic/set_feed_tab.js 我的关注     # 切过去
 *   node test_case/diagnostic/set_feed_tab.js              # 不带参数 = 只打印当前选中的
 *
 * 只读性说明：切筛选 tab 不改任何数据（和「检查活动入口」那条用例一样的操作）。
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const qaPage = pages.qaPage;
const target = process.argv[2] || "";

async function reportState(page, label) {
  const info = await qaPage.readFeedTabs(page);
  console.log(`\n[${label}] 当前选中 = ${JSON.stringify(info.selected || "（认不出来）")}`);
  if (!info.found) {
    console.log("  找不到 tab 栏 —— 手机现在多半不在首页信息流上");
    return page;
  }
  for (const r of info.tabs) {
    console.log(
      r.found
        ? `    ${r.tab}: alpha=${r.alpha}, weight=${r.weight}${r.selected ? "   <- 选中" : ""}`
        : `    ${r.tab}: 找不到`
    );
  }
  return page;
}

async function goHome(page) {
  return qaPage.ensureOnHomeFeed(page);
}

async function switchToTarget(page) {
  return qaPage.switchToFeedTab(page, { tab: target, timeout: 10000 });
}

(async () => {
  if (target && !qaPage.FEED_TABS.includes(target)) {
    console.log(`「${target}」不是首页的筛选 tab。可用的只有这四个：${qaPage.FEED_TABS.join(" / ")}`);
    process.exit(2);
  }

  const funcList = [[goHome, null], [reportState, "切换前"]];
  if (target) funcList.push([switchToTarget, null], [reportState, "切换后"]);

  await appTest(funcList, {
    meta: {
      feature: "诊断",
      story: "首页筛选 tab",
      title: target ? `把首页筛选 tab 切到「${target}」` : "打印当前选中的筛选 tab",
    },
  });
})().catch((e) => {
  console.error("\n失败: " + e.message);
  process.exit(1);
});
