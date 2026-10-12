/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**搜索页压在上面时，「回到首页」会不会假装成功？**
 *
 * 背景（2026/10/12 踩到）：手机上还停在搜索页时，`回到首页` 报了成功（日志里
 * 「已到达有问必答页 / 已选中筛选 tab」），可屏幕上明明还是搜索页 ——
 * 因为"找首页信息流"是**跨页查找**的，它在**被盖住的**那个首页页里找到了筛选 tab。
 * 紧接着点底部 tab 就失败，而报错看着像"导航坏了"（其实是上一步没把页面带回前台）。
 *
 * 做法（正反两面）：
 *   1. 先确认现在能回首页（正例）
 *   2. 主动打开搜索页，把手机**停在搜索页**上
 *   3. 调「回到首页」—— 断言：回来之后**前台页**确实是首页信息流（能读到四个筛选 tab）
 *
 * 只读：只导航 + 读 DOM。
 * 运行：node test_case/diagnostic/probe_home_feed_foreground.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

/** 前台页上能不能读到首页那四个筛选 tab（= 屏幕上真的显示着信息流） */
async function feedVisibleOnForeground(page) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  return ["最新提问", "推荐", "精选问答", "我的关注"].every((t) => text.includes(t));
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);
  console.log(
    "\n[第 1 步] 回首页后，前台能看到四个筛选 tab 吗：%s",
    (await feedVisibleOnForeground(page)) ? "能" : "不能"
  );

  console.log("\n[第 2 步] 主动打开搜索页，把手机停在搜索页上");
  page = await qaPage.openSearch(page);
  const beforeText = await base.pageText(await base.foreground(page));
  console.log("  现在的前台页文字开头：%s", JSON.stringify(beforeText.slice(0, 40)));
  if (!beforeText.includes("搜索历史") && !beforeText.includes("热门话题")) {
    const e = new Error("没能把手机停在搜索页（前置条件不满足），这一步测不了");
    e.preconditionNotMet = true;
    throw e;
  }

  console.log("\n[第 3 步] 停在搜索页上执行「回到首页」");
  page = await qaPage.ensureOnHomeFeed(page);
  const ok = await feedVisibleOnForeground(page);
  const afterText = await base.pageText(await base.foreground(page));
  console.log("  回来之后前台页文字开头：%s", JSON.stringify(afterText.slice(0, 60)));
  if (!ok) {
    throw new Error(
      "「回到首页」报了成功，但**屏幕上显示的不是首页信息流**（前台页读不到四个筛选 tab）。\n" +
        "  这就是「假成功」：下一步（点底部 tab）会失败，而报错会指向错的地方。"
    );
  }
  console.log("\n✅ 通过：回到首页之后，屏幕上确实是首页信息流");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "回到首页", title: "搜索页压在上面时回到首页会不会假成功" },
  });
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
