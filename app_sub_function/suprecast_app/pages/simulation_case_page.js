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
  // 需求 713556982：「搜索框下移出导航栏、作为单独的一行」—— 判定要量"搜索行"的 y
  searchRow: ".nav-search-row",
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
  // ---------- 详情页（2026/10/12 实测结构）----------
  detailPage: ".case-detail-page",
  detailTitle: ".case-title",
  commentSection: ".case-comment-section",
  commentCount: ".comment-count",
  footerIcons: ".footer-icons",
  // ---------- 介绍长图页（点案例库首页那张 banner 进去）----------
  introPage: ".cases-ct-intro-page",
  introImage: '[class*="cases-ct-intro-bg"]',
  copyButtonText: "复制案例",
  /*
   * 付费案例点「复制案例」会先弹一个确认框（实测结构 2026/10/12）：
   *   .nut-dialog-outer.exchange-dialog
   *     .nut-dialog-header   「确认复制案例？」
   *     .nut-dialog-content  「花费积分：5 / 兑换成功后，不支持撤回兑换」
   *     .nut-dialog-footer
   *       .nut-button-default  「取消」
   *       .nut-button-primary  「确定」   ← 点它才真的复制（扣积分）
   */
  dialogFooter: ".nut-dialog-footer",
  dialogConfirm: ".nut-dialog-footer .nut-button-primary",
  dialogCancel: ".nut-dialog-footer .nut-button-default",
};

/** 付费案例复制确认框里的标志文案（用它判断"到底弹没弹确认框"） */
const COPY_CONFIRM_MARK = "确认复制案例";

/** 复制成功后的提示文案（**逐字取自需求 713381608 原文**） */
const COPY_TOAST = ["复制成功", "使用手机号登录智铸超云，即可查看案例详情"];

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
    /*
     * 【幂等 ≠ 状态正确 —— 2026/10/16 踩到】
     *
     * 案例库顶部有两个 tab：「仿真案例库」/「压铸护航服务」。**列表只在第一个 tab 里**；
     * 停在第二个 tab 上时 `.case-list-card` 一张都没有（那片是配置驱动的，测试环境里更是空的）。
     * 我做完"护航那片有没有内容"的探针之后把手机留在了第二个 tab 上 —— 紧接着的一次全量里，
     * 凡是以「打开案例库」开头、后面要读列表的用例接连报红（"案例库列表是空的，没法测复制"），
     * 而**页面其实没坏**，只是 tab 不对。
     *
     * 所以这里补一句归位：在案例库页上，如果顶部选中的不是「仿真案例库」，就切回去。
     * 只在**选中态读得到、且确实不对**时才动（读不到就不动，免得瞎点）。
     */
    console.log("已在案例库列表页，跳过导航（幂等）");
    return await ensureListTab(page);
  }
  page = await base.ensureOnTabPage(page);
  // 点 tab + 验证 + **带验证的重试**统一在 switchToBottomTab 里（偶发的一次点击不生效就再点一次）
  page = await base.switchToBottomTab(page, TAB_TEXT, {
    isTarget: async () => (await base.countOf(await base.foreground(page), SEL.page)) > 0,
    timeout,
  });
  console.log("已到达案例库列表页");
  // ⚠️ 导航到了还不够：顶部 tab 可能是「压铸护航服务」（那片没有列表、banner 也没有）。
  // 2026/10/16 实测踩到过一次（我自己把手机留在那个 tab 上，紧接着的全量连红 3 条）——
  // 所以**两条路径都要归位**（只放在"幂等早退"那条路上是不够的）。
  return await ensureListTab(page);
}

/**
 * 把案例库顶部 tab 归位到「仿真案例库」（有列表的那个）。已经在则不动。只读 + 必要时点一下 tab。
 * @returns {Promise<import('playwright').Page>}
 */
async function ensureListTab(page) {
  const cur = await activeTopTab(page);
  if (cur && cur !== TOP_TABS[0]) {
    console.log(`  案例库停在「${cur}」tab 上（那里没有案例列表、也没有介绍 banner）—— 切回「${TOP_TABS[0]}」`);
    // 圈进顶部 tab 栏再点：这几个字在页面上别处也会有（标题/长图）
    await base.tapTextWithin(await base.foreground(page), SEL.topTabs, TOP_TABS[0]);
    await base.sleep(1500);
  }
  return base.foreground(page);
}

/**
 * 当前选中的是案例库顶部哪个 tab（读 `.cases-top-tab` 上的 `active`；读不到返回空串）。
 * 只读、不点。为什么要有它：**列表只在「仿真案例库」那个 tab 里**，
 * 停在另一个 tab 上时整个列表都会"看起来是空的"（见 ensureOn 里那段说明）。
 * @returns {Promise<string>} tab 文案；读不到返回 ""
 */
async function activeTopTab(page) {
  const fg = await base.foreground(page);
  try {
    return await fg.evaluate(
      (sel) => {
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const els = Array.from(document.querySelectorAll(sel.topTab));
        const hit = els.find((el) => /(^|\s)active(\s|$)/.test(String(el.getAttribute("class") || "")));
        return hit ? norm(hit.innerText) : "";
      },
      { topTab: SEL.topTab }
    );
  } catch (e) {
    return "";
  }
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
 *
 * 另外把**需求 713556982（压铸护航和案例库整合）**里跟这一页有关的两条也一起验了
 *（同一个页面、同一次读取，没必要再开一条用例）：
 *   4. 「页面顶部分为**仿真案例库（默认）**和压铸护航服务两个 tab」—— 断言 `.cases-top-tab` 恰好 2 个、
 *      且带 `active` 的那个是「仿真案例库」
 *   5. 「原仿真案例库的**搜索框下移出导航栏，作为单独的一行**」—— 几何断言：搜索行（`.nav-search-row`）
 *      的 y **在顶部 tab 栏的下边缘之下**（实测 tab 栏底 83、搜索行 y=86）。"单独一行"不能只看存在。
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
        // 需求 713556982 的三样：顶部 tab 的个数/选中态、tab 栏下边缘、搜索行的 y
        topTabCount: document.querySelectorAll(sel.topTab).length,
        activeTopTab: (() => {
          const el = document.querySelector(sel.topTab + ".active");
          return el ? String(el.innerText || "").replace(/\s+/g, " ").trim() : "";
        })(),
        tabsBottom: (() => {
          const el = document.querySelector(sel.topTabs);
          return el ? Math.round(el.getBoundingClientRect().bottom) : null;
        })(),
        searchRowY: box(document.querySelector(sel.searchRow)),
      };
    },
    { topBanner: SEL.topBanner, categoryRow: SEL.categoryRow, topTab: SEL.topTab, topTabs: SEL.topTabs, searchRow: SEL.searchRow }
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

  // ---- 需求 713556982（压铸护航和案例库整合）----
  if (geo.topTabCount !== 2) {
    problems.push(
      `顶部 tab 应当是 2 个（仿真案例库 / 压铸护航服务），实测 ${geo.topTabCount} 个 —— 需求 713556982 第 2 条`
    );
  }
  if (geo.activeTopTab !== "仿真案例库") {
    problems.push(
      `顶部 tab 默认应当是「仿真案例库」，实测选中的是 ${JSON.stringify(geo.activeTopTab)} —— 需求 713556982 第 2 条`
    );
  }
  if (geo.searchRowY === null) {
    problems.push("找不到搜索行（.nav-search-row）—— 需求 713556982 要求搜索框下移成单独一行");
  } else if (geo.tabsBottom !== null && geo.searchRowY < geo.tabsBottom - 2) {
    problems.push(
      `搜索框没有在 tab 栏下方单独成行：搜索行 y=${geo.searchRowY}，顶部 tab 栏下边缘 y=${geo.tabsBottom} —— ` +
        `需求 713556982 第 2 条要求「搜索框下移出导航栏，作为单独的一行」`
    );
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

/* ============================================================================
 * 案例详情页（需求 713381608 的另一半）
 * ============================================================================
 * 实测结构（2026/10/12，点开列表第一张卡片「凝固应力」）：
 *   .case-detail-page            整页根容器
 *     custom-navbar              顶栏（返回箭头是 .nav-return / icon-base-nav-return）
 *     .case-title                案例名
 *     .meta-block-details / .case-id   案例信息（网格数、时间…）
 *     .case-detail-after-card-divider  分割线
 *     .case-comment-section > .comment-list / .comment-count / .comment-item
 *     .flex.justify-end.footer-icons   底部操作条（实测只有三个图标：点赞 thumb-up / 收藏 star1 / 分享 fenxiang）
 *
 * 需求原文里跟本页有关的两条（都是只读能验的）：
 *   ① 「案例详情页**取消显示底部的复制数图标、评论数图标**」
 *      —— 实测底部操作条里只有 thumb-up / star1 / fenxiang，没有 fuzhi、也没有评论图标 ✓
 *   ② 「评论区标题『**全部回答**』改为『**全部评论**』」
 *      —— 实测页面上有「全部评论」、找不到「全部回答」✓
 *   ③ 「案例详情分享时，缩略图采用案例封面图，标题采用案例名称」—— 分享走系统 UI，**测不了**（记在文档里）
 */

/** 现在屏幕上是不是案例详情页 */
async function isOnDetail(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.detailPage)) > 0;
}

/** 定位案例详情页（前台优先，找不到就跨页找） */
async function findDetailPage(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.detailPage)) > 0) return fg;
  return base.findPageContaining(page, { selector: SEL.detailPage });
}

/**
 * 点开列表第一张卡片，进案例详情页（幂等：已经在详情页就直接返回）。
 * 点击走 `tapLocator`（真实 adb 事件），并且会等 `.case-detail-page` 真的出现才算到达。
 */
async function openFirstCase(page, { timeout = 15000 } = {}) {
  if (await isOnDetail(page)) {
    console.log("已在案例详情页，跳过导航（幂等）");
    return base.foreground(page);
  }
  page = await ensureOn(page);
  const list = await readList(page);
  if (!list.length) throw await base.notFound("案例卡片（列表是空的，没法点进详情页）", await base.foreground(page));

  /*
   * 【点 + 验证 + 重试一次 —— 2026/10/16 补】
   *
   * 真机证据：一天里"点第一张案例卡片后没进详情页"**偶发两次**（`.js` 的案例评论用例、
   * 以及 ZW_027 第一次跑），两次的共同点是紧接着之前有过写数据/页面重渲染 ——
   * 失败截图里人还在列表页（页面没坏），失败信息里 `page.screenshot` 还超时了 10 秒
   *（说明那一会儿 webview 正忙）。单条复跑都过。
   *
   * 这种情况不该让整条用例红：跟 `switchToBottomTab` 一个口径 ——
   * **再点一次并重新验证**（每次都重新取坐标，不闭眼重复同一个坐标）。
   * 两次都不成才报错，错误信息里带上当时的页面文字。
   */
  let ok = false;
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    const fg = await base.foreground(page);
    const cur = await readList(fg);
    if (!cur.length) {
      // 列表在这期间空了（例如页面重新渲染中）：再等一下重读一次
      await base.sleep(1200);
      continue;
    }
    await base.tapLocator(fg, fg.locator(SEL.card).first(), `第一张案例卡片「${cur[0].title}」${attempt > 1 ? "（重试）" : ""}`);
    ok = await base.waitUntil(async () => (await base.countOf(await base.foreground(page), SEL.detailPage)) > 0, {
      timeout,
    });
    if (!ok && attempt < 2) {
      console.log("  [自愈] 点了第一张案例卡片但详情页没出现（偶发的一次点击不生效）—— 重新取坐标再点一次");
    }
  }
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点第一张案例卡片后没有进入详情页（未出现 ${SEL.detailPage}）。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
    );
  }
  console.log(`已进入案例详情页（案例：${list[0].title}）`);
  return base.foreground(page);
}

/**
 * 按**名字**点开某个案例（付费案例的复制链路要用它挑样本）。
 *
 * 做法：直接按文字点；点不到就往下滚几屏再找（列表是瀑布流，目标可能不在首屏）。
 * 找到之后等 `.case-detail-page` 出现才算到达 —— 与 openFirstCase 同一套判据。
 */
async function openByName(page, name, { timeout = 15000, maxScrolls = 6 } = {}) {
  const wanted = String(name || "").trim();
  if (!wanted) throw new Error("「打开案例」需要填案例名（参数1），例如 填充任务1");

  page = await ensureOn(page);
  if (await isOnDetail(page)) {
    const cur = await base.textOf(await base.foreground(page), SEL.detailTitle);
    if (String(cur || "").trim() === wanted) {
      console.log(`已在案例详情页「${cur}」，跳过导航（幂等）`);
      return base.foreground(page);
    }
  }

  const { swipeUp } = require("../android");
  for (let attempt = 0; attempt <= maxScrolls; attempt++) {
    const fg = await base.foreground(page);
    if ((await base.countOfText(fg, wanted)) > 0) {
      await base.tapText(fg, wanted, `案例「${wanted}」`);
      const ok = await base.waitUntil(async () => (await base.countOf(await base.foreground(page), SEL.detailPage)) > 0, {
        timeout,
      });
      if (!ok) {
        const now = await base.foreground(page);
        throw new Error(
          `点了案例「${wanted}」但没有进入详情页（未出现 ${SEL.detailPage}）。\n` +
            `  当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
        );
      }
      console.log(`已进入案例详情页（点了「${wanted}」，第 ${attempt + 1} 屏）`);
      return base.foreground(page);
    }
    if (attempt < maxScrolls) {
      console.log(`  第 ${attempt + 1} 屏没看到「${wanted}」，往下滚一屏再找`);
      page = await swipeUp(page);
      await base.sleep(900);
    }
  }

  const list = await readList(page);
  throw new Error(
    `往下滚了 ${maxScrolls} 屏也没找到案例「${wanted}」。\n` +
      `  当前列表里读到 ${list.length} 张卡片，例如：${JSON.stringify(list.slice(0, 6).map((c) => c.title))}\n` +
      `  （案例名要跟列表上一字不差；也可能是这个案例没发布/被删了）`
  );
}

/**
 * 校验案例详情页是否符合需求（**只读**，断言取自需求 713381608 原文）：
 *   1. 「评论区标题『全部回答』改为『全部评论』」—— 断言：有「全部评论」、**没有**「全部回答」
 *   2. 「案例详情页取消显示底部的复制数图标、评论数图标」—— 断言：底部操作条里的图标
 *      **不含**复制（fuzhi）/ 评论（pinglun / comment）类图标（实测是点赞 / 收藏 / 分享三个）
 */
async function assertDetailRules(page, kwargs, ctx) {
  const fg = (await findDetailPage(page)) || (await base.foreground(page));
  const problems = [];

  const info = await fg.evaluate(
    (sel) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const text = norm(document.body.innerText);
      const icons = [];
      for (const el of Array.from(document.querySelectorAll("wx-text, wx-view"))) {
        const c = String(el.getAttribute("class") || "");
        if (!/icon-base|iconfont/i.test(c)) continue;
        const r = el.getBoundingClientRect();
        icons.push({ cls: c.slice(0, 80), y: Math.round(r.y) });
      }
      const commentSection = document.querySelector(sel.commentSection);
      return {
        hasAllComment: text.includes("全部评论"),
        hasAllAnswer: text.includes("全部回答"),
        icons,
        commentSectionText: commentSection ? norm(commentSection.innerText).slice(0, 40) : "",
        title: norm((document.querySelector(sel.detailTitle) || {}).innerText || ""),
      };
    },
    { commentSection: SEL.commentSection, detailTitle: SEL.detailTitle }
  );

  if (!info.hasAllComment) problems.push("评论区标题不是「全部评论」（需求要求由「全部回答」改过来）");
  if (info.hasAllAnswer) problems.push("页面上还能看到「全部回答」（需求要求改成「全部评论」）");

  // 「底部的复制数图标、评论数图标」应当已经取消 —— 实测底部只有点赞/收藏/分享
  const bottomIcons = info.icons.filter((i) => i.y > 600);
  const badBottom = bottomIcons.filter((i) => /fuzhi|pinglun|comment/i.test(i.cls));
  if (badBottom.length) {
    problems.push(
      `详情页底部仍有复制/评论类图标：${JSON.stringify(badBottom.map((i) => i.cls))}（需求要求取消）`
    );
  }

  if (problems.length) {
    throw new Error(
      "案例详情页不符合需求（713381608）：\n  - " +
        problems.join("\n  - ") +
        `\n  实测: ${JSON.stringify({ 标题: info.title, 底部图标: bottomIcons.map((i) => i.cls), 评论区: info.commentSectionText })}`
    );
  }
  console.log(
    `断言通过: 评论区标题是「全部评论」（页面上没有「全部回答」）；` +
      `详情页底部只有 ${bottomIcons.length} 个图标（${bottomIcons.map((i) => i.cls.split(" ").find((c) => c.startsWith("icon-base")) || "?").join(" / ")}），没有复制数/评论数图标`
  );
  if (ctx) {
    ctx.set("caseDetailTitle", info.title);
    ctx.set("caseDetailCommentTitle", "全部评论");
  }
  return fg;
}

/* ============================================================================
 * 介绍长图页（点案例库首页那张介绍 banner 进去）
 * ============================================================================
 * 实测（2026/10/12）：点 banner 后落到 `.cases-ct-intro-page`，
 * 整页就是**一张超长图** `cases-ct-intro-bg`（实测 347x3790，比屏幕高 5 倍多），
 * 页面文字只有 7 个字（「玩转仿真案例库」）—— 这正是需求说的「介绍长图详情页」。
 *
 * 需求原文：「案例库列表在分类上方展示介绍 banner，**点击后进入介绍长图详情页**」
 *          「首页 banner 图，为**单张图片**，点击后跳转到案例库模块介绍长图页面」
 *          （owner 2026/10/12 澄清：这里的"首页"指**设计中心/案例库的首页**，不是小程序首页）
 */

async function isOnIntro(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.introPage)) > 0;
}

/** 点案例库首页那张介绍 banner，进介绍长图页 */
async function openIntro(page, { timeout = 15000 } = {}) {
  if (await isOnIntro(page)) {
    console.log("已在介绍长图页，跳过导航（幂等）");
    return base.foreground(page);
  }
  page = await ensureOn(page);
  const fg = await base.foreground(page);
  await base.tapSelector(fg, SEL.topBanner, "案例库首页的介绍 banner");
  const ok = await base.waitUntil(async () => (await base.countOf(await base.foreground(page), SEL.introPage)) > 0, {
    timeout,
  });
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点了介绍 banner 但没有进入介绍长图页（未出现 ${SEL.introPage}）。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
    );
  }
  console.log("已进入介绍长图页");
  return base.foreground(page);
}

/**
 * 校验介绍长图页是否符合需求（**只读**）：
 *   1. 整页是**单张图片**（就是那张介绍长图），不是一堆文字/列表
 *   2. 这张图是**长图**：高度远大于屏高（实测 3790 : 屏高 673 ≈ 5.6 倍）
 */
async function assertIntroRules(page, kwargs, ctx) {
  const fg = (await base.foreground(page)) || (await base.foreground(page));
  const problems = [];
  const info = await fg.evaluate(
    (sel) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const img = document.querySelector(sel.introImage);
      const r = img ? img.getBoundingClientRect() : null;
      const all = Array.from(document.querySelectorAll("wx-image")).filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 100 && b.height > 100;
      });
      return {
        hasImage: !!img,
        imgRect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
        imgCount: all.length,
        vh: Math.round(window.innerHeight),
        text: norm(document.body.innerText).slice(0, 60),
      };
    },
    { introImage: SEL.introImage }
  );

  if (!info.hasImage) {
    problems.push(`找不到介绍长图（${SEL.introImage}）—— 需求要求这一页是"单张图片"的长图`);
  } else {
    const [, , w, h] = info.imgRect;
    if (h <= info.vh) {
      problems.push(`介绍图不算"长图"：图高 ${h}px，屏高约 ${info.vh}px（长图应当明显高于屏幕）`);
    }
    if (info.imgCount > 1) {
      problems.push(`页面上不止一张大图（${info.imgCount} 张）—— 需求说是"单张图片"`);
    }
    if (w < 200) problems.push(`介绍图太窄（宽 ${w}px），不像铺满屏宽的介绍长图`);
  }

  if (problems.length) {
    throw new Error(
      "案例库介绍长图页不符合需求（713381608）：\n  - " +
        problems.join("\n  - ") +
        `\n  实测: ${JSON.stringify(info)}`
    );
  }
  console.log(
    `断言通过: 介绍长图页是单张大图（${info.imgRect[2]}x${info.imgRect[3]}，屏高约 ${info.vh}），点击案例库首页 banner 确实跳到这一页`
  );
  if (ctx) ctx.set("caseIntroImageSize", `${info.imgRect[2]}x${info.imgRect[3]}`);
  return fg;
}

/* ============================================================================
 * 复制案例（**会写数据**：复制记录 +1、案例复制数 +1；付费案例还会扣积分）
 * ============================================================================
 * 需求原文：「案例复制完成后，弹出提示复制成功，提示
 *   『使用手机号登录智铸超云，即可查看案例详情』」「免费和付费案例都提示」
 *
 * 2026/10/12 真机实测（案例 60「凝固应力」，免费）：
 *   点详情页的「复制案例」→ 约 1.4 秒后页面出现「复制成功 / 使用手机号登录智铸超云，即可查看案例详情」，
 *   同时库里 `simulation_copy_record` +1、`simulation_case.copy_count` +1（免费案例不扣积分）。
 *
 * ⚠️ 时间顺序注意：提示**不是立刻出现**的（第 1 次采样还没看到，1.4 秒后才出现），
 *    所以这里必须"等 + 轮询"，不能点完立刻断言。
 */

/** 点当前详情页的「复制案例」，并断言弹出需求里那句提示（**会写数据**） */
async function copyCurrentCase(page, { timeout = 10000, ctx = null, onNoEffect = null } = {}) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.detailPage)) === 0) {
    throw new Error(`「复制案例」要在案例详情页上执行（当前页没有 ${SEL.detailPage}）`);
  }
  const before = await base.pageText(fg);
  if (!before.includes(SEL.copyButtonText)) {
    throw new Error(`详情页上找不到「${SEL.copyButtonText}」按钮`);
  }

  /*
   * 付费案例会**先弹确认框**（「确认复制案例？ 花费积分：N / 兑换成功后，不支持撤回兑换」），
   * 只有点「确定」才真的复制（扣积分）。免费案例没有这一步，所以这里要"有就点、没有就跳过"。
   * 实测（2026/10/12）：不加这一步，付费案例点完复制什么都不发生 —— 用例会报
   * 「点了复制案例但没有出现提示」，看着像产品坏了，其实是流程上少点了一次确认。
   */
  /** 点一次「复制案例」并等结果：返回 "toast"（提示已出现）/ "none"（既没确认框也没提示） */
  const tapAndWait = async () => {
    await base.tapText(await base.foreground(page), SEL.copyButtonText, `「${SEL.copyButtonText}」按钮`);

    // 免费案例直接出提示、付费案例先弹确认框 —— 所以这里等"两者之一先出现"，
    // 而不是死等确认框（免费案例根本没有它，死等会白花几秒）
    await base.waitUntil(
      async () => {
        const t = await base.pageText(await base.foreground(page));
        return t.includes(COPY_CONFIRM_MARK) || COPY_TOAST.every((w) => t.includes(w));
      },
      { timeout: 8000, interval: 300 }
    );
    if ((await base.pageText(await base.foreground(page))).includes(COPY_CONFIRM_MARK)) {
      const dialogText = await base.pageText(await base.foreground(page));
      const feeMatch = dialogText.match(/花费积分\s*[:：]?\s*(\d+)/);
      console.log(
        `  [提示] 这是付费案例：弹出确认框「${COPY_CONFIRM_MARK}？花费积分：${feeMatch ? feeMatch[1] : "?"}」` +
          ` —— 点「确定」继续（**这一步会真的扣积分**，积分在中台记账，本动作不复位积分）`
      );
      await base.tapSelector(await base.foreground(page), SEL.dialogConfirm, "确认框的「确定」");
    }

    const ok = await base.waitUntil(
      async () => {
        const text = await base.pageText(await base.foreground(page));
        return COPY_TOAST.every((w) => text.includes(w));
      },
      { timeout, interval: 400 }
    );
    return ok ? "toast" : "none";
  };

  let result = await tapAndWait();

  /*
   * 【点了一次没反应时怎么办 —— 2026/10/15 全量跑里真踩到】
   * 那次 `复制案例` 的点击**像是没生效**：没弹确认框、没出提示，而且**库里一条记录都没多**
   * （复位那步 "deleted=0" 就是证据）。单条复跑同一条用例立刻通过 —— 属于偶发。
   *
   * 这类"操作没生效"和"提示没出现"必须分开处理，否则就是两种后果：
   *   · 当成失败 -> 报告里长期躺着一条偶发红（没人再信红）；
   *   · 无脑重试 -> 万一第一次其实复制成功了，第二次会**又多复制一条**，把"多了 1 条"的断言搞坏。
   * 所以这里把"到底生效没有"交给**调用方**判断（它有数据库水位，能用记录数说话），
   * 只有调用方明确说"没生效、可以重试"时才再点一次。
   */
  if (result !== "toast" && onNoEffect) {
    const noEffect = await onNoEffect();
    if (noEffect) {
      console.log("  [提示] 第一次点击没生效（调用方查库确认：复制记录没变）—— 重新点一次，再等结果");
      result = await tapAndWait();
    } else {
      console.log("  [提示] 库里其实已经多了一条记录 —— 说明是**提示没出现**（不是点击没生效），不再重试");
    }
  }

  if (result !== "toast") {
    const now = await base.pageText(await base.foreground(page));
    const missing = COPY_TOAST.filter((w) => !now.includes(w));
    throw new Error(
      `点了「${SEL.copyButtonText}」但没有出现需求要求的提示，缺：${JSON.stringify(missing)}。\n` +
        `  当前页面前 200 字: ${JSON.stringify(now.slice(0, 200))}`
    );
  }
  console.log(`断言通过: 复制后弹出提示「${COPY_TOAST.join(" / ")}」（与需求原文逐字一致）`);
  if (ctx) ctx.set("caseCopyToastVerified", true);
  return base.foreground(page);
}

module.exports = {
  SEL,
  TAB_TEXT,
  TOP_TABS,
  activeTopTab,
  SORT_TAGS,
  COPY_TOAST,
  COPY_CONFIRM_MARK,
  isOn,
  findCasePage,
  ensureOn,
  readList,
  assertListRules,
  isOnDetail,
  findDetailPage,
  openFirstCase,
  openByName,
  assertDetailRules,
  isOnIntro,
  openIntro,
  assertIntroRules,
  copyCurrentCase,
};
