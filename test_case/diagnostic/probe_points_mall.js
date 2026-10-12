/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713582097「积分商城增加回到顶部按钮」取证据。
 *
 * 需求原话：「积分商城首页右下角新增『回到顶部』悬浮按钮：滚动超过 1.5 屏后淡入出现，
 * 点击平滑滚动回顶部且按钮隐藏，滚回阈值以内淡出隐藏，内容不足阈值始终不显示」。
 *
 * 要测它，得先知道三件事（本探针就是去问这三件事）：
 *   ① 从哪进积分商城（用户中心里的入口长什么样、点了之后到哪）
 *   ② 按钮到底叫什么（是「回到顶部」还是图标/别的话术）
 *   ③ 滑几次才会出现（我们的「滑动」一次约一屏，要滑几次才越过 1.5 屏阈值）
 *
 * 只读：只切 tab / 点入口 / 滑动 / 读文字，不改任何数据。
 * 运行：node test_case/diagnostic/probe_points_mall.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;
const userCenter = pages.userCenter;

const BTN = "回到顶部";

async function show(page, label, n = 140) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("[%s] 元素=%d 文字开头: %s", label, await base.countOf(fg, "*"), JSON.stringify(text.slice(0, n)));
  return fg;
}

async function probe(page) {
  // ① 用户中心：看有哪些入口
  page = await userCenter.switchTo(page);
  page = await show(page, "用户中心");

  // ② 点「积分商城」进积分商城首页
  const hasEntry = (await base.countOfText(page, "积分商城")) > 0;
  console.log("用户中心里有「积分商城」入口吗：%s", hasEntry ? "有" : "无");
  if (hasEntry) {
    await base.tapText(page, "积分商城", "入口「积分商城」");
    await base.sleep(2500);
    page = await show(page, "积分商城首页(未滚动)");
    console.log("未滚动时「%s」出现吗：%s", BTN, (await base.countOfText(page, BTN)) > 0 ? "有" : "无");
  }

  // ③ 一次一次往上滑，看按钮第几次出现（顺带记录每次是否滑动了）
  for (let i = 1; i <= 4; i++) {
    try {
      const { swipeUp } = require("../../app_sub_function/suprecast_app/android");
      page = await swipeUp(page);
    } catch (e) {
      console.log("第 %d 次滑动没成功：%s", i, e.message.split("\n")[0]);
      break;
    }
    const fg = await show(page, "滑动 " + i + " 次后", 90);
    const shown = (await base.countOfText(fg, BTN)) > 0;
    console.log("  -> 第 %d 次滑动后「%s」%s", i, BTN, shown ? "出现了" : "还没出现");
    if (shown) break;
  }

  // ④ 如果出现了，点它，看是否回顶部且按钮消失
  const fg = await base.foreground(page);
  if ((await base.countOfText(fg, BTN)) > 0) {
    await base.tapText(fg, BTN, "回到顶部按钮");
    await base.sleep(2000);
    const after = await show(page, "点击回到顶部之后", 90);
    console.log("点击后「%s」还在吗：%s", BTN, (await base.countOfText(after, BTN)) > 0 ? "还在" : "已隐藏");
  } else {
    console.log("滑了 4 次都没看到「%s」—— 要么文案不是这个，要么阈值没越过", BTN);
  }

  // 收尾：回首页
  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "积分商城", title: "回到顶部按钮的存在与出现时机" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
