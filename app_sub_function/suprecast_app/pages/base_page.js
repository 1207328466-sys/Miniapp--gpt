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
  noteInputSent,
} = require("../../../common/app_common");
const { getDevice, tapElement, goBack } = require("../android");

/**
 * 实测的底部 tab 文案。
 * 注意：**按文本判断，不写 class 前缀** —— 各页面 tab 栏的 class 前缀都不一样
 *（实测见过 bar-index--*、index--*），写前缀等于给自己挖坑。
 */
const BOTTOM_TAB_TEXTS = ["有问必答", "学习中心", "设计专区", "我的"];

/**
 * 底部 tab 栏的容器选择器（Taro 的 `custom-tab-bar`）。
 *
 * 【为什么值得单独拎出来】2026/10/16 真机实测：
 *   · `[class*="custom-tab-bar"]` 命中 **1 个**，它的 class 是 `custom-tab-bar index--custom-tab-bar`
 *     （业务类名原样在，`index--` 那半是编译器噪声）；
 *   · 而「我的」这个词**整页命中 2 个** —— 一个是底部 tab，一个是首页筛选栏的「我的关注」
 *     （`getByText` 默认是"包含"匹配）。也就是说"点底部 tab 我的"一直是在**赌 DOM 顺序**
 *     （账本根因 3 那次 strict mode 报错就是这个撞名）。
 * 圈进这条栏再点，就从"赌"变成"确定"：实测同一个词在栏里只命中 1 个。
 */
const BOTTOM_TAB_BAR = '[class*="custom-tab-bar"]';

/**
 * 下拉刷新在 DOM 里的两个抓手（2026/10/16 真机采样定的，见 docs/踩坑记录.md 坑 53）。
 *
 * 小程序的下拉刷新不是"页面级"的（源码里全局搜不到 `enablePullDownRefresh`），
 * 而是 Taro `<ScrollView refresherEnabled onRefresherRefresh>` —— scroll-view 的**自定义下拉刷新**。
 * Taro 把它渲染成 WeChat 运行时自带的那套元素：
 *   · 容器 `wx--refresher--container--private`：**被拉动/回弹时它的 y 会变**（实测 -674 → -557 → 回 -674）；
 *   · 转圈的点 `wx-refresher-default-dot-*-blink-anim`：**刷新中才有**（实测刷新中 3 个，
 *     静止时是 `-fold` 那 2 个）。
 * 所以"刷新开始/结束"不用 sleep 猜，看这两样就行。
 */
const REFRESHER_CONTAINER = '[class*="wx--refresher--container--private"]';
const REFRESHER_LOADING = '[class*="blink-anim"]';

/**
 * 下拉手势的两个点 —— **纯函数**，方便离线自检。
 *
 * 口径：**0.25 屏高 → 0.75 屏高**（跟框架里滑动用的那对比例一致，见 `android.swipeToEdge`）。
 *
 * 【为什么是这两个数（2026/10/16 实测校准）】一开始用的是 0.34 → 0.70：
 *   · 首页信息流上能刷（那页比较宽松）；
 *   · 但**案例库上完全喂不进去** —— 库里的复制数从 14 改成 15，界面一直显示 14；
 *     换成 0.25 → 0.75、800ms 之后一次就刷出来了（界面变 15）。
 *   同一页上连续采样的证据（`probe_refresher_signal.js`）：下拉过程中刷新容器 y 从 -632 走到 -462、
 *   `blink-anim` 出现 3 个点、`eco-loading-status` 摘掉 `is-hidden` —— 三个信号齐全，
 *   说明"手势到位了"，之前只是**起手点落在一个不吃下拉的区域**。
 * @param {{w:number,h:number}} screen 设备像素尺寸
 * @returns {{x:number,y1:number,y2:number,ms:number}}
 */
function refreshSwipePoints(screen) {
  const w = Number(screen && screen.w) || 0;
  const h = Number(screen && screen.h) || 0;
  const x = Math.round(w / 2);
  const y1 = Math.round(h * 0.25);
  const y2 = Math.min(Math.round(h * 0.75), Math.max(y1 + 200, h - 10));
  return { x, y1, y2, ms: 800 };
}

/** 读一眼下拉刷新的现场：有没有 refresher、它现在在什么位置、是不是在转圈 */
async function readRefresher(p) {
  try {
    return await p.evaluate(
      ({ c, l }) => {
        const el = document.querySelector(c);
        const r = el ? el.getBoundingClientRect() : null;
        return {
          hasRefresher: !!el,
          y: r ? Math.round(r.y) : null,
          loading: document.querySelectorAll(l).length,
        };
      },
      { c: REFRESHER_CONTAINER, l: REFRESHER_LOADING }
    );
  } catch (e) {
    return { hasRefresher: false, y: null, loading: 0 };
  }
}

/**
 * **下拉刷新**（真机验证过：真的会重新取数）。
 *
 * 【为什么要有它】owner 2026/10/15 定：需要刷新就刷新，别让"改了数据没反应"变成误判。
 * 真机实测（2026/10/16，证据见坑 53）：
 *   · 后台置顶一条帖子 → **一次下拉** → 第一条立刻变成「置顶 兄弟」（约 1 秒内）；
 *   · 取消置顶 → 再下拉一次 → 「置顶」立刻摘掉；
 *   · 刷新过程中：`blink-anim` 的点出现（转圈）、信息流卡片数 10 → 0 → 10（**列表真的清空重取**）。
 *
 * 【它和"真切 tab"的关系】两种都能刷新，各有各的用处：
 *   · 下拉刷新：不用离开这一页、任何开了 refresher 的页面都能用（源码里 12 个页面开了）；
 *   · 真切 tab：只有一级页的筛选栏能这么干（坑 49 验过）。
 *   两者都**不刷新**的反例也记着：`进用户中心再回首页`、"本来就在这一栏时调切换"（幂等空操作）。
 *
 * 【判据不是 sleep】① 等"被拉动/开始转圈"；② 等"转圈没了 + 容器位置回到起始值"连续两次成立。
 * 页面不在顶部时会先被滚回顶部（那一下不一定触发刷新），所以没看出迹象会**再试一次**并打日志。
 *
 * @param {import('playwright').Page} page
 * @param {{timeout?: number, startTimeout?: number, attempts?: number}} [options]
 * @returns {Promise<import('playwright').Page>}
 */
async function pullToRefresh(page, { timeout = 15000, startTimeout = 1500, attempts = 5 } = {}) {
  const fg = await foreground(page);
  const before = await readRefresher(fg);
  if (!before.hasRefresher) {
    throw new Error(
      "这一页没有下拉刷新（DOM 里找不到 wx--refresher--container--private）。\n" +
        "  源码里开了下拉刷新的页面：首页信息流 / 案例库 / 学习中心 / 我的 / 安全百科 等 12 个列表页；\n" +
        "  搜索页、帖子详情这类二级页没有。要在这种页面刷新数据，用「返回上一页」重进，或真切一次 tab。"
    );
  }
  const screen = await fg.evaluate(() => ({
    w: Math.round((window.innerWidth || 0) * (window.devicePixelRatio || 1)),
    h: Math.round((window.innerHeight || 0) * (window.devicePixelRatio || 1)),
  }));
  const g = refreshSwipePoints(screen);
  const device = await getDevice();

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await device.shell(`input swipe ${g.x} ${g.y1} ${g.x} ${g.y2} ${g.ms}`);
    noteInputSent(); // 刚下拉过：下一次解析前台页要用"页面可能正在动"的超时

    /*
     * ① 等"真的被拉动/开始转圈"。
     *
     * ⚠️ 两个坑（2026/10/16 都在真机上碰到过，第一个差点让这条判据变成假的）：
     *   · **"容器位置变了"不等于"刷新了"**：把列表往上滚，容器 y 也会变；如果只认这个，
     *     就会报"刷新完成"而其实什么都没刷（在案例库那页真踩到了：它那一下只是把列表滚到顶，
     *     容器 y 从 -2726 变到 -632 就稳住了，于是被判成"刷新完成"）。
     *     **所以"开始刷新"的唯一证据是：转圈的点出现了（`blink-anim`）**。
     *   · **页面可能不在顶部**（列表被上一条用例滚下去了）—— 那一下只是把它滚回顶部，
     *     所以这里允许"多试几次"，一次不成就再拉一次，别一次不成就报错。
     */
    const started = await waitUntil(
      async () => {
        const s = await readRefresher(fg);
        return s.loading > 0;
      },
      { timeout: startTimeout, interval: 120 }
    );
    if (!started) {
      console.log(
        `  [提示] 第 ${attempt}/${attempts} 次下拉没看出刷新迹象（页面多半不在顶部，这一下只是在把它滚回顶部）`
      );
      continue;
    }

    /*
     * ② 等"刷完"：转圈的点没了 **+ 容器位置连续两次不动**。
     *
     * 这里**不能**要求"回到下拉前那一刻的位置"：页面是滚着的，下拉前后基准根本不是一个
     * （实测：案例库列表滚到 -2726 时下拉，回弹之后停在 -1971…-10 这种位置，
     * 死等原基准会 15 秒超时 —— 首页那次"回到 -674"只是因为它本来就在顶部）。
     */
    let last = null;
    let stable = 0;
    const done = await waitUntil(
      async () => {
        const s = await readRefresher(fg);
        const still = s.loading === 0 && last !== null && Math.abs(s.y - last) <= 4;
        last = s.y;
        stable = still ? stable + 1 : 0;
        return stable >= 2;
      },
      { timeout, interval: 150 }
    );
    if (!done) {
      throw new Error(
        `下拉刷新超时（等了 ${timeout}ms 还没回到静止）。\n` +
          `  最后读到：${JSON.stringify(await readRefresher(fg))}（loading>0 = 还在转圈）`
      );
    }
    console.log(`  下拉刷新完成（第 ${attempt} 次下拉触发的；转圈已停、位置稳定在 y=${last}）`);
    return fg;
  }

  throw new Error(
    `下拉了 ${attempts} 次都没触发刷新（每次等 ${startTimeout}ms 没看到"被往下拉/转圈"）。\n` +
      `  三种常见原因：① 这一页的下拉刷新被关掉了（源码 refresherEnabled）；\n` +
      `  ② 手势落点不对（现在是 x=${g.x}, ${g.y1} -> ${g.y2}）—— 手机上手动下拉一次试试，能刷就是落点问题；\n` +
      `  ③ 列表被滚得太深，${attempts} 次都还只够滚回顶部 —— 先加一步「滑动」（方向=下）把它滚到顶，再下拉。`
  );
}

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
 * 拦住「按 id 定位」的写法 —— **纯函数**，方便离线自检。
 *
 * 【为什么把它做成硬规则】2026/10/14 实测结论：**id 是"页面实例"的产物，会变。**
 *   · 页面一直开着时它不变（首页搜索栏 `_AQ` 隔天还在，4 份 dump 都是它）；
 *   · 但**只要重进一次页面就全换**：退出搜索页再进去，输入框 `_JN` → `_Kr`，
 *     5 个热门话题的 id 全换一遍；带 hash 前缀的（`9d834775--_XFi`）更是只在一次 dump 里出现过。
 * 所以框架里**不留任何按 id 定位的口子**：表格里那三个动作（`点id` / `检查id存在` /
 * `检查id不存在`）当天就从动作清单里删掉了；这个函数管住另一条路 ——
 * 有人把 id 写法抄进「点选择器」「检查元素存在」这类**选择器参数**里。
 *
 * 判据刻意保守（宁可判不出来，也不要乱报）：只认 `#xxx` 和 `[id=...]` 两种写法。
 *
 * @param {string} selector 选择器（通常是表格里「参数1」那一格）
 * @returns {string} 原样返回（过了这一关就是合法的），方便直接链式用
 */
function rejectIdSelector(selector) {
  const s = String(selector == null ? "" : selector).trim();
  const looksLikeId = s.startsWith("#") || /\[\s*id\s*[~|^$*]?=/.test(s);
  if (looksLikeId) {
    throw new Error(
      `「${selector}」是**按 id 定位**，框架不允许：id 会变。\n` +
        `  实测（2026/10/14）：页面一直开着时 id 不变，可**只要重进一次页面就全换**——` +
        `退出搜索页再进去，输入框 _JN → _Kr，热门话题 5 条的 id 全换。\n` +
        `  换成这几种（按可靠程度）：① 看得见的文字（「点文字」「检查文字显示」）；` +
        `② class（「打印页面结构」里抄，例如 .search-container）；` +
        `③ 结构写法（例如 .hot-topics .inline-flex，参数2 还能填「第几个」）。`
    );
  }
  return selector;
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
/**
 * 「这个选择器写的是原子类吗？」—— **纯函数**，方便离线自检。命中就返回那个词，否则空串。
 *
 * 【为什么要它】2026/10/15 owner 把小程序前端源码给了我们。源码里能一眼看出两类 class：
 *   · **业务类名**（`eco-tab-item`、`case-list-card`、`overlay-mask`）：写页面时自己起的，
 *     看得懂、稳（实测运行时 DOM 里原样保留）；
 *   · **原子类**（`fs-28`、`text-_h3D3D3D_`、`whitespace-nowrap`）：样式系统编译出来的**样式名**，
 *     一屏上到处都是、换个设计稿就变。
 * 填表的人**分不出**这两类（都长得像 class），最常干的事就是照抄原子类 —— 踩坑记录里那条
 * 「`.fs-28 text-blacks28 ml-2` 找不到选择器」就是这么来的。所以这里认出来、提醒一句，
 * 并告诉他去哪儿找业务类名（`tools/scan_anchors.py --find`）。
 *
 * 判据**只用来提醒，不用来拦截**（宁可漏报，也别把正常选择器说成原子类）：
 *   · 颜色/尺寸被编译成 hex 的：`text-_h3D3D3D_`
 *   · 前缀+数字的：`fs-28`、`ml-2`、`w-4`、`z-10`
 *   · 常见的布局/排版关键字：见 ATOMIC_EXACT
 *
 * @param {string} selector 表里填的选择器
 * @returns {string} 命中的那个原子类名；没认出来返回 ""
 */
function looksLikeAtomicClass(selector) {
  const tokens = String(selector == null ? "" : selector).match(/[A-Za-z_][\w-]*/g) || [];
  for (const t of tokens) {
    if (ATOMIC_PATTERNS.some((re) => re.test(t))) return t;
    if (ATOMIC_EXACT.has(t)) return t;
  }
  return "";
}

/** 原子类的形状（正则） */
const ATOMIC_PATTERNS = [
  /_[0-9A-Za-z]{3,10}_/, // 颜色/尺寸被编译成一串杂名字：text-_h3D3D3D_
  /^[a-z]{1,4}-\d+$/, // 前缀+数字：fs-28 / ml-2 / w-4 / z-10
  /^(text|bg|border|fill|stroke)-(gray|grey|blue|red|green|white|black|yellow|orange|purple|pink|slate|zinc)-\d+$/,
  /^(text|bg|border|fill|stroke)-[a-z]+\d+$/, // bg-blacks38 / text-blacks28（色号被编成名字+数字）
  /^(font|leading|tracking)-(normal|medium|semibold|bold|extrabold|light|thin|relaxed|tight|snug|loose|none)$/,
  /^(whitespace|overflow|object)-(nowrap|normal|hidden|visible|auto|scroll|cover|contain|fill)$/,
];

/** 原子类里那些"不带数字"的常见货 */
const ATOMIC_EXACT = new Set([
  "inline-flex", "flex-1", "flex-auto", "flex-none", "flex-grow", "flex-shrink-0", "flex-col",
  "items-center", "items-start", "items-end", "items-baseline", "justify-center", "justify-start",
  "justify-end", "justify-between", "justify-around", "shrink-0", "grow-0", "self-center",
  "truncate", "ellipsis", "rounded-xs", "rounded-sm", "rounded-md", "rounded-lg", "rounded-full",
  "shadow-lg", "shadow-sm", "border-b", "border-t", "border-l", "border-r", "border-none",
  "border-solid", "border-dashed", "box-border", "w-full", "h-full", "min-h-screen", "max-h-full",
  "max-w-full", "min-w-0", "text-sm", "text-xs", "text-lg", "bg-white", "bg-black", "bg-transparent",
  "bg-red", "text-blue", "text-red", "text-white", "text-black", "object-cover", "object-contain",
  "select-none", "pointer-events-none", "antialiased", "break-keep", "break-words", "break-all",
  "font-weight-500", "font-weight-600", "overflow-y-auto", "overflow-x-hidden", "leading-normal",
  "leading-relaxed", "font-semibold", "font-medium", "font-bold", "font-normal",
]);

/** 认出原子类时的那段人话提醒 */
function atomicAdvice(name) {
  return (
    `\n  [提示] 「${name}」看着是**原子类**（样式系统编译出来的名字）—— 这种名字一屏上到处都是，` +
    `而且换个设计稿就变，不适合当定位锚点。\n` +
    `    源码里的**业务类名**更稳（eco-tab-item / case-list-card / overlay-mask 这种）。\n` +
    `    怎么找：python tools/scan_anchors.py --find <关键词>，或看 knowledge/前端源码与选择器对照.md`
  );
}

async function selectorMissHint(page, selector) {
  // 按 id 找、没找到时的专属提示。
  // 2026/10/14：按 id 定位已经从框架里删掉了（动作删了、选择器参数写了也会在导出时被拦，
  // 见 rejectIdSelector）。这段提示留给**绕过表格的那条路**（页面对象/临时探针里手写
  // `[id="..."]` 的情况）：id 会变，找不到是正常现象，不是"用例写错了"。
  const idMatch = /^\[id="((?:[^"\\]|\\.)+)"\]$/.exec(String(selector || "").trim());
  if (idMatch) {
    return (
      `\n  [提示] 这行是**按 id 找**「${idMatch[1]}」—— 框架里按 id 定位已经删掉了，因为 id 会变：\n` +
      `    · 同一个页面一直开着时它不变（首页搜索栏 _AQ 隔天还在）；\n` +
      `    · 但**只要重进一次这个页面就全换**（实测：退出再进搜索页，搜索框 _JN -> _Kr，\n` +
      `      5 个热门话题的 id 也全换了一遍）。\n` +
      `    所以"昨天还能用的 id 今天找不到"是正常现象，不是你写错了。\n` +
      `    换法（表格里可用）：① 看得见的**文字**（点文字 / 检查文字显示）；② **class**（.search-container）；\n` +
      `    ③ 结构写法（.hot-topics .inline-flex）。id 只当**看结构**的调试信息（打印页面结构 / dump_page.js）。`
    );
  }
  const joined = suggestJoinedSelector(selector);
  // 没有"空格抄错"的问题时，也还有一件常见的事要提醒：**抄的是原子类**。
  // （2026/10/15 起有源码可查，能把这句话说出来，并指路去哪儿找业务类名）
  if (!joined) {
    const atomicOnly = looksLikeAtomicClass(selector);
    return atomicOnly ? atomicAdvice(atomicOnly) : "";
  }
  let n = 0;
  try {
    n = await page.locator(joined).count();
  } catch (e) {
    n = 0;
  }
  const rule = `  [提示] CSS 里**空格表示「里面的」**（后代），不是「同时满足」。`;
  const atomic = looksLikeAtomicClass(joined);
  const tail = atomic ? atomicAdvice(atomic) : "";
  if (n > 0) {
    const first = joined.split(".")[1] ? "." + joined.split(".")[1] : joined;
    return (
      `\n${rule}\n` +
      `    你填的这串看起来是**同一个元素上的多个 class** —— 那样要连着写、不加空格：\n` +
      `    ${joined}（实测能命中 ${n} 个，可以直接照抄）\n` +
      `    也可以只留最有辨识度的那一个，例如 ${first}。\n` +
      `    想确认页面上到底有哪些 class：用表格动作「打印页面结构」，或跑\n` +
      `    node test_case/diagnostic/dump_page.js --only-text` +
      tail
    );
  }
  return (
    `\n${rule}\n` +
    `    如果这几个名字是**同一个元素上的多个 class**，要连着写：${joined}；\n` +
    `    如果确实是「里面的」（例如 .hot-topics .inline-flex），那要检查两半分别写对没有。` +
    tail
  );
}

/**
 * 元素**完整在视口里**吗？—— 只"量一量"，不点不改。
 *
 * 【为什么要这个动作（2026/10/15 补）】缺陷 713581859「切换标签时，没有自动回顶部」要断言的是
 * "切完 tab 之后列表**回到了顶部**"，而框架原来只有「检查元素存在/不存在」——**滚出屏幕的元素
 * 依然"存在"**，那种断言抓不到"没回顶部"。
 *
 * 判据（都按 CSS 像素算）：
 *   · 元素存在且**有尺寸**（宽高 > 0 —— 隐藏元素也有 rect，不能只看 rect）；
 *   · 上下左右**都在视口内**（`top >= -1`、`bottom <= 视口高 + 1`，容 1px 的舍入）。
 *     要的是"**完整**可见"：只露一半 = 没回顶部，就该判不通过。
 *
 * @returns {Promise<{found:boolean, inViewport?:boolean, w?:number, h?:number, top?:number, bottom?:number, vh?:number}>}
 */
async function elementInViewport(page, selector) {
  const s = rejectIdSelector(selector);
  const fg = await foreground(page);
  return fg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const rounded = {
      w: Math.round(r.width),
      h: Math.round(r.height),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      right: Math.round(r.right),
      vw: Math.round(vw),
      vh: Math.round(vh),
    };
    const inViewport =
      r.width > 0 &&
      r.height > 0 &&
      r.top >= -1 &&
      r.bottom <= vh + 1 &&
      r.left >= -1 &&
      r.right <= vw + 1;
    return { found: true, inViewport, ...rounded };
  }, s);
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
/**
 * 「取第几个」的解析 —— **纯函数**，方便离线自检。
 *
 * 为什么要有它（2026/10/14 owner 提的「找找更方便的定位方式」）：
 * 定位元素时最常见的麻烦不是"选择器写不对"，而是**命中了多个、想挑其中一个**：
 * 热门话题那 5 条标题 class 完全一样，页面上"查看"按钮也可能有好几个 ——
 * 而 id 会变（重进页面就全换）、class 重复、文字重名。
 * 所以给「点文字」「点选择器」加一个 **参数2 = 第几个**：留空是第 1 个（老行为不变），
 * 填 2 就是第 2 个。这样既不用学 `:nth-match(...)` 那种写法，也不用碰会变的 id。
 *
 * @param {string|number|undefined} raw 表里填的"第几个"
 * @returns {number} ≥1 的整数；留空返回 1
 */
function parseIndex(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return 1; // 不填 = 第 1 个（跟以前完全一样）
  if (!/^\d+$/.test(s)) {
    throw new Error(`「第几个」只能填 1、2、3… 这样的正整数，现在填的是 ${JSON.stringify(raw)}`);
  }
  const n = Number(s);
  if (n < 1) throw new Error(`「第几个」要从 1 数起，现在填的是 ${n}`);
  return n;
}

/**
 * 从页面文本里抠出**用户看到的积分余额** —— **纯函数**，方便离线自检。
 *
 * 实测口径（2026/10/14 积分商城首页）：页面上是「当前积分 30326」这种形式
 * （同一屏还有「积分明细 / 积分获取 / 积分抽奖 / 兑换记录 / 积分榜单」这些入口名）。
 *
 * 【为什么要读页面上的数，而不是只读库】库里的 `user.points` 是**本地余额**，
 * 而小程序显示的是「本地余额 + 还没同步进来的中台流水」（表字典：point_daily_sync_record 是 T+1 副本）
 * —— 用户看到的是后者。对账要么看用户看到的数，要么两个都看（见 docs/踩坑记录.md 坑 42）。
 *
 * @param {string} text 页面可见文本
 * @returns {number|null} 读到的余额；读不到返回 null（**不要**猜成 0）
 */
function parsePointsFromText(text) {
  const m = /当前积分\s*[:：]?\s*(\d+)/.exec(String(text || ""));
  return m ? Number(m[1]) : null;
}

/**
 * 解析「滑动」的两个参数 —— **纯函数**，方便离线自检。
 *
 * 口径（owner 2026/10/14 定稿）：**「滑动」 = 一直滑到页面不动为止（滑到底/滑到顶）**，
 * 不需要人去设"每次滑多少 / 滑几次"。
 *   · 参数1 = 方向：`上`（往下翻到底）/ `下`（滚回顶部）；**可不填**，留空 = 上
 *   · 参数2 = 最多滑几次（安全上限）：**可不填**，留空 = 10；范围 1~50
 *
 * 为什么要上限：首页那种**无限加载**的列表滑不到头，必须有个数兜着
 * （到上限不当失败，但会明确打一句"还能继续滚"）。
 */
function parseScrollSpec(dirRaw, maxRaw) {
  const d = String(dirRaw == null ? "" : dirRaw).trim();
  const dir = d === "" ? "上" : d;
  if (!["上", "下"].includes(dir)) {
    throw new Error(
      `「滑动」的参数1 是**方向**，只能填「上」或「下」（留空 = 上），现在填的是 ${JSON.stringify(dirRaw)}。\n` +
        `  注意：「滑动」现在不用填次数了 —— 它自己一直滑到不动为止；` +
        `真想限制最多滑几次，把数字填到**参数2**（例如 5）。`
    );
  }
  const m = String(maxRaw == null ? "" : maxRaw).trim();
  if (!m) return { dir, max: 10, maxRaw: "" };
  if (!/^\d+$/.test(m) || Number(m) < 1 || Number(m) > 50) {
    throw new Error(
      `「滑动」的参数2 是「最多滑几次」，只能填 1~50 的整数（留空 = 10），现在填的是 ${JSON.stringify(maxRaw)}`
    );
  }
  return { dir, max: Number(m), maxRaw: m };
}

/**
 * 命中多个时，把**候选**一个个念出来（标签 / class / 坐标 / 前 20 字）。
 *
 * 【为什么值得打这几行】点击"点错了地方"这种事故，在报告里长得跟"点对了"一模一样：
 * 步骤 OK、截图也没错得离谱。2026/10/16 实测到过具体例子：`点文字「推荐」` 在首页
 * **命中 2 处**（筛选 tab 上有一处，信息流某张卡片的标题也恰好是「推荐」），
 * 框架按 DOM 顺序点了第 1 个 —— 这次对了，但换个数据/换个排序就可能点到卡片上。
 * 把候选打出来，报告里就能一眼看出"它挑的是哪一个、还有哪些没被挑"。
 *
 * @param {import('playwright').Locator} locator
 * @param {number} limit 最多念几个
 * @returns {Promise<string[]>}
 */
async function describeMatches(locator, limit = 5) {
  const rows = [];
  for (let i = 0; i < limit; i++) {
    const row = await locator
      .nth(i)
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const txt = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20);
        const cls = String(el.getAttribute("class") || "").trim().split(/\s+/).slice(0, 3).join(".");
        return (
          `<${el.tagName.toLowerCase()}${cls ? " class=" + JSON.stringify(cls) : ""}>` +
          ` @${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)} ` +
          JSON.stringify(txt)
        );
      })
      .catch(() => "(读不到这个候选)");
    rows.push(row);
  }
  return rows;
}

async function tapLocator(page, locator, what, index = 1) {
  const count = await locator.count().catch(() => 0);
  if (count === 0) throw await notFound(what, page);
  if (index > count) {
    throw new Error(
      `${what}：要取第 ${index} 个，但只命中了 ${count} 个（「第几个」不能超出命中数）。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await pageText(page)).slice(0, 120))}`
    );
  }
  if (count > 1) {
    const rows = await describeMatches(locator, Math.min(count, 5));
    console.log(`  [留意] 这一步命中了 ${count} 处，实际点第 ${index} 个 —— 候选如下：`);
    rows.forEach((r, i) => {
      console.log(`      ${i + 1 === index ? "→" : " "} ${i + 1}. ${r}`);
    });
    if (count > rows.length) console.log(`      （还有 ${count - rows.length} 个没显示）`);
    console.log(
      `      点错了的话：参数2 填「第几个」挑，或者改用「范围内点文字」（参数1 填范围选择器、参数2 填文字）圈定范围。`
    );
  }
  const device = await getDevice();
  await tapElement(device, page, locator.nth(index - 1));
  console.log(`  已点击${what}（匹配 ${count} 个，取第 ${index} 个）`);
}

/**
 * 在指定 page 上真实 tap 选择器命中的第 1 个元素。
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} what 人话描述，用于日志与报错
 */
async function tapSelector(page, selector, what, index = 1) {
  const label = `${what}（选择器 ${selector}${index > 1 ? `，第 ${index} 个` : ""}）`;
  // 把 selector 一起传进去：没命中时才能给出"空格是「里面的」"那条提示（填表的人最常踩的坑）
  if ((await countOf(page, selector)) === 0) throw await notFound(label, page, selector);
  // 命中了也提醒一句：抄原子类写用例，今天能跑、改版就烂（判据见 looksLikeAtomicClass）
  const atomic = looksLikeAtomicClass(selector);
  if (atomic) {
    console.log(
      `  [提示] 选择器里的「${atomic}」是原子类（样式名），建议换业务类名：` +
        `python tools/scan_anchors.py --find <关键词>`
    );
  }
  await tapLocator(page, page.locator(selector), label, index);
}

/**
 * 在指定 page 上按可见文本真实 tap。
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {string} what 人话描述；省略时用文本本身
 */
async function tapText(page, text, what, index = 1) {
  const label = (what || `文本「${text}」`) + (index > 1 ? `（取第 ${index} 个）` : "");
  if ((await countOfText(page, text)) === 0) throw await notFound(label, page);
  // 注意用 hasText 精确锁定"包含该文本的那个元素集合"再取第 N 个。
  // 不加 .first() 会在 strict mode 下抛 "resolved to N elements"（账本 根因 3）。
  await tapLocator(page, page.getByText(text), label, index);
}

/**
 * 「范围内点文字」的两个参数怎么读 —— **纯函数**，方便离线自检。
 *
 * 口径（2026/10/16 定）：**参数1 = 范围（容器选择器）、参数2 = 文字**。
 * 为什么要有这个动作：同一个词在页面上出现好几处时，「点文字」只能数"第几个"。
 * 实测（2026/10/16 真机）：首页 `推荐` 这俩字**整页命中 2 处** —— 一处是筛选 tab，
 * 另一处是信息流里某张卡片的标题；圈定 `.eco-tab-bar-container` 之后就只剩 1 处。
 *
 * 这里只做两件事：把两个参数读干净、**把常见的"填反了"当场说清楚**。
 * 为什么值得为"填反"写一段：参数1 是选择器、参数2 是文字，**看着都不像同一个东西**，
 * 但表格里两格挨着，新手很容易把文字填到参数1 —— 那时框架会去页面上找名叫"推荐"的标签，
 * 报一句"找不到范围「推荐」"，人照样看不懂。所以这里直接认出来并告诉他怎么换过来。
 *
 * @param {string} scope 参数1：范围（选择器，例如 .eco-tab-bar-container）
 * @param {string} text 参数2：文字（例如 推荐）
 * @returns {{scopeSelector: string, wanted: string}}
 */
function checkScopeArgs(scope, text) {
  const s = String(scope == null ? "" : scope).trim();
  const t = String(text == null ? "" : text).trim();
  const CJK = /[\u4e00-\u9fa5]/;
  const looksSelector = (v) => /^[.#[]/.test(v);
  if (!s && !t) {
    throw new Error(
      `「范围内点文字」要填两个参数：参数1 = 范围（容器选择器，例如 .eco-tab-bar-container）、` +
        `参数2 = 文字（例如 推荐）。现在两格都空着。`
    );
  }
  if (!s) {
    throw new Error(`「范围内点文字」的参数1（范围）空着 —— 要填一个容器选择器，例如 .eco-tab-bar-container。`);
  }
  if (!t) {
    throw new Error(
      `「范围内点文字」的参数2（文字）空着 —— 要填想在范围里点的那些字，例如 推荐。`
    );
  }
  if (CJK.test(s) && looksSelector(t)) {
    throw new Error(
      `「范围内点文字」两个参数看起来**填反了**：参数1 是**范围**（选择器，例如 .eco-tab-bar-container）、` +
        `参数2 是**文字**（例如 推荐）。\n` +
        `  你现在填的是 参数1=${JSON.stringify(s)}、参数2=${JSON.stringify(t)} —— 换过来就行。`
    );
  }
  if (CJK.test(s)) {
    throw new Error(
      `「范围内点文字」的参数1 是**范围**，要填一个选择器（例如 .eco-tab-bar-container），` +
        `现在填的是 ${JSON.stringify(s)} —— 看着像文字。\n` +
        `  是不是想点「${s}」？那应该：参数1 填范围、参数2 填 ${JSON.stringify(s)}。\n` +
        `  不知道范围该填什么：python tools/scan_anchors.py --find <关键词>`
    );
  }
  rejectIdSelector(s); // 按 id 定位是框架不允许的（id 会变），这道闸门对所有选择器参数一致生效
  return { scopeSelector: s, wanted: t };
}

/**
 * 在**指定范围里**按文字真实 tap 一下。
 *
 * 为什么用 `page.locator(范围).getByText(文字)` 而不是手写 CSS（例如
 * `.eco-tab-bar-container span:has-text("推荐")`）：2026/10/16 真机实测过两种写法的差别 ——
 *   · `getByText` 只给**最内层**那个放文字的节点（实测「最新提问」命中 1 个 = 那个 <span>）；
 *   · `:has-text()` 会把**所有祖先**都算命中（tab 容器、内容区、文字节点全在里面），
 *     再按"第几个"挑，挑到哪一层全看 DOM 顺序 —— 那是"看着有选择器、其实还在猜"。
 * 所以范围 + getByText 这一对是**能说清它点了哪个**的写法。
 *
 * @param {import('playwright').Page} page
 * @param {string} scope 范围（容器选择器）
 * @param {string} text 文字
 * @param {number} index 范围里第几处（默认 1；圈好范围后一般就一处）
 * @returns {Promise<import('playwright').Page>}
 */
async function tapTextWithin(page, scope, text, index = 1) {
  const { scopeSelector, wanted } = checkScopeArgs(scope, text);
  const label = `范围「${scopeSelector}」里的文字「${wanted}」`;
  const scopeLoc = page.locator(scopeSelector);
  const scopeCount = await scopeLoc.count().catch(() => 0);
  if (scopeCount === 0) {
    throw new Error(
      `找不到范围「${scopeSelector}」—— 范围要先在页面上存在，才能在里面找文字。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await pageText(page)).slice(0, 120))}\n` +
        `  范围选择器从哪来：python tools/scan_anchors.py --find <关键词>（例如 --find tab）`
    );
  }
  const hits = scopeLoc.getByText(wanted);
  if ((await hits.count().catch(() => 0)) === 0) {
    throw new Error(
      `范围「${scopeSelector}」里（命中 ${scopeCount} 个容器）没有文字「${wanted}」。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await pageText(page)).slice(0, 120))}\n` +
        `  两层常见原因：① 文字写错了/还没渲染出来；② 范围选小了或选大了（把这个词圈在外面了）。`
    );
  }
  await tapLocator(page, hits, label, index);
  return page;
}

/**
 * 点底部 tab：**优先圈进 tab 栏再按文字点**，栏不在或栏里没这个词才退回整页按文字找。
 *
 * 为什么不直接改成"只在栏里找"：真机上万一某个页面/某次改版没有 `custom-tab-bar`
 * （或 tab 文案变了），一刀切会让所有"切到用户中心"的用例一起红 —— 那种红是框架造成的，
 * 最误导人。所以这里保底退回老写法，并**打一行日志说明它退回了**（不是静默降级）。
 *
 * @param {import('playwright').Page} page
 * @param {string} tabText 底部 tab 文案
 * @param {number} index 第几个（默认 1）
 * @returns {Promise<import('playwright').Page>}
 */
async function tapBottomTab(page, tabText, index = 1) {
  if ((await countOf(page, BOTTOM_TAB_BAR)) > 0) {
    const inBar = await page.locator(BOTTOM_TAB_BAR).getByText(tabText).count().catch(() => 0);
    if (inBar > 0) return await tapTextWithin(page, BOTTOM_TAB_BAR, tabText, index);
    console.log(
      `  [提示] 底部 tab 栏里没有「${tabText}」—— 退回"整页按文字找"（tab 文案可能变了，留意一下）`
    );
  } else {
    console.log(`  [提示] 这一页上没有 custom-tab-bar 容器 —— 退回"整页按文字找"`);
  }
  await tapText(page, tabText, `底部 tab「${tabText}」`, index);
  return page;
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
  if ((await countOf(fg, BOTTOM_TAB_BAR)) > 0) return fg;

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
 * 更要紧的是：**偶发的一次点击不生效** —— 2026/10/12 全量跑里 `ZW_016` 就栽在这上面：
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
    // 圈进 tab 栏再点（2026/10/16）：底部 tab 的文案跟页面内容会撞名 ——
    // 实测「我的」整页命中 2 个（另一个是首页筛选栏的「我的关注」）
    await tapBottomTab(fg, tabText);
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
  elementInViewport,
  parseIndex,
  parsePointsFromText,
  parseScrollSpec,
  suggestJoinedSelector,
  looksLikeAtomicClass,
  checkScopeArgs,
  selectorMissHint,
  rejectIdSelector,
  waitUntil,
  tapLocator,
  tapSelector,
  tapText,
  tapTextWithin,
  textOf,
  classOf,
  BOTTOM_TAB_TEXTS,
  BOTTOM_TAB_BAR,
  refreshSwipePoints,
  pullToRefresh,
  readRefresher,
  withBottomTabBar,
  ensureOnTabPage,
  exitDecision,
  switchToBottomTab,
  tapBottomTab,
  inputValue,
};
