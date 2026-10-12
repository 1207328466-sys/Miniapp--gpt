/*
 * 页面对象（Page Object）公共能力
 *
 * 【为什么要页面对象】
 * 之前的问题：选择器和"这个页面长什么样"的知识散落在各处 ——
 * 用例层各自定义一套 SEL_* 常量，关键字层（android.js）里也硬编码了业务文案
 * （"我的"、"积分商城"、"学习中心"…）。小程序一改版，就得满仓库找哪里用了它。
 * 页面对象把「某个页面的知识」收进一个文件：它的选择器、它独有的标记、
 * 它能做的操作、以及"现在到底是不是这个页面"的判定。
 *
 * 【一个刻意的设计：所有函数都是"纯函数 + page 作第一个参数"，不用 class/this】
 * 原因在框架本身：runAppSteps 靠 `func.name` 打日志、算耗时、命名截图文件，
 * 并且是以 `func(page, kwargs)` 的形式**独立调用**步骤函数的。
 *   - 用 class 方法 → this 会丢
 *   - 用闭包/箭头函数包一层 → func.name 会变成无意义的名字
 * 所以页面对象 = 一组具名导出的函数，直接写进 funcList 就能用：
 *     [learnCenter.ensureOnColumnList, null]
 *
 * 【边界】
 * 这里只做组合与编排。共用的原子能力（真实 tap、前台页解析、断言）
 * 仍在 common/app_common.js 与 android.js 里 —— 页面对象不重复实现它们。
 *
 * 【所有判据的铁律】
 * 必须先解析出**唯一一个前台页**，再在同一个对象上做全部检查。
 * 历史上"两个判据看两个页面、结论自相矛盾"就是这么来的（账本 根因 9）。
 */

const {
  resolveForegroundPage,
  findPageContaining,
  pagesContaining,
  waitForPageContaining,
} = require("../../../common/app_common");
const { getDevice, tapElement, goBack } = require("../android");

/**
 * 实测的底部 tab 文案。
 * 注意：**按文本判断，不写 class 前缀** —— 各页面 tab 栏的 class 前缀都不一样
 *（实测见过 bar-index--*、index--*），写前缀等于给自己挖坑。
 */
const BOTTOM_TAB_TEXTS = ["有问必答", "学习中心", "设计专区", "我的"];

/** 纯等待。不依赖 page 对象：page 被销毁后 page.waitForTimeout 会抛错 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析当前前台页；解析失败时退回传入的 page（并留下提示，不让整条用例崩在基础设施上）。
 * 页面对象里所有判据都从这里拿 page，保证"同一个判据只看一个页面"。
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Page>}
 */
async function foreground(page) {
  try {
    return await resolveForegroundPage(page);
  } catch (e) {
    console.log(`  [提示] 解析前台页失败，沿用当前 page: ${e.message.split("\n")[0]}`);
    return page;
  }
}

/** 取指定 page 的可见文本（失败返回空串，不抛错） */
async function pageText(p) {
  try {
    if (!p || p.isClosed()) return "";
    return await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
  } catch (e) {
    return "";
  }
}

/** 指定 page 上某选择器命中多少个（失败返回 0） */
async function countOf(p, selector) {
  try {
    if (!p || p.isClosed()) return 0;
    return await p.locator(selector).count();
  } catch (e) {
    return 0;
  }
}

/** 指定 page 上按文本命中多少个（失败返回 0） */
async function countOfText(p, text) {
  try {
    if (!p || p.isClosed()) return 0;
    return await p.getByText(text).count();
  } catch (e) {
    return 0;
  }
}

/** 统一的"找不到"错误：只报"找不到元素"没法定位，必须把页面上有什么一起带上 */
async function notFound(what, page) {
  return new Error(
    `找不到${what}。\n  当前页面前 120 字: ${JSON.stringify((await pageText(page)).slice(0, 120))}`
  );
}

/**
 * 轮询等待某个条件成立。
 * 为什么不用 page.waitForXxx：那些都绑在 page 上，page 一旦被销毁就抛错；
 * 而这里的条件通常是"重新解析前台页之后再判"，必须由调用方自己拿新页面。
 * @param {() => Promise<boolean>} check 条件
 * @param {{timeout?: number, interval?: number}} [options]
 * @returns {Promise<boolean>} 成立返回 true，超时返回 false（不抛错，由调用方决定怎么报）
 */
async function waitUntil(check, { timeout = 8000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  while (true) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(interval);
  }
}

/**
 * 在指定 page 上真实 tap 一个 Locator。
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} locator
 * @param {string} what 人话描述，用于日志与报错
 */
async function tapLocator(page, locator, what) {
  const count = await locator.count().catch(() => 0);
  if (count === 0) throw await notFound(what, page);
  const device = await getDevice();
  await tapElement(device, page, locator.first());
  console.log(`  已点击${what}（匹配 ${count} 个，取第 1 个）`);
}

/**
 * 在指定 page 上真实 tap 选择器命中的第 1 个元素。
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} what 人话描述，用于日志与报错
 */
async function tapSelector(page, selector, what) {
  const label = `${what}（选择器 ${selector}）`;
  if ((await countOf(page, selector)) === 0) throw await notFound(label, page);
  await tapLocator(page, page.locator(selector), label);
}

/**
 * 在指定 page 上按可见文本真实 tap。
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {string} what 人话描述；省略时用文本本身
 */
async function tapText(page, text, what) {
  const label = what || `文本「${text}」`;
  if ((await countOfText(page, text)) === 0) throw await notFound(label, page);
  // 注意用 hasText 精确锁定"包含该文本的那个元素集合"再取第 1 个。
  // 不加 .first() 会在 strict mode 下抛 "resolved to N elements"（账本 根因 3）。
  await tapLocator(page, page.getByText(text), label);
}

/** 取指定 page 上某选择器第 1 个元素的文本（失败返回空串） */
async function textOf(p, selector) {
  try {
    const n = await countOf(p, selector);
    if (n === 0) return "";
    return (await p.locator(selector).first().innerText()).replace(/\s+/g, " ").trim();
  } catch (e) {
    return "";
  }
}

/** 取指定 page 上某选择器第 1 个元素的 class（失败返回空串） */
async function classOf(p, selector) {
  try {
    const n = await countOf(p, selector);
    if (n === 0) return "";
    return await p.locator(selector).first().evaluate((el) => String(el.getAttribute("class") || ""));
  } catch (e) {
    return "";
  }
}

/**
 * 当前页面上有没有底部 tab 栏；有则返回该页，没有返回 null。
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Page|null>}
 */
async function withBottomTabBar(page) {
  const fg = await foreground(page);
  // 【先看结构，再看文字】2026/10/12 踩到：案例详情页的一条**评论内容里含「我的」**
  // （"我的期待我委屈委屈我"），旧判据"四个 tab 文案里命中任意一个就算有 tab 栏"当场被骗 ——
  // 于是框架认定"已经在 tab 页上"，不去点返回，接着点底部 tab 就报「找不到底部 tab」。
  // 小程序的底部 tab 栏有稳定类名（custom-tab-bar），拿它当第一判据。
  if ((await countOf(fg, '[class*="custom-tab-bar"]')) > 0) return fg;

  // 结构上找不到时才退回文字判据，并且要求**至少两个** tab 文案同时出现：
  // 只命中一个仍然可能只是页面内容里恰好有这两个字（比如评论、帖子标题）。
  let hits = 0;
  for (const text of BOTTOM_TAB_TEXTS) {
    if ((await countOfText(fg, text)) > 0) hits += 1;
  }
  return hits >= 2 ? fg : null;
}

/**
 * 确保停在"有底部 tab 栏的一级页面"上。
 *
 * 【为什么需要它 —— 这条是真机验证时踩出来的】
 * 小程序里有一批二级页**没有底部 tab 栏**：专栏详情页、搜索页、答题活动页……
 * 如果用例从这些页面起步，而它的第一步是"点底部 tab 某某"，
 * 就会直接失败在"找不到底部 tab"。实测：从搜索页起步跑
 * `test_learn_center_column`，**两次尝试都失败**，报错是
 * 「当前既不在详情页、也不在学习中心，也找不到底部 tab」——
 * 而当时手机上明明是可以在搜索页点返回回到首页的。
 *
 * 策略：没有 tab 栏就点返回（`goBack` 会校验页面确实变了），最多退 maxAttempts 次。
 *
 * @param {import('playwright').Page} page
 * @param {{maxAttempts?: number}} [options]
 * @returns {Promise<import('playwright').Page>} 带底部 tab 栏的页面
 */
async function ensureOnTabPage(page, { maxAttempts = 3 } = {}) {
  for (let i = 1; i <= maxAttempts; i++) {
    const fg = await foreground(page);
    if (await withBottomTabBar(fg)) return fg;
    console.log(`  [自愈] 当前页没有底部 tab 栏（应处在二级页），点返回退出（第 ${i}/${maxAttempts} 次）`);
    page = await goBack(fg, { timeout: 8000 });
  }
  const fg = await foreground(page);
  throw new Error(
    `尝试 ${maxAttempts} 次返回后仍未出现底部 tab 栏，无法进入一级页面。` +
      `当前页面前 200 字:\n  ${JSON.stringify((await pageText(fg)).slice(0, 200))}`
  );
}

/**
 * 读回输入框的真实内容。
 *
 * 【为什么不能直接读 el.value】
 * 小程序的自定义输入组件（wx-input / wx-textarea）把值放在**属性**上，
 * 不在 DOM 属性（property）上，也不在文本节点里。实测三种读法只有第一种有效：
 *
 *   el.value                          -> undefined（自定义元素没有这个 property）
 *   el.querySelector("input").value   -> ""（内层是个 style="visibility:hidden" disabled 的占位 input）
 *   el.getAttribute("value")          -> "testzzq9x"  ✅
 *
 * 这个坑非常隐蔽：**读不到 ≠ 没输进去**。用错的读法做校验，会得到
 * "输入未生效"的**假失败**（本轮实测踩到，见账本第十六节）。
 *
 * @param {import('playwright').Locator} locator 输入元素
 * @returns {Promise<string>}
 */
async function inputValue(locator) {
  return locator.evaluate((el) => {
    const attr = el.getAttribute ? el.getAttribute("value") : null;
    if (attr !== null) return String(attr);
    if ("value" in el && el.value != null) return String(el.value);
    const inner = el.querySelector ? el.querySelector("input, textarea") : null;
    return inner && inner.value != null ? String(inner.value) : "";
  });
}

module.exports = {
  getDevice,
  findPageContaining,
  pagesContaining,
  waitForPageContaining,
  sleep,
  foreground,
  pageText,
  countOf,
  countOfText,
  notFound,
  waitUntil,
  tapLocator,
  tapSelector,
  tapText,
  textOf,
  classOf,
  BOTTOM_TAB_TEXTS,
  withBottomTabBar,
  ensureOnTabPage,
  inputValue,
};
