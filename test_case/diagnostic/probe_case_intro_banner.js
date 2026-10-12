/*
 * 诊断（不以 test_ 开头，pytest 不收集）：点案例库首页那张介绍 banner，会落到哪一页？
 *
 * 需求 713381608 原文（owner 2026/10/12 澄清：「首页 banner」指**设计中心（案例库）的首页**）：
 *   「案例库列表在分类上方展示介绍 banner，**点击后进入介绍长图详情页**」
 *   「首页 banner 图，为单张图片，点击后跳转到案例库模块介绍长图页面」
 *
 * 本探针就干三件事：
 *   1. 打开案例库，读介绍 banner（cases-top-banner）的位置
 *   2. 点它，看落到哪一页（把新页面的文字 / 根容器 / 大图打出来）
 *   3. 退回来（这个探针自己把手机交还）
 *
 * 只读：只导航 + 读 DOM，不复制、不点赞。
 * 运行：node test_case/diagnostic/probe_case_intro_banner.js
 */

const { appTest } = require("../../common/app_common");
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

async function probe(page) {
  page = await caseLibrary.ensureOn(page);
  const fg = await base.foreground(page);

  const banner = await fg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], cls: el.getAttribute("class") };
  }, caseLibrary.SEL.topBanner);
  console.log("\n介绍 banner：%s", JSON.stringify(banner));
  if (!banner) throw new Error(`案例库首页上找不到介绍 banner（${caseLibrary.SEL.topBanner}）`);

  const before = await base.pageText(fg);
  await base.tapSelector(fg, caseLibrary.SEL.topBanner, "案例库首页的介绍 banner");
  await base.sleep(4000);

  const after = await base.foreground(page);
  const text = await base.pageText(after);
  console.log("\n=== 点 banner 之后的页面（前 300 字）===");
  console.log(text.slice(0, 300));
  console.log("\n页面变了吗：%s", text !== before ? "变了" : "**没变（点了没反应）**");

  const info = await after.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const rootCls = [];
    for (const el of Array.from(document.querySelectorAll("wx-view, div"))) {
      const c = String(el.getAttribute("class") || "");
      if (/intro|banner|poster|long|image|detail|case/i.test(c)) rootCls.push(c.slice(0, 70));
      if (rootCls.length >= 30) break;
    }
    const imgs = [];
    for (const el of Array.from(document.querySelectorAll("wx-image"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) continue;
      imgs.push({ cls: String(el.getAttribute("class") || "").slice(0, 40), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    }
    return { rootCls: Array.from(new Set(rootCls)).slice(0, 20), imgs, textLen: norm(document.body.innerText).length };
  });
  console.log("\n=== 候选类名（含 intro/banner/image/…）===");
  console.log("  " + info.rootCls.join("  "));
  console.log("\n=== 这页上的大图（>=100x100）===");
  info.imgs.forEach((i) => console.log("  <%s> 位置=%s", i.cls, JSON.stringify(i.rect)));
  console.log("\n页面文字长度：%s 字（长图页通常几乎没文字）", info.textLen);

  // 交还：退回到案例库，再回首页
  page = await android.goBack(after);
  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "点介绍 banner 落到哪一页" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
