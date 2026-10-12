/*
 * 诊断（不以 test_ 开头，pytest 不收集）：首页那张「教你玩转 仿真案例库」banner 到底是个什么元素。
 *
 * 背景（真机截图已确认，2026/10/12）：它就长在**首页信息流左列**里，是一张**图片卡**
 * —— 图上的「教你玩转 / 仿真案例库」是**印在图里的字**，DOM 的 innerText 读不到，
 * 这就是之前按文字找、连续采样都"没有"的原因。
 *
 * 本探针：停在首页 -> 把信息流里所有图片元素（img / 背景图）的地址、位置、尺寸、外层 class 列出来，
 *          再顺带把"卡片文字 + 图片"的配对打出来，便于认清哪一块是 banner。
 * 只读：只读 DOM，不点击、不滑动。
 * 运行：node test_case/diagnostic/probe_case_banner_img.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

async function probe(page) {
  page = await qa.ensureOnHomeFeed(page);
  const fg = await base.foreground(page);

  const imgs = await fg.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rows = [];

    const nearestCls = (el) => {
      let n = el;
      for (let i = 0; i < 6 && n; i++) {
        const c = String((n.getAttribute && n.getAttribute("class")) || "").trim();
        if (c) return n.tagName.toLowerCase() + "." + c.split(/\s+/).slice(0, 3).join(".");
        n = n.parentElement;
      }
      return "(无 class)";
    };

    const push = (el, kind, src) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      rows.push({
        kind,
        src: String(src || ""),
        ratio: Number((box.w / box.h).toFixed(2)),
        box,
        inView: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw,
        cls: nearestCls(el),
      });
    };

    for (const el of Array.from(document.querySelectorAll("img"))) {
      push(el, "img", el.getAttribute("src") || el.currentSrc || "");
    }
    for (const el of Array.from(document.querySelectorAll("div,view,section"))) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none" && bg.includes("url(")) push(el, "bg", bg.slice(0, 140));
    }
    return rows;
  });

  const inView = imgs.filter((im) => im.inView);
  console.log("=== 首页信息流里的大图（>=40x40）共 %d 个，其中在屏内 %d 个 ===", imgs.length, inView.length);
  console.log("=== 屏内的逐个列全（地址给全，方便比对是哪张图）===");
  inView.forEach((im, i) => {
    console.log(
      "  #%d [%s] 位置=%s 尺寸=%dx%d 比例=%s\n      外层=%s\n      src=%s",
      i + 1, im.kind, JSON.stringify([im.box.x, im.box.y]), im.box.w, im.box.h, im.ratio, im.cls, im.src
    );
  });

  console.log("\n=== 不在屏内的（只给地址尾段，供参考）===");
  imgs.filter((im) => !im.inView).forEach((im) => {
    console.log("  位置=%s 尺寸=%dx%d src尾=%s", JSON.stringify([im.box.x, im.box.y]), im.box.w, im.box.h, im.src.slice(-60));
  });

  // 顺带看看信息流卡片的文字，便于把"哪张卡对应哪张图"对上
  const cards = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    const nodes = Array.from(document.querySelectorAll('[class*="card"], [class*="flow-item"], [class*="question"]'));
    for (const el of nodes) {
      const t = norm(el.innerText);
      const r = el.getBoundingClientRect();
      if (!t && !el.querySelector("img")) continue;
      out.push({
        cls: String(el.getAttribute("class") || "").slice(0, 80),
        text: t.slice(0, 40),
        imgs: el.querySelectorAll("img").length,
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      });
      if (out.length >= 14) break;
    }
    return out;
  });
  console.log("\n=== 信息流候选卡片（前 14 个）===");
  cards.forEach((c) => console.log("  class=%s 图=%d 文字=%s", c.cls, c.imgs, JSON.stringify(c.text))); 

  // 把"左下角那块"（截图里 banner 所在区域）的元素原样倒出来 —— 用来认清它到底是什么
  const region = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 30 || r.height < 20) continue;
      if (r.left > 200 || r.top < 560 || r.bottom > 900) continue;
      const bg = getComputedStyle(el).backgroundImage;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") || "").slice(0, 70),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        text: norm(el.innerText).slice(0, 30),
        bg: bg && bg !== "none" ? "有" : "",
        src: String(el.getAttribute("src") || "").slice(-50),
      });
      if (out.length >= 40) break;
    }
    return out;
  });
  console.log("\n=== 左下角区域（x<200 且 y 在 560~900）的元素 ===");
  region.forEach((e) =>
    console.log("  <%s class=%s> 位置=%s %s%s%s", e.tag, e.cls, JSON.stringify(e.rect), e.text ? "文字=" + JSON.stringify(e.text) : "", e.bg ? " 有背景图" : "", e.src ? " src尾=" + e.src : "")
  );

  // 所有 wx-image：把地址"解码后"打出来（文件名是中文，一眼能看出是不是案例库的图）
  const wxImgs = await fg.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll("wx-image"))) {
      const r = el.getBoundingClientRect();
      let raw = String(el.getAttribute("src") || "");
      let decoded = raw;
      try { decoded = decodeURIComponent(raw.replace(/^url\(["']?/, "").replace(/["']?\)$/, "")); } catch (e) { /* 保持原样 */ }
      decoded = decoded.replace(/^url\(["']?/, "").replace(/["']?\)$/, "").split("?")[0];
      const cls = String(el.getAttribute("class") || "");
      out.push({
        cls: cls.slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        name: decoded.split("/").slice(-1)[0].slice(-60),
        hit: decoded.includes("案例") || decoded.includes("case"),
      });
    }
    return out;
  });
  console.log("\n=== 所有 wx-image（共 %d 个）：文件名解码后 ===", wxImgs.length);
  wxImgs.forEach((w, i) =>
    console.log("  #%d %s 位置=%s 文件=%s%s", i + 1, w.cls, JSON.stringify(w.rect), JSON.stringify(w.name), w.hit ? "   <== 名字里有「案例」" : "")
  );

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "案例库 banner 是什么元素" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
