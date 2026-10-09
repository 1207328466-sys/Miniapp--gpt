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

const DEFAULT_DEVICE_SERIAL = "93e9db1c";
const DEFAULT_WX_PKG = "com.tencent.mm:appbrand0";

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
};

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
 * @returns {Promise<import('playwright').Page>} page
 */
async function runAppSteps(page, testSubFunctions, photoPath = null, caller = { fileName: "app", funcName: "unknown" }) {
  let savedError = null;
  const totalStart = Date.now();
  const stepTimes = [];

  for (const [func, kwargs] of testSubFunctions) {
    log.info(`正在执行${func.name}步骤`);
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
          // webview 截图可能卡在等待字体加载，限制超时避免长时间阻塞
          await page.screenshot({ path: curPhotoPath, timeout: 10000 });
        } catch (shotErr) {
          log.error(`截图失败: ${shotErr.message}`);
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
 * 等待微信小程序 WebView 并获取其 Page，同时等待 DOM 加载与视口就绪。
 * @param {import('playwright').AndroidDevice} device
 * @returns {Promise<import('playwright').Page>} 小程序 webview 的 page
 */
async function getWxWebviewPage(device = null) {
  if (!device)
  {
    // 【官方API：android.devices】连接安卓设备，adb必须已经识别设备
    const devices = await android.devices();
    device = devices.find((d) => d.serial() === DEFAULT_DEVICE_SERIAL) || devices[0];
    log.info(`AndroidDevice连接成功，设备serial: ${device.serial()}`);
  }
  log.info("等待微信小程序WebView...");
  // 给可能阻塞的调用加超时兜底，避免某个后台 webview 拖死整体
  const withTimeout = (promise, ms, msg) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))]);

  const allWebviews = await device.webViews();
  let page = null;
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
  if (!page) throw new Error("找不到前台小程序webview");

  // 等待DOM加载
  await page.waitForLoadState("domcontentloaded");
  // 关键：等待页面视口宽度>0
  await page.waitForFunction(() => document.documentElement.clientWidth > 10, { timeout: 15000 });
  return page;
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
 * @param {string} [options.deviceSerial] 设备序列号（adb devices），默认 93e9db1c
 * @param {string} [options.pkg] 微信小程序 webview 进程包名
 * @param {string|null} [options.photosPath] 截图存放路径
 * @param {number} [options.webviewTimeout] 等待 webview 出现的超时时间（毫秒）
 * @param {boolean} [options.closeOnFinish] 结束后是否关闭设备连接，默认 true
 * @returns {Promise<{device: import('playwright').AndroidDevice, page: import('playwright').Page}>}
 */
async function appTest(testSubFunctions, options = {}) {
  const {
    deviceSerial = DEFAULT_DEVICE_SERIAL,
    pkg = DEFAULT_WX_PKG,
    photosPath = null,
    webviewTimeout = 40000,
    closeOnFinish = true,
  } = options;

  let device = null;
  try {
    // 【官方API：android.devices】连接安卓设备，adb必须已经识别设备
    const devices = await android.devices();
    device = devices.find((d) => d.serial() === DEFAULT_DEVICE_SERIAL) || devices[0];
    log.info(`AndroidDevice连接成功，设备serial: ${device.serial()}`);
    // 等待微信小程序 WebView 并获取 Page
    let page = await getWxWebviewPage(device);
    const caller = getCaller();
    page = await runAppSteps(page, testSubFunctions, photosPath, caller);
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
};
