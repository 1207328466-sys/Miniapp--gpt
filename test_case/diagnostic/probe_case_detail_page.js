/*
 * 诊断（不以 test_ 开头，pytest 不收集）：案例详情页长什么样？
 *
 * 需求 713381608 里跟详情页有关的三条（都是只读就能验的）：
 *   ① 「案例详情页取消显示底部的**复制数图标、评论数图标**」
 *   ② 「评论区标题『**全部回答**』改为『**全部评论**』」
 *   ③ 「案例详情分享时，缩略图采用案例封面图，标题采用案例名称」（分享走系统 UI，测不了）
 *
 * 本探针：从案例库列表点进第一张卡片，把这页的 DOM 结构打清楚（根容器 / 评论区标题 / 底部图标），
 * 顺带看看**要不要登录才能看**（需求里提到「使用手机号登录智铸超云，即可查看案例详情」）。
 *
 * 只读：只导航 + 读 DOM，不点赞、不评论、不复制。
 * 运行：node test_case/diagnostic/probe_case_detail_page.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

async function probe(page) {
  page = await caseLibrary.ensureOn(page);
  const list = await caseLibrary.readList(page);
  console.log("\n列表里第一张卡片：%s", JSON.stringify(list[0] || null));

  const fg = await base.foreground(page);
  const cards = fg.locator(caseLibrary.SEL.card).first();
  await base.tapLocator(fg, cards, `第一张案例卡片「${list[0] ? list[0].title : "?"}」`);
  await base.sleep(4000);

  const after = await base.foreground(page);
  const text = await base.pageText(after);
  console.log("\n=== 点开之后的页面前 400 字 ===");
  console.log(text.slice(0, 400));
  console.log("\n含「全部评论」：%s ｜ 含「全部回答」：%s", text.includes("全部评论") ? "有" : "无", text.includes("全部回答") ? "有" : "无");
  console.log("含「登录」：%s ｜ 含「复制成功」：%s", text.includes("登录") ? "有" : "无", text.includes("复制成功") ? "有" : "无");

  const info = await after.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    // 所有类名里带 case / comment / detail 的元素（挑选择器用）
    const classes = new Set();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (/case|comment|detail|copy|fuzhi|share|pinglun/i.test(c)) c.split(/\s+/).forEach((x) => classes.add(x));
    }
    // 固定定位的元素（底部操作条若存在，通常 position:fixed + 贴底）—— 需求说"取消底部的复制数/评论数图标"
    const fixed = [];
    for (const el of Array.from(document.querySelectorAll("wx-view, wx-text, div"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 10 || r.width < 10) continue;
      fixed.push({
        pos: cs.position,
        cls: String(el.getAttribute("class") || "").slice(0, 60),
        rect: box(el),
        text: norm(el.innerText).slice(0, 30),
      });
    }
    // 底部区域（页面下缘 20%）里有什么 —— 需求说"取消底部的复制数/评论数图标"
    const vh = window.innerHeight;
    const bottom = [];
    for (const el of Array.from(document.querySelectorAll("wx-view, wx-text, div"))) {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.82 || r.height < 10 || r.width < 10) continue;
      bottom.push({ cls: String(el.getAttribute("class") || "").slice(0, 60), rect: box(el), text: norm(el.innerText).slice(0, 20) });
      if (bottom.length >= 14) break;
    }
    // 页面上所有"图标"（class 里带 icon）：看详情页还有没有复制/评论类图标
    const icons = [];
    for (const el of Array.from(document.querySelectorAll("wx-text, wx-view, image"))) {
      const c = String(el.getAttribute("class") || "");
      if (!/icon/i.test(c)) continue;
      icons.push({ cls: c.slice(0, 70), rect: box(el) });
      if (icons.length >= 20) break;
    }
    return { classes: Array.from(classes).slice(0, 50), bottom, fixed, icons };
  });

  console.log("\n=== 页面里带 case/comment/copy/… 的类名（去重）===");
  console.log("  " + info.classes.join("  "));
  console.log("\n=== 屏幕下缘 20% 里的元素（找「底部的复制数/评论数图标」）===");
  info.bottom.forEach((b) => console.log("  <%s> 位置=%s 文字=%s", b.cls, JSON.stringify(b.rect), JSON.stringify(b.text)));

  console.log("\n=== 固定/吸顶定位的元素（底部操作条会在这里）===");
  if (!info.fixed.length) console.log("  （没有）");
  info.fixed.forEach((f) => console.log("  [%s] <%s> 位置=%s 文字=%s", f.pos, f.cls, JSON.stringify(f.rect), JSON.stringify(f.text)));

  console.log("\n=== 页面里的图标（class 带 icon）===");
  if (!info.icons.length) console.log("  （没有）");
  info.icons.forEach((i) => console.log("  <%s> 位置=%s", i.cls, JSON.stringify(i.rect)));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "案例详情页结构" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
