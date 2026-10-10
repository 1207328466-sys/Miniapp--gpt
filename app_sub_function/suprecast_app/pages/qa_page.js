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
};

const BOTTOM_TAB_TEXT = "有问必答";

/** 现在是不是「有问必答」页（判据：搜索栏存在） */
async function isOn(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.searchBar)) > 0;
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
  if (await isOnSearchPage(page)) return base.foreground(page); // 搜索页也算"到了"

  const fg = await base.foreground(page);
  if ((await base.countOfText(fg, BOTTOM_TAB_TEXT)) === 0) {
    throw new Error(
      `无法到达「有问必答」页：当前既没有搜索栏（${SEL.searchBar}），也找不到底部 tab「${BOTTOM_TAB_TEXT}」。` +
        `请手动把小程序切到有底部 tab 栏的页面。当前页面前 200 字:\n  ${(await base.pageText(fg)).slice(0, 200)}`
    );
  }

  await base.tapText(fg, BOTTOM_TAB_TEXT, `底部 tab「${BOTTOM_TAB_TEXT}」`);

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

module.exports = { SEL, BOTTOM_TAB_TEXT, isOn, isOnSearchPage, ensureOn, openSearch, typeKeyword };
