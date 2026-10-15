/*
 * @author: weiyue.zhang
 * @project_name: UITest
 * @cur_file: app_common.js
 * @create_date: 2026/10/8
 *
 * common/test_common.py 中 app 相关部分（app_test / __run_appium_test）的 JS 版本。
 * 参考根目录 app.js：使用 Playwright 的 Android 实验性 API（_android）连接安卓设备，
 * 捕获微信小程序 WebView 的 Page，再按步骤列表依次执行子函数。
 *
 * func_list 格式与 Python 保持一致：
 *   [[func, { param: value }], [func, null], ...]
 * 其中 kwargs 为 null/空 时以 func(page) 调用，否则以 func(page, kwargs) 调用。
 */

const fs = require("fs");
const path = require("path");
const { _android: android } = require("playwright");
const { createStepLogger } = require("./step_log");

// 设备序列号没有默认值 —— 它必须来自"显式指定 / 环境变量 / 唯一连接的设备"，
// 见 pickDevice 的说明（写死一个序列号在换机器时必挂，而且会静默连错设备）。
const DEFAULT_WX_PKG = "com.tencent.mm:appbrand0";
const DEFAULT_WEBVIEW_TIMEOUT = 40000;

/** 允许用环境变量覆盖的配置项（给"本机设备不一样"留出口，不必改代码） */
const ENV_KEYS = {
  deviceSerial: "UITEST_DEVICE_SERIAL",
  pkg: "UITEST_WX_PKG",
  webviewTimeout: "UITEST_WEBVIEW_TIMEOUT",
  appId: "UITEST_APP_ID",
};

/**
 * 本次运行"期望的小程序 appid"。
 *
 * 【为什么需要它 —— 这是一个静默测错对象的风险】
 * 测试环境和生产环境是**两个不同的小程序**，而同一部微信里可能同时缓存着它们。
 * 原来的 `resolveForegroundPage` 在拿不到 appid 时（例如开局落在 `/preload/` 空壳页）
 * 会**按出现频次推断**该用哪个 appid —— 于是有可能推断到生产那个，
 * 之后所有断言都跑在生产小程序上，**而且不会报错**。
 *
 * 所以这里做成"进程级默认值"：`appTest` 里解析一次，之后**所有**
 * `resolveForegroundPage` 调用（包括页面对象内部的）自动带上这道校验，
 * 不需要一层层传参。设置了就以它为准，不匹配一律报错，不退回推断。
 *
 * 取值：`appTest(..., { appId })` > 环境变量 `UITEST_APP_ID` > 不限制（保持旧行为）
 */
let activeExpectedAppId = null;

/**
 * 【诊断】多候选时把"候选页身份"打出来。
 *
 * 为什么要它：2026/10/10 owner 跑表格用例「ZW_007」时，context 里 6 个页面有 3 个
 * 同时在产出动画帧；兜底判据按"元素数最多"挑，挑中了**学习中心·专栏列表**（217 个元素），
 * 而真正在前台的是搜索页 —— 于是"找搜索输入框"必然失败。
 * 当时日志里只有一句「退化为按元素数挑选」，**看不出是哪几个页面在抢**，只能靠猜。
 * 这里把每个候选的身份打出来：元素数 / url / 文字前 60 字。
 *
 * 限流：10 秒最多打一次明细。出错时这类判定每一步都会触发，
 * 不限流会把整段日志冲掉（实测一次运行里刷了 30 多行同样的提示）。
 */
let lastAmbiguityDumpAt = 0;

/**
 * 每个页面"上一轮是不是在出帧" / "是什么时候开始出帧的"。
 *
 * 为什么需要：多候选时的兜底判据原来是"元素数最多的赢"，真机上因此挑错过页（坑 19）。
 * 2026/10/10 用 probe_pages.js --timeline 采样证明了一个可靠信号：
 *   从首页点进搜索页时 —— 搜索页 RAF 由 false 变 true，**被盖住的首页由 true 变 false**。
 * 也就是说"**刚开始出帧的那个页面 = 刚跳过去的页面**"。
 * 用 WeakMap：页面被销毁就自动回收，不会长期占内存。
 */
const rafAliveState = new WeakMap();
const rafAliveSince = new WeakMap();

/**
 * 这个页面能不能当「前台页候选」。
 *
 * 【为什么要有它】2026/10/12 真机抓到：context 里有一个 **11 个元素、正文全空**的页面
 * （appid 与真页面相同，所以躲过了安全阀），它在某个瞬间"出了一帧"，
 * 于是被「最近开始出帧的优先」这条规则挑中 —— 整个用例从一个空白页起步
 * （表现：以「回到首页」开头的用例第一步就失败，报「返回无效、元素数 747→747 没变化」）。
 *
 * 判据（都是实测值，不是拍的）：
 *   - url 含 `/preload/`：微信的预加载空壳页（框架早期文档里就记过这一类）
 *   - 元素数 < 30：实测真实页面 74~747 个元素，空壳页 9~11 个 —— 中间留足余量
 *
 * 兜底：过滤后一个候选都不剩时，调用方会退回"不过滤"的集合 ——
 * 宁可回到旧行为，也不能因为过滤变成"没有页面可用"。
 */
function isUsableForegroundCandidate({ url = "", count = -1 } = {}) {
  if (/\/preload\//.test(String(url))) return false;
  if (count >= 0 && count < 30) return false;
  return true;
}

/**
 * 取"同一个目标小程序"的候选页面（appid 安全阀 + 丢掉已销毁的页）。
 *
 * ⚠️ 这里和 `resolveForegroundPage` 里的候选筛选是**同一套规则的两处实现**：
 * 关键那条是 appid 安全阀（防止静默跑到生产小程序上）。改筛选规则时两处一起改。
 */
function pagesOfExpectedApp(page) {
  let ctx = null;
  try {
    if (page && !page.isClosed()) ctx = page.context();
  } catch (e) {
    /* 已销毁的 page 调 context() 会抛错，走缓存 */
  }
  if (!ctx) ctx = cachedContext;
  if (!ctx) throw new Error("拿不到浏览器 context：传入的 page 已失效，且此前没有缓存过 context");
  cachedContext = ctx;

  const expected = activeExpectedAppId || null;
  return ctx
    .pages()
    .filter((p) => {
      try {
        return !p.isClosed();
      } catch (e) {
        return false;
      }
    })
    .filter((p) => !expected || appIdOf(p.url()) === expected);
}

/**
 * 在候选页里**直接找**"含某个元素 / 某段文字"的那一页（找不到返回 null）。
 *
 * 【为什么需要它】很多操作压根不需要知道"哪个页在前台" —— 它只想知道"哪个页里有我要的东西"。
 * 例：打开搜索页之后要找 `wx-input.search-input`，直接在候选页里找含它的那一页就行，
 * 不必先猜前台页再判断 —— "猜前台页"正是坑 19 反复出问题的地方。
 *
 * @param {import('playwright').Page} page
 * @param {{selector?: string|null, text?: string|null, texts?: string[]|null}} matcher
 *        selector：选择器至少命中 1 个元素
 *        text    ：可见文字里包含这段
 *        texts   ：可见文字里**同时**包含这几段（例如首页那排筛选 tab 全都出现）
 * @returns {Promise<import('playwright').Page|null>}
 *
 * ⚠️ 边界（别误用）：这只解决"**定位**"，不解决"屏幕上现在显示的是哪一页"。
 * 要断言"屏幕上看得见某段文字"，仍然得走 `resolveForegroundPage`。
 */
async function pagesContaining(page, { selector = null, text = null, texts = null } = {}) {
  if (!selector && !text && !texts) {
    throw new Error("pagesContaining 至少要给 selector / text / texts 之一");
  }
  const hits = [];
  for (const p of pagesOfExpectedApp(page)) {
    try {
      if (selector && (await p.locator(selector).count().catch(() => 0)) > 0) {
        hits.push(p);
        continue;
      }
      if (text || texts) {
        const body = await p
          .evaluate(() =>
            String((document.body && document.body.innerText) || "").replace(/\s+/g, " ")
          )
          .catch(() => "");
        if ((text && body.includes(text)) || (texts && texts.length && texts.every((t) => body.includes(t)))) {
          hits.push(p);
        }
      }
    } catch (e) {
      /* 页面可能刚被销毁，跳过 */
    }
  }
  return hits;
}

/**
 * 在候选页里**直接找**"含某个元素 / 某段文字"的那一页（找不到返回 null）。
 *
 * 【为什么需要它】很多操作压根不需要知道"哪个页在前台" —— 它只想知道"哪个页里有我要的东西"。
 * 例：打开搜索页之后要找 `wx-input.search-input`，直接在候选页里找含它的那一页就行，
 * 不必先猜前台页再判断 —— "猜前台页"正是坑 19 反复出问题的地方。
 *
 * ⚠️⚠️ 边界（真机踩过，别误用）：**"候选页里存在某一页" ≠ "屏幕上显示的就是它"。**
 * 所以这个函数只能用来**定位**（找到就去操作它），不能用来判断"我是否已经到达某页" ——
 * 后者会把"存在但被盖住的旧页"当成"已经到了"。
 * 实证：切用户中心时用它做幂等判断 -> 0.55 秒就"成功"了、其实页面压根没切。
 *
 * @param {{exclude?: any[]}} [options] exclude：排除这些页面（例如"点击前就存在的旧页"，
 *        用它避免把残留的旧搜索页当成刚打开的新页）
 */
async function findPageContaining(page, matcher = {}, { exclude = [] } = {}) {
  const hits = await pagesContaining(page, matcher);
  return hits.find((p) => !exclude.includes(p)) || null;
}

/** 反复找"含某元素的页"，直到找到或超时（找不到返回 null） */
async function waitForPageContaining(
  page,
  matcher,
  { timeout = 15000, interval = 300, exclude = [] } = {}
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const hit = await findPageContaining(page, matcher, { exclude });
    if (hit) return hit;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * 多候选时挑"哪个才是前台页"（纯函数，便于单独测）。
 *
 * 规则按优先级：
 *   1. 最近 recentMs 内**刚开始出帧**的那个 —— 说明页面刚跳过去（真机实测信号）；
 *   2. 最近没有新页面开始出帧（说明没在跳转）-> 用调用方手里这一页（它通常就是当前页）；
 *   3. 都没有 -> 退回"元素数最多"（老兜底，保留但降到最后）。
 *
 * @param {Array<{page: any, count: number}>} candidates
 * @param {{callerPage?: any, sinceOf?: (p:any)=>number, recentMs?: number, now?: number}} [options]
 * @returns {{page: any, count: number, why: string}}
 */
function pickForegroundCandidate(
  candidates,
  { callerPage = null, sinceOf = () => 0, recentMs = 3000, now = Date.now() } = {}
) {
  const list = candidates.map((c) => ({ ...c, since: sinceOf(c.page) || 0 }));
  const newest = list.reduce((a, b) => (b.since > a.since ? b : a), list[0]);

  if (newest.since > 0 && now - newest.since <= recentMs) {
    return {
      page: newest.page,
      count: newest.count,
      why: `「${Math.round((now - newest.since) / 1000)} 秒前刚开始出帧」的那个（第 ${list.indexOf(newest) + 1} 个候选）`,
    };
  }

  const same = list.find((c) => c.page === callerPage);
  if (same) {
    return { page: same.page, count: same.count, why: "没有新页面开始出帧，沿用调用方手里这一页" };
  }

  const most = list.reduce((a, b) => (b.count > a.count ? b : a), list[0]);
  return { page: most.page, count: most.count, why: "没有可用信号，退回「元素数最多」（老兜底）" };
}

async function describePageIdentity(p) {
  let url = "(拿不到 url)";
  try {
    url = p.url();
  } catch (e) {
    /* 页面刚被销毁 */
  }
  const count = await p.locator("*").count().catch(() => -1);
  const text = await p
    .evaluate(() =>
      String((document.body && document.body.innerText) || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)
    )
    .catch(() => "(拿不到文字)");
  return { url, count, text };
}

async function logAmbiguity(pages, pickedPage) {
  const now = Date.now();
  if (now - lastAmbiguityDumpAt < 10000) return; // 限流：只打第一次
  lastAmbiguityDumpAt = now;

  const rows = await Promise.all(pages.map(describePageIdentity));
  log.debug(`前台页多候选：${rows.length} 个页面都还在出帧，把它们的身份打出来：[挑中] = 实际采用的`);
  rows.forEach((r, i) => {
    const mark = pages[i] === pickedPage ? "  [挑中]" : "";
    log.debug(`  ${i + 1}) 元素数=${r.count} url=${r.url}${mark}`);
    log.debug(`     文字前 60 字: ${JSON.stringify(r.text)}`);
  });
}

/**
 * 解析期望的 appid（格式校验 + 落到进程级默认值）。
 * @param {{appId?: string}} [options]
 * @returns {string|null}
 */
function resolveExpectedAppId(options = {}) {
  const id = options.appId || process.env[ENV_KEYS.appId] || null;
  if (!id) return null;
  if (!/^wx[0-9a-fA-F]+$/.test(String(id))) {
    throw new Error(
      `期望的 appid 格式不对：${JSON.stringify(id)}（应形如 wx3de2e1d179b60303）`
    );
  }
  activeExpectedAppId = String(id);
  return activeExpectedAppId;
}

/**
 * 决定"用哪台设备"。
 *
 * 优先级：显式传入的 deviceSerial > 环境变量 UITEST_DEVICE_SERIAL > 自动探测。
 *
 * 【为什么不能直接取 devices[0]】
 * 原实现无条件 `devices.find(===硬编码序列号) || devices[0]`，于是：
 *   - 序列号写死，换一台手机就"找不到"，只能靠 devices[0] 兜底蒙对；
 *   - 一旦插了第二台设备（模拟器、同事的手机），会**静默连错设备** ——
 *     不报任何错，但整个用例在测另一个对象。这是最难查的一类问题。
 * 所以这里改成：只有"恰好一台设备"才允许自动选择；多于一台必须显式指定。
 *
 * @param {import('playwright').AndroidDevice[]} devices adb 已识别的设备列表
 * @param {string} [deviceSerial] 显式指定的序列号
 * @returns {import('playwright').AndroidDevice}
 */
function pickDevice(devices, deviceSerial) {
  if (!devices || devices.length === 0) {
    throw new Error(
      "adb 没有识别到任何设备。检查：手机已开启 USB 调试、数据线支持传输、" +
        "`adb devices` 显示 device（而不是 unauthorized/offline）"
    );
  }

  const wanted = deviceSerial || process.env[ENV_KEYS.deviceSerial] || null;
  const serials = devices.map((d) => d.serial());

  if (wanted) {
    const hit = devices.find((d) => d.serial() === wanted);
    if (!hit) {
      throw new Error(
        `指定的设备 ${wanted} 不在已连接列表里。已连接：${serials.join(", ")}`
      );
    }
    return hit;
  }

  if (devices.length === 1) {
    log.info(`未指定设备，自动选用唯一连接的设备：${serials[0]}`);
    return devices[0];
  }

  throw new Error(
    `检测到 ${devices.length} 台设备（${serials.join(", ")}），无法自动决定用哪一台。` +
      `请显式指定其中一台：appTest(funcList, { deviceSerial: "..." })，` +
      `或设置环境变量 ${ENV_KEYS.deviceSerial}=...`
  );
}

/**
 * 解析 webview 相关配置：显式参数 > 环境变量 > 默认值。
 * @param {{pkg?: string, webviewTimeout?: number}} [options]
 * @returns {{pkg: string, webviewTimeout: number}}
 */
function resolveWebviewOptions(options = {}) {
  const rawTimeout =
    options.webviewTimeout || process.env[ENV_KEYS.webviewTimeout] || DEFAULT_WEBVIEW_TIMEOUT;
  const timeout = Number(rawTimeout);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`webviewTimeout 必须是正数，当前值：${rawTimeout}`);
  }
  return {
    pkg: options.pkg || process.env[ENV_KEYS.pkg] || DEFAULT_WX_PKG,
    webviewTimeout: timeout,
  };
}

/**
 * 默认**不打 DEBUG**。
 *
 * 那些 DEBUG 行是"框架内部怎么解析前台页、每步耗时多少"的细节，一次全量跑能刷几百行 ——
 * 对看结果的人（尤其零基础的同事）来说，真正的信号（哪条失败、为什么、截图在哪）会被埋掉。
 * 需要诊断时开一下就行（run.py / pytest / node 都会继承环境变量）：
 *
 *     PowerShell:  $env:UITEST_DEBUG = "1"; python run.py -k 用例编号
 *     跑完清掉:    Remove-Item Env:\UITEST_DEBUG
 *
 * ⚠️ 注意：这只影响 DEBUG。失败信息、步骤明细、截图路径、[提示]/[自愈] 这些**照旧会打** ——
 * 它们才是"出事时要看的东西"，不能因为"太吵"就藏起来。
 */
const DEBUG_ON = /^(1|true|yes|on)$/i.test(String(process.env.UITEST_DEBUG || ""));

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => {
    if (DEBUG_ON) console.log(`[DEBUG] ${msg}`);
  },
};

/**
 * 浏览器 context 缓存。
 *
 * 为什么需要缓存：小程序某些导航会**销毁 page 对象**，此时对已销毁的 page
 * 调用 page.context() 会直接抛错，就再也拿不到兄弟页面、无法恢复。
 * context 对象本身在页面切换 / 销毁后依然有效，所以在第一次拿到时就存下来。
 * @type {import('playwright').BrowserContext|null}
 */
let cachedContext = null;

/**
 * 从 servicewechat URL 里提取小程序 appid；取不到（如 /preload/ 页）返回 null。
 * 实测微信会同时缓存多个小程序，context 里会混入别的小程序的 page。
 * @param {string} url
 * @returns {string|null}
 */
function appIdOf(url) {
  const m = String(url).match(/servicewechat\.com\/(wx[0-9a-fA-F]+)\//);
  return m ? m[1] : null;
}

/**
 * 创建"用例上下文"：给同一用例里的所有步骤共享数据用。
 *
 * 【为什么需要它】
 * 步骤之间经常要传数据，最典型的是"上一步从页面上取到的值，下一步拿来断言"。
 * 之前没有这个能力，用例只能把值挂在函数属性上（`stepClickFirstColumn.firstName = ...`），
 * 那是拿函数对象当全局变量用 —— 名字一旦改了、函数被包装了，就会静默失效。
 *
 * 【作用域】每次 appTest 调用创建一个新 ctx。
 * 这一点是刻意与"参考框架"不同的：那边把提取到的数据放在**类属性**里，
 * 用例之间会互相污染（多进程下更危险）。这里保证每个用例一份，用完即弃。
 *
 * @param {Object} [initial] 初始数据
 * @returns {{data: Object, set: Function, get: Function, has: Function, require: Function, snapshot: Function}}
 */
function createCaseContext(initial = {}) {
  const data = { ...initial };
  return {
    data,
    set(key, value) {
      data[key] = value;
      return value;
    },
    get(key) {
      return data[key];
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(data, key);
    },
    /**
     * 取一个**必须存在**的值：缺失时立刻报错。
     * 缺数据时返回 undefined，会让错误在几步之后以"元素找不到"的形式炸出来，
     * 那时的报错完全看不出根因 —— 与其那样，不如在这里点明。
     */
    require(key) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        throw new Error(
          `上下文里没有 "${key}"。它应该由前面的某个步骤 ctx.set("${key}", ...) 写入；` +
            `当前已有的键：${JSON.stringify(Object.keys(data))}`
        );
      }
      return data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

/**
 * 注入页面执行的探针：能否在超时内等到一帧动画。
 *
 * 后台页对应的原生 WebView 已被系统挂起，渲染线程不再产出帧，
 * 所以 requestAnimationFrame 不触发 —— 能等到帧的才是前台可见页。
 * 注意不能用 locator.isVisible() 判断：后台页里的元素同样返回 true。
 * @param {number} ms 等待上限（毫秒）
 * @returns {Promise<boolean>}
 */
const RAF_PROBE = (ms) =>
  new Promise((resolve) => {
    let done = false;
    requestAnimationFrame(() => {
      done = true;
      resolve(true);
    });
    setTimeout(() => {
      if (!done) resolve(false);
    }, ms);
  });

/**
 * 生成 %m%d_%H%M%S 格式时间戳，用于截图命名
 * @param {Date} date
 * @returns {string}
 */
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * 从调用栈中获取调用者文件名与函数名，等价于 Python 的 inspect.stack()[1]
 * @returns {{fileName: string, funcName: string}}
 */
function getCaller() {
  // 0: Error, 1: getCaller, 2: appTest, 3: 业务调用处
  const stack = (new Error().stack || "").split("\n");
  const frame = stack[3] || "";
  const match = frame.match(/at\s+(?:(\S+)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
  if (match) {
    return {
      fileName: path.basename(match[2]).replace(/\.[^.]+$/, ""),
      funcName: match[1] || "anonymous",
    };
  }
  return { fileName: "app", funcName: "unknown" };
}

/**
 * 按步骤列表执行子函数（同步阻塞式逐步骤执行），参考 __run_appium_test 设计。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {Array<[Function, Object|null]>} testSubFunctions 子步骤列表
 * @param {string|null} photoPath 截图保存路径，为空则不截图
 * @param {{fileName: string, funcName: string}} caller 调用者信息（用于截图目录命名）
 * @param {import('playwright').AndroidDevice|null} device 设备对象，用于截图失败时回退到 adb screencap
 * @param {{resolveForeground?: boolean, stepLog?: Object|null, ctx?: Object|null}} [options]
 *        resolveForeground: 是否在每步开始前把 page 换成当前真正的前台页（默认 true）
 *        stepLog: 结构化步骤日志写入器（见 common/step_log.js）
 *        ctx: 用例上下文（见 createCaseContext），会作为第 3 个参数传给每个步骤
 * @returns {Promise<import('playwright').Page>} page
 */
async function runAppSteps(page, testSubFunctions, photoPath = null, caller = { fileName: "app", funcName: "unknown" }, device = null, options = {}) {
  const { resolveForeground = true, stepLog = null, ctx = null } = options;
  let savedError = null;
  const totalStart = Date.now();
  const stepTimes = [];
  let stepIndex = 0;

  for (const [func, kwargs] of testSubFunctions) {
    stepIndex += 1;
    log.info(`正在执行${func.name}步骤`);

    // 【关键】每步开始前把 page 换成"当前真正显示在屏幕上的前台页"。
    // 为什么必须做：小程序切页后，上一步返回的 page 可能
    //   1) 降级为后台页（仍在 context.pages() 里，但内容冻结在切换前）
    //   2) 直接被销毁
    // 用例拿着这种过期引用去做判据，就会出现"界面明明已经对了、判据却说没对"
    // 的假失败（实测：点击底部 tab 后持续点击 4 次仍未"到达"目标页）。
    if (resolveForeground) {
      try {
        const fg = await resolveForegroundPage(page);
        if (fg !== page) log.debug(`步骤 ${func.name} 前重新解析前台页`);
        page = fg;
      } catch (e) {
        log.debug(`步骤 ${func.name} 前解析前台页失败，沿用当前 page: ${e.message.split("\n")[0]}`);
      }
    }

    const stepStart = Date.now();
    let stepDuration = 0;
    let curPhotoPath = null;
    try {
      // 第 3 个参数是共享上下文。注意无参分支要显式传 undefined 而不是 null ——
      // 很多步骤写成 `(page, { x = 1 } = {})`，传 null 会触发解构报错，传 undefined 才走默认值。
      if (kwargs) {
        page = await func(page, kwargs, ctx);
      } else {
        page = await func(page, undefined, ctx);
      }
    } catch (e) {
      savedError = e;
      log.error(e.message);
    } finally {
      // 记录步骤结束时间并计算执行时间
      stepDuration = (Date.now() - stepStart) / 1000;
      if (photoPath) {
        curPhotoPath = path.join(
          photoPath,
          `${caller.fileName}_${caller.funcName}`,
          `_${func.name}_${timestamp()}.png`
        );
        try {
          fs.mkdirSync(path.dirname(curPhotoPath), { recursive: true });
          // 优先用 Playwright 截图；但实测小程序页面在过渡（路由切换/字体加载）时
          // 会卡在 "waiting for fonts to load" 之后，即使 10 秒超时也会失败。
          // 因此失败后回退到 adb 原生截屏 —— 它截真实屏幕、不受页面脚本影响。
          let shotOk = false;
          try {
            await page.screenshot({ path: curPhotoPath, timeout: 10000 });
            shotOk = true;
          } catch (e1) {
            log.error(`page.screenshot 失败(${e1.message.split("\n")[0]})，改用 adb screencap`);
          }
          if (!shotOk && device) {
            const buf = await device.shell("screencap -p");
            fs.writeFileSync(curPhotoPath, buf);
            log.info(`已用 adb screencap 保存截图: ${path.basename(curPhotoPath)}`);
          }
        } catch (shotErr) {
          log.error(`截图失败: ${shotErr.message.split("\n")[0]}`);
        }
      }
      stepTimes.push([func.name, stepDuration]);

      // 结构化日志：一行一步，供 conftest 还原成报告层次。
      // 必须在 throw 之前写，否则失败的这一步会缺失。
      if (stepLog) {
        stepLog.step({
          num: stepIndex,
          name: func.name,
          status: savedError ? "failed" : "passed",
          duration: stepDuration,
          screenshot: curPhotoPath,
          error: savedError ? savedError.message : null,
        });
      }

      if (savedError) {
        throw savedError;
      }
    }
    log.debug(`${func.name}步骤执行完成，耗时: ${stepDuration.toFixed(2)}秒`);
  }

  // 输出时间统计信息
  const totalDuration = (Date.now() - totalStart) / 1000;
  log.debug("\n=== 测试步骤执行时间统计 ===");
  for (const [stepName, duration] of stepTimes) {
    log.debug(`${stepName}: ${duration.toFixed(2)}秒`);
  }
  log.debug(`总执行时间: ${totalDuration.toFixed(2)}秒`);
  return page;
}






/**
 * 解析出"当前真正显示在屏幕上的小程序前台页"。
 *
 * 这是本框架最核心的一个能力，所有"拿到的 page 对不对"的问题都收敛到这里。
 *
 * 背景：appTest 原来只是"遍历 webview，取第一个 url 含 servicewechat.com 的 page"，
 * 但小程序同一个 context 下并存多个 page（真实内容页 / 预加载页 / 空壳页 / 后台页），
 * URL 全都含 servicewechat.com，于是取到哪个完全看设备返回顺序。
 * 实测取到过只有一个 <body><div> 的预加载空壳页，导致后续所有元素定位全部超时。
 *
 * 判据：后台页对应的原生 WebView 已被系统挂起，渲染线程不再产出帧，
 * 因此 requestAnimationFrame 不触发。能等到帧的才是前台可见页。
 * 注意不能用 locator.isVisible() 判断——后台页内的元素同样返回 true。
 *
 * 【重要】传进来的 page 本身可能就是过期的：
 *   - 已销毁（isClosed() === true）
 *   - 已降级为后台页（仍然活着、仍在 context.pages() 里，但内容冻结）
 * 两种情况都在这里被兜住：context 从缓存取，前台页重新探测。
 * 因此业务用例不需要再自己写"重新获取页面"的逻辑。
 *
 * @param {import('playwright').Page} page 候选页面（允许已失效）
 * @param {{timeout?: number, expectedAppId?: string}} [options]
 *        timeout: 单个页面的 RAF 探测超时（毫秒）；
 *        expectedAppId: 期望的小程序 appid（缺省用进程级默认值）。**设置了就是硬校验**：
 *        候选页里 appid 不匹配的一律排除，一个都没有就报错，不退回"按频次推断"。
 * @returns {Promise<import('playwright').Page>} 当前前台页
 * @throws {Error} context 拿不到、或没有任何页面在产出动画帧时抛出
 */
async function resolveForegroundPage(page, { timeout = 500, expectedAppId = null } = {}) {
  // 【安全阀】期望的 appid：优先用显式传入的，其次用进程级默认值（appTest 解析过一次）
  const expected = expectedAppId || activeExpectedAppId || null;
  // 1) 取浏览器 context：page 可用时优先从它取，已销毁则退回缓存
  let ctx = null;
  try {
    if (page && !page.isClosed()) ctx = page.context();
  } catch (e) {
    // 已销毁的 page 调 context() 会抛错，忽略，走缓存
  }
  if (!ctx) ctx = cachedContext;
  if (!ctx) {
    throw new Error("拿不到浏览器 context：传入的 page 已失效，且此前没有缓存过 context");
  }
  cachedContext = ctx;

  // 2) 收集还活着的候选页面
  const all = ctx.pages().filter((p) => {
    try {
      return !p.isClosed();
    } catch (e) {
      return false;
    }
  });
  if (!all.length) throw new Error("context 里没有任何可用页面");

  // 3) 确定目标 appid。
  //    a) 有"期望 appid"（安全阀打开）-> **硬校验**：不匹配的候选页一律排除，
  //       一个都没有就报错，绝不退回"按频次推断" —— 那是可能静默跑到生产小程序上的路径。
  //    b) 没有期望值 -> 沿用旧行为：优先用传入 page 的 appid，取不到再按出现频次推断。
  let targetAppId = null;
  let candidates;
  if (expected) {
    candidates = all.filter((p) => appIdOf(p.url()) === expected);
    if (!candidates.length) {
      const seen = [...new Set(all.map((p) => appIdOf(p.url()) || "(无 appid 的页，如 /preload/)"))];
      throw new Error(
        `当前微信里没有打开期望的小程序 ${expected}（安全阀拦截）。\n` +
          `  context 里实际看到的 appid：${seen.join("、")}\n` +
          `  这道阀是为了**防止静默测错对象**：测试环境与生产环境是两个不同的小程序，\n` +
          `  宁可不跑，也不要跑到另一个上去。若确认要测的是别的小程序，\n` +
          `  请改环境变量 UITEST_APP_ID，或传 appTest(..., { appId }) 。`
      );
    }
    targetAppId = expected;
  } else {
    try {
      if (page && !page.isClosed()) targetAppId = appIdOf(page.url());
    } catch (e) {
      // 忽略
    }
    if (!targetAppId) {
      const freq = new Map();
      for (const p of all) {
        const id = appIdOf(p.url());
        if (id) freq.set(id, (freq.get(id) || 0) + 1);
      }
      let best = 0;
      for (const [id, n] of freq) {
        if (n > best) {
          best = n;
          targetAppId = id;
        }
      }
    }
    const pool = targetAppId ? all.filter((p) => appIdOf(p.url()) === targetAppId) : all;
    candidates = pool.length ? pool : all;
  }

  // 3.5) 【空壳页先剔掉】按 url 剔一遍（`/preload/` 是微信的预加载空壳页）。
  //      过滤后一个不剩就用原集合 —— 宁可回到旧行为，也不能"没有候选"。
  const byUrl = candidates.filter((p) => {
    try {
      return isUsableForegroundCandidate({ url: p.url() });
    } catch (e) {
      return true;
    }
  });
  if (byUrl.length) candidates = byUrl;

  // 4) 并行探测：只有还在产出动画帧的才是前台页。
  //    这里必须并行——串行探测每个页面最多要等一个 timeout，
  //    7 个页面就是 3.5 秒的纯等待，放到每一步之前会严重拖慢用例。
  const probes = await Promise.all(
    candidates.map(async (p) => {
      try {
        const alive = await p.evaluate(RAF_PROBE, timeout);
        if (!alive) return null;
        const count = await p.locator("*").count().catch(() => 0);
        return { page: p, count };
      } catch (e) {
        // 页面不可用（预加载页 / 已销毁），跳过
        return null;
      }
    })
  );
  const aliveRaw = probes.filter(Boolean);
  // 4.5) 【空壳页再剔一遍】这次按元素数（实测真实页面 74~747，空壳页 9~11）。
  //      同样：剔完一个不剩就不过滤。
  const alive = aliveRaw.filter((a) => isUsableForegroundCandidate({ count: a.count }));
  if (!alive.length) alive.push(...aliveRaw);

  /*
   * 4.6) 【单个候选不能轻信 —— 2026/10/15 补】
   *
   * 真机事故：手机停在小程序**二级页（答题页）**，框架却挑了后台的**首页信息流**，
   * 之后整条用例都在"错的页面上"操作，最后报出一句看不懂的「找不到底部 tab 我的」。
   * 复核发现：微信里**每页都在以 ~60fps 出帧**（实测答题页 61 帧/秒、后台首页 60 帧/秒），
   * 所以"还出不出帧"这个二值判据分不出谁在屏幕上；能分出的是**输入归属**
   * （发一次 ESC，只有屏幕上那页收到 keydown，实测后台页 0 次）。
   *
   * 但输入归属只在"多候选"分支里用得上。事故那次偏偏只剩**一个**候选 ——
   * 屏幕上那页的探测**超时了一次**（500ms 没等到帧）就被判成"没在出帧"，直接踢出候选，
   * 于是没有歧义、也没人去问输入归属，就这么挑了后台页。
   *
   * 所以这里加一道复核：**候选不止一个、却只剩一个出帧时，把落选的那些用更长的超时再探一次**。
   * 探不回来 -> 维持原判（不改变原来的行为）；探回来了 -> 进入多候选判定，
   * 由输入归属这条硬信号来定（见 pickByInputOwnership）。
   */
  if (alive.length === 1 && candidates.length > 1) {
    const alivePages = new Set(alive.map((a) => a.page));
    const retry = await Promise.all(
      candidates
        .filter((p) => !alivePages.has(p))
        .map(async (p) => {
          try {
            return (await p.evaluate(RAF_PROBE, 1200)) ? p : null;
          } catch (e) {
            return null;
          }
        })
    );
    const back = retry.filter(Boolean);
    if (back.length) {
      console.log(
        `  [提示] 前台页复核：第一轮只探到 1 个在出帧的页面，但用更长的超时又探到 ${back.length} 个` +
          ` —— 交给「输入归属」判定谁在屏幕上（微信里前后台页面都会出帧，单靠出帧分不出来）`
      );
      for (const p of back) {
        const count = await p.locator("*").count().catch(() => 0);
        if (isUsableForegroundCandidate({ count })) alive.push({ page: p, count });
      }
    }
  }

  // 记录"每个页面是什么时候开始出帧的"（多候选时用它挑：刚出帧的那个 = 刚跳过去的页面）
  const nowTs = Date.now();
  const aliveSet = new Set(alive.map((a) => a.page));
  for (const { page: p, count } of alive) {
    if (rafAliveState.get(p) !== true) {
      rafAliveState.set(p, true);
      rafAliveSince.set(p, nowTs);
      log.debug(`前台页信号：一个页面开始出帧（元素数=${count}）`);
    }
  }
  for (const p of candidates) {
    if (!aliveSet.has(p)) rafAliveState.set(p, false);
  }

  if (!alive.length) {
    // 没有任何页面在产出帧：可能是切换过渡中，也可能判据本身不适用。
    // 此时退回传入的 page（只要它还活着），让调用方仍拿到一个能用的对象。
    if (page && !page.isClosed()) return page;
    throw new Error(`context 里 ${candidates.length} 个页面都没有检测到前台页（RAF 全部不活跃）`);
  }

  // 5) 唯一候选：直接用它
  let picked = alive[0];

  // 6) 多个候选：几乎只发生在页面切换的过渡窗口里（新旧页面短暂同时出帧）。
  //    实测从专栏列表页进详情页时出现过：旧列表页 188 个元素、新详情页 118 个，
  //    此时若按"元素最多"挑，会选中已经过期的那一个。
  //    所以先等一小拍再探一次，让过渡结束；仍然分不清才退化为按元素数挑。
  if (alive.length > 1) {
    await new Promise((r) => setTimeout(r, 250));
    const second = await Promise.all(
      alive.map(async ({ page: p }) => {
        try {
          return (await p.evaluate(RAF_PROBE, timeout)) ? p : null;
        } catch (e) {
          return null;
        }
      })
    );
    const still = second.filter(Boolean);
    if (still.length === 1) {
      const count = await still[0].locator("*").count().catch(() => 0);
      picked = { page: still[0], count };
    } else {
      // 【先问"输入送给谁"】多页同时出帧时，DOM 层看不出谁在显示（见 pickByInputOwnership 的说明）。
      // 输入只会到显示中的那一页，所以先发一次 ESC 探一下 —— 探不出来才退回原来的挑法。
      const byInput = await pickByInputOwnership(still);
      if (byInput) {
        const count = await byInput.locator("*").count().catch(() => 0);
        picked = { page: byInput, count };
      } else {
        // 多候选且输入归属也定不下来：按 pickForegroundCandidate 的三条规则挑（详见该函数注释）
        const chosen = pickForegroundCandidate(alive, {
          callerPage: page,
          sinceOf: (p) => rafAliveSince.get(p) || 0,
        });
        picked = { page: chosen.page, count: chosen.count };
        log.debug(`前台页判定仍有 ${still.length} 个候选（疑似页面过渡中），挑法：${chosen.why}`);
        // 把候选页身份打出来（限流，一次运行里只打第一次）—— 这种事靠猜没有意义
        await logAmbiguity(still, picked.page);
      }
    }
  }

  if (picked.page !== page) {
    log.debug(`前台页解析: 候选=${candidates.length} 活跃=${alive.length} 元素数=${picked.count}`);
  }
  return picked.page;
}

/* ============================================================================
 * 输入归属探测：**多页同时出帧时，谁才是屏幕上显示的那一页**
 * ============================================================================
 * 【为什么需要它 —— 2026/10/12 一次全量 22 条全红】
 *   框架原来的前台页判据是「还在出帧 + 最近开始出帧的优先」。可**多个页面会同时以 60fps 出帧**
 *   （实测案例库页就一直在动画），于是判据认错了页：屏幕上明明已经切回首页（截图为证），
 *   框架却还盯着案例库页 —— 接下来每一步的"校验"都在错的页上做，整轮测试全红。
 *
 * 【试过、但不行的信号（都实测过，别再走一遍）】
 *   · document.visibilityState / document.hidden —— 所有页都是 visible/false
 *   · document.hasFocus() —— 所有页都 true
 *   · body 的 display / visibility / opacity / 尺寸 / elementFromPoint —— 全都一样
 *   · 出帧节奏（连续 8 个 120ms 窗口）—— 显示页与后台页都是 8/8/8/8…，分辨不出来
 *
 * 【能行的信号：输入只会送到显示中的那一页】
 *   给每个候选页装一个 keydown 监听，然后发一次 `keyevent 111`（ESC）——
 *   实测**只有显示中的那一页**收到了 keydown；而且 ESC 只收输入法、不改界面（零副作用）。
 */
const inputProbeReady = new WeakSet();

/** 给一页装"输入到达"监听（每页只装一次） */
async function installInputProbe(p) {
  if (inputProbeReady.has(p)) return true;
  try {
    await p.evaluate(() => {
      if (window.__uitestInputProbeInstalled) return;
      window.__uitestInputProbeInstalled = true;
      window.__uitestInputSeen = 0;
      document.addEventListener("keydown", () => {
        window.__uitestInputSeen = Date.now();
      }, true);
    });
    inputProbeReady.add(p);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 用"输入归属"挑出前台页。
 * @param {Array<import('playwright').Page>} candidates 都还在出帧的候选页
 * @returns {Promise<import('playwright').Page|null>} 恰好一页收到输入就返回它；否则 null（交给原判据）
 */
async function pickByInputOwnership(candidates) {
  const installed = await Promise.all(candidates.map(installInputProbe));
  if (!installed.some(Boolean)) return null;

  let device = null;
  try {
    // 延迟 require：本文件与 android.js 互相引用（同文件里其它地方也是这么做的）
    device = await require("../app_sub_function/suprecast_app/android").getDevice();
  } catch (e) {
    return null;
  }

  const sentAt = Date.now();
  try {
    await device.shell("input keyevent 111"); // ESC：只收输入法，不改界面
  } catch (e) {
    return null;
  }
  await new Promise((r) => setTimeout(r, 250));

  const seen = [];
  for (const p of candidates) {
    try {
      const ts = await p.evaluate(() => window.__uitestInputSeen || 0);
      if (ts >= sentAt) seen.push(p);
    } catch (e) {
      // 页面不可用，跳过
    }
  }
  if (seen.length === 1) {
    log.debug("前台页输入归属判定：只有一页收到输入（ESC）");
    return seen[0];
  }
  log.debug(`前台页输入归属判定：${seen.length} 页收到输入（无法据此定论）`);
  return null;
}

/**
 * 兼容旧调用方的薄封装：解析前台页，失败时返回原 page（不抛错）。
 * 新代码请直接用 resolveForegroundPage。
 * @param {import('playwright').Page} page 候选页面
 * @param {number} timeout 单个页面的探测超时（毫秒）
 * @returns {Promise<import('playwright').Page>}
 */
async function pickForegroundPage(page, timeout = 800) {
  try {
    return await resolveForegroundPage(page, { timeout });
  } catch (e) {
    log.debug(`pickForegroundPage 解析失败，返回原 page: ${e.message.split("\n")[0]}`);
    return page;
  }
}

/**
 * 等待微信小程序 WebView 并获取其 Page，同时等待 DOM 加载与视口就绪。
 *
 * 【重要】返回值保证是"当前显示在屏幕上的前台页"，而不是随便一个 webview 对应的页。
 * 小程序同一 context 下并存多个 page，选错会导致元素定位全部超时。
 *
 * @param {import('playwright').AndroidDevice|null} device 设备对象；为空时自行连接
 * @param {{pkg?: string, webviewTimeout?: number}} [options]
 *        pkg: 小程序 webview 进程包名；webviewTimeout: 等待 webview 出现的超时（毫秒）
 * @returns {Promise<import('playwright').Page>} 小程序前台 webview 的 page
 */
async function getWxWebviewPage(device = null, options = {}) {
  const { pkg, webviewTimeout } = resolveWebviewOptions(options);
  const expectedAppId = options.appId ? resolveExpectedAppId(options) : activeExpectedAppId;

  if (!device) {
    // 【官方API：android.devices】连接安卓设备，adb必须已经识别设备
    const devices = await android.devices();
    device = pickDevice(devices); // 显式指定 > 环境变量 > 唯一的设备 > 报错
    log.info(`AndroidDevice连接成功，设备serial: ${device.serial()}`);
  }
  log.info(`等待微信小程序WebView（pkg=${pkg}，超时 ${webviewTimeout}ms）...`);

  // 给可能阻塞的调用加超时兜底，避免某个后台 webview 拖死整体。
  //
  // 【纪律】错误消息里必须带上**实际使用的延时值**，而不是只带形参名对应的值。
  // 原因：自建的超时封装如果把参数写串（例如把 label 当成了 ms），会产生
  // "看起来完全正常"的超时错误 —— 团队工作流里有专门一篇踩坑记录：
  // setTimeout(fn, label) -> 延时 NaN -> 立即触发，而消息里插值的是正确的 ms，
  // 信息自洽、完全看不出异常，结果被误判成"通道挂了"，还让人白重启了一次工具。
  // 这里把实际值打出来，非法值额外标注，让这类错误一眼可见。
  const withTimeout = (promise, ms, msg) => {
    const actual = Number(ms);
    const mark = Number.isFinite(actual) && actual > 0 ? "" : " <- 非法延时值！";
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${msg} [实际延时 ${actual}ms${mark}]`)),
          actual
        )
      ),
    ]);
  };

  let page = null;

  // 首选：按 pkg 直接找小程序 webview。
  // 注意用 withTimeout 自己兜超时，而不是把 timeout 塞给 webView()——
  // 这样无论底层 API 的签名怎么变，webviewTimeout 都一定生效。
  try {
    const wv = await withTimeout(
      device.webView({ pkg }),
      webviewTimeout,
      `等待小程序 webview 超时（pkg=${pkg}，${webviewTimeout}ms）`
    );
    page = await withTimeout(wv.page(), 5000, "page() 超时");
    log.info(`按 pkg 找到小程序 webview，pid=${wv.pid()}, url=${page.url()}`);
  } catch (e) {
    log.info(`按 pkg 找 webview 未成功（${e.message.split("\n")[0]}），回退为遍历全部 webview`);
  }

  // 回退：遍历所有 webview，按 URL 特征挑（与旧版本行为一致，保证不会更糟）
  if (!page) {
    const allWebviews = await device.webViews();
    let anyMatch = null;
    for (const wv of allWebviews) {
      try {
        const pageTmp = await withTimeout(wv.page(), 5000, "page() 超时");
        const url = pageTmp.url(); // url() 同步返回，无需 await
        console.log(`检查 webview pid=${wv.pid()} url=${url}`);
        // 小程序页面特征：servicewechat.com
        if (url.includes("servicewechat.com")) {
          // 有期望 appid 时优先挑匹配的那个；一个都不匹配就先留着，
          // 交给 resolveForegroundPage 去报"安全阀拦截"这个更清楚的原因
          if (expectedAppId && appIdOf(url) !== expectedAppId) {
            if (!anyMatch) anyMatch = { page: pageTmp, pid: wv.pid(), url };
            continue;
          }
          page = pageTmp; // 直接复用该 page，不要 close、也不要再取一次
          log.info(`WebView捕获成功, pid=${wv.pid()}, url=${url}`);
          break;
        }
      } catch (e) {
        console.error(`跳过 webview: ${e.message}`);
      }
    }
    if (!page && anyMatch) {
      log.info(`没有 appid 匹配的 webview，先用 pid=${anyMatch.pid} 的页面继续（后续会由安全阀判定）`);
      page = anyMatch.page;
    }
  }
  if (!page) {
    throw new Error("找不到前台小程序webview（检查：微信已打开目标小程序，且小程序处于前台）");
  }

  // 等待DOM加载
  await page.waitForLoadState("domcontentloaded");
  // 关键：等待页面视口宽度>0
  await page.waitForFunction(() => document.documentElement.clientWidth > 10, { timeout: 15000 });

  // 【关键】缓存 context：page 后续可能被小程序导航销毁，
  // 而 context 对象始终有效，是"页面丢了还能找回来"的唯一依据。
  cachedContext = page.context();

  // 关键：上面按 URL 匹配到的可能只是"并存页面之一"，未必是屏幕上正在显示的那个。
  // 这里再挑一次前台页，避免把空壳页/后台页当成目标页。
  const picked = await resolveForegroundPage(page, { expectedAppId });
  if (picked !== page) {
    const count = await picked.locator("*").count().catch(() => 0);
    log.info(`已切换到前台页: 元素数=${count}`);
  }
  return picked;
}

/**
 * App 通用执行函数，参考 app_test / app.js 设计。
 *
 * 使用示例::
 *
 *   const { appTest } = require("./common/app_common");
 *   const { login, clickElementByText } = require("./app_sub_function/suprecast_app/android");
 *
 *   const funcList = [
 *     [login, { username: "admin", password: "123456" }],
 *     [clickElementByText, { text: "进入首页" }],
 *   ];
 *   await appTest(funcList, { photosPath: "report/photo_app" });
 *
 * @param {Array<[Function, Object|null]>} testSubFunctions 测试子步骤列表
 * @param {Object} [options] 可选配置
 * @param {string} [options.deviceSerial] 设备序列号；不传时依次尝试环境变量
 *        UITEST_DEVICE_SERIAL、唯一连接的设备；多台设备时**报错**而不是随便挑一台
 * @param {string} [options.pkg] 微信小程序 webview 进程包名，默认 com.tencent.mm:appbrand0
 * @param {string|null} [options.photosPath] 截图存放路径
 * @param {number} [options.webviewTimeout] 等待 webview 出现的超时（毫秒），默认 40000
 * @param {boolean} [options.closeOnFinish] 结束后是否关闭设备连接，默认 true
 * @param {{feature?: string, story?: string, title?: string}} [options.meta] 用例元数据，
 *        用于报告分组；省略时按用例文件名推导
 * @param {Object} [options.context] 用例上下文的初始数据
 * @param {string} [options.stepLogPath] 步骤日志路径；默认取环境变量 UITEST_STEP_LOG
 * @returns {Promise<{device: import('playwright').AndroidDevice, page: import('playwright').Page, ctx: Object}>}
 */
async function appTest(testSubFunctions, options = {}) {
  const { deviceSerial, photosPath = null, closeOnFinish = true, meta = null, context = null } = options;
  // 这三个参数以前"解构出来了却从没用过"：deviceSerial 被硬编码序列号盖掉，
  // pkg / webviewTimeout 则完全没传下去。现在统一走解析函数，真的生效。
  const webviewOptions = resolveWebviewOptions(options);
  // 期望的小程序 appid（安全阀）。解析一次即成为进程级默认值，
  // 之后所有 resolveForegroundPage 调用（含页面对象内部的）都会自动带这道校验。
  const expectedAppId = resolveExpectedAppId(options);
  if (expectedAppId) {
    log.info(`已开启 appid 安全阀：只操作 ${expectedAppId} 的页面`);
  } else {
    log.info("未指定 appid（UITEST_APP_ID / options.appId）—— 不做 appid 硬校验，可能跑到别的小程序上");
  }

  // 用例上下文：每个用例一份，不跨用例共享可变状态
  const ctx = createCaseContext(context);

  // 结构化步骤日志：路径由 Python 侧经环境变量指定（见 common/step_log.js 的说明）
  const casePath = process.argv[1] || "";
  const stepLog = createStepLogger({
    filePath: options.stepLogPath || process.env.UITEST_STEP_LOG || null,
    caseFile: casePath ? path.basename(casePath) : null,
    meta,
  });

  let device = null;
  let failure = null;
  try {
    stepLog.case({
      // 缺省分组：用例所在目录名 / 文件名去掉 test_ 前缀，至少让报告有层次可看
      feature: casePath ? path.basename(path.dirname(casePath)) : null,
      story: casePath ? path.basename(casePath).replace(/\.js$/, "").replace(/^test_/, "") : null,
    });

    // 【官方API：android.devices】连接安卓设备，adb必须已经识别设备
    const devices = await android.devices();
    device = pickDevice(devices, deviceSerial);
    log.info(`AndroidDevice连接成功，设备serial: ${device.serial()}`);
    // 等待微信小程序 WebView 并获取 Page
    let page = await getWxWebviewPage(device, webviewOptions);
    const caller = getCaller();
    page = await runAppSteps(page, testSubFunctions, photosPath, caller, device, { stepLog, ctx });
    return { device, page, ctx };
  } catch (e) {
    failure = e;
    log.error(`异常：${e.message}`);
    throw e;
  } finally {
    // 无论成功失败都写总结行（含上下文快照）—— 失败时的数据状态是复现问题的关键
    stepLog.finish({ context: ctx.snapshot(), error: failure ? failure.message : null });
    if (closeOnFinish && device) {
      await device.close();
      log.info("设备连接关闭");
    }
  }
}

module.exports = {
  appTest,
  runAppSteps,
  pickForegroundCandidate,
  isUsableForegroundCandidate,
  getWxWebviewPage,
  pickForegroundPage,
  resolveForegroundPage,
  findPageContaining,
  pagesContaining,
  waitForPageContaining,
  pagesOfExpectedApp,
  appIdOf,
  pickDevice,
  resolveWebviewOptions,
  resolveExpectedAppId,
  createCaseContext,
  DEFAULT_WX_PKG,
  DEFAULT_WEBVIEW_TIMEOUT,
};
