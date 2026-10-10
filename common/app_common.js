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

// 设备序列号没有默认值 —— 它必须来自"显式指定 / 环境变量 / 唯一连接的设备"，
// 见 pickDevice 的说明（写死一个序列号在换机器时必挂，而且会静默连错设备）。
const DEFAULT_WX_PKG = "com.tencent.mm:appbrand0";
const DEFAULT_WEBVIEW_TIMEOUT = 40000;

/** 允许用环境变量覆盖的配置项（给"本机设备不一样"留出口，不必改代码） */
const ENV_KEYS = {
  deviceSerial: "UITEST_DEVICE_SERIAL",
  pkg: "UITEST_WX_PKG",
  webviewTimeout: "UITEST_WEBVIEW_TIMEOUT",
};

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

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
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
 * @param {{resolveForeground?: boolean}} [options] resolveForeground: 是否在每步开始前把
 *        page 换成当前真正的前台页（默认 true）
 * @returns {Promise<import('playwright').Page>} page
 */
async function runAppSteps(page, testSubFunctions, photoPath = null, caller = { fileName: "app", funcName: "unknown" }, device = null, options = {}) {
  const { resolveForeground = true } = options;
  let savedError = null;
  const totalStart = Date.now();
  const stepTimes = [];

  for (const [func, kwargs] of testSubFunctions) {
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
    try {
      if (kwargs) {
        page = await func(page, kwargs);
      } else {
        page = await func(page);
      }
    } catch (e) {
      savedError = e;
      log.error(e.message);
    } finally {
      // 记录步骤结束时间并计算执行时间
      stepDuration = (Date.now() - stepStart) / 1000;
      if (photoPath) {
        const curPhotoPath = path.join(
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
 * @param {{timeout?: number}} [options] timeout: 单个页面的 RAF 探测超时（毫秒）
 * @returns {Promise<import('playwright').Page>} 当前前台页
 * @throws {Error} context 拿不到、或没有任何页面在产出动画帧时抛出
 */
async function resolveForegroundPage(page, { timeout = 500 } = {}) {
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

  // 3) 确定目标 appid：优先用传入 page 的；取不到（如 /preload/ 页）就从候选里推最主流的
  let targetAppId = null;
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
  const candidates = pool.length ? pool : all;

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
  const alive = probes.filter(Boolean);

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
      if (still.length > 1) {
        log.debug(`前台页判定仍有 ${still.length} 个候选（疑似页面过渡中），退化为按元素数挑选`);
      }
      alive.sort((a, b) => b.count - a.count);
      picked = alive[0];
    }
  }

  if (picked.page !== page) {
    log.debug(`前台页解析: 候选=${candidates.length} 活跃=${alive.length} 元素数=${picked.count}`);
  }
  return picked.page;
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

  if (!device) {
    // 【官方API：android.devices】连接安卓设备，adb必须已经识别设备
    const devices = await android.devices();
    device = pickDevice(devices); // 显式指定 > 环境变量 > 唯一的设备 > 报错
    log.info(`AndroidDevice连接成功，设备serial: ${device.serial()}`);
  }
  log.info(`等待微信小程序WebView（pkg=${pkg}，超时 ${webviewTimeout}ms）...`);

  // 给可能阻塞的调用加超时兜底，避免某个后台 webview 拖死整体
  const withTimeout = (promise, ms, msg) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

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
    for (const wv of allWebviews) {
      try {
        const pageTmp = await withTimeout(wv.page(), 5000, "page() 超时");
        const url = pageTmp.url(); // url() 同步返回，无需 await
        console.log(`检查 webview pid=${wv.pid()} url=${url}`);
        // 小程序页面特征：servicewechat.com
        if (url.includes("servicewechat.com")) {
          page = pageTmp; // 直接复用该 page，不要 close、也不要再取一次
          log.info(`WebView捕获成功, pid=${wv.pid()}, url=${url}`);
          break;
        }
      } catch (e) {
        console.error(`跳过 webview: ${e.message}`);
      }
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
  const picked = await resolveForegroundPage(page);
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
 * @returns {Promise<{device: import('playwright').AndroidDevice, page: import('playwright').Page}>}
 */
async function appTest(testSubFunctions, options = {}) {
  const { deviceSerial, photosPath = null, closeOnFinish = true } = options;
  // 这三个参数以前"解构出来了却从没用过"：deviceSerial 被硬编码序列号盖掉，
  // pkg / webviewTimeout 则完全没传下去。现在统一走解析函数，真的生效。
  const webviewOptions = resolveWebviewOptions(options);

  let device = null;
  try {
    // 【官方API：android.devices】连接安卓设备，adb必须已经识别设备
    const devices = await android.devices();
    device = pickDevice(devices, deviceSerial);
    log.info(`AndroidDevice连接成功，设备serial: ${device.serial()}`);
    // 等待微信小程序 WebView 并获取 Page
    let page = await getWxWebviewPage(device, webviewOptions);
    const caller = getCaller();
    page = await runAppSteps(page, testSubFunctions, photosPath, caller, device);
    return { device, page };
  } catch (e) {
    log.error(`异常：${e.message}`);
    throw e;
  } finally {
    if (closeOnFinish && device) {
      await device.close();
      log.info("设备连接关闭");
    }
  }
}

module.exports = {
  appTest,
  runAppSteps,
  getWxWebviewPage,
  pickForegroundPage,
  resolveForegroundPage,
  appIdOf,
  pickDevice,
  resolveWebviewOptions,
  DEFAULT_WX_PKG,
  DEFAULT_WEBVIEW_TIMEOUT,
};
