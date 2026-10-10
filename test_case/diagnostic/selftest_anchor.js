/*
 * 自检（**需要手机**）：验证"跨页找"真的不依赖"猜前台页"。
 *
 * 做法：故意拿一个**过期的页面对象**（首页那一页）去问"搜索页在哪"、
 * 拿搜索页的对象去问"首页信息流在哪" —— 如果还能找对，就说明这一路判断
 * 不再依赖"哪个页在前台"这个猜测（坑 19 反复出问题的地方）。
 *
 * 运行：node test_case/diagnostic/selftest_anchor.js
 * 退出码：0 = 全对；1 = 有不对的
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

let failed = 0;

async function step1回首页并记住它(page) {
  page = await qa.ensureOnHomeFeed(page);
  const fg = await base.foreground(page);
  step1回首页并记住它.homePage = fg; // 记下"首页那一页的对象"
  console.log(`① 已回到首页信息流（元素数=${await base.countOf(fg, "*")}）`);
  return fg;
}

async function step2打开搜索页(page) {
  const search = await qa.openSearch(page);
  step2打开搜索页.searchPage = search;
  console.log(`② 已打开搜索页（元素数=${await base.countOf(search, "*")}）`);
  return search;
}

async function step3用过期的首页对象找搜索页() {
  const stale = step1回首页并记住它.homePage; // 这是"已经过期"的首页对象
  const found = await qa.findSearchPage(stale);
  const ok = found === step2打开搜索页.searchPage;
  console.log(
    `${ok ? "OK  " : "FAIL"} ③ 拿过期的首页对象找搜索页：${found ? "找到了" : "没找到"}（元素数=${found ? await base.countOf(found, "*") : "-"}）`
  );
  if (!ok) failed += 1;
  return step2打开搜索页.searchPage;
}

async function step4用搜索页对象找首页() {
  const search = step2打开搜索页.searchPage;
  const found = await qa.findHomeFeedPage(search); // 反过来问
  const text = found ? (await base.pageText(found)).slice(0, 30) : "";
  const ok = Boolean(found) && text.includes("最新提问");
  console.log(
    `${ok ? "OK  " : "FAIL"} ④ 拿搜索页对象找首页信息流：${found ? `找到了（"${text}"）` : "没找到"}`
  );
  if (!ok) failed += 1;
  return search;
}

async function step5收尾(page) {
  await qa.ensureOnHomeFeed(page);
  console.log(`\n结论：${failed ? `有 ${failed} 项不对` : "跨页查找双向都正确，不依赖前台页猜测"}`);
  if (failed) throw new Error("跨页查找自检未通过");
  return page;
}

(async () => {
  await appTest(
    [
      [step1回首页并记住它, null],
      [step2打开搜索页, null],
      [step3用过期的首页对象找搜索页, null],
      [step4用搜索页对象找首页, null],
      [step5收尾, null],
    ],
    { meta: { feature: "诊断", story: "跨页查找", title: "用过期页面对象验证跨页查找" } }
  );
})().catch((e) => {
  console.error("\n自检失败: " + e.message);
  process.exit(1);
});
