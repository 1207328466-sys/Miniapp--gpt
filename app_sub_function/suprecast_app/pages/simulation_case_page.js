/*
 * 页面对象：案例库（仿真案例库）
 *
 * 【入口是怎么找到的 —— 记下来免得下次再翻】
 * 需求 713381608 卡了很久的"入口找不到"，2026/10/12 找到了：
 *   **底部 tab「设计专区」打开就是仿真案例库列表**（页面顶部还有一排 tab：仿真案例库 / 压铸护航服务）。
 * 之前试过两条死路（都记在 knowledge/可自动化需求清单.md 里）：
 *   ① 首页信息流里那张「教你玩转 仿真案例库」是**测试账号发的帖子图**（帖子 2323 / aaaaaa），不是入口；
 *   ② 用户中心的「仿真案例」是收藏的类型筛选单选按钮，点了不跳转是正确行为。
 *
 * 【本页的实测结构（2026/10/12，真机）】
 *   .cases-page                     整页根容器（只在案例库出现）
 *     .cases-nav-bar / .cases-top-tabs / .cases-top-tab[.active]   顶部 tab（仿真案例库 / 压铸护航服务）
 *     .cases-scroll-inner
 *       .cases-top-banner-wrap > wx-image.cases-top-banner   介绍 banner（333x129，比例 2.58）
 *       .cases-sticky-head                                  吸顶筛选区
 *         .cases-biz-tabs-wrap      全部 / 积分兑换 / 免费案例
 *         .cases-category-row > .cases-category-item        分类（汽车 / 电子与通信 / …）
 *       .filter-tabs / .cases-filter-tags                   推荐 / 最新发布 / 最多查看 / 最多点赞 / 最多复制
 *       .case-list-masonry > .case-list-card                案例卡片（瀑布流）
 *         .case-list-card-image > wx-image.case-image       封面
 *         .case-list-card-title                             案例名
 *         .case-list-card-points                            免费 / N 积分
 *         .case-list-card-footer
 *           .case-list-card-author                          作者
 *           .case-list-card-stats                           右下角"复制数"那一处
 *             wx-text.icon-base-fuzhi                       **复制图标**（拼音 fuzhi = 复制）
 *             .case-list-card-viewcount                     数字（实测 = 数据库的 copy_count）
 *
 * 【需求原文（713381608）里跟本页有关的两条】
 *   ① 「案例库列表在分类上方展示介绍 banner」—— 实测 banner 的 y=130、分类行 y=313，确实在上方
 *   ② 「在案例库列表页，案例右下角显示由评论图标+评论数改为**复制图标+复制数**」
 *      —— 实测卡片右下角是 `icon-base-fuzhi` + 数字，整页找不到任何"评论"图标；
 *      数字的**语义**也拿数据库对过：案例「仅凝固」页面显示 5，库里 `copy_count=5`（而 `view_count=11`）
 */

const base = require("./base_page");

const SEL = {
  page: ".cases-page",
  topTabs: ".cases-top-tabs",
  topTab: ".cases-top-tab",
  topBanner: ".cases-top-banner",
  bizTabs: ".cases-biz-tabs-wrap",
  categoryRow: ".cases-category-row",
  categoryItem: ".cases-category-item",
  filterTags: ".cases-filter-tags",
  list: ".case-list-masonry",
  card: ".case-list-card",
  cardTitle: ".case-list-card-title",
  cardPoints: ".case-list-card-points",
  cardStats: ".case-list-card-stats",
  cardCount: ".case-list-card-viewcount",
};

/** 进入案例库的入口：底部 tab「设计专区」（它本身就是案例库） */
const TAB_TEXT = "设计专区";

/** 案例库顶部那排 tab（第二个是压铸护航服务，另一条业务线，别混） */
const TOP_TABS = ["仿真案例库", "压铸护航服务"];

/** 排序项（需求没直接要求，但它是"复制数"这条业务的旁证：有「最多复制」这一项） */
const SORT_TAGS = ["推荐", "最新发布", "最多查看", "最多点赞", "最多复制"];

/** 现在屏幕上是不是案例库 */
async function isOn(page) {
  // 看前台页：候选页里可能有被盖住的旧案例库页（坑 22 的教训）
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.page)) > 0;
}

/** 定位案例库那一页（前台优先，找不到就跨页找） */
async function findCasePage(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.page)) > 0) return fg;
  return base.findPageContaining(page, { selector: SEL.page });
}

/** 确保停在案例库列表页（自导航 + 幂等） */
async function ensureOn(page, { timeout = 15000 } = {}) {
  if (await isOn(page)) {
    console.log("已在案例库列表页，跳过导航（幂等）");
    return base.foreground(page);
  }
  page = await base.ensureOnTabPage(page);
  await base.tapText(page, TAB_TEXT, `底部 tab「${TAB_TEXT}」`);
  const ok = await base.waitUntil(async () => (await base.countOf(await base.foreground(page), SEL.page)) > 0, {
    timeout,
  });
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点底部 tab「${TAB_TEXT}」后没有进入案例库（未出现 ${SEL.page}）。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
    );
  }
  console.log("已到达案例库列表页");
  return base.foreground(page);
}

/**
 * 逐张读案例卡片（**只读**）：标题 / 价格 / 右下角那个数字（复制数）/ 图标类名
 * @returns {Promise<Array<{index:number,title:string,points:string,count:string,iconClass:string,text:string}>>}
 */
async function readList(page) {
  const fg = (await findCasePage(page)) || (await base.foreground(page));
  return fg.evaluate(
    (sel) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      document.querySelectorAll(sel.card).forEach((card, i) => {
        const titleEl = card.querySelector(sel.cardTitle);
        const pointsEl = card.querySelector(sel.cardPoints);
        const statsEl = card.querySelector(sel.cardStats);
        const countEl = card.querySelector(sel.cardCount);
        const iconEl = statsEl ? statsEl.querySelector('wx-text[class*="icon"]') : null;
        out.push({
          index: i,
          title: norm(titleEl ? titleEl.innerText : ""),
          points: norm(pointsEl ? pointsEl.innerText : ""),
          count: norm(countEl ? countEl.innerText : statsEl ? statsEl.innerText : ""),
          iconClass: String((iconEl && iconEl.getAttribute("class")) || ""),
          text: norm(card.innerText).slice(0, 60),
        });
      });
      return out;
    },
    { card: SEL.card, cardTitle: SEL.cardTitle, cardPoints: SEL.cardPoints, cardStats: SEL.cardStats, cardCount: SEL.cardCount }
  );
}

/**
 * 校验案例库列表页是否符合需求（**只读**，断言全部取自需求 713381608 原文）：
 *
 *   1. 「案例库列表在分类上方展示介绍 banner」
 *      —— 断言：`.cases-top-banner` 存在，且它的 y **小于**分类行的 y（"上方"是几何关系，不能只看存在）
 *   2. 「在案例库列表页，案例右下角显示由评论图标+评论数改为**复制图标+复制数**」
 *      —— 断言：每张卡片的右下角有**复制图标**（class 含 icon-base-fuzhi）+ 一个数字；
 *         并且整页**找不到评论图标**（class 里带 comment/pinglun 的都被视为"评论图标还在"）
 *   3. 页面上确实有案例卡片（否则前面两条会"因为没东西可查"而假通过）
 */
async function assertListRules(page, kwargs, ctx) {
  const fg = (await findCasePage(page)) || (await base.foreground(page));
  const problems = [];

  const geo = await fg.evaluate(
    (sel) => {
      const box = (el) => (el ? Math.round(el.getBoundingClientRect().y) : null);
      const commenty = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const c = String(el.getAttribute("class") || "");
        if (/comment|pinglun/i.test(c)) commenty.push(c.slice(0, 60));
      }
      return {
        bannerY: box(document.querySelector(sel.topBanner)),
        categoryY: box(document.querySelector(sel.categoryRow)),
        commenty: Array.from(new Set(commenty)).slice(0, 5),
      };
    },
    { topBanner: SEL.topBanner, categoryRow: SEL.categoryRow }
  );

  if (geo.bannerY === null) {
    problems.push(`分类上方没有介绍 banner（找不到 ${SEL.topBanner}）—— 需求要求「案例库列表在分类上方展示介绍 banner」`);
  } else if (geo.categoryY !== null && geo.bannerY >= geo.categoryY) {
    problems.push(
      `介绍 banner 不在分类上方：banner 的 y=${geo.bannerY}，分类行的 y=${geo.categoryY}（需求要求 banner 在上面）`
    );
  }

  const cards = await readList(fg);
  if (cards.length === 0) {
    problems.push(`一张案例卡片都没读到（${SEL.card}）—— 没有卡片这几条断言等于没测`);
  }
  cards.forEach((c) => {
    if (!/fuzhi/.test(c.iconClass)) {
      problems.push(
        `卡片「${c.title}」右下角的图标不是复制图标（读到的 class=${JSON.stringify(c.iconClass)}，期望含 icon-base-fuzhi）`
      );
    }
    if (!/^\d+$/.test(c.count)) {
      problems.push(`卡片「${c.title}」右下角没有数字（读到的复制数是 ${JSON.stringify(c.count)}）`);
    }
  });
  if (geo.commenty.length) {
    problems.push(`页面上还有"评论"相关的图标/元素（${JSON.stringify(geo.commenty)}）—— 需求要求改成复制图标+复制数`);
  }

  if (problems.length) {
    throw new Error("案例库列表页不符合需求（713381608）：\n  - " + problems.join("\n  - "));
  }
  console.log(
    `断言通过: 介绍 banner 在分类上方（y ${geo.bannerY} < ${geo.categoryY}）；` +
      `${cards.length} 张卡片右下角都是「复制图标 + 复制数」（如「${cards[0].title}」显示 ${cards[0].count}）；` +
      `整页没有评论图标`
  );
  if (ctx) {
    ctx.set("caseCardCount", cards.length);
    ctx.set("caseFirstTitle", cards[0] ? cards[0].title : "");
    ctx.set("caseFirstCopyCount", cards[0] ? cards[0].count : "");
  }
  return fg;
}

module.exports = {
  SEL,
  TAB_TEXT,
  TOP_TABS,
  SORT_TAGS,
  isOn,
  findCasePage,
  ensureOn,
  readList,
  assertListRules,
};
