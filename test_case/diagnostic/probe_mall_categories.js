/*
 * 诊断（只读）：积分商城首页现在长什么样 —— 分类 tab 有哪些、当前能看到的礼品名字。
 *
 * 用途：给缺陷 713396918「屏蔽某一分类后，全部分类下不应显示该分类的礼品」挑一个
 * **现在确实可见**的礼品当夹具（不然"不显示"的断言会天然成立，等于没测）。
 *
 * 运行：node test_case/diagnostic/probe_mall_categories.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const mall = pages.pointsMall;

async function probe(page) {
  page = await mall.ensureOn(page);
  const fg = await base.foreground(page);
  const info = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const text = norm(document.body.innerText);
    const shortTexts = [];
    document.querySelectorAll("wx-text, wx-view").forEach((el) => {
      const t = norm(el.innerText);
      if (t && t.length <= 12 && el.children.length === 0) shortTexts.push(t);
    });
    return { text: text.slice(0, 700), shortTexts: Array.from(new Set(shortTexts)).slice(0, 40) };
  });
  console.log("\n=== 积分商城首页文字（前 700 字）===");
  console.log(info.text);
  console.log("\n=== 页面上的短文本（去重，前 40 个）===");
  console.log(JSON.stringify(info.shortTexts));
  return page;
}

appTest([[probe, null]], { photosPath: null }).catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
