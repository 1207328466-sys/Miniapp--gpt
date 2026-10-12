/*
 * 页面对象：有问必答（= 首页「压铸人的社区百科」）与它的搜索页
 *
 * 【一个容易混淆的点】文档里出现过两个叫法，实测是**同一个页面**：
 *   「首页（社区百科）」—— 账本里的叫法，418 元素
 *   「有问必答」       —— 底部 tab 上的文字
 * 判据：页面上有 `.search-container` 搜索栏；底部 tab 栏里「有问必答」对应的就是它。
 *
 * 实测结构（2026/10/10）：
 *
 * 有问必答页（约 418 元素）：
 *   <wx-view class="search-container">搜索...</wx-view>          <- 333x34，是个 wx-view，不是输入框
 *   <wx-text class="h5-i iconfont icon-base-search ...">
 * 点它之后进入**搜索页**（新建 page，74~77 元素）：
 *   <wx-input class="h5-input search-input" value="...">         <- 真实输入框
 *   搜索历史 / 热门搜索 等区块
 *   ⚠️ 搜索页上 `.search-container` 为 0 —— 可用它判断"是否已经离开列表页"。
 *
 * 【中文限制】`adb shell input text` **不支持中文**：传中文不报错，但字不会进去。
 * 所以 typeKeyword 对非 ASCII 关键词**直接报错**，而不是让它静默失败 ——
 * 静默失败正是这个框架最想消灭的东西。
 *
 * 【未做】"提交搜索 + 校验结果页"这一层还没做：结果页的结构尚未实测，
 * 不凭猜测写断言。现有能力停在"关键词确实输入进去了"，并且是硬校验。
 */

const base = require("./base_page");

const SEL = {
  searchBar: ".search-container", // 有问必答页的搜索栏（点它跳搜索页）
  searchInput: "wx-input.search-input", // 搜索页的真实输入框
  // 搜索页的「热门话题」区块（需求 713129788）。实测 2026/10/12：
  //   .hot-topics                区块容器；**标题是一张图片**（按文字「热门话题」找不到！）
  //   .hot-topics .inline-flex   每个条目（序号 1..5 + 话题名），实测正好 5 个
  hotTopics: ".hot-topics",
  hotTopicItem: ".hot-topics .inline-flex",
  // 首页内容流首块的「活动卡」（答题/图文/跳转链接三种类型共用）。
  // ⚠️ `quiz_activity_page.js` 用同一选择器点进答题活动 —— 两处引用同一个 class，
  // 小程序改版时这两个地方要一起改。
  activityCard: '[class*="qa-activity-flow-item--card"]',
  activitySwiper: '[class*="qa-activity-flow-item__swiper"]',
};

const BOTTOM_TAB_TEXT = "有问必答";

/**
 * 首页内容流的筛选 tab（用界面上的实际文案）。
 * 口径来源：需求 713594979「小程序-有问必答首页增加活动入口」——
 * 「在最新/推荐/精选/我的关注下都显示」。
 */
const FEED_TABS = ["最新提问", "推荐", "精选问答", "我的关注"];

/** 「回到首页」的默认筛选 tab：标准起点 */
const FEED_DEFAULT_TAB = "最新提问";

/**
 * 首页那排筛选 tab 的**选中态怎么认**。
 *
 * 【证据】2026/10/10 真机实测（探针 `test_case/diagnostic/probe_feed_tabs.js`，
 * 点「最新提问」前后两次快照对照，两个 tab 的值正好互换）：
 *
 *   选中  ： color rgba(0,0,0,0.88) + font-weight 500
 *   未选中： color rgba(0,0,0,0.48) + font-weight 400
 *
 * ⚠️ **没有 class 可用**：首页这排 tab 的标签连 class 都没有（探针里 `cls:` 一行是空的），
 *    选中态完全由计算样式表达，只能读 getComputedStyle。
 *    （对比：学习中心那排顶部 tab 用的是 `class active` —— 两套组件不一样，别互相套用。）
 *
 * 阈值取 0.8 / 500：离实测值足够远（0.88/500 与 0.48/400）。判据万一失效，
 * 报错里会把四个 tab 的原始值全打出来，一眼就能看出是小程序改版了。
 */
const FEED_TAB_SELECTED = { minAlpha: 0.8, minWeight: 500 };

/**
 * 断言「活动入口（活动卡）在内容流的每个筛选 tab 下都显示」。
 * 需求原文：「在最新/推荐/精选/我的关注下都显示」。
 * **只读**：只切 tab + 数活动卡，不点卡片、不改任何数据。
 */
async function assertActivityBlockInAllFeedTabs(page, { tabs = FEED_TABS, waitAfterTab = 2500 } = {}) {
  // 【锚定】这是需求 713594979 的"页面结构检查"，锚在**识别出来的首页信息流页**上，
  // 而不是"猜出来的前台页"：就算前台页判错，只要信息流页存在，这组检查就该在它上面做。
  page = (await findHomeFeedPage(page)) || (await base.foreground(page));
  const results = [];

  for (const tab of tabs) {
    let fg = page; // 用锚定好的那一页，不再每次重新猜前台页
    if ((await base.countOfText(fg, tab)) === 0) {
      // 【自愈】找不到 tab 有两种原因：界面文案真的改了，或者刚才那一下点击把页面带歪了。
      // 后者在真机回归里出现过（见下面那处说明），所以先确认"是不是还在信息流上"。
      if (!(await isOnHomeFeed(fg))) {
        console.log(`  [自愈] 看不到「${tab}」且不像停在信息流上，重新导航后再找一次`);
        page = await ensureOnHomeFeed(page);
        fg = await base.foreground(page);
      }
      if ((await base.countOfText(fg, tab)) === 0) {
        results.push({ tab, cards: null, note: "找不到该筛选 tab" });
        console.log(`  [${tab}] 找不到该筛选 tab —— 跳过（界面文案可能变了）`);
        continue;
      }
    }

    await base.tapText(fg, tab, `筛选 tab「${tab}」`);
    await base.sleep(waitAfterTab);
    fg = page;

    // 【自愈】真机回归踩到（2026/10/10）：某一次点「推荐」时，adb 实际点到了 tab 的
    // **祖先容器**（日志形如「向上第 2 层找到可点击容器」），页面被带到别处 ——
    // 于是后面几个 tab 全部"找不到该筛选 tab"，报出一条看着像"首页改版了"的失败。
    // 同一次运行里紧接着的另一条用例（同样的检查）是 4 个 tab 全过的，所以那是点击偶发失误，
    // 不是小程序的问题。判据用"还看不看得见筛选 tab"，不成立就重新导航、重点一次。
    if (!(await isOnHomeFeed(fg))) {
      console.log(`  [自愈] 点完「${tab}」之后不像停在信息流上（看不见筛选 tab），重新导航并重点一次`);
      page = await ensureOnHomeFeed(page);
      fg = await base.foreground(page);
      if ((await base.countOfText(fg, tab)) > 0) {
        await base.tapText(fg, tab, `筛选 tab「${tab}」（重试）`);
        await base.sleep(waitAfterTab);
        fg = await base.foreground(page);
      }
    }

    const cards = await base.countOf(fg, SEL.activityCard);
    const hasSwiper = (await base.countOf(fg, SEL.activitySwiper)) > 0;
    results.push({ tab, cards, note: `swiper=${hasSwiper}` });
    console.log(`  [${tab}] 活动卡数=${cards} ${hasSwiper ? "(有轮播容器)" : "(无轮播容器)"}`);
  }

  // 谁弄脏谁负责：本函数会把 4 个 tab 逐个点一遍，最后停在最后一个（实测是「我的关注」）。
  // 收尾时把 tab 还回默认的「最新提问」，否则后面的用例会从一个意料之外的筛选 tab 上开始
  //（owner 2026/10/10 反馈的现象）。
  // 注意：归位失败只提示、不影响本次断言结论 —— 免得把"首页有问题"写成"归位失败"。
  try {
    await switchToFeedTab(page, { timeout: 5000 });
  } catch (e) {
    console.warn(`  [提示] 收尾时没能把筛选 tab 归位到「${FEED_DEFAULT_TAB}」：${e.message.split("\n")[0]}`);
  }

  const checked = results.filter((r) => r.cards !== null);
  const bad = checked.filter((r) => r.cards === 0);

  if (!checked.length) {
    throw new Error(
      `一个筛选 tab 都没找到（试过：${tabs.join("、")}）。当前页面前 160 字: ` +
        JSON.stringify((await base.pageText(await base.foreground(page))).slice(0, 160))
    );
  }
  if (bad.length) {
    throw new Error(
      `需求 713594979 要求「活动入口在最新/推荐/精选/我的关注下都显示」，但以下 tab 没有活动卡：\n` +
        bad.map((r) => `  - ${r.tab}`).join("\n") +
        `\n  各 tab 实测: ${JSON.stringify(results)}\n` +
        `  （若所有 tab 都没有，可能当前确实没有进行中的活动 —— 那时整块隐藏才是对的，` +
        `先确认后台有没有"进行中且显示开关打开"的活动）`
    );
  }
  console.log(
    `断言通过: 活动入口在 ${checked.length} 个筛选 tab 下都显示（` +
      checked.map((r) => `${r.tab}:${r.cards}`).join("，") +
      `）`
  );
  return base.foreground(page);
}

/** 现在是不是「有问必答」页（判据：搜索栏存在） */
async function isOn(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.searchBar)) > 0;
}

/** 这一页上是不是同时看得见那 4 个筛选 tab（= 它是首页信息流） */
async function containsAllFeedTabs(p) {
  const t = await base.pageText(p);
  return FEED_TABS.every((x) => t.includes(x));
}

/**
 * 找「首页信息流页」（那排筛选 tab 全都出现的那一页）：**前台优先，找不到就跨页找**。
 *
 * 为什么要有这个"跨页找"：很多判断不该依赖"猜哪个页在前台"（坑 19 反复出问题的地方）。
 * 我们想知道的其实是"有没有哪一页就是首页信息流" —— 那直接在候选页里找就行。
 */
async function findHomeFeedPage(page) {
  const fg = await base.foreground(page);
  if (await containsAllFeedTabs(fg)) return fg;
  return base.findPageContaining(page, { texts: FEED_TABS });
}

/**
 * 找「搜索页」（含 `wx-input.search-input` 的那一页）：同样前台优先、找不到就跨页找。
 */
async function findSearchPage(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.searchInput)) > 0) return fg;
  return base.findPageContaining(page, { selector: SEL.searchInput });
}

/**
 * 现在是不是**真的**停在首页信息流上（判据：看得见至少一个筛选 tab）。
 *
 * 【为什么不能只看「搜索栏存在」】2026/10/10 真机回归踩到：搜索页/搜索结果页同样带
 * `.search-container`，于是 isOn 在搜索页上也返回 true —— 用例以为自己在首页，
 * 接着去数筛选 tab / 数活动卡，得到「一个筛选 tab 都没找到」这种**看着像功能坏了、
 * 其实是没导航到位**的假失败。筛选 tab 只出现在信息流首块，用它当判据就躲开了这个歧义。
 *
 * 2026/10/10 晚追加：判据从"前台页上有没有筛选 tab"改成"**有没有哪一页**是首页信息流"
 * （findHomeFeedPage）—— 少依赖一次"猜前台页"。
 */
async function isOnHomeFeed(page) {
  return Boolean(await findHomeFeedPage(page));
}

/**
 * 读首页那排筛选 tab 的原始状态（只读）。
 *
 * 【为什么必须先锁定「tab 栏」再去读】实测：和某个 tab 同名的元素在整页里不止一处 ——
 * 「最新提问」命中 3 个嵌套元素；点完「最新提问」之后「推荐」甚至命中 6 个，
 * 多出来的是白色 9px 的卡片角标。全页乱找就会读到别的元素（判据假成立/假失败）。
 * 做法：先找**同时包含 4 个 tab 文案的最内层容器**，那就是 tab 栏；再在它里面找标签。
 *
 * @returns {Promise<{found: boolean, selected: string, tabs: Array}>}
 */
async function readFeedTabs(page) {
  // 注意：这里**不再换页**（原来是 base.foreground(page)）——
  // 调用方可能已经把某一页锚定好了（例如"跨页找到的首页信息流页"），这里再换一次就把锚点丢了。
  // 传进来是哪一页，就读哪一页。
  return page.evaluate(
    ({ tabs, minAlpha, minWeight }) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const all = Array.from(document.querySelectorAll("*"));
      const bars = all.filter((el) => tabs.every((t) => norm(el.innerText).includes(t)));
      const bar = bars.length ? bars[bars.length - 1] : null; // 文档顺序里最靠后的那个 = 最内层
      if (!bar) return { found: false, selected: "", tabs: [] };

      const rows = tabs.map((t) => {
        const hits = Array.from(bar.querySelectorAll("*")).filter((el) => norm(el.innerText) === t);
        if (!hits.length) return { tab: t, found: false, alpha: null, weight: null, selected: false };
        const el = hits[hits.length - 1]; // 最内层那个（外层包裹元素的 innerText 也等于 tab 名）
        const cs = getComputedStyle(el);
        const m = cs.color.match(/rgba?\(([^)]+)\)/);
        const nums = m ? m[1].split(",").map((x) => parseFloat(x)) : [];
        const alpha = nums.length === 4 ? nums[3] : 1; // rgb(...) 没有 alpha 位 -> 视为 1
        const weight = parseInt(cs.fontWeight, 10) || 400;
        return {
          tab: t,
          found: true,
          alpha,
          weight,
          color: cs.color,
          selected: alpha >= minAlpha && weight >= minWeight,
        };
      });
      const hit = rows.find((r) => r.selected);
      return { found: true, selected: hit ? hit.tab : "", tabs: rows };
    },
    {
      tabs: FEED_TABS,
      minAlpha: FEED_TAB_SELECTED.minAlpha,
      minWeight: FEED_TAB_SELECTED.minWeight,
    }
  );
}

/** 当前选中的是哪个筛选 tab（拿不到返回空串） */
async function activeFeedTab(page) {
  const info = await readFeedTabs(page);
  return info.selected || "";
}

/**
 * 需求 713341876 规定的筛选 tab 顺序：「最新提问和推荐互换顺序，最新提问为打开首页的默认展示内容」。
 * 实测（2026/10/12，用坐标核对过）：最新提问(130) → 推荐(343) → 精选问答(557) → 我的关注(816)。
 */
const EXPECTED_FEED_TAB_ORDER = ["最新提问", "推荐", "精选问答", "我的关注"];

/** 读首页那排筛选 tab 的**实际先后顺序**（按 DOM 里的顺序，不是按我们常量里的顺序） */
async function feedTabOrder(page) {
  const fg = await base.foreground(page);
  return fg.evaluate((tabs) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const all = Array.from(document.querySelectorAll("*"));
    const bars = all.filter((el) => tabs.every((t) => norm(el.innerText).includes(t)));
    const bar = bars.length ? bars[bars.length - 1] : null; // 最内层的那个 = tab 栏
    if (!bar) return [];
    const order = [];
    for (const el of Array.from(bar.querySelectorAll("*"))) {
      const t = norm(el.innerText);
      if (tabs.includes(t) && !order.includes(t)) order.push(t);
    }
    return order;
  }, FEED_TABS);
}

/**
 * 按需求 713341876 校验首页信息流的筛选 tab：
 *   ① 顺序必须是「最新提问 → 推荐 → 精选问答 → 我的关注」（需求：最新提问和推荐互换顺序）
 *   ② 打开首页默认选中的必须是「最新提问」（需求：最新提问为打开首页的默认展示内容）
 */
async function assertFeedTabOrder(page, { expected = EXPECTED_FEED_TAB_ORDER } = {}) {
  const order = await feedTabOrder(page);
  if (order.length !== expected.length) {
    const fg = await base.foreground(page);
    throw new Error(
      `首页筛选 tab 只读到 ${order.length} 个（期望 ${expected.length} 个）：${JSON.stringify(order)}\n` +
        `  当前页面前 160 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 160))}`
    );
  }
  const same = order.every((t, i) => t === expected[i]);
  if (!same) {
    throw new Error(
      `需求 713341876 要求顺序是 ${JSON.stringify(expected)}，实际是 ${JSON.stringify(order)}\n` +
        `  （这条需求做的就是"最新提问和推荐互换顺序"，顺序变了就是回归）`
    );
  }
  console.log(`  ① 顺序正确：${order.join(" → ")} ✓`);

  const selected = await activeFeedTab(page);
  if (selected !== expected[0]) {
    throw new Error(
      `需求 713341876 要求打开首页默认展示「${expected[0]}」，实测当前选中的是 ${JSON.stringify(selected)}`
    );
  }
  console.log(`  ② 默认选中正确：「${selected}」 ✓`);
  return base.foreground(page);
}

/** 把四个 tab 的实测值拼成一行，用于日志与报错（判据失效时一眼看到真相） */
function describeFeedTabs(info) {
  if (!info.found) return "找不到首页的 tab 栏（当前页可能不在首页信息流上）";
  return info.tabs
    .map((r) => (r.found ? `${r.tab}(alpha=${r.alpha}, weight=${r.weight})` : `${r.tab}(找不到)`))
    .join("，");
}

/**
 * 切到某个筛选 tab，并且**等到它真的变成选中态**才算成功；已选中则直接返回（幂等）。
 *
 * 【为什么非要验证】点一下 ≠ 切过去了：真机回归里出现过"adb 点到 tab 的祖先容器、
 * 页面被带到别处"（踩坑记录坑 17）。不验证就会静默停在错的 tab 上，
 * 让后面的用例在一个意料之外的筛选 tab 上开始 —— 这正是 owner 2026/10/10 反馈的现象。
 */
async function switchToFeedTab(page, { tab = FEED_DEFAULT_TAB, timeout = 8000, maxAttempts = 2 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if ((await activeFeedTab(page)) === tab) {
      console.log(`已选中筛选 tab「${tab}」，无需切换（幂等）`);
      return page;
    }

    // 同样不换页：锚点在哪一页就在哪一页上点（tapText 直接用这一页的坐标）
    if ((await base.countOfText(page, tab)) === 0) {
      throw await base.notFound(`筛选 tab「${tab}」`, page);
    }
    await base.tapText(page, tab, `筛选 tab「${tab}」${attempt > 1 ? "（重试）" : ""}`);

    const ok = await base.waitUntil(async () => (await activeFeedTab(page)) === tab, { timeout });
    if (ok) {
      console.log(`已切到筛选 tab「${tab}」`);
      return page;
    }
    console.warn(
      `  第 ${attempt} 次点「${tab}」之后它没有变成选中态。实测：${describeFeedTabs(await readFeedTabs(page))}`
    );
  }

  throw new Error(
    `点了「${tab}」${maxAttempts} 次，它都没有变成选中态（每次等 ${timeout}ms）。\n` +
      `  实测四个 tab：${describeFeedTabs(await readFeedTabs(page))}\n` +
      `  判据依据：选中 = 颜色 alpha>=${FEED_TAB_SELECTED.minAlpha} 且 font-weight>=${FEED_TAB_SELECTED.minWeight}` +
      `（2026/10/10 实测 0.88/500，未选中 0.48/400）。若四个值整体都变了，多半是小程序改版，判据要重新校准。`
  );
}

/** 现在是不是搜索页（判据：出现真实输入框；此时搜索栏已消失） */
async function isOnSearchPage(page) {
  return Boolean(await findSearchPage(page));
}

/**
 * 确保处于「有问必答」页或搜索页；不在则点底部 tab 过去（幂等）。
 * 这一步把 test_example.js 从"必须人工把手机停到有问必答页"变成了自导航。
 */
async function ensureOn(page, { timeout = 10000 } = {}) {
  if (await isOn(page)) return base.foreground(page);

  // 【这里刻意**不再**把搜索页当成「已到有问必答」】2026/10/10 真机回归时踩到：
  // 手机上停在搜索页（或搜索结果页 —— 它也带着搜索输入框）时，这一行原来会直接返回，
  // 于是用例后面「数活动卡 / 数筛选 tab」就在搜索页上执行，
  // 报出「一个筛选 tab 都没找到」「活动卡数=0」这类**看着像功能坏了、其实导航没到位**的失败。
  // 现在的做法：搜索页也是一种二级页（它没有底部 tab 栏），交给 ensureOnTabPage 点返回退出来。
  // 注意这对「打开搜索」流程没有影响 —— openSearch 会先自己判断"已在搜索页就复用"。

  // 先确保站在"有底部 tab 栏的一级页面"上：专栏详情页 / 答题活动页等二级页都没有
  // 底部 tab 栏，从这里直接去找底部 tab 必然失败（这条是真机验证时踩出来的）。
  page = await base.ensureOnTabPage(page);
  if (await isOn(page)) return await base.foreground(page);

  await base.tapText(page, BOTTOM_TAB_TEXT, `底部 tab「${BOTTOM_TAB_TEXT}」`);

  // 点击后**重新解析前台页**再看结果：切 tab 会新建 page，旧 page 内容会冻结
  //（账本根因 4 / 8），在旧 page 上等只会白等。
  const ok = await base.waitUntil(async () => isOn(page), { timeout });
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点击底部 tab「${BOTTOM_TAB_TEXT}」后没有进入有问必答页（未出现 ${SEL.searchBar}）。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
    );
  }
  console.log("已到达「有问必答」页");
  return base.foreground(page);
}

/**
 * 确保停在**首页信息流**上（不是"有问必答 tab 上的某个搜索视图"）。
 *
 * 【为什么还需要它 —— 真机回归踩到的假失败】
 * 搜索页/搜索结果页同样带 `.search-container`，所以 `isOn` 在那种页面上也返回 true，
 * `ensureOn` 于是直接返回；用例接着去数筛选 tab / 活动卡，就报出
 * 「一个筛选 tab 都没找到」—— 看着像"首页改版了、活动卡没了"，其实只是没导航到位。
 * 这里的判据换成**信息流首块的筛选 tab**，并且在没到位时点返回退出搜索视图再来一轮。
 *
 * @param {import('playwright').Page} page
 * @param {{maxAttempts?: number}} [options]
 * @returns {Promise<import('playwright').Page>} 首页信息流的页面
 */
async function ensureOnHomeFeed(page, { maxAttempts = 3 } = {}) {
  // 延迟 require：本文件与 android.js 互相引用
  const { goBack } = require("../android");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    page = await base.ensureOnTabPage(page); // 二级页（搜索页/详情页/答题页）先点返回退出
    page = await ensureOn(page); // 切到「有问必答」tab（幂等）
    // 【不猜前台页】直接找"哪一页是首页信息流"（前台优先，找不到就跨页找），
    // 找到就把后续操作锚在它上面
    const fg = await base.foreground(page);
    const feed = await findHomeFeedPage(page);
    // 【但它必须"真的显示在屏幕上"】2026/10/12 踩到：搜索页压在上面时，跨页查找会在
    // **被盖住的**首页页里找到信息流 tab —— 于是这一步"报成功"，屏幕上却还停在搜索页；
    // 紧接着的动作（点底部 tab）自然失败，而报错看着像"导航坏了"。
    // 这正是坑 22 的规矩：**到达/幂等判断要看前台页**，跨页查找只用于"定位"。
    if (feed && feed === fg) {
      // 到了信息流还不算完：小程序会记住上次选中的是哪个筛选 tab
      //（上一次跑「检查活动入口」会把 tab 停在「我的关注」），所以顺手归位到默认 tab ——
      // 这样表格里的「回到首页」才真的是"标准起点"。owner 2026/10/10 反馈的就是这个。
      const switched = await switchToFeedTab(feed);
      return await scrollFeedToTop(switched);
    }
    console.log(
      `  [自愈] 屏幕上显示的不是首页信息流${feed ? "（首页被别的页盖住了）" : ""}，` +
        `多半停在搜索页/搜索结果页/二级页，点返回退出（第 ${attempt}/${maxAttempts} 次）`
    );
    page = await goBack(await base.foreground(page));
  }

  throw new Error(
    `尝试 ${maxAttempts} 次退出搜索视图后，仍然看不到首页的筛选 tab` +
      `（${FEED_TABS.join(" / ")}）。`
  );
}

/**
 * 把首页信息流滚回顶部 —— **「起点摆正」的另一半**。
 *
 * 【为什么要它】2026/10/12 实测发现：上一条用例把信息流滚下去之后，「回到首页」只把
 * 筛选 tab 归位，**滚动位置是留着的**。于是下一条用例的起点其实不在顶部：
 *   · 搜索栏被滚出屏幕 —— 点它会落到别处（坑 25 的那次偶发红就是这么来的）；
 *   · 「打开第一个帖子」点到的会是**另一篇帖子**。
 * 第二种最难查：用例没错、框架也没错，错的是"上一条留下的痕迹"，
 * 而失败信息看起来像产品问题。这跟"筛选 tab 会记住上次那个"（坑 18）是同一类问题，
 * 修法也一样：**谁弄脏谁负责**，回首页就回标准起点。
 *
 * 实现：找页面上"最长的那个可滚动容器"（小程序的列表是 wx-scroll-view/div 自己在滚，
 * 不是 window 滚动），把它的 scrollTop 归零。前后各读一次，有变化才打日志（不刷屏）。
 */
async function scrollFeedToTop(page) {
  const fg = await base.foreground(page);
  const info = await fg
    .evaluate(() => {
      let best = null;
      for (const el of document.querySelectorAll("div, wx-view, wx-scroll-view")) {
        const over = el.scrollHeight - el.clientHeight;
        if (over > 20 && (!best || over > best.scrollHeight - best.clientHeight)) best = el;
      }
      const before = best ? best.scrollTop : window.scrollY || 0;
      if (best) best.scrollTop = 0;
      if (window.scrollY) window.scrollTo(0, 0);
      const after = best ? best.scrollTop : window.scrollY || 0;
      return { found: !!best, before: Math.round(before), after: Math.round(after) };
    })
    .catch(() => null);

  if (info && info.before > 0) {
    console.log(`  信息流原本停在 ${info.before}px 处 -> 已滚回顶部（起点摆正）`);
  }
  return fg;
}

/**
 * 打开搜索页：点搜索栏 → 等真实输入框出现。
 * 已在搜索页时直接返回（幂等）。
 */
async function openSearch(page, { timeout = 15000 } = {}) {
  // 【幂等判断必须看前台页】不能用"候选页里有没有搜索页"来判断"我已经在搜索页" ——
  // 那会把"存在但被盖住的旧搜索页"当成已到达（真机实证：切用户中心因此 0.55 秒假成功、页面压根没切）。
  const fg0 = await base.foreground(page);
  if ((await base.countOf(fg0, SEL.searchInput)) > 0) {
    console.log("已在搜索页（前台就是它），跳过打开动作（幂等）");
    return fg0;
  }
  // 记下"点击前就含输入框的旧页"，点完要排除它们 —— 免得把残留的旧页当成刚打开的新页
  const stale = await base.pagesContaining(page, { selector: SEL.searchInput });

  page = await ensureOn(page, { timeout });
  await base.tapSelector(page, SEL.searchBar, "搜索栏");

  // 【不猜前台页】点完直接问："候选页里有没有哪一页出现了真实输入框？"
  // 有就是它（并把它返回，后面的步骤就锚在这一页上）；没有才算真的没进去。
  const found = await base.waitForPageContaining(
    page,
    { selector: SEL.searchInput },
    { timeout, exclude: stale }
  );
  if (!found) {
    const now = await base.foreground(page);
    throw new Error(
      `点击搜索栏后没有进入搜索页（候选页里都没有出现 ${SEL.searchInput}）。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
    );
  }
  console.log("已进入搜索页");
  return found;
}

/** 搜索页上热门话题有几个（只读；0 通常说明没停在搜索页上） */
async function hotTopicCount(page) {
  const fg = await base.foreground(page);
  return base.countOf(fg, SEL.hotTopicItem);
}

/**
 * 点搜索页上的**第一个热门话题**（需求 713129788：点它应跳到"热门话题搜索结果页"）。
 *
 * 为什么按"第一个"点、不按名字点：热门话题是后台配置的（取前 5 个），名字会变 ——
 * 把名字写进用例，过两天就红了。按位置点才稳定。
 */
async function openFirstHotTopic(page) {
  const fg = await base.foreground(page);
  const n = await base.countOf(fg, SEL.hotTopicItem);
  if (n === 0) {
    throw new Error(
      `当前页面上没有热门话题条目（${SEL.hotTopicItem} 命中 0 个）—— 是不是没停在搜索页上？\n` +
        `  当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
    );
  }
  await base.tapLocator(fg, fg.locator(SEL.hotTopicItem).first(), `第 1 个热门话题（共 ${n} 个）`);
  await base.sleep(2500); // 等结果页渲染
  return base.foreground(page);
}

/**
 * 往搜索框输入关键词，并且**读回校验**。
 *
 * 为什么必须硬校验：输入框没拿到焦点时，adb 发过去的按键事件会被系统**静默丢弃**，
 * 不报错、字也没进去。不校验就会得到"跑了但什么都没测"的假通过。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{keyword: string, clear?: boolean, timeout?: number}} params
 *        keyword: 关键词（仅限 ASCII 可见字符，见下方限制说明）
 *        clear: 是否先清空输入框（默认 true，避免残留上一次的关键词）
 * @returns {Promise<import('playwright').Page>} 输入后的前台页
 */
async function typeKeyword(page, { keyword, clear = true, timeout = 8000 } = {}) {
  if (!keyword) throw new Error("typeKeyword 缺少参数 keyword");

  // 只放行一小撮绝对安全的字符：
  //   - 非 ASCII（中文）→ adb input text 不支持，传进去不报错但不生效
  //   - shell 元字符（空格引号 $ & ; 等）→ 命令是发给设备上的 shell 执行的，
  //     带上它们有注入风险，一律不给过
  // 与其静默失败/冒险，不如在这里明确拒绝。
  if (!/^[A-Za-z0-9_.-]+$/.test(keyword)) {
    throw new Error(
      `关键词只允许字母/数字/下划线/点/连字符，当前是 ${JSON.stringify(keyword)}。\n` +
        `  原因：关键词最终通过 \`adb shell input text\` 发送 —— 非 ASCII（中文）不生效且不报错，\n` +
        `  shell 元字符（空格、引号、$、&、; 等）有注入风险。中文输入的方案见 README「已知限制」。`
    );
  }

  // 延迟 require：本文件与 android.js 互相引用
  const { getDevice, tapElement, waitImeShown } = require("../android");

  // 【不猜前台页】直接找含输入框的那一页并锚定到它（找不到才是真的不在搜索页）
  const anchored = await findSearchPage(page);
  if (!anchored) {
    const fg = await base.foreground(page);
    throw new Error(
      `typeKeyword 需要在搜索页上执行（候选页里都没有 ${SEL.searchInput}）。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
    );
  }
  const fg = anchored;

  const device = await getDevice();
  const input = fg.locator(SEL.searchInput).first();

  // 1) 先点一下让输入框拿到焦点，**并确认软键盘真的弹出来**。
  //    没聚焦就发按键，事件会被丢弃（要点 3）。
  await tapElement(device, fg, input);
  if (!(await waitImeShown(device, fg))) {
    throw new Error("输入框没有拿到焦点（软键盘未弹出），此时输入会被系统丢弃，中止");
  }

  // 2) 清空旧内容（搜索框会记住上一次的关键词，实测跨轮次残留）
  if (clear) {
    const current = await base.inputValue(input);
    if (current.length > 0) {
      console.log(`  输入框已有内容 ${JSON.stringify(current)}，先清空`);
      await device.shell("input keyevent 123"); // MOVE_END
      await base.sleep(200);
      for (let i = 0; i < current.length; i++) {
        await device.shell("input keyevent 67"); // DEL
      }
      await base.sleep(300);
      const after = await base.inputValue(input);
      if (after.length > 0) {
        throw new Error(`清空输入框失败，仍有残留内容: ${JSON.stringify(after)}`);
      }
    }
  }

  // 3) 输入 + 读回校验（校验失败就重试几次）
  //
  // 【为什么要重试】2026/10/10 真机踩到：同样敲 `hello`，读回来是 `hlo` ——
  // adb 逐字符发按键时偶发丢字（键盘还在动/事件被丢），重试就能过。
  // 注意：重试**不等于降级校验** —— 每次重试仍然读回比对，三次都不对才报错。
  const expected = clear ? keyword : `${await base.inputValue(input)}`;
  let ok = false;
  let lastActual = "";
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    if (attempt > 1) {
      console.warn(`  第 ${attempt} 次重试输入（上一次读回的是 ${JSON.stringify(lastActual)}）`);
      await device.shell("input keyevent 123"); // MOVE_END
      for (let i = 0; i < 20; i++) await device.shell("input keyevent 67"); // DEL 清空
      await base.sleep(400);
    }
    await device.shell(`input text ${keyword}`);
    ok = await base.waitUntil(
      async () => {
        lastActual = await base.inputValue(input);
        return clear ? lastActual === expected : lastActual.endsWith(keyword);
      },
      { timeout: Math.min(timeout, 4000), interval: 300 }
    );
  }
  if (!ok) {
    throw new Error(
      `输入未生效（重试 3 次仍不对。期望${clear ? "" : "以"} ${JSON.stringify(keyword)} 结尾，` +
        `最后读到 ${JSON.stringify(lastActual)}）。\n` +
        `  这一步必须硬校验：输入框未聚焦时 adb 事件会被静默丢弃，不校验就会产生假通过。`
    );
  }

  console.log(`已输入关键词「${keyword}」并读回校验通过`);
  return base.foreground(page);
}

module.exports = {
  SEL,
  BOTTOM_TAB_TEXT,
  FEED_TABS,
  FEED_DEFAULT_TAB,
  isOn,
  isOnHomeFeed,
  findHomeFeedPage,
  findSearchPage,
  readFeedTabs,
  activeFeedTab,
  feedTabOrder,
  assertFeedTabOrder,
  switchToFeedTab,
  isOnSearchPage,
  ensureOn,
  ensureOnHomeFeed,
  openSearch,
  hotTopicCount,
  openFirstHotTopic,
  typeKeyword,
  assertActivityBlockInAllFeedTabs,
};
