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
  // 课程卡片的外壳（实测 2026/10/12：wx-view.rounded-_32px_.overflow-hidden，319x198；
  // 信息块在里面是 wx-view.p-4，文字形如「免费课程 26人已学习 15课程评价 ¥0」）
  courseCard: '[class*="rounded-_32px_"]',
};

const TOP_TAB = { course: "课程", column: "专栏", encyclopedia: "压铸百科" };
const BOTTOM_TAB_TEXT = "学习中心";
/* 专栏列表页的"独有小标题"。
 * 2026/10/14 实测校准：原来只有「热门专栏」，那天真机上整页找不到它 ——
 * 页面上是「往期专栏」（互动专栏过了活动期就会落到"往期"，见 `wx-text` 标题行）。
 * 两个都认：**这个问题的本质是"判据漂移"** —— 判据盯着一句会随数据变的文案，
 * 数据一变，用例就报"没到达"，看着像功能坏了。所以只要**其中之一**在，就算到了专栏列表页；
 * 卡片（`.column-card`）数量 > 0 仍是必要条件，防止把"空列表"当成到达。
 */
const MARKERS_COLUMN_LIST = ["热门专栏", "往期专栏"];

/** 现在是不是学习中心（判据：三个顶部 tab 元素都在） */
async function isOn(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.headerTab)) >= 3;
}

/** 现在是不是学习中心的「专栏」列表页（有卡片 且 有专栏小标题：热门专栏 / 往期专栏） */
async function isOnColumnList(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.columnCard)) === 0) return false;
  const text = await base.pageText(fg);
  return MARKERS_COLUMN_LIST.some((m) => text.includes(m));
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
 *   A. 已在专栏列表页            -> 直接返回
 *   B. 在学习中心但不在专栏 tab  -> 切顶部「专栏」tab
 *   C. 在任意**二级页**（专栏详情页 / 搜索页 / 答题活动页……）
 *      -> 这些页面都**没有底部 tab 栏**，先由 `base.ensureOnTabPage` 点返回退出来
 *   D. 在有底部 tab 的其它一级页 -> 点底栏「学习中心」
 *
 * C 这条是**真机验证时踩出来的**：原先只特判了"专栏详情页"这一种二级页，
 * 从搜索页起步时两次尝试都失败（报"既不在详情页、也不在学习中心，也找不到底部 tab"）。
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

    if (await isOn(page)) {
      // 已经在学习中心，只是停在课程 / 压铸百科 tab 上
      console.log(`  [尝试 ${attempt}] 在学习中心，切到「${TOP_TAB.column}」tab`);
      page = await switchToColumnTab(page);
      continue;
    }

    console.log(
      `  [尝试 ${attempt}] 不在学习中心，页面前 60 字=${JSON.stringify((await base.pageText(page)).slice(0, 60))}`
    );

    // 关键：先确保站在"有底部 tab 栏的一级页面"上。二级页（专栏详情页 / 搜索页 /
    // 答题活动页）都没有底部 tab 栏，从这里直接去找底部 tab 必然失败。
    page = await base.ensureOnTabPage(page);

    if (await isOnColumnList(page)) {
      console.log("  退出二级页后已经就是专栏列表页");
      return page;
    }

    await base.tapText(page, BOTTOM_TAB_TEXT, `底部 tab「${BOTTOM_TAB_TEXT}」`);
    await base.sleep(waitAfterTab);
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
 * 打开第一张专栏卡片进入详情页，并确认真的进去了。
 * 点击后**必须重新解析前台页**：卡片点击会新建 page，旧 page 会冻结。
 *
 * @param {import('playwright').Page} page
 * @param {{timeout?: number, waitAfterTap?: number}} [options]
 * @param {Object|null} [ctx] 用例上下文；传入时会把第一张卡片的名称存成
 *        `firstColumnName`，供后续步骤断言"点进去的确实是同一个专栏"
 */
async function openFirstColumn(page, { timeout = 12000, waitAfterTap = 3000 } = {}, ctx = null) {
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
  // 把"点的是哪一个"记进上下文：后面才能断言详情页就是这一个，
  // 而不是只断言"进了某个详情页"（后者在点错卡片时照样会通过）。
  if (ctx) ctx.set("firstColumnName", name);

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

/**
 * **纯函数**：把课程卡片上的动态前缀剥掉，剩下的开头就是课程名。
 *
 * 卡片文字形如（实测）：
 *   「免费课程 26 人已学习 15 课程评价 ¥0」
 *   「已购买(学习进度 0%) 717 13人已学习 1课程评价 ¥1」
 *   「0 免费课程 26 人已学习 15 课程评价 ¥0」   ← 前面还挂着一个纯数字角标
 * 所以要依次剥掉：已购买(学习进度 N%) → 纯数字前缀。
 *
 * ⚠️ 剥"纯数字前缀"要小心：课程名本身可能是数字（库里就有叫「18」的课）。
 * 所以调用方**两个变体都要试**（剥过的 + 没剥的），见 test_from_table.js 的那个动作。
 */
function stripCourseCardPrefix(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^\s*已购买\s*[（(]\s*学习进度\s*\d+\s*%\s*[）)]\s*/, "")
    .trim();
}

/**
 * **纯函数**：一张课程卡能给出的所有"名字候选"。
 *
 * 卡片文字里有两类动态前缀：
 *   · 「已购买(学习进度 0%)」—— 直接剥掉；
 *   · 一个**纯数字角标**（实测形如「0 免费课程 26人已学习」）—— 这个要**谨慎**剥：
 *     课程名本身可能是纯数字（库里就有一门叫「18」的课），盲目剥会把名字吃掉。
 *     判据：剥完之后，剩下的文字还得能看出"名字 + N人已学习"的形态（名字不是纯数字）—— 才认这个剥法。
 *
 * 第一版就是盲目剥数字，离线自检当场抓到：`已购买(学习进度 0%) 717 13人已学习` 被剥成
 * 「13 人已学习」，「717」这个课程名没了。
 */
function cardVariants(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const noBuy = stripCourseCardPrefix(raw);
  const out = [raw, noBuy];

  const stripped = noBuy.replace(/^\d+\s+/, "").trim();
  const m = stripped.match(/^(.+?)\s+\d+\s*人已学习/);
  if (stripped !== noBuy && m && m[1].trim() && !/^\d+$/.test(m[1].trim())) {
    out.push(stripped);
  }
  return Array.from(new Set(out.filter(Boolean)));
}

/**
 * **纯函数**：在一堆课程卡片里，找出"库里 0 课时的课程名"有没有出现（对账用）。
 *
 * 为什么不用"整页文字里 includes(名字)"：**会被前缀骗**。
 * 库里既有「付费课程1」也有「付费课程10」—— 只做子串匹配的话，
 * 列表里出现「付费课程10」就会被误判成"0 课时的「付费课程1」显示了"，报一条假失败。
 * 所以这里要求：**名字后面得是空白**（卡片文字形如「付费课程10 3人已学习 …」），
 * 并且"剥过前缀的"和"原文"两个版本都试（课程名本身可能是纯数字，库里就有一门叫「18」的课）。
 *
 * @param {Array<{text:string, name:string}>} cards 小程序列表里读到的卡片
 * @param {string[]} dbNames 库里 0 课时的课程名
 * @returns {string[]} 真出现了的名字（空数组 = 全部符合需求）
 */
function findZeroLessonShown(cards, dbNames) {
  const hits = [];
  for (const name of new Set(dbNames || [])) {
    const n = String(name || "").trim();
    if (!n) continue;
    const found = (cards || []).some((c) => {
      const variants = cardVariants((c && c.text) || "");
      return variants.some((v) => v === n || v.startsWith(n + " "));
    });
    if (found) hits.push(n);
  }
  return hits;
}

/**
 * 把「课程」tab 里的课程**逐张**读出来（只读）：边往下滚边收集，滚到底或连着几次没新增就停。
 *
 * @returns {Promise<Array<{text:string, name:string}>>} text = 卡片原文（规范化后），name = 剥掉前缀的版本
 */
async function readCourseList(page, { maxScrolls = 12 } = {}) {
  const collected = [];
  const seen = new Set();

  const collectOnce = async () => {
    const fg = await base.foreground(page);
    const cards = await fg.evaluate(
      (sel) => {
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const out = [];
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const r = el.getBoundingClientRect();
          // 只要课程卡那个尺寸段（实测 319x198；放宽到 100~400 高，避开整页容器）
          if (r.width < 200 || r.height < 100 || r.height > 400) continue;
          const t = norm(el.innerText);
          if (!/人已学习/.test(t)) continue; // 课程卡的标志：有「N人已学习」
          out.push(t.slice(0, 80));
        }
        return out;
      },
      SEL.courseCard
    );
    let added = 0;
    cards.forEach((t) => {
      if (seen.has(t)) return;
      seen.add(t);
      collected.push({ text: t, name: stripCourseCardPrefix(t) });
      added += 1;
    });
    return { total: cards.length, added };
  };

  let last = await collectOnce();
  for (let i = 1; i <= maxScrolls; i++) {
    // 滚一屏（列表在 wx-scroll-view 里，用真实滑动最稳）
    page = await require("../android").swipeUp(page);
    await base.sleep(900);
    last = await collectOnce();
    const text = await base.pageText(await base.foreground(page));
    if (/已经到底了|没有更多/.test(text)) {
      console.log(`  课程列表已经到底（第 ${i} 次滑动后），共收集 ${collected.length} 张卡片`);
      break;
    }
    if (last.added === 0 && i >= 2) {
      console.log(`  连着两次滑动都没有新增卡片（第 ${i} 次），认为到底了，共 ${collected.length} 张`);
      break;
    }
  }
  return collected;
}

module.exports = {
  SEL,
  TOP_TAB,
  BOTTOM_TAB_TEXT,
  // ⚠️ 这两个导出别混：MARKERS_（复数）是判据用的**列表**；
  // MARKER_COLUMN_LIST（单数）保留旧名给老代码/文档引用，指向**首选**那个小标题。
  MARKERS_COLUMN_LIST,
  MARKER_COLUMN_LIST: MARKERS_COLUMN_LIST[0],
  isOn,
  isOnColumnList,
  activeTopTab,
  switchToTopTab,
  switchToColumnTab,
  columnCardCount,
  firstColumnName,
  ensureOnColumnList,
  openFirstColumn,
  readCourseList,
  stripCourseCardPrefix,
  cardVariants,
  findZeroLessonShown,
};
