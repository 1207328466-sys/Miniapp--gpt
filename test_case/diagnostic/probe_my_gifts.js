/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713628867「积分兑换记录和活动礼品记录整合」取证据。
 *
 * 需求原话（摘要）：
 *   「入口页面：积分商城页面的【我的礼品】（原兑换记录名称改为我的礼品）」
 *   「状态：在全部和待使用之间新增一个状态『待兑换』」
 *   「来源：在状态行下方增加来源筛选，分为『全部来源』（默认）、『积分兑换』、『活动礼品』」
 *   「礼品卡片左上角增加来源标签（积分兑换/活动礼品）」
 *
 * 要去问三件事：① 商城页上那个入口现在叫什么（「我的礼品」还是老的「兑换记录」）
 * ② 进去之后有哪些状态词、来源筛选词 ③ 页面上都有哪些文字
 *
 * 只读：只点入口 + 读文字，不改任何数据。
 * 运行：node test_case/diagnostic/probe_my_gifts.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;
const mall = pages.pointsMall;

const WORDS = ["我的礼品", "兑换记录", "待兑换", "待使用", "全部来源", "积分兑换", "活动礼品"];

/** 打印某一页上这些关键词在不在（只读） */
async function dumpWords(fg, label, limit = 200) {
  const text = await base.pageText(fg);
  console.log("\n[%s] 元素=%d", label, await base.countOf(fg, "*"));
  WORDS.forEach((w) => console.log("   %s: %s", w, text.includes(w) ? "有" : "无"));
  console.log("   文字开头: %s", JSON.stringify(text.slice(0, limit)));
  return text;
}

async function probe(page) {
  page = await mall.ensureOn(page);
  const fg0 = await base.foreground(page);
  const text0 = await dumpWords(fg0, "积分商城首页");

  const entry = ["我的礼品", "兑换记录"].find((w) => text0.includes(w));
  console.log("\n入口文案用的是：%s", entry || "（两个都没找到）");
  if (!entry) {
    page = await qa.ensureOnHomeFeed(page);
    return page;
  }

  await base.tapText(fg0, entry, "入口「" + entry + "」");
  await base.sleep(2500);
  await dumpWords(await base.foreground(page), "点「" + entry + "」之后", 260);

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "积分商城", title: "「我的礼品」入口与状态/来源筛选" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
