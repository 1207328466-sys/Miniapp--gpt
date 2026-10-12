/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713582097 的「回到顶部」按钮**到底长什么样**。
 *
 * 上一轮探针的结论：积分商城能进（用户中心 ->「积分商城」），但滑到底也没找到文案「回到顶部」。
 * 所以这次不再按文案找，而是**按结构找**：
 *   A) 文字/属性/class 里带「顶」「回」「top」「back」的元素
 *   B) 右下角的悬浮元素（position=fixed/absolute + 小尺寸 + 落在屏幕右下角那块）
 * 两者都打印 class / 文本 / 位置尺寸 —— 有候选就能据此写选择器。
 *
 * 只读：只滑动 + 读 DOM，不点任何按钮。
 * 运行：node test_case/diagnostic/probe_mall_top_button.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;
const userCenter = pages.userCenter;

async function scan(page, label) {
  const fg = await base.foreground(page);
  const out = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const all = Array.from(document.querySelectorAll("*"));
    const kw = /顶|回|top|back/i;
    const byKeyword = [];
    const byPosition = [];
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    for (const el of all) {
      const text = norm(el.innerText).slice(0, 20);
      const cls = String(el.getAttribute("class") || "");
      const aria = String(el.getAttribute("aria-label") || el.getAttribute("title") || "");
      if ((text && kw.test(text)) || kw.test(cls) || aria) {
        if (byKeyword.length < 12) byKeyword.push({ tag: el.tagName.toLowerCase(), cls, text, aria });
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const floating = (cs.position === "fixed" || cs.position === "absolute") && r.width > 8 && r.height > 8;
      const bottomRight = r.left > vw * 0.6 && r.top > vh * 0.5;
      if (floating && bottomRight && r.width < 200 && r.height < 200 && byPosition.length < 12) {
        byPosition.push({
          tag: el.tagName.toLowerCase(),
          cls,
          text,
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        });
      }
    }
    return { vw, vh, byKeyword, byPosition };
  });
  console.log("\n[%s] 视口 %dx%d", label, out.vw, out.vh);
  console.log("  A) 文字/属性带关键词的：");
  out.byKeyword.forEach((r) => console.log("     <%s class=%s> text=%s aria=%s", r.tag, r.cls, JSON.stringify(r.text), JSON.stringify(r.aria)));
  console.log("  B) 右下角悬浮元素：");
  if (!out.byPosition.length) console.log("     （没有）");
  out.byPosition.forEach((r) =>
    console.log("     <%s class=%s> text=%s rect=%s", r.tag, r.cls, JSON.stringify(r.text), JSON.stringify(r.rect))
  );
  return fg;
}

async function probe(page) {
  page = await userCenter.switchTo(page);
  await base.tapText(page, "积分商城", "入口「积分商城」");
  await base.sleep(2500);
  page = await base.foreground(page);
  await scan(page, "商城首页·未滚动");

  const { swipeUp } = require("../../app_sub_function/suprecast_app/android");
  for (let i = 1; i <= 3; i++) {
    try {
      page = await swipeUp(page);
    } catch (e) {
      console.log("第 %d 次滑动失败（多半到底了）：%s", i, e.message.split("\n")[0]);
      break;
    }
  }
  await scan(page, "商城首页·滑到底");

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "积分商城", title: "按结构找「回到顶部」按钮" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
