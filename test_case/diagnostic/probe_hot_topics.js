/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713129788「有问必答-搜索新增热门话题」取证据。
 *
 * 需求原话（摘要）：
 *   1. 「热门话题」：显示管理后台的**前 5 个**话题，作为热门话题；
 *   2. 搜索规则：筛选出带有该话题标签的帖子，并显示在搜索结果页；
 *   3. **热门话题的点击不会显示在搜索历史**；
 *   交互：搜索页点击「热门话题」→ 跳转热门话题搜索结果页；点 X 和返回按钮回到搜索页。
 *
 * 要去问四件事：① 搜索页上「热门话题」区块在不在、叫什么 ② 有几个（需求说前 5 个）
 * ③ 点一个之后到的是不是结果页（结果页标记：全部回答） ④ 返回后搜索历史里有没有它
 *
 * 只读：只点话题 / 返回 / 读文字，不改任何数据。
 * 运行：node test_case/diagnostic/probe_hot_topics.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

const HOT = "热门话题";
const RESULT_MARK = "全部回答";

/** 在搜索页上找"热门话题"区块：打印候选元素的 class 与文本（只读） */
async function scanHotTopics(page) {
  const fg = await base.foreground(page);
  const out = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const all = Array.from(document.querySelectorAll("*"));
    const hit = {
      hasTitle: false,
      titleEl: "",
      candidates: [],
    };
    for (const el of all) {
      const text = norm(el.innerText);
      const cls = String(el.getAttribute("class") || "");
      if (text === "\u70ed\u95e8\u8bdd\u9898") {
        hit.hasTitle = true;
        hit.titleEl = el.tagName.toLowerCase() + "." + cls;
      }
      // 话题 chip：文本短、有 class，且不是"热门话题"这个标题本身
      if (text && text.length <= 12 && cls && /topic|hot|chip|tag/i.test(cls)) {
        if (hit.candidates.length < 12) hit.candidates.push({ tag: el.tagName.toLowerCase(), cls, text });
      }
    }
    return hit;
  });
  console.log("[热门话题区块] 标题在吗：%s（%s）", out.hasTitle ? "在" : "不在", out.titleEl);
  console.log("  候选话题元素（按 class 含 topic/hot/chip/tag 找）：");
  if (!out.candidates.length) console.log("    （没找到）");
  out.candidates.forEach((c) => console.log("    <%s class=%s> %s", c.tag, c.cls, JSON.stringify(c.text)));
  return out;
}

async function probe(page) {
  // ① 回到首页 -> 打开搜索页（不输入），看热门话题区块
  page = await qa.ensureOnHomeFeed(page);
  page = await qa.openSearch(page);
  await base.sleep(1500);
  const searchText = await base.pageText(await base.foreground(page));
  console.log("\n[搜索页] 元素=%d", await base.countOf(await base.foreground(page), "*"));
  console.log("  含「%s」：%s", HOT, searchText.includes(HOT) ? "有" : "无");
  console.log("  文字开头: %s", JSON.stringify(searchText.slice(0, 160)));
  const scan = await scanHotTopics(page);

  // 额外：把"1 2 3 4 5"这种排名数字的结构挖出来 —— 热门话题很可能是带序号的榜单
  const ranked = await (await base.foreground(page)).evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const t = norm(el.innerText);
      if (!/^[1-9]$/.test(t)) continue;
      const chain = [];
      let cur = el;
      for (let i = 0; i < 4 && cur; i++) {
        const cls = String(cur.getAttribute("class") || "");
        chain.push(cur.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : "") + "[" + norm(cur.innerText).slice(0, 24) + "]");
        cur = cur.parentElement;
      }
      if (out.length < 6) out.push(chain.join("  <-  "));
    }
    return out;
  });
  console.log("\n[带序号的元素（像热门话题榜单）] 共扫到 %d 组：", ranked.length);
  ranked.forEach((r) => console.log("   " + r));

  // 把 .hot-topics 这棵子树的结构打出来（选选择器用）
  const tree = await (await base.foreground(page)).evaluate(() => {
    const root = document.querySelector(".hot-topics");
    if (!root) return ["（没有 .hot-topics）"];
    const lines = [];
    const walk = (el, depth) => {
      if (depth > 3) return;
      const cls = String(el.getAttribute("class") || "");
      const text = String(el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20);
      lines.push("  ".repeat(depth) + el.tagName.toLowerCase() + (cls ? " class=" + JSON.stringify(cls) : "") + (text ? "  text=" + JSON.stringify(text) : ""));
      Array.from(el.children).forEach((c) => walk(c, depth + 1));
    };
    walk(root, 0);
    return lines.slice(0, 40);
  });
  console.log("\n[.hot-topics 子树]");
  tree.forEach((l) => console.log("   " + l));

  // ② 点第一个话题，看是否进结果页
  const first = scan.candidates[0];
  let topic = first ? first.text : "";
  if (!topic) {
    console.log("\n没扫到话题 chip，退而求其次：在页面里找短文本试试");
    topic = "";
  }
  if (topic) {
    await base.tapText(await base.foreground(page), topic, "热门话题「" + topic + "」");
    await base.sleep(2500);
    const afterText = await base.pageText(await base.foreground(page));
    console.log("\n[点话题「%s」之后] 含结果页标记「%s」：%s", topic, RESULT_MARK, afterText.includes(RESULT_MARK) ? "是" : "否");
    console.log("  文字开头: %s", JSON.stringify(afterText.slice(0, 160)));

    // ③ 返回搜索页，看历史里有没有它（需求说不会记进历史）
    const back = await require("../../app_sub_function/suprecast_app/android").goBack(
      await base.foreground(page)
    );
    await base.sleep(1500);
    const backText = await base.pageText(await base.foreground(back));
    console.log(
      "\n[返回搜索页] 搜索历史里出现话题「%s」了吗：%s",
      topic,
      backText.includes(topic) ? "出现了（不符合需求）" : "没出现（符合需求）"
    );
    console.log("  文字开头: %s", JSON.stringify(backText.slice(0, 160)));
  }

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "搜索页", title: "热门话题区块与点击行为" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
