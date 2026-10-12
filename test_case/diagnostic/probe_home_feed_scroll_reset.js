/*
 * 诊断（不以 test_ 开头，pytest 不收集）：验证「回到首页」会不会把信息流滚回顶部。
 *
 * 背景（2026/10/12）：实测发现「回到首页」只把筛选 tab 归位、**滚动位置留着** ——
 * 于是下一条用例的起点其实不在顶部（搜索栏被滚出屏幕；「打开第一个帖子」会点到别的帖子）。
 * 这是"上游用例留下的痕迹"型偶发红，最难查，所以专门钉一个探针。
 *
 * 做法（正反两面）：
 *   1. 先「回到首页」，读搜索栏位置 —— 应当 ≥ 0（在屏幕内）
 *   2. 往上滑两屏，再读 —— 应当变负（已被滚走，证明"滑得动"）
 *   3. 再「回到首页」，再读 —— 应当回到 ≥ 0（**这就是这次修的东西**）
 *
 * 只读：只滑动 + 读坐标，不点击。
 * 运行：node test_case/diagnostic/probe_home_feed_scroll_reset.js
 */

const { appTest } = require("../../common/app_common");
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

async function searchBarY(page) {
  const fg = await base.foreground(page);
  const y = await fg
    .evaluate(() => {
      const el = document.querySelector(".search-container");
      return el ? Math.round(el.getBoundingClientRect().y) : null;
    })
    .catch(() => null);
  return y;
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);
  const y1 = await searchBarY(page);
  console.log("\n[第 1 步] 回到首页后，搜索栏 y = %s（应当 ≥ 0）", y1);

  for (let i = 0; i < 2; i++) {
    page = await android.swipeUp(page);
    await base.sleep(800);
  }
  const y2 = await searchBarY(page);
  console.log("[第 2 步] 往上滑两屏后，搜索栏 y = %s（应当 < 0，说明确实滚动了）", y2);

  page = await qaPage.ensureOnHomeFeed(page);
  const y3 = await searchBarY(page);
  console.log("[第 3 步] 再回到首页后，搜索栏 y = %s（应当 ≥ 0 —— 这就是这次修的东西）", y3);

  if (y2 !== null && y2 >= 0) {
    throw new Error("这一步没滑动（y 还是正的），后面的结论不成立 —— 先查滑动为什么没生效");
  }
  if (y3 === null || y3 < 0) {
    throw new Error(
      `「回到首页」没有把信息流滚回顶部：搜索栏 y = ${y3}（期望 ≥ 0）。\n` +
        `  这样下一条用例的起点就不在顶部 —— 搜索栏点不到、「打开第一个帖子」也会点到别的帖子。`
    );
  }
  console.log("\n✅ 通过：回到首页会把信息流滚回顶部（起点摆正）");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "回到首页", title: "回到首页是否把信息流滚回顶部" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
