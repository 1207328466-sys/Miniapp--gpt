/*
 * 页面对象：学习中心
 *
 * 实测结构（2026/10/10）：
 *   顶部 tab 栏（三个 tab，选中态用 class active 表达）：
 *     <wx-view class="course-header-tabs">                      <- 容器
 *       <wx-view class="h5-view header-tab">课程</wx-view>
 *       <wx-view class="h5-view header-tab active">专栏</wx-view>
 *       <wx-view class="header-tab">压铸百科</wx-view>
 *     </wx-view>
 *   「专栏」tab 的内容：
 *     <wx-view class="column-tab-list">
 *       <wx-view class="column-card" ...>                       <- 实测 7 张
 *         <wx-text class="column-card-name"><span>N1-预热期专栏</span></wx-text>
 *     </wx-view>
 *   本页独有标题：「热门专栏」（实测在其它页面出现 0 次）
 *
 * 进入方式：点底部 tab「学习中心」。
 * ⚠️ 底部 tab 栏的 class 前缀**每个页面都不一样**（实测见过 bar-index--* 和 index--*），
 * 所以这里一律按**文本**定位，不写 class 前缀 —— 这正是当初
 * "各页面 tab 栏 class 不统一"那个问题的实际解法。
 */

const base = require("./base_page");
const columnDetail = require("./column_detail_page");

const SEL = {
  // ⚠️ 必须用精确类名。写成 [class*="header-tab"] 会把容器 course-header-tabs
  // 一起命中（它的 class 里也含这段子串）且排在首位，.first() 就会选到容器，
  // 而容器中心恰好落在「专栏」tab 的右边界上 —— 点 1 像素边缘，导致"时好时坏"。
  // 详见账本 根因 11（实测坐标 326,245 vs 273,245）。
  headerTab: ".header-tab",
  headerTabBar: ".course-header-tabs",
  columnCard: ".column-card",
  columnCardName: ".column-card-name",
};

const TOP_TAB = { course: "课程", column: "专栏", encyclopedia: "压铸百科" };
const BOTTOM_TAB_TEXT = "学习中心";
const MARKER_COLUMN_LIST = "热门专栏";

/** 现在是不是学习中心（判据：三个顶部 tab 元素都在） */
async function isOn(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.headerTab)) >= 3;
}

/** 现在是不是学习中心的「专栏」列表页（有卡片 且 有「热门专栏」标题） */
async function isOnColumnList(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.columnCard)) === 0) return false;
  return (await base.pageText(fg)).includes(MARKER_COLUMN_LIST);
}

/** 当前选中的是哪个顶部 tab（返回 tab 文本；拿不到返回空串） */
async function activeTopTab(page) {
  const fg = await base.foreground(page);
  const n = await base.countOf(fg, SEL.headerTab);
  for (let i = 0; i < n; i++) {
    const el = fg.locator(SEL.headerTab).nth(i);
    const cls = await el.evaluate((e) => String(e.getAttribute("class") || "")).catch(() => "");
    if (/(^|\s)active(\s|$)/.test(cls)) {
      return (await el.innerText()).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/**
 * 切到某个顶部 tab；已是选中态则直接返回（幂等）。
 * 点击后**等到它真的变成选中态**才返回，而不是 sleep 猜时间。
 */
async function switchToTopTab(page, { tab, timeout = 8000 } = {}) {
  if (!tab) throw new Error("switchToTopTab 缺少参数 tab");
  let fg = await base.foreground(page);

  const tabLocator = fg.locator(SEL.headerTab, { hasText: tab });
  if ((await tabLocator.count().catch(() => 0)) === 0) {
    throw await base.notFound(`顶部 tab「${tab}」（选择器 ${SEL.headerTab}）`, fg);
  }

  const cls = await tabLocator.first().evaluate((el) => String(el.getAttribute("class") || ""));
  if (/(^|\s)active(\s|$)/.test(cls)) {
    console.log(`  顶部 tab「${tab}」已是选中态，跳过点击（幂等）`);
    return fg;
  }

  await base.tapLocator(fg, tabLocator, `顶部 tab「${tab}」`);

  const ok = await base.waitUntil(
    async () => {
      fg = await base.foreground(fg);
      return (await activeTopTab(fg)) === tab;
    },
    { timeout }
  );
  if (!ok) {
    throw new Error(
      `点击顶部 tab「${tab}」后它没有变成选中态（当前选中：${JSON.stringify(await activeTopTab(fg))}）`
    );
  }
  console.log(`  已切换到顶部 tab「${tab}」`);
  return fg;
}

/** 切到「专栏」tab（业务语义的名字，内部就是 switchToTopTab） */
async function switchToColumnTab(page, options = {}) {
  return switchToTopTab(page, { tab: TOP_TAB.column, ...options });
}

/** 专栏卡片数量 */
async function columnCardCount(page) {
  const fg = await base.foreground(page);
  return base.countOf(fg, SEL.columnCard);
}

/** 第一张专栏卡片的名称 */
async function firstColumnName(page) {
  const fg = await base.foreground(page);
  return base.textOf(fg, SEL.columnCardName);
}

/**
 * 确保停在「学习中心 - 专栏列表页」。框架不负责导航到起始页，这一步负责自愈。
 *
 * 小程序可能停在几种状态，逐个处理：
 *   A. 已在专栏列表页          -> 直接返回
 *   B. 在专栏详情页            -> 点顶部返回按钮（实测详情页没有底部 tab 栏）
 *   C. 在学习中心但不在专栏 tab -> 切顶部「专栏」tab
 *   D. 在有底部 tab 的其它页面  -> 点底栏「学习中心」
 *
 * 【每轮循环都必须重新解析前台页】点底部 tab 后旧 page 会降级为后台页（内容冻结），
 * 只有重新取页面才能看到切换后的真实内容 —— 账本根因 8 / 9 的教训。
 */
async function ensureOnColumnList(page, { maxAttempts = 4, waitAfterTab = 2500 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    page = await base.foreground(page);

    if (await isOnColumnList(page)) {
      console.log(`  已在专栏列表页（第 ${attempt} 次检查通过）`);
      return page;
    }

    const onDetail = await columnDetail.isOn(page);
    const onLearnCenter = await isOn(page);
    const hasBottomTab = (await base.countOfText(page, BOTTOM_TAB_TEXT)) > 0;
    const t = await base.pageText(page);
    console.log(
      `  [尝试 ${attempt}] 在详情页=${onDetail} 在学习中心=${onLearnCenter} ` +
        `有底部tab栏=${hasBottomTab} 页面前 60 字=${JSON.stringify(t.slice(0, 60))}`
    );

    if (onDetail) {
      page = await columnDetail.back(page);
      continue;
    }

    if (onLearnCenter) {
      // 已经在学习中心，只是停在课程/压铸百科 tab 上
      page = await switchToColumnTab(page);
      continue;
    }

    if (hasBottomTab) {
      await base.tapText(page, BOTTOM_TAB_TEXT, `底部 tab「${BOTTOM_TAB_TEXT}」`);
      await base.sleep(waitAfterTab);
      continue;
    }

    throw new Error(
      `无法到达专栏列表页：当前既不在详情页、也不在学习中心，也找不到底部 tab「${BOTTOM_TAB_TEXT}」。` +
        `请手动把小程序切到有底部 tab 栏的页面。当前页面前 200 字:\n  ${t.slice(0, 200)}`
    );
  }

  page = await base.foreground(page);
  if (!(await isOnColumnList(page))) {
    throw new Error(
      `尝试 ${maxAttempts} 次后仍未到达专栏列表页。当前页面前 200 字:\n  ${(await base.pageText(page)).slice(0, 200)}`
    );
  }
  return page;
}

/**
 * 点第一张专栏卡片进入详情页，并确认真的进去了。
 * 点击后**必须重新解析前台页**：卡片点击会新建 page，旧 page 会冻结。
 */
async function openFirstColumn(page, { timeout = 12000, waitAfterTap = 3000 } = {}) {
  page = await base.foreground(page);

  const count = await columnCardCount(page);
  if (count === 0) {
    throw new Error(
      `没有找到任何专栏卡片（${SEL.columnCard}），「${TOP_TAB.column}」页可能还没加载完。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(page)).slice(0, 120))}`
    );
  }

  const name = await firstColumnName(page);
  console.log(`  当前共 ${count} 张卡片，第一张是「${name}」`);
  await base.tapSelector(page, SEL.columnCard, "第一张专栏卡片");
  await base.sleep(waitAfterTap);

  const ok = await base.waitUntil(async () => columnDetail.isOn(page), { timeout });
  if (!ok) {
    page = await base.foreground(page);
    throw new Error(
      `点击第一张专栏卡片后没有进入详情页（未出现 ${columnDetail.SEL.title}）。` +
        `当前页面前 200 字: ${JSON.stringify((await base.pageText(page)).slice(0, 200))}`
    );
  }
  return base.foreground(page);
}

module.exports = {
  SEL,
  TOP_TAB,
  BOTTOM_TAB_TEXT,
  MARKER_COLUMN_LIST,
  isOn,
  isOnColumnList,
  activeTopTab,
  switchToTopTab,
  switchToColumnTab,
  columnCardCount,
  firstColumnName,
  ensureOnColumnList,
  openFirstColumn,
};
