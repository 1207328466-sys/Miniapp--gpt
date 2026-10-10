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

/**
 * 断言「活动入口（活动卡）在内容流的每个筛选 tab 下都显示」。
 * 需求原文：「在最新/推荐/精选/我的关注下都显示」。
 * **只读**：只切 tab + 数活动卡，不点卡片、不改任何数据。
 */
async function assertActivityBlockInAllFeedTabs(page, { tabs = FEED_TABS, waitAfterTab = 2500 } = {}) {
  const results = [];

  for (const tab of tabs) {
    let fg = await base.foreground(page);
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
    fg = await base.foreground(page);

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

/**
 * 现在是不是**真的**停在首页信息流上（判据：看得见至少一个筛选 tab）。
 *
 * 【为什么不能只看「搜索栏存在」】2026/10/10 真机回归踩到：搜索页/搜索结果页同样带
 * `.search-container`，于是 isOn 在搜索页上也返回 true —— 用例以为自己在首页，
 * 接着去数筛选 tab / 数活动卡，得到「一个筛选 tab 都没找到」这种**看着像功能坏了、
 * 其实是没导航到位**的假失败。筛选 tab 只出现在信息流首块，用它当判据就躲开了这个歧义。
 */
async function isOnHomeFeed(page) {
  const fg = await base.foreground(page);
  for (const tab of FEED_TABS) {
    if ((await base.countOfText(fg, tab)) > 0) return true;
  }
  return false;
}

/** 现在是不是搜索页（判据：出现真实输入框；此时搜索栏已消失） */
async function isOnSearchPage(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.searchInput)) > 0;
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
    if (await isOnHomeFeed(page)) return await base.foreground(page);
    console.log(
      `  [自愈] 已在「有问必答」tab 但看不到信息流筛选 tab（多半停在搜索页/搜索结果页），点返回退出（第 ${attempt}/${maxAttempts} 次）`
    );
    page = await goBack(await base.foreground(page));
  }

  throw new Error(
    `尝试 ${maxAttempts} 次退出搜索视图后，仍然看不到首页的筛选 tab` +
      `（${FEED_TABS.join(" / ")}）。`
  );
}

/**
 * 打开搜索页：点搜索栏 → 等真实输入框出现。
 * 已在搜索页时直接返回（幂等）。
 */
async function openSearch(page, { timeout = 15000 } = {}) {
  if (await isOnSearchPage(page)) {
    console.log("已在搜索页，跳过打开动作（幂等）");
    return base.foreground(page);
  }

  page = await ensureOn(page, { timeout });
  await base.tapSelector(page, SEL.searchBar, "搜索栏");

  const ok = await base.waitUntil(async () => isOnSearchPage(page), { timeout });
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点击搜索栏后没有进入搜索页（未出现 ${SEL.searchInput}）。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
    );
  }
  console.log("已进入搜索页");
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

  const fg = await base.foreground(page);
  if (!(await isOnSearchPage(fg))) {
    throw new Error(
      `typeKeyword 需要在搜索页上执行（找不到 ${SEL.searchInput}）。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
    );
  }

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

  // 3) 输入 + 读回校验
  await device.shell(`input text ${keyword}`);

  const expected = clear ? keyword : `${await base.inputValue(input)}`;
  const ok = await base.waitUntil(
    async () => {
      const actual = await base.inputValue(input);
      return clear ? actual === expected : actual.endsWith(keyword);
    },
    { timeout, interval: 300 }
  );
  if (!ok) {
    throw new Error(
      `输入未生效（期望${clear ? "" : "以"} ${JSON.stringify(keyword)} 结尾，实际 ${JSON.stringify(
        await base.inputValue(input)
      )}）。\n` +
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
  isOn,
  isOnHomeFeed,
  isOnSearchPage,
  ensureOn,
  ensureOnHomeFeed,
  openSearch,
  typeKeyword,
  assertActivityBlockInAllFeedTabs,
};
