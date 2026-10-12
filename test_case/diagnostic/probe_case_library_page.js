/*
 * 诊断（不以 test_ 开头，pytest 不收集）：案例库列表页（设计专区 → 仿真案例库）的结构。
 *
 * 背景（2026/10/12）：案例库需求 713381608 卡了很久的"入口找不到"，这次找到了 ——
 *   底部 tab「设计专区」打开就是**仿真案例库**列表（上面还有一排 tab：仿真案例库 / 压铸护航服务）。
 *   本探针把这一页的 DOM 结构打清楚，好写页面对象与断言（不凭猜测写选择器）。
 *
 * 重点看三样（都来自需求原文）：
 *   1. 分类上方有没有**介绍 banner**（需求：案例库列表在分类上方展示介绍 banner）
 *   2. 案例卡片右下角是不是**复制图标 + 复制数**（需求：由评论图标+评论数改为复制图标+复制数）
 *   3. 卡片的类名/结构长什么样（写选择器用）
 *
 * 只读：只导航 + 读 DOM。
 * 运行：node test_case/diagnostic/probe_case_library_page.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;

async function probe(page) {
  page = await base.ensureOnTabPage(page);
  await base.tapText(page, "设计专区", "底部 tab「设计专区」");
  await base.sleep(3500);

  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n=== 整页文字（前 500 字）===");
  console.log(text.slice(0, 500));

  const info = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    const desc = (el) => {
      const cls = String((el.getAttribute && el.getAttribute("class")) || "").split(/\s+/).slice(0, 3).join(".");
      return el.tagName.toLowerCase() + (cls ? "." + cls : "");
    };

    // 1) 大图（介绍 banner 会是其中之一：宽、靠上、比例扁）
    const images = [];
    for (const el of Array.from(document.querySelectorAll("wx-image"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 50) continue;
      images.push({ cls: desc(el), rect: box(el), ratio: Number((r.width / r.height).toFixed(2)) });
    }

    // 2) 案例卡片：class 里带 case 的元素，各自含几个「复制数」样式的文本
    const cards = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (!/case/i.test(c)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) continue;
      cards.push({ cls: c.slice(0, 80), rect: box(el), text: norm(el.innerText).slice(0, 40) });
      if (cards.length >= 10) break;
    }

    // 3) 页面里 class 带 case 的所有类名（去重），便于挑选择器
    const classNames = new Set();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (/case/i.test(c)) c.split(/\s+/).forEach((x) => classNames.add(x));
    }

    return { images, cards, classNames: Array.from(classNames).slice(0, 40) };
  });

  console.log("\n=== 页面上的大图（>=100x50）===");
  info.images.forEach((im) => console.log("  %s 位置=%s 比例=%s", im.cls, JSON.stringify(im.rect), im.ratio));

  console.log("\n=== class 里带 case 的元素（前 10 个）===");
  info.cards.forEach((c) => console.log("  %s 位置=%s 文字=%s", c.cls, JSON.stringify(c.rect), JSON.stringify(c.text)));

  console.log("\n=== 带 case 的类名（去重）===");
  console.log("  " + info.classNames.join("  "));

  // 4) 卡片右下角那处到底长什么样（"复制数"的判据要靠它）+ 有没有"评论"图标
  const detail = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const stats = document.querySelector(".case-list-card-stats");
    const banner = document.querySelector(".cases-top-banner");
    const catRow = document.querySelector(".cases-category-row");
    const commentish = [];
    const copyish = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (/comment/i.test(c)) commentish.push(c.slice(0, 60));
      if (/copy/i.test(c)) copyish.push(c.slice(0, 60));
    }
    return {
      statsHtml: stats ? String(stats.outerHTML).slice(0, 400) : "(找不到 .case-list-card-stats)",
      statsText: stats ? norm(stats.innerText) : "",
      bannerY: banner ? Math.round(banner.getBoundingClientRect().y) : null,
      categoryY: catRow ? Math.round(catRow.getBoundingClientRect().y) : null,
      commentClasses: Array.from(new Set(commentish)).slice(0, 8),
      copyClasses: Array.from(new Set(copyish)).slice(0, 8),
    };
  });
  console.log("\n=== 卡片右下角（.case-list-card-stats）===");
  console.log("  文字: %s", JSON.stringify(detail.statsText));
  console.log("  HTML: %s", detail.statsHtml);
  console.log("\n=== 几何关系（介绍 banner 必须在分类上方）===");
  console.log("  介绍 banner 的 y = %s，分类行的 y = %s", detail.bannerY, detail.categoryY);
  console.log("\n=== 页面里带 comment / copy 的类名 ===");
  console.log("  comment: %s", JSON.stringify(detail.commentClasses));
  console.log("  copy: %s", JSON.stringify(detail.copyClasses));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "案例库列表页结构" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
