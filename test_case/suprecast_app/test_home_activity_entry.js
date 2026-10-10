/*
 * @project_name: UITest
 * @cur_file: test_home_activity_entry.js
 * @create_date: 2026/10/10
 *
 * 用例：首页活动入口（活动卡）在内容流的每个筛选 tab 下都显示
 *
 * 需求口径（**713594979「小程序-有问必答首页增加活动入口」**）：
 *   「在最新/推荐/精选/我的关注下都显示」
 *
 * 【只读】本用例只切筛选 tab + 数活动卡，**不点活动卡、不改任何数据**，
 * 可以随时反复跑。起始页不限（步骤 1 自导航到首页）。
 *
 * 期望失败时的信息：会列出每个 tab 实测的活动卡数，
 * 便于区分"某个 tab 不显示"和"整块都没了（当前无进行中活动）"。
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  assertSelectorCount,
} = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const qaPage = pages.qaPage;
const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

(async () => {
  const funcList = [
    // 步骤 1：自导航到首页（有问必答），幂等
    [qaPage.ensureOn, null],

    // 断言：确实在首页 —— 判据是搜索栏，它只出现在这一页
    [assertSelectorCount, { selector: qaPage.SEL.searchBar, expected: 1 }],

    // 步骤 2：逐个筛选 tab 切过去，断言活动入口都在（需求 713594979）
    [qaPage.assertActivityBlockInAllFeedTabs, null],
  ];

  await appTest(funcList, {
    photosPath,
    meta: {
      feature: "有问必答首页",
      story: "活动入口",
      title: "活动卡在各筛选 tab 下都显示",
    },
  });

  console.log("\n" + "=".repeat(60));
  console.log("test_home_activity_entry.js 执行完成（全部步骤通过）");
  console.log("=".repeat(60));
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
