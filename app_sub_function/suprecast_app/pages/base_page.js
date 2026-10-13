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

/**
 * 把「像是把元素的多个 class 抄成一串」的选择器，改写成 CSS 里真正的写法（`.a.b.c`）。
 *
 * 【为什么要有它】真实踩到（2026/10/13 owner 填表）：页面上一个元素的 class 是
 * `fs-28 text-blacks28 ml-2`（**三个 class，用空格分开**），照抄进「点选择器」就变成
 * `.fs-28 text-blacks28 ml-2` —— 而 CSS 里**空格是「里面的」**（后代），于是框架去找
 * 「.fs-28 里面的 <text-blacks28> 里面的 <ml-2>」，必然 0 个命中。
 * 同一个元素上的多个 class，正确写法是**连着写、不加空格**：`.fs-28.text-blacks28.ml-2`。
 *
 * 判断口径（宁可判不出来，也不要乱猜）：必须带空格、第一段是 `.名字` 的样子，
 * 且**后面每一段都是"没带点号的裸名字"**（照抄 class 列表才会这样），而且看着像 class 名
 * （含数字或连字符）。两种写法都会被放过：
 *   · `.hot-topics .inline-flex` —— 后面那半自己带点号，是**合法的"里面的"写法**；
 *   · `.course-detail div` —— `div` 是纯字母，像真标签。
 * （第一版就是漏了"后面必须没带点号"这一条，把 `.hot-topics .inline-flex` 也当成抄错串 ——
 *   自检当场抓到：乱给建议比不给更坏，用户会照着一个同样错的写法去改。）
 *
 * @param {string} selector 表里填的选择器
 * @returns {string|null} 建议的写法（例如 `.a.b.c`）；判断不出来返回 null
 */
function suggestJoinedSelector(selector) {
  const s = String(selector || "").trim();
  if (!s.includes(" ")) return null;
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  if (!parts[0].startsWith(".")) return null;
  const looksLikeClass = (raw) => /[0-9]/.test(raw) || raw.includes("-");
  const names = [];
  names.push(parts[0].slice(1));
  for (const p of parts.slice(1)) {
    if (p.startsWith(".") || p.startsWith("#") || p.startsWith("[")) return null; // 自己带符号 = 合法的独立选择器
    if (!looksLikeClass(p)) return null; // 像真标签（div/span…）
    names.push(p);
  }
  return "." + names.join(".");
}

/**
 * 选择器没命中时的「人话提示」：说明**空格是「里面的」**，并把正确写法算出来。
 *
 * 只有**实测能命中**才敢给确定建议（"写成 X，命中 N 个"）；命不中就只讲规则、不乱指路 ——
 * 宁可少说一句，也不要给一个同样错的答案。
 */
async function selectorMissHint(page, selector) {
  const joined = suggestJoinedSelector(selector);
  if (!joined) return "";
  let n = 0;
  try {
    n = await page.locator(joined).count();
  } catch (e) {
    n = 0;
  }
  const rule = `  [提示] CSS 里**空格表示「里面的」**（后代），不是「同时满足」。`;
  if (n > 0) {
    const first = joined.split(".")[1] ? "." + joined.split(".")[1] : joined;
    return (
      `\n${rule}\n` +
      `    你填的这串看起来是**同一个元素上的多个 class** —— 那样要连着写、不加空格：\n` +
      `    ${joined}（实测能命中 ${n} 个，可以直接照抄）\n` +
      `    也可以只留最有辨识度的那一个，例如 ${first}。\n` +
      `    想确认页面上到底有哪些 class：用表格动作「打印页面结构」，或跑\n` +
      `    node test_case/diagnostic/dump_page.js --only-text`
    );
  }
  return (
    `\n${rule}\n` +
    `    如果这几个名字是**同一个元素上的多个 class**，要连着写：${joined}；\n` +
    `    如果确实是「里面的」（例如 .hot-topics .inline-flex），那要检查两半分别写对没有。`
  );
}

/** 统一的"找不到"错误：只报"找不到元素"没法定位，必须把页面上有什么一起带上 */
async function notFound(what, page, selector) {
  return new Error(
    `找不到${what}。\n  当前页面前 120 字: ${JSON.stringify((await pageText(page)).slice(0, 120))}` +
      (selector ? await selectorMissHint(page, selector) : "")
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
  // 把 selector 一起传进去：没命中时才能给出"空格是「里面的」"那条提示（填表的人最常踩的坑）
  if ((await countOf(page, selector)) === 0) throw await notFound(label, page, selector);
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
 * 点底部 tab 并**验证真的切过去了**（没切过去就再点一次，最多 retries 次）。
 *
 * 【为什么要有它】几处页面对象各写了一遍「点 tab + 等到达」，重试策略还不一样。
 * 更要紧的是：**偶发的一次点击不生效** —— 2026/10/12 全量跑里 `案例库_002` 就栽在这上面：
 * 失败截图显示底部 tab 栏好好的、有问必答 tab 还选中着，说明那一下点击**没有任何反应**，
 * 而单次实现里没有第二次机会（这条用例单独跑是过的，典型的偶发红）。
 *
 * 统一到这里之后：
 *   · 重试是**带验证的**（每次都重新问「目标页到了没」），不是闭眼再点一下；
 *   · 每次重试都打日志（不是静默重试）—— 报告里能看到「第二次才成」这种信号。
 *
 * @param {import('playwright').Page} page
 * @param {string} tabText 底部 tab 的文案（按文字定位：各页面 tab 栏的 class 前缀不一样）
 * @param {{isTarget: () => Promise<boolean>, timeout?: number, retries?: number}} opts
 *   isTarget：目标页到了吗（由调用方定义「到了」的判据）
 */
async function switchToBottomTab(page, tabText, { isTarget, timeout = 15000, retries = 2 } = {}) {
  if (typeof isTarget !== "function") throw new Error("switchToBottomTab 需要 isTarget（判据函数）");
  for (let i = 1; i <= retries; i++) {
    const fg = await foreground(page);
    await tapText(fg, tabText, `底部 tab「${tabText}」`);
    if (await waitUntil(isTarget, { timeout })) return await foreground(page);
    if (i < retries) {
      console.log(`  [自愈] 点了「${tabText}」但目标页没到（第 ${i}/${retries} 次）—— 再点一次`);
    }
  }
  const now = await foreground(page);
  throw new Error(
    `点了 ${retries} 次底部 tab「${tabText}」，目标页始终没出现。\n` +
      `  当前页面前 120 字: ${JSON.stringify((await pageText(now)).slice(0, 120))}`
  );
}

/**
 * 「从二级页退到一级页」的退出判定 —— **纯函数**，只决定下一步做什么。
 *
 * 把判定抽出来单独一个函数，是因为这里踩过**差一次检查**的 bug（2026/10/13）：
 * 原来的循环写成"最多返回 3 次"，而**第 3 次返回之后没有再看一眼**就直接报失败 ——
 * 于是"正好需要退 3 层"的用例（首页 → 我的 → 积分商城 → 积分明细）必红：
 * 第 3 次返回后人已经站在有底部 tab 栏的「我的」页上，框架却放弃了。
 * 真机证据：owner 的用例在「回到首页」这一步失败，而截图里底部 tab 栏清清楚楚就在。
 *
 * 抽成纯函数之后，判定逻辑能被离线自检钉住（test_case/diagnostic/selftest_tabpage_exit.js）。
 *
 * @param {{hasTabBar: boolean, backsDone: number, maxBacks: number}} p
 * @returns {"done" | "back" | "give_up"}
 *   done    已经有底部 tab 栏了（一级页），收工
 *   back    还没有，而且还能再退一次
 *   give_up 退够了次数仍然没有 —— 这时才该报错
 */
function exitDecision({ hasTabBar, backsDone, maxBacks }) {
  if (hasTabBar) return "done";
  if (backsDone < maxBacks) return "back";
  return "give_up";
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
  let backsDone = 0;
  while (true) {
    const fg = await foreground(page);
    const hasTabBar = !!(await withBottomTabBar(fg));
    const action = exitDecision({ hasTabBar, backsDone, maxBacks: maxAttempts });
    if (action === "done") return fg;
    if (action === "give_up") break;
    console.log(
      `  [自愈] 当前页没有底部 tab 栏（应处在二级页），点返回退出（第 ${backsDone + 1}/${maxAttempts} 次）`
    );
    page = await goBack(fg, { timeout: 8000 });
    backsDone++;
  }
  const fg = await foreground(page);
  throw new Error(
    `尝试 ${maxAttempts} 次返回后仍未出现底部 tab 栏，无法进入一级页面。` +
      `当前页面前 200 字:\n  ${JSON.stringify((await pageText(fg)).slice(0, 200))}\n` +
      `  提示：如果屏幕上**明明看得到**底部 tab 栏，那是"前台页认错了页"（多 webview 时的老毛病），` +
      `请把这一步的截图和日志一起发出来 —— 不要当成用例写错了。`
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
  suggestJoinedSelector,
  selectorMissHint,
  waitUntil,
  tapLocator,
  tapSelector,
  tapText,
  textOf,
  classOf,
  BOTTOM_TAB_TEXTS,
  withBottomTabBar,
  ensureOnTabPage,
  exitDecision,
  switchToBottomTab,
  inputValue,
};
