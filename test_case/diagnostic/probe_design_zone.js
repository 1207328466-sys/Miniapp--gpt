/*
 * 诊断（不以 test_ 开头，pytest 不收集）：底部「设计专区」里有什么？案例库会不会在这儿？
 *
 * 背景：案例库需求（713381608）一直卡在"找不到入口"。
 *   已排除：首页信息流那张图是**测试账号的帖子**；用户中心的「仿真案例」是收藏的类型筛选；
 *   首页 banner 的跳转类型只有三种（不含案例库）。
 *   底部四个 tab 里，「设计专区」还没正经看过 —— 这次用页面对象按**文字**点（不是估坐标，
 *   上一次估坐标点到了帖子详情页）。
 *
 * 做法：回首页 -> 点底部 tab「设计专区」-> 打印整页文字（找「案例」字样）+ 截图。
 * 只读：只导航 + 读页面文字。
 * 运行：node test_case/diagnostic/probe_design_zone.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);
  page = await base.ensureOnTabPage(page);

  await base.tapText(page, "设计专区", "底部 tab「设计专区」");
  await base.sleep(3500);

  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n=== 设计专区：当前页面前 400 字 ===");
  console.log(text.slice(0, 400));
  console.log("\n含「案例」吗：%s", text.includes("案例") ? "有" : "无");
  console.log("含「仿真」吗：%s", text.includes("仿真") ? "有" : "无");

  page = await qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "设计专区", title: "设计专区里有没有案例库入口" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
