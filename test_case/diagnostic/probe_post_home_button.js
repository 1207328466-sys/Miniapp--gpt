/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713256065「支持分享和返回首页」的前半句
 * ——「帖子详情页顶部导航栏：点击主页按钮，回到有问必答首页」。
 *
 * 要问三件事：
 *   ① 首页信息流里的"帖子卡片"用什么 class（谁能点进详情）
 *   ② 帖子详情页的顶部导航栏上都有什么按钮（有没有那个"主页"按钮）
 *   ③ 点了它之后是不是真的回到了有问必答首页（判据：首页的搜索栏 + 筛选 tab）
 *
 * 只读：只点帖子卡片与（如果存在的）导航按钮，不改任何数据。
 * 运行：node test_case/diagnostic/probe_post_home_button.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

async function dump(page, label, limit = 200) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n[%s] 元素=%d 文字开头: %s", label, await base.countOf(fg, "*"), JSON.stringify(text.slice(0, limit)));
  return { fg, text };
}

async function probe(page) {
  // ① 回到首页，找帖子卡片（listing 类名候选）
  page = await qa.ensureOnHomeFeed(page);
  const fg = await base.foreground(page);
  const cards = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const cls = String(el.getAttribute("class") || "");
      if (/flow-item|post-item|feed-item|qa-flow/i.test(cls)) {
        const t = norm(el.innerText);
        if (t.length > 6 && out.length < 8) out.push({ tag: el.tagName.toLowerCase(), cls, text: t.slice(0, 40) });
      }
    }
    return out;
  });
  console.log("[首页里像帖子卡片的元素]");
  if (!cards.length) console.log("   （没找到 flow-item/post-item/feed-item 之类的类名）");
  cards.forEach((c) => console.log("   <%s class=%s> %s", c.tag, c.cls, JSON.stringify(c.text)));

  if (!cards.length) {
    page = await qa.ensureOnHomeFeed(page);
    return page;
  }

  // ② 点第一张卡进详情页（按选择器点，不按文字 —— 卡片文本里有换行/多个字段，getByText 匹配不到）
  await base.tapSelector(await base.foreground(page), ".flow-item", "第一张帖子卡片");
  await base.sleep(2500);
  const detail = await dump(page, "点卡片之后（详情页？）", 240);

  // ③ 详情页导航栏上的按钮：把所有 class 含 nav/back/home 的元素打出来
  const navs = await detail.fg.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const cls = String(el.getAttribute("class") || "");
      if (/nav|back|home|return/i.test(cls)) {
        const r = el.getBoundingClientRect();
        out.push({
          tag: el.tagName.toLowerCase(),
          cls,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
        if (out.length >= 14) break;
      }
    }
    return out;
  });
  console.log("\n[详情页上 class 含 nav/back/home/return 的元素]");
  if (!navs.length) console.log("   （没有）");
  navs.forEach((n) => console.log("   <%s class=%s> rect=%s", n.tag, n.cls, JSON.stringify(n.rect)));

  // ④ 如果看到像"主页"的元素，点它，看是否回首页（判据：\.search-container 命中 1 个）
  const homeLike = navs.find((n) => /home/i.test(n.cls));
  if (homeLike) {
    console.log("\n试着点 class 含 home 的元素：%s", homeLike.cls);
    await base.tapSelector(await base.foreground(page), "." + homeLike.cls.trim().split(/\s+/)[0], "主页按钮");
    await base.sleep(2500);
    const back = await dump(page, "点主页按钮之后", 160);
    console.log("   现在在首页信息流吗（含「最新提问」）：%s", back.text.includes("最新提问") ? "是" : "否");
  } else {
    console.log("\n没找到 class 含 home 的导航元素 —— 「主页按钮」可能不在 DOM 里（例如在微信胶囊菜单里）");
  }

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "帖子详情", title: "详情页有没有「主页」按钮" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
