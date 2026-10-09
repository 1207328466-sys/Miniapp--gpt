/*
 * @author: weiyue.zhang
 * @project_name: UITest
 * @cur_file: android.js
 * @create_date: 2026/10/8
 *
 * app_sub_function/suprecast_app/android.py 的 JS 版本。
 * 参考根目录 app.js：使用 Playwright 的 Android 实验性 API（_android）连接安卓设备、
 * 获取微信小程序 WebView 的 Page，之后所有交互都基于 Playwright 的 Page API（async）。
 *
 * 说明：所有子函数第一个参数统一为 page，并 return page 以支持链式调用；
 * 只有需要设备级能力的 switchToWxWebview 以 device 作为第一个参数。
 */

const WX_WEBVIEW_PKG = "com.tencent.mm:appbrand0";
const { getWxWebviewPage } = require("../../common/app_common");
const { _android: android } = require("playwright");

// 有问必答页的搜索栏（是个 wx-view，不是输入框）；点击后进入搜索页
const SEARCH_BAR = ".search-container";
// 搜索页的真实输入框
const SEARCH_INPUT = "wx-input.search-input";

/**
 * 懒加载安卓设备，仅用 shell() 执行 adb 命令（不依赖 playwright 的 driver apk）
 * @returns {Promise<import('playwright').AndroidDevice>}
 */
let androidDevice = null;
async function getDevice() {
  if (!androidDevice) {
    const devices = await android.devices();
    androidDevice = devices[0];
    console.log(`AndroidDevice连接成功，设备serial: ${androidDevice.serial()}`);
  }
  return androidDevice;
}

/**
 * 用真实 adb tap 点击元素。
 * 小程序视图层只响应真实触摸事件，Playwright 合成的鼠标事件点了没反应，
 * 因此把 DOM 坐标按 devicePixelRatio 换算成屏幕坐标后走 input tap。
 * @param {import('playwright').AndroidDevice} device
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} locator
 */
async function tapElement(device, page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("元素取不到坐标，可能不可见");
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const x = Math.round((box.x + box.width / 2) * dpr);
  const y = Math.round((box.y + box.height / 2) * dpr);
  await device.shell(`input tap ${x} ${y}`);
  console.log(`adb tap(${x}, ${y})`);
}

/**
 * 在 context 的所有 page 中找出包含指定选择器的 page。
 * 小程序同一 context 下会并存多个 tab 页，传进来的 page 未必是目标页。
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<import('playwright').Page|null>}
 */
async function findPageWith(page, selector) {
  for (const p of page.context().pages()) {
    const count = await p.locator(selector).count().catch(() => 0);
    if (count > 0) return p;
  }
  return null;
}
/**
 * 切换到用户中心
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @returns {Promise<import('playwright').Page>} page
 */
async function switchToUserCenter(page) {
  try {
    await page.waitForTimeout(2000);
    const userCenterButton = page.getByText("我的");
    await userCenterButton.waitFor({ state: "visible", timeout: 10000 });
    await userCenterButton.click({ timeout: 10000,force: true });
    console.log("已切换到用户中心");
    return page;
  } catch (e) {
    console.error(`切换到用户中心失败: ${e.message}`);
    throw e;
  }
}


/**
 * 获取小程序当前处于前台的页面。
 * 小程序在同一个 context 下会同时存在多个视图层 page（首页/我的/弹窗页/预加载页等），
 * 页面切换后之前拿到的 page 会变成后台页，再对它操作会一直等待超时。
 * 后台页对应的原生 WebView 已被挂起，渲染线程不再产出帧（requestAnimationFrame 不触发），
 * 因此用“是否还在产生动画帧”来判断哪个 page 真正显示在屏幕上。
 * 注意：不能用 locator.isVisible() 判断，后台页内的元素同样返回 true。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{timeout?: number}} params timeout: 单个 page 的探测超时（毫秒）
 * @returns {Promise<import('playwright').Page>} 前台页面；都探测不到时返回原 page
 */
async function getForegroundPage(page, { timeout = 500 } = {}) {
  for (const p of page.context().pages()) {
    try {
      const alive = await p.evaluate(
        (ms) =>
          new Promise((resolve) => {
            let done = false;
            requestAnimationFrame(() => {
              done = true;
              resolve(true);
            });
            setTimeout(() => {
              if (!done) resolve(false);
            }, ms);
          }),
        timeout
      );
      if (alive) {
        return p;
      }
    } catch (e) {
      // 页面不可用（如预加载页），跳过
    }
  }
  return page;
}


/**
 * 登录小程序
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @returns {Promise<import('playwright').Page>} page
 */
async function login(page) {
  try {
    // 切换 tab 后当前页面会变成新的 webview，操作前先定位前台页面
    page = await getForegroundPage(page);
    await page.getByText("我的").first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);
    page = await getForegroundPage(page);
    await page.getByText("登录/注册").first().click({ timeout: 10000 });
    page = await getForegroundPage(page);
    await page.getByText("同意协议并继续").first().click({ timeout: 10000 });
    await page.getByText("4148").first().click({ timeout: 10000 });
    console.log("已登录");
    return page;
  } catch (e) {
    console.error(`登录失败: ${e.message}`);
    throw e;
  }
}

/**
 * 等待软键盘弹出（mInputShown=true），说明输入框已真正拿到焦点。
 * 没聚焦时 adb input text 的事件会被丢弃，必须等键盘起来再输入。
 * @param {import('playwright').AndroidDevice} device
 * @param {import('playwright').Page} page
 * @param {number} timeout
 * @returns {Promise<boolean>} 超时返回 false
 */
async function waitImeShown(device, page, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const out = (await device.shell("dumpsys input_method")).toString();
    if (/mInputShown=true/.test(out)) return true;
    await page.waitForTimeout(300);
  }
  return false;
}


/**
 * 打开搜索框：点击搜索栏跳转到搜索页，并聚焦搜索页的输入框。
 * 搜索栏（.search-container）只在“有问必答”页，且它是 wx-view 不能 fill，只能真实 tap 跳转；
 * 跳转后再 tap 输入框，软键盘弹出即表示聚焦成功。关键词输入由调用方自行处理。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{timeout?: number}} params timeout: 等待搜索页出现的超时（毫秒）
 * @returns {Promise<import('playwright').Page>} 搜索页 page，可在其 wx-input 上继续输入
 */
async function focusSearchInput(page, { timeout = 10000 } = {}) {
  try {
    const device = await getDevice();
    // 1. 同一 context 下并存多个 tab 页，先在所有 page 中找出含搜索栏的那个
    const target = await findPageWith(page, SEARCH_BAR);
    if (!target) {
      throw new Error(`没有 page 含搜索栏 ${SEARCH_BAR}，请先切到有问必答页`);
    }
    // 2. 真实 tap 搜索栏，跳到搜索页
    await tapElement(device, target, target.locator(SEARCH_BAR).first());
    // 3. 搜索页是新出现的 page，等它渲染出来
    let searchPage = null;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !searchPage) {
      await target.waitForTimeout(500);
      searchPage = await findPageWith(page, SEARCH_INPUT);
    }
    if (!searchPage) {
      throw new Error(`未进入搜索页，没找到 ${SEARCH_INPUT}`);
    }
    // 4. tap 输入框聚焦，软键盘弹出说明焦点已拿到
    await tapElement(device, searchPage, searchPage.locator(SEARCH_INPUT).first());
    if (!(await waitImeShown(device, searchPage))) {
      throw new Error("输入框未获得焦点（软键盘没弹出）");
    }
    console.log("已打开搜索页并聚焦输入框");
    await searchPage.waitForTimeout(1500);
    await device.shell("input text test");
    await device.shell("input keyevent 66");
    await device.shell("input keyevent 66");
    return searchPage;
  } catch (e) {
    console.error(`打开搜索框失败: ${e.message}`);
    throw e;
  }
}

/**
 * 通过元素 id 点击元素
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{elementId: string, timeout?: number}} params elementId: 元素 id；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function clickElementById(page, { elementId, timeout = 10000 } = {}) {
  try {
    const el = page.locator(`#${elementId}`);
    await el.waitFor({ state: "visible", timeout });
    await el.click({ timeout });
    await page.waitForTimeout(500);
    console.log(`已点击元素: ${elementId}`);
    return page;
  } catch (e) {
    console.error(`点击元素失败 [${elementId}]: ${e.message}`);
    throw e;
  }
}

/**
 * 通过文本内容点击元素
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number}} params text: 元素文本；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function clickElementByText(page, { text, timeout = 10000 } = {}) {
  try {
    const el = page.getByText(text, { exact: false }).first();
    await el.waitFor({ state: "visible", timeout });
    await el.click({ timeout });
    await page.waitForTimeout(500);
    console.log(`已点击文本: ${text}`);
    return page;
  } catch (e) {
    console.error(`点击文本失败 [${text}]: ${e.message}`);
    throw e;
  }
}

/**
 * 向指定元素输入文本
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{elementId: string, text: string, timeout?: number}} params elementId: 元素 id；text: 要输入的文本；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function inputText(page, { elementId, text, timeout = 10000 } = {}) {
  try {
    const el = page.locator(`#${elementId}`);
    await el.waitFor({ state: "attached", timeout });
    await el.click();
    await el.fill(text);
    await page.waitForTimeout(300);
    console.log(`已输入文本到 [${elementId}]: ${text}`);
    return page;
  } catch (e) {
    console.error(`输入文本失败 [${elementId}]: ${e.message}`);
    throw e;
  }
}

/**
 * 断言指定元素存在
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{elementId: string, timeout?: number}} params elementId: 元素 id；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function assertElementExists(page, { elementId, timeout = 5000 } = {}) {
  try {
    await page.locator(`#${elementId}`).waitFor({ state: "attached", timeout });
    console.log(`元素存在校验通过: ${elementId}`);
    return page;
  } catch (e) {
    console.error(`元素不存在 [${elementId}]: ${e.message}`);
    throw e;
  }
}

/**
 * 向上滑动（从屏幕下方向上方滑动）
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{duration?: number}} params duration: 滑动持续时间（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function swipeUp(page, { duration = 800 } = {}) {
  try {
    const size = page.viewportSize() || { width: 0, height: 0 };
    const startX = Math.floor(size.width / 2);
    const startY = Math.floor(size.height * 0.8);
    const endY = Math.floor(size.height * 0.2);
    const steps = Math.max(2, Math.round(duration / 100));
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, endY, { steps });
    await page.mouse.up();
    await page.waitForTimeout(500);
    console.log("向上滑动完成");
    return page;
  } catch (e) {
    console.error(`滑动失败: ${e.message}`);
    throw e;
  }
}

/**
 * 返回上一页（基于 webview 历史记录）
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @returns {Promise<import('playwright').Page>} page
 */
async function goBack(page) {
  try {
    await page.goBack();
    await page.waitForTimeout(500);
    console.log("已返回上一页");
    return page;
  } catch (e) {
    console.error(`返回失败: ${e.message}`);
    throw e;
  }
}

/**
 * 切换到微信小程序 webview 上下文，并选中内容最多的窗口
 * @param {import('playwright').AndroidDevice} device 安卓设备
 * @param {{timeout?: number}} params timeout: 等待 webview 出现的超时时间（毫秒）
 * @returns {Promise<import('playwright').Page>} 小程序 webview 的 Page
 */
async function switchToWxWebview(device, { timeout = 20000 } = {}) {
  try {
    const webview = await device.webView({ pkg: WX_WEBVIEW_PKG }, { timeout });
    const page = await webview.page();
    await page.waitForLoadState("domcontentloaded");
    // 小程序 webview 存在多个窗口，选择元素最多的那个（避免落在空白页）
    let targetPage = page;
    let maxCount = -1;
    for (const p of page.context().pages()) {
      const count = await p.locator("*").count();
      if (count > maxCount) {
        targetPage = p;
        maxCount = count;
      }
    }
    console.log(`已切换到小程序webview上下文: pid=${webview.pid()}`);
    return targetPage;
  } catch (e) {
    console.error(`切换小程序webview上下文失败: ${e.message}`);
    throw e;
  }
}

/**
 * 在微信小程序 webview 中按文本点击元素
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number}} params text: 元素文本；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function clickWxText(page, { text, timeout = 10000 } = {}) {
  try {
    const el = page.getByText(text, { exact: false }).first();
    await el.waitFor({ state: "visible", timeout });
    await el.click({ timeout });
    await page.waitForTimeout(500);
    console.log(`已点击小程序文本: ${text}`);
    return page;
  } catch (e) {
    console.error(`点击小程序文本失败 [${text}]: ${e.message}`);
    throw e;
  }
}

/**
 * 输出当前页面的 HTML 结构（调试用，便于确认该用哪个定位器）。
 * 为便于阅读只保留 class 属性，并按 DOM 层级缩进；无子元素的节点与其文本合并成一行。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{tag?: string|string[]}} params tag: 只输出这些元素类型（如 "wx-text"，可传数组）；不传则输出整个 body
 * @returns {Promise<import('playwright').Page>} page
 */
async function dumpElements(page, { tag } = {}) {
  try {
    const selector = !tag ? "body" : (Array.isArray(tag) ? tag : [tag]).join(",");
    const html = await page.evaluate((sel) => {
      const lines = [];
      const walk = (el, depth) => {
        const pad = "  ".repeat(depth);
        const name = el.tagName.toLowerCase();
        const cls = el.getAttribute("class");
        const open = `<${name}${cls ? ` class="${cls}"` : ""}>`;
        const kids = Array.from(el.children);
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" ");
        if (!kids.length) {
          lines.push(`${pad}${open}${text}</${name}>`);
          return;
        }
        lines.push(`${pad}${open}`);
        if (text) lines.push(`${pad}  ${text}`);
        kids.forEach((k) => walk(k, depth + 1));
        lines.push(`${pad}</${name}>`);
      };
      document.querySelectorAll(sel).forEach((el) => walk(el, 0));
      return lines.join("\n");
    }, selector);
    console.log(html);
    return page;
  } catch (e) {
    console.error(`输出HTML失败: ${e.message}`);
    throw e;
  }
}

module.exports = {
  WX_WEBVIEW_PKG,
  getForegroundPage,
  login,
  clickElementById,
  clickElementByText,
  inputText,
  assertElementExists,
  swipeUp,
  goBack,
  switchToWxWebview,
  clickWxText,
  switchToUserCenter,
  focusSearchInput,
  dumpElements,
};
