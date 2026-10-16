/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713495189「评论为 0 时文案优化」
 * 的第 4 个页面 —— **专栏详情页**实际显示什么。
 *
 * 为什么要单独探这一页：前端源码（`src/packageA/pages/column-detail/index.tsx`）里有两道
 * **只在专栏才有的分支**，光看"0 评论"三个字根本判不出该看到什么：
 *
 *   ① `hideComments`：**回顾期 / 结束** 且评论数为 0 -> 整个评论区**不渲染**（连"全部评论 0"都没有）；
 *   ② `emptyTitle={isPreheat ? "评论区未开放" : undefined}`：
 *      预热期 -> 显示「评论区未开放 + X年X月X日即可参与讨论」；
 *      互动期 -> emptyTitle 为空 -> 才轮到共用组件的「参与评论获取积分」。
 *
 * 所以"专栏详情页要显示「参与评论获取积分」"这件事，**只在「互动期 + 0 评论」这一格成立** ——
 * 本探针的作用就是把「列表里每一张专栏卡现在是哪一期、评论区显示什么」一次性摊开，避免猜。
 *
 * 只读：只列表 / 进详情 / 读文字 / 退回，不点订阅、不发评论、不改任何数据。
 *
 * 运行：node test_case/diagnostic/probe_column_comment_states.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const learnCenter = pages.learnCenter;
const columnDetail = pages.columnDetail;

const NEW_TEXT = "参与评论获取积分";
const OLD_TEXT = "期待你的评论";

/** 一段文字里"评论区的样子"：四种可能的状态各认一句标志性文案 */
function describeCommentArea(text) {
  const marks = {
    新文案: text.includes(NEW_TEXT),
    旧文案: text.includes(OLD_TEXT),
    "全部评论": text.includes("全部评论"),
    未开放: text.includes("评论区未开放"),
    互动已结束: text.includes("互动已结束"),
  };
  const hit = Object.keys(marks).filter((k) => marks[k]);
  return hit.length ? hit.join(" / ") : "（没有任何评论区的标志文案）";
}

/** 把一个标志文案附近的上下文打出来（看它前后到底写了什么） */
function context(text, word, radius = 45) {
  const i = text.indexOf(word);
  if (i < 0) return "";
  return JSON.stringify(text.slice(Math.max(0, i - radius), i + radius));
}

/** 列表里每一张专栏卡的名字（按 DOM 顺序） */
async function cardNames(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(() =>
    Array.from(document.querySelectorAll(".column-card-name")).map((e) =>
      String(e.innerText || "").replace(/\s+/g, " ").trim()
    )
  );
}

async function probe(page) {
  page = await learnCenter.ensureOnColumnList(page);
  const names = await cardNames(page);
  console.log(`\n列表现有专栏卡片 ${names.length} 张：${JSON.stringify(names)}`);
  console.log(
    `列表页文字前 200 字：${JSON.stringify((await base.pageText(await base.foreground(page))).slice(0, 200))}`
  );

  const rows = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    console.log(`\n===== [${i + 1}/${names.length}] 进专栏「${name}」 =====`);
    let fg = await base.foreground(page);
    try {
      await base.tapLocator(fg, fg.locator(".column-card", { hasText: name }).first(), `专栏卡「${name}」`);
    } catch (e) {
      console.log(`  点不进去，跳过：${e.message.split("\n")[0]}`);
      rows.push({ name, state: `点不进去：${e.message.split("\n")[0]}` });
      page = await base.foreground(page);
      continue;
    }
    await base.sleep(2500);

    fg = await base.foreground(page);
    const title = await columnDetail.title(fg).catch(() => "");
    const text = await base.pageText(fg);
    const shown = describeCommentArea(text);
    const sub = await columnDetail.subscribeState(fg).catch(() => "unknown");
    console.log(`  详情页标题：${JSON.stringify(title)}；订阅态=${sub}`);
    console.log(`  评论区状态：${shown}`);
    console.log(
      `  有「${NEW_TEXT}」=${text.includes(NEW_TEXT)} ｜ 有「${OLD_TEXT}」=${text.includes(OLD_TEXT)}`
    );
    ["全部评论", NEW_TEXT, OLD_TEXT, "评论区未开放", "互动已结束"].forEach((w) => {
      const ctx = context(text, w);
      if (ctx) console.log(`    「${w}」上下文：${ctx}`);
    });
    rows.push({ name, state: shown });

    page = await columnDetail.back(fg);
    await base.sleep(1500);
    // 退回来之后可能停在别的 tab 上，下一轮开头重新自愈
    page = await learnCenter.ensureOnColumnList(page);
  }

  console.log("\n\n===== 汇总 =====");
  rows.forEach((r) => console.log(`  ${r.state.padEnd(28, " ")} ${r.name}`));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  console.log("已回首页（探针归位）");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "评论文案", title: "需求 713495189：专栏详情页的评论区状态" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
