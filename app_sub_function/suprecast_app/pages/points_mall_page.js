/*
 * 页面对象：积分商城首页（需求 713582097）
 *
 * 【怎么进去】用户中心里点「积分商城」（实测 2026/10/12：入口文案就是「积分商城」，
 * 点进去是 338 个元素的商城首页：当前积分 / 积分明细 / 积分获取 / 积分抽奖 / 兑换记录 / 积分榜单 / 热门推荐 …）。
 *
 * 【回到顶部按钮长什么样（实测）】它是个**图标按钮，没有文字**：
 *   <wx-view class="rewards-store-backtop">                      ← 未滚动：存在但**没有** --visible
 *   <wx-view class="h5-view rewards-store-backtop --visible">    ← 滑到底：多出 --visible 修饰类
 * 位置固定在右下角（40×40，约 (298,614)）。
 *
 * ⚠️ 这就是为什么"按文字找它"会找不到（我第一版探针就白找了一轮）——
 * 判据只能按 **class 里的 `--visible`**，不是按文本，也不是按"元素在不在"（它一直在 DOM 里）。
 *
 * 需求口径（713582097 原文）：
 *   滚动超过 1.5 屏后淡入出现 / 点击平滑滚动回顶部且按钮隐藏 / 滚回阈值以内淡出隐藏 /
 *   内容不足阈值始终不显示 / 仅积分商城首页生效
 */

const base = require("./base_page");

const SEL = {
  backTop: ".rewards-store-backtop",
  backTopVisible: ".rewards-store-backtop--visible",
};

const ENTRY_TEXT = "积分商城"; // 用户中心里的入口文案
const PAGE_MARKERS = ["当前积分", "积分明细", "兑换记录"]; // 商城首页独有的几段文字

/** 现在是不是积分商城首页 */
async function isOn(page) {
  const fg = await base.foreground(page);
  const t = await base.pageText(fg);
  return PAGE_MARKERS.filter((m) => t.includes(m)).length >= 2;
}

/**
 * 确保停在积分商城首页（从用户中心点进去；已在则幂等返回）。
 * @returns {Promise<import('playwright').Page>}
 */
async function ensureOn(page) {
  if (await isOn(page)) {
    console.log("已在积分商城首页，跳过导航（幂等）");
    return base.foreground(page);
  }
  const userCenter = require("./user_center_page");
  page = await userCenter.switchTo(page);
  await base.tapText(page, ENTRY_TEXT, `入口「${ENTRY_TEXT}」`);
  const ok = await base.waitUntil(async () => isOn(page), { timeout: 12000 });
  if (!ok) {
    const fg = await base.foreground(page);
    throw new Error(
      `点了「${ENTRY_TEXT}」之后没有到积分商城首页（判据：${PAGE_MARKERS.join(" / ")} 至少出现两段）。\n` +
        `  当前页面前 160 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 160))}`
    );
  }
  console.log("已进入积分商城首页");
  return base.foreground(page);
}

/** 回到顶部按钮现在的状态：visible / hidden / missing（按 class 判，见文件头说明） */
async function backTopState(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.backTop)) === 0) return "missing";
  return (await base.countOf(fg, SEL.backTopVisible)) > 0 ? "visible" : "hidden";
}

/**
 * 读**用户现在看到的积分余额**（积分商城首页上的「当前积分 N」）。
 *
 * 【为什么读页面，而不是读库里的 `user.points`】
 * 库里的 `user.points` 是**本地余额**，而小程序显示的是「本地余额 + 还没同步进来的中台流水」
 * （表字典：`point_daily_sync_record` 是 T+1 的副本）—— 用户看到的是后者。
 * 2026/10/14 实测就撞上过：页面显示 30326，库里 `user.points` 只有 28331。
 * 所以「发多少到账多少」这种对账，必须以**页面上的数**为准（详见 docs/踩坑记录.md 坑 42）。
 *
 * 【为什么先回首页再进商城】导航都是幂等的（已经在那一页就不动），不强制重进会读到**旧渲染**
 * —— 验数据库类改动时踩过这个坑（坑 43）。
 *
 * 副作用：跑完手机停在**积分商城首页**。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{page: import('playwright').Page, points: number}>} 导航后的 page + 读到的余额
 */
async function readVisiblePoints(page) {
  const qaPage = require("./qa_page");
  page = await qaPage.ensureOnHomeFeed(page);
  page = await ensureOn(page);
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  const points = base.parsePointsFromText(text);
  if (points === null) {
    throw new Error(
      "读不到「当前积分」：积分商城首页上没有『当前积分 N』这段文字。\n" +
        `  当前页面前 160 字: ${JSON.stringify(text.slice(0, 160))}`
    );
  }
  return { page: fg, points };
}

/**
 * 按需求 713582097 校验「回到顶部」按钮（**只读**：只滑动 + 点这个按钮本身，不改数据）。
 *
 * 三步，每步都对着需求里的一句话：
 *   1. 未滚动（或先点它回到顶部之后）-> 按钮应隐藏（需求：滚回阈值以内淡出隐藏 / 初始不显示）
 *   2. 向上滑到（接近）底部 -> 按钮应出现（需求：滚动超过 1.5 屏后淡入出现）
 *   3. 点它 -> 回到顶部且按钮隐藏（需求：点击平滑滚动回顶部且按钮隐藏）
 */
async function assertBackTopRules(page, { maxSwipes = 4 } = {}) {
  const { swipeUp } = require("../android");
  page = await ensureOn(page);

  // 若进来时按钮已可见（说明页面停在"滚过"的状态）——先点它回顶部，否则第 1 步没有意义
  if ((await backTopState(page)) === "visible") {
    console.log("  进来时页面是滚过的：先点一次「回到顶部」把起点摆正");
    await base.tapSelector(page, SEL.backTop, "回到顶部按钮（摆正起点）");
    await base.sleep(1500);
  }

  const s1 = await backTopState(page);
  if (s1 !== "hidden") {
    throw new Error(
      `需求 713582097：未滚动时按钮应当不显示，实测状态=${s1}` +
        `（hidden=存在但没有 --visible；missing=连元素都没有；visible=已经显示）`
    );
  }
  console.log("  ① 未滚动：按钮隐藏 ✓");

  let swiped = 0;
  for (let i = 1; i <= maxSwipes; i++) {
    try {
      page = await swipeUp(page);
      swiped += 1;
    } catch (e) {
      console.log(`  第 ${i} 次滑动没位移（多半到底了）：${e.message.split("\n")[0]}`);
      break;
    }
    if ((await backTopState(page)) === "visible") break;
  }
  const s2 = await backTopState(page);
  if (s2 !== "visible") {
    throw new Error(
      `需求 713582097：滚过阈值后按钮应当出现，实测滑了 ${swiped} 次后状态=${s2}`
    );
  }
  console.log(`  ② 滑了 ${swiped} 次后：按钮出现 ✓`);

  await base.tapSelector(page, SEL.backTop, "回到顶部按钮");
  const ok = await base.waitUntil(async () => (await backTopState(page)) === "hidden", {
    timeout: 6000,
    interval: 400,
  });
  if (!ok) {
    throw new Error(
      `需求 713582097：点「回到顶部」之后按钮应当隐藏，实测状态=${await backTopState(page)}`
    );
  }
  console.log("  ③ 点击后：回到顶部且按钮隐藏 ✓");
  return base.foreground(page);
}

module.exports = {
  SEL,
  ENTRY_TEXT,
  PAGE_MARKERS,
  isOn,
  ensureOn,
  backTopState,
  readVisiblePoints,
  assertBackTopRules,
};
