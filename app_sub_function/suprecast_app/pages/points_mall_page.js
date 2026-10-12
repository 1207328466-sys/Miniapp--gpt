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

module.exports = { SEL, ENTRY_TEXT, PAGE_MARKERS, isOn, ensureOn, backTopState, assertBackTopRules };
