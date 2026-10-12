/*
 * 诊断（不以 test_ 开头，pytest 不收集）：首页 4 个筛选 tab 下，「活动卡」是
 * **偶发渲染慢** 还是 **真的没有**。
 *
 * 【为什么要它】坑 17 复核后留下的唯一没被否证的可能：切到「推荐」时读到 0 张卡。
 * 当时的 `waitAfterTab` 是 2500ms —— 如果只是"还没来得及渲染"，那是框架该多等一会儿；
 * 如果一直数不到，那就是**产品问题**（需求 713594979 要求 4 个 tab 下都显示）。
 * 两者的区别只有"看时间序列"才能分辨：全 0 = 真的没有；先 0 后 1 = 只是慢。
 *
 * 做法：逐个 tab —— 点它 → 立刻连续数 10 次活动卡（每 600ms 一次，共约 6 秒）→ 打印序列。
 * 同时打印"这一页当前选中的筛选 tab"（用 activeFeedTab），好区分
 * "tab 没切过去"和"切过去了但没卡"。
 *
 * 只读：只切 tab + 数元素，不点卡片、不改任何数据。
 * 运行：node test_case/diagnostic/probe_feed_cards.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

const ROUNDS = 10; // 每个 tab 数这么多次
const GAP_MS = 600; // 每次之间等多久

/** 数一张页面上的活动卡（只读） */
async function countCards(page) {
  const cards = await base.countOf(page, qa.SEL.activityCard);
  const swiper = await base.countOf(page, qa.SEL.activitySwiper);
  return { cards, swiper };
}

async function probeAllTabs(page) {
  // 自己先回到首页信息流（可重复运行），再把每个 tab 走一遍
  page = await qa.ensureOnHomeFeed(page);
  base.foreground = base.foreground; // 保持引用（无操作，只为可读性）

  console.log("每个 tab：点它 -> 立刻连续数 %d 次活动卡（间隔 %dms）" % [ROUNDS, GAP_MS]);
  for (const tab of qa.FEED_TABS) {
    page = (await qa.findHomeFeedPage(page)) || page;
    const before = await qa.activeFeedTab(page);
    await base.tapText(page, tab, "筛选 tab「" + tab + "」");

    const series = [];
    let selected = "";
    for (let i = 1; i <= ROUNDS; i++) {
      await new Promise((r) => setTimeout(r, GAP_MS));
      const c = await countCards(page);
      series.push(c.cards === 0 ? "0" : c.cards + (c.swiper > 0 ? "s" : ""));
      if (i === ROUNDS) selected = await qa.activeFeedTab(page);
    }
    const numbers = series.map((s) => String(s).replace("s", ""));
    const everSeen = numbers.some((n) => n !== "0");
    console.log(
      "  [" +
        tab +
        "] 切换前选中=" +
        JSON.stringify(before) +
        " / 数完时选中=" +
        JSON.stringify(selected) +
        " 序列=" +
        series.join(",") +
        "  -> " +
        (everSeen ? "出现过卡（只是快慢问题）" : "全程 0 张（真的没有）")
    );
  }

  // 收尾：把 tab 交还给默认值 + 回到首页
  await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probeAllTabs, null]], {
    meta: { feature: "诊断", story: "首页活动卡", title: "各筛选 tab 下活动卡的时间序列" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
