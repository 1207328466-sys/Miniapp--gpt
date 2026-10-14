/*
 * 诊断（不以 test_ 开头，pytest 不收集）：缺陷 713006028
 * 「帖子详情页，评论按钮点击无响应」—— 想给它写一条回归用例，得先知道两件事：
 *   ① 帖子详情页的"评论入口"到底是哪个元素（文字？图标？class 是什么）
 *   ② 点它之后**页面有什么可断言的变化**（只有"点了有反应"才能写成断言；
 *      否则只能写成"入口还在"，那种断言挡不住这个 bug）
 *
 * 只读：只点评论入口，不发评论、不改任何数据。
 * 运行：node test_case/diagnostic/probe_post_comment_entry.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const postDetail = pages.postDetail;

const SNAP_JS = () => {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const out = { texts: [], candidates: [], inputs: [] };
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const cls = String(el.getAttribute("class") || "");
    const t = norm(el.innerText);
    // 可能跟"评论"有关的元素：class 里带 comment/pinglun/input/send/发送
    if (/comment|pinglun|reply|input|send/i.test(cls)) {
      const r = el.getBoundingClientRect();
      out.candidates.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 120),
        text: t.slice(0, 30),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      });
      if (out.candidates.length >= 20) break;
    }
  }
  for (const el of Array.from(document.querySelectorAll("wx-input, input, textarea"))) {
    out.inputs.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.getAttribute("class") || "").slice(0, 80),
      placeholder: el.getAttribute("placeholder"),
      value: el.getAttribute("value"),
      focused: document.activeElement === el,
    });
  }
  // 屏幕下半部分（y > 600）上的东西：评论入口/发送按钮这类都在底部操作条里
  out.bottom = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.y < 600 || r.height < 8 || r.width < 8) continue;
    const t = norm(el.innerText);
    if (!t || t.length > 12) continue;
    out.bottom.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.getAttribute("class") || "").slice(0, 90),
      text: t,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    });
    if (out.bottom.length >= 24) break;
  }
  const body = norm(document.body.innerText);
  out.texts = body.slice(-400);
  return out;
};

async function dump(page, label) {
  const fg = await base.foreground(page);
  const snap = await fg.evaluate(SNAP_JS);
  console.log("\n=== %s ===", label);
  console.log("页尾文字: %s", JSON.stringify(snap.texts));
  console.log("输入框: %s", JSON.stringify(snap.inputs));
  console.log("屏幕下半部分:");
  (snap.bottom || []).forEach((b) =>
    console.log("   <%s class=%s rect=%s> %s", b.tag, b.cls, b.rect.join(","), JSON.stringify(b.text))
  );
  console.log("候选元素:");
  snap.candidates.forEach((c) =>
    console.log("   <%s class=%s rect=%s> %s", c.tag, c.cls, c.rect.join(","), JSON.stringify(c.text))
  );
  return snap;
}

async function probe(page) {
  page = await postDetail.openFirstFromFeed(page);
  const before = await dump(page, "① 帖子详情页（点之前）");

  // 评论入口：优先按文字「留下你的回答」点（页面对象里它是判据之一），找不到就按 class 猜
  const fg = await base.foreground(page);
  const entry = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    // 实测：入口那行的文字是「留下你的回答...」（带三个点），按**包含**匹配；
    // 但祖先容器也"包含"这段文字（它的 innerText 里也有），所以要取**面积最小**的那个
    const hits = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const t = norm(el.innerText);
      if (!t.includes("留下你的回答")) continue;
      const r = el.getBoundingClientRect();
      hits.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") || "").slice(0, 90),
        text: t.slice(0, 40),
        area: Math.round(r.width * r.height),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      });
    }
    hits.sort((a, b) => a.area - b.area);
    return hits.slice(0, 6);
  });
  console.log("\n[评论入口候选（按面积从小到大）]");
  (entry || []).forEach((e) =>
    console.log("   <%s class=%s rect=%s area=%d> %s", e.tag, e.cls, e.rect.join(","), e.area, JSON.stringify(e.text))
  );
  if (!entry || !entry.length) {
    console.log("   （没找到「留下你的回答」这类文字入口，下面的点击跳过）");
    return page;
  }

  /* 【反向验证】ZW_003 第4步断言的是「点了评论入口之后页面出现『发送』」。
   * 这条断言要成立，必须**点之前页面上没有「发送」** —— 否则点了没反应也会绿（假绿）。
   * 所以这里点之前先数一遍：不是 0 就说明那条用例的核心断言是空的，必须当场报出来。
   */
  // ⚠️ 这里必须用**和断言同一个口径**：表格里的「检查文字显示」看的是 document.body.innerText
  //    （只算**看得见**的文字），不是「DOM 里有没有这个节点」。
  //    实测：点之前 DOM 里已经有 1 个「发送」节点（面板预先渲染好、隐藏着），
  //    所以用 countOfText 去"反向验证"会得出错误的结论 —— 这条注释就是那次踩坑的记录。
  const beforeText = await base.pageText(await base.foreground(page));
  const beforeDomCount = await base.countOfText(await base.foreground(page), "发送");
  console.log(
    "\n[反向验证] 点之前：innerText 里有「发送」吗？%s；DOM 里「发送」节点 %d 个（隐藏的也算）",
    beforeText.includes("发送") ? "有（断言会假绿，得换）" : "没有（可以）",
    beforeDomCount
  );
  if (beforeText.includes("发送")) {
    throw new Error(
      `反向验证失败：点评论入口之前**可见文字**里就已经有「发送」—— ` +
        `那 ZW_003 的核心断言（点完检查「发送」出现）就是假绿，得换断言。`
    );
  }

  // 按文字点：Playwright 的 text 匹配取的是"包含这段文字的最小元素"，这里用没带省略号的四个字
  await base.tapText(fg, "留下你的回答", "评论入口");
  await base.sleep(2500);
  const after = await dump(page, "② 点了评论入口之后");

  console.log("\n[结论线索]");
  const afterText = await base.pageText(await base.foreground(page));
  const afterSend = afterText.includes("发送");
  console.log(
    "  正向验证：点之后可见文字里有「发送」吗？%s —— %s",
    afterSend ? "有" : "没有",
    afterSend ? "评论入口真的有反应（ZW_003 第4步成立）" : "没反应！这条断言会把 bug 抓住"
  );
  console.log("  输入框数量：点之前 %d 个，点之后 %d 个", before.inputs.length, after.inputs.length);
  console.log(
    "  页尾文字变化：%s",
    before.texts === after.texts ? "（没有变化 —— 这个入口点了确实没反应？）" : "（变了，可断言）"
  );
  // 收尾：关掉评论面板（点遮罩），把手机还回去
  await base.tapSelector(await base.foreground(page), ".overlay-mask", "评论面板遮罩");
  await base.sleep(1200);
  return page;
}

appTest([[probe, null]], { photosPath: null }).catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
