/*
 * 页面对象：帖子详情页（需求 713256065 的「返回首页」那一半）
 *
 * 【实测结构】2026/10/12：
 *   首页信息流里的帖子卡片：`wx-view.flow-item`（点第一张就进详情）
 *   详情页顶部导航栏 `wx-view.custom-navbar` 上两个图标：
 *     `icon-base-nav-return`（返回，rect 约 [11,51,17,17]）
 *     `icon-base-home`       （主页，rect 约 [46,49,20,20]）  ← 需求里说的"主页按钮"
 *   点主页按钮之后回到有问必答首页（实测：页面变成 423 元素、出现「最新提问」那排筛选 tab）
 *
 * 【需求口径】713256065：「帖子详情页顶部导航栏：点击主页按钮，回到有问必答首页」✓
 *   （另一句"顶部 ··· 支持分享到朋友圈"走系统 UI，测不了，不在这里管）
 */

const base = require("./base_page");

const SEL = {
  feedCard: ".flow-item", // 首页信息流里的帖子卡片
  navHome: ".icon-base-home", // 详情页导航栏上的"主页"按钮
};

/** 现在是不是帖子详情页（判据：详情页独有的文案） */
async function isOn(page) {
  const fg = await base.foreground(page);
  const t = await base.pageText(fg);
  return t.includes("全部评论") || t.includes("留下你的回答") || t.includes("获得10积分");
}

/**
 * 从首页信息流打开第一张帖子卡片，进详情页。
 * 注意：卡片文本里混着标题/作者/评论数（还有换行），按文字点匹配不到，只能按选择器点。
 */
async function openFirstFromFeed(page) {
  const qa = require("./qa_page");
  page = await qa.ensureOnHomeFeed(page);
  const feed = await base.foreground(page);
  if ((await base.countOf(feed, SEL.feedCard)) === 0) {
    throw new Error(
      `首页信息流里找不到帖子卡片（${SEL.feedCard} 命中 0 个）—— 可能这一屏没加载出来`
    );
  }
  await base.tapSelector(feed, SEL.feedCard, "第一张帖子卡片");

  const ok = await base.waitUntil(async () => isOn(page), { timeout: 12000 });
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点了第一张帖子卡片之后没进详情页。\n  当前页面前 160 字: ${JSON.stringify(
        (await base.pageText(now)).slice(0, 160)
      )}`
    );
  }
  console.log("已进入帖子详情页");
  return base.foreground(page);
}

/** 点详情页导航栏上的「主页」按钮（需求 713256065） */
async function tapHome(page) {
  const fg = await base.foreground(page);
  await base.tapSelector(fg, SEL.navHome, "导航栏「主页」按钮");
  await base.sleep(2000); // 等首页信息流渲染
  return base.foreground(page);
}

module.exports = { SEL, isOn, openFirstFromFeed, tapHome };
