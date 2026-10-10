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

/** 纯等待。不依赖 page 对象：page 被销毁后 page.waitForTimeout 会抛错 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 有问必答页的搜索栏（.search-container）与搜索页的输入框
// （wx-input.search-input）这两个选择器已经移到 pages/qa_page.js 的 SEL 里
// —— 它们属于"某个页面的知识"，不该留在关键字层。

/**
 * 懒加载安卓设备，仅用 shell() 执行 adb 命令（不依赖 playwright 的 driver apk）
 * @returns {Promise<import('playwright').AndroidDevice>}
 */
let androidDevice = null;
async function getDevice() {
  if (!androidDevice) {
    const { pickDevice } = require("../../common/app_common");
    const devices = await android.devices();
    // 与 appTest 共用同一套"选哪台设备"的规则：显式指定 > 环境变量 >
    // 唯一连接的设备 > 多台时报错。
    // 以前这里直接取 devices[0]，和 appTest 各挑各的 —— 插第二台设备时
    // 两边可能连到不同设备上，而且不报错。
    androidDevice = pickDevice(devices);
    console.log(`AndroidDevice连接成功，设备serial: ${androidDevice.serial()}`);
  }
  return androidDevice;
}

/**
 * 从元素向上找"真正可点击的祖先容器"。
 *
 * 为什么需要它：小程序里很多文字节点的盒子尺寸是退化的。
 * 实测首页底部 tab 栏：
 *   [4] "我的"   tab-item 容器 x=278 y=673 w=69  h=61   ← 正常
 *                文字 span   x=323 y=686 w=0   h=22   ← 宽度为 0
 * 直接按 span 的中心算坐标会偏，点不中响应区域。
 * 实测：tap tab-item 中心 (1094, 2462) 成功切换页面；
 *       tap span 中心   (1131, 2440) 无任何效果。
 *
 * 策略：从元素本身开始向上找，选第一个"尺寸正常且增长不过分"的祖先。
 * - 面积 > 400（排除零宽度、一像素分隔线这类元素）
 * - 面积不超过 max(起始元素的 8 倍, 10000)（避免一路爬到整页容器，那会点到页面正中间）
 * - 最多向上 4 层
 *
 * @param {import('playwright').Locator} locator
 * @returns {Promise<{selector: string, level: number, box: Object, reason: string}>}
 */
async function findClickableAncestor(locator) {
  return locator.evaluate((start) => {
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, area: r.width * r.height };
    };

    const describe = (el) => {
      const cls = String(el.className || "").trim().split(/\s+/).slice(0, 3).join(".");
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
    };

    const startRect = rectOf(start);

    // 起点本身尺寸正常，不必向上找
    if (startRect.area > 400) {
      return { selector: "self", level: 0, box: startRect, reason: "起点元素尺寸正常" };
    }

    // 容器面积上限：既防止爬到整页容器，又要给"文字节点极小"的情况留足空间。
    // 实测底部 tab 栏：文字 span 面积只有 190，而真正可点击的 tab-item 容器
    // 面积是 4239 —— 若按"起点 8 倍 + 2000"算，上限只有 3522，会把正确的
    // 容器误判成"过大"而退回文字节点，导致点击坐标偏离真正的响应区域。
    // 经验值：小程序里正常的可点区域面积普遍在 4000~10000 之间，故设 10000 下限。
    const areaLimit = Math.max(startRect.area * 8, 10000);

    let cur = start;
    for (let i = 0; i < 4; i++) {
      const parent = cur.parentElement;
      if (!parent) break;
      cur = parent;

      const r = rectOf(cur);
      if (r.area > 400) {
        // 尺寸增长过多说明爬到整页容器了，会点到页面正中间，放弃
        if (r.area <= areaLimit) {
          return {
            selector: describe(cur),
            level: i + 1,
            box: r,
            reason: `向上第 ${i + 1} 层找到可点击容器`,
          };
        }
        return {
          selector: "self",
          level: 0,
          box: startRect,
          reason: `向上第 ${i + 1} 层容器过大（${describe(cur)} 面积 ${Math.round(r.area)}），改用起点`,
        };
      }
    }

    return { selector: "self", level: 0, box: startRect, reason: "未找到合适的祖先，改用起点" };
  });
}

/**
 * 用真实 adb tap 点击元素。
 * 小程序视图层只响应真实触摸事件，Playwright 合成的鼠标事件点了没反应，
 * 因此把 DOM 坐标按 devicePixelRatio 换算成屏幕坐标后走 input tap。
 *
 * 会先向上寻找"真正可点击的祖先容器"再取坐标（见 findClickableAncestor），
 * 因为小程序的文字节点常常是零宽度的，按它取中心会点偏。
 *
 * @param {import('playwright').AndroidDevice} device
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} locator
 * @returns {Promise<{x:number,y:number,target:string,level:number,reason:string}>} 实际点击的坐标与目标
 */
async function tapElement(device, page, locator) {
  const found = await findClickableAncestor(locator);
  let { x, y, w, h } = found.box;

  if (!w || !h) throw new Error("元素取不到有效尺寸，可能不可见");
  if (found.selector === "self") {
    const box = await locator.boundingBox();
    if (!box) throw new Error("元素取不到坐标，可能不可见");
    ({ x, y, width: w, height: h } = box);
  }

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const px = Math.round((x + w / 2) * dpr);
  const py = Math.round((y + h / 2) * dpr);
  await device.shell(`input tap ${px} ${py}`);
  console.log(`adb tap(${px}, ${py})  目标=${found.selector}  ${found.reason}`);
  return { x: px, y: py, target: found.selector, level: found.level, reason: found.reason };
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
 * 切换到用户中心。
 *
 * 【实现已迁移到页面对象】
 * 原实现在这里，含判据文案（「积分商城」/「登录/注册」）、幂等、重试、
 * "点击后重新取前台页再验证"等一堆页面知识。这些属于**页面对象**该管的事；
 * 留在关键字层会让 android.js 逐渐变成各页面业务知识的大杂烩。
 * 现在逻辑在 pages/user_center_page.js，本函数只是兼容外壳，行为不变。
 *
 * ⚠️ 新代码请直接用页面对象：
 *     const pages = require("./pages");
 *     [pages.userCenter.switchTo, { timeout: 10000 }]
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{timeout?: number, retries?: number}} [options] 透传给页面对象
 * @returns {Promise<import('playwright').Page>} 切换后的前台页
 */
async function switchToUserCenter(page, options = {}) {
  // 延迟 require：本文件与 pages/ 下的模块互相引用，
  // 运行时取可确保两边都已加载完毕（与 resolveForegroundPage 同样的处理）。
  const userCenterPage = require("./pages/user_center_page");
  return userCenterPage.switchTo(page, options);
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
  // 实现已下沉到驱动层：那里统一处理"page 已销毁 / 已降级为后台页"两种情况，
  // 并缓存 context，避免对已销毁的 page 调 context() 直接抛错。
  // 这里保留同名函数只是为了兼容历史调用方（如 diagnostic 脚本）。
  const { resolveForegroundPage } = require("../../common/app_common");
  try {
    return await resolveForegroundPage(page, { timeout });
  } catch (e) {
    console.warn(`getForegroundPage 解析失败，返回原 page: ${e.message.split("\n")[0]}`);
    return page;
  }
}


/**
 * 登录小程序
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @returns {Promise<import('playwright').Page>} page
 */
async function login(page) {
  try {
    const device = await getDevice();
    // 内部小工具：按文本真实 tap，并等待页面切换
    const tapByText = async (text) => {
      const el = page.getByText(text).first();
      await el.waitFor({ state: "attached", timeout: 10000 });
      await tapElement(device, page, el);
    };

    // 切换 tab 后当前页面会变成新的 webview，操作前先定位前台页面
    page = await getForegroundPage(page);
    await tapByText("我的");
    await page.waitForTimeout(1000);

    page = await getForegroundPage(page);
    await tapByText("登录/注册");

    page = await getForegroundPage(page);
    await tapByText("同意协议并继续");

    // ⚠️ 硬编码测试账号，换账号/换环境必须改代码，待抽到配置
    await tapByText("4148");

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
 * 打开搜索页 → 输入关键词 test → 回车提交。
 *
 * 【已迁移到页面对象】页面知识（有问必答页、.search-container、
 * wx-input.search-input）已收进 `pages/qa_page.js`。这里保留同名导出，
 * 只为兼容历史调用方，行为与原实现一致（关键词仍写死 test）。
 *
 * ⚠️ 新代码请直接用页面对象，并且**不要再写死关键词**：
 *     const qaPage = require("./pages/qa_page");
 *     [qaPage.openSearch, null]                                  // 自导航到搜索页
 *     [qaPage.typeKeyword, { keyword: "你要搜的词" }]             // 输入并读回校验
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{timeout?: number}} [options] timeout: 等待搜索页出现的超时（毫秒）
 * @returns {Promise<import('playwright').Page>} 搜索页 page
 */
async function focusSearchInput(page, { timeout = 10000 } = {}) {
  // 延迟 require：本文件与 pages/ 互相引用，运行时取可确保两边都已加载
  const qaPage = require("./pages/qa_page");
  // openSearch 内部自带幂等与自导航（原来是"没有 page 含搜索栏就报错"，
  // 要求人工先把手机停在有问必答页）
  let fg = await qaPage.openSearch(page, { timeout });
  fg = await qaPage.typeKeyword(fg, { keyword: "test" });

  // 提交。⚠️ 提交之后的"结果页"结构尚未实测，所以这里**没有**断言 ——
  // 属于已知的未覆盖部分，不要误以为搜索全链路已被验证。
  const device = await getDevice();
  await device.shell("input keyevent 66");
  await device.shell("input keyevent 66");
  console.log("已提交搜索（结果页校验尚未实现）");
  return fg;
}

/**
 * 通过元素 id 点击元素
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{elementId: string, timeout?: number}} params elementId: 元素 id；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function clickElementById(page, { elementId, timeout = 10000 } = {}) {
  try {
    const el = page.locator(`[id="${elementId}"]`);
    // 用 attached 而不是 visible：小程序大量元素是零宽度的文字节点，
    // visible 判断会直接超时；实际点击交给 tapElement 向上找可点击容器。
    await el.waitFor({ state: "attached", timeout });
    const device = await getDevice();
    await tapElement(device, page, el);
    await page.waitForTimeout(500);
    console.log(`已点击元素: ${elementId}`);
    return page;
  } catch (e) {
    console.error(`点击元素失败 [${elementId}]: ${e.message}`);
    throw e;
  }
}

/**
 * 通过文本内容点击元素（真实 adb tap）
 *
 * 【为什么不用 Playwright 的 .click()】
 * 实测对照结果：
 *   底部 tab 栏「我的」 .click()  → Timeout 8000ms，页面无变化（彻底失败）
 *   同一目标           tapElement → 成功切换页面
 *   顶部筛选栏「推荐」  .click()  → 同样 Timeout，但内容其实变了（误报失败）
 *
 * 根因：Playwright 的 .click() 会等元素 "visible, enabled and stable"，
 * 其中 stable 要求元素连续两帧位置不变。而小程序页面持续重绘，
 * 元素永远不稳定，于是 .click() 要么超时抛错、要么误报失败。
 * 真实 adb tap 不经过这些检查，直接发系统触摸事件，可靠得多。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number}} params text: 元素文本；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function clickElementByText(page, { text, timeout = 10000 } = {}) {
  try {
    const el = page.getByText(text, { exact: false }).first();
    await el.waitFor({ state: "attached", timeout });
    const device = await getDevice();
    await tapElement(device, page, el);
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
    const el = page.locator(`[id="${elementId}"]`);
    await el.waitFor({ state: "attached", timeout });

    // 先用真实 tap 让输入框拿到焦点。
    // 不能用 el.click()：小程序上会因页面持续重绘触发 stability 超时。
    const device = await getDevice();
    await tapElement(device, page, el);

    // fill() 走浏览器层面直接赋值，不依赖软键盘，速度最快。
    await el.fill(text, { timeout });
    await page.waitForTimeout(300);

    // ⚠️ 关键校验：小程序的自定义输入组件（wx-input / wx-textarea）可能
    // 不接受浏览器层面的赋值，此时 fill() 不报错但内容为空 —— 典型的假通过。
    // 这里主动读回校验，避免静默失败。
    //
    // 【读法的坑，本轮实测修正】值放在 **value 属性**上：
    //   el.value                          -> undefined（自定义元素没有这个 property）
    //   el.querySelector("input").value   -> ""（内层是 style="visibility:hidden" disabled 的占位 input）
    //   el.getAttribute("value")          -> 真实内容 ✅
    // 原来的实现用的是第二种读法，于是**必然误报** "fill() 未真正写入"。
    // 这是一个真 bug：读不到 ≠ 没输进去（见账本第十六节）。
    const actual = await el.evaluate((node) => {
      const attr = node.getAttribute ? node.getAttribute("value") : null;
      if (attr !== null) return String(attr);
      if ("value" in node && node.value != null) return String(node.value);
      const inner = node.querySelector ? node.querySelector("input, textarea") : null;
      return inner && inner.value != null ? String(inner.value) : "";
    });
    if (actual !== text) {
      throw new Error(
        `fill() 未真正写入（期望 "${text}"，实际 "${actual}"）。` +
          `该元素很可能是小程序自定义输入组件，不接受浏览器层面赋值，需改用 adb input text。`
      );
    }

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
    await page.locator(`[id="${elementId}"]`).waitFor({ state: "attached", timeout });
    console.log(`元素存在校验通过: ${elementId}`);
    return page;
  } catch (e) {
    console.error(`元素不存在 [${elementId}]: ${e.message}`);
    throw e;
  }
}

// ============================================================
// 断言层（wait + assert 合体）
//
// 为什么需要它：框架原来只有 assertElementExists 一个断言，缺了它，功能坏了
// 用例也会报 passed —— 这是最危险的一类假通过。
//
// 三条设计约定：
//   1. 断言前先解析"当前前台页"。断言和操作一样，必须作用在屏幕上真正显示的
//      那个 page 上，否则会拿冻结的后台页去做判断。
//   2. 等待与断言合体（内部轮询）。小程序渲染时序抖动很大，"点完立刻断言"
//      几乎必然失败；让用例自己 sleep 猜时间则既慢又不稳。
//   3. 失败信息必须自带现场证据（当前元素数 + 可见文本前 200 字），
//      否则只报"没找到元素"根本没法定位。
//
// 返回值都是**真正断言过的那一页**，因此 runAppSteps 会把最新 page 传给后续步骤。
// ============================================================

/**
 * 读取"当前前台页"的可见文本，供断言使用。
 *
 * 用 `document.body.innerText` 而不是 `page.content()`：innerText 只返回**可见文本**，
 * 自动排除隐藏元素以及 <style>/<script> 里的同名字符串（用 content() 会误判）。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面（允许已失效）
 * @returns {Promise<{page: import('playwright').Page, text: string}>} 前台页与其可见文本
 */
async function readForegroundText(page) {
  // 注意用 require 而不是顶部 import：app_common 与本文件存在循环依赖
  const { resolveForegroundPage } = require("../../common/app_common");
  const fg = await resolveForegroundPage(page);
  const text = await fg.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
  return { page: fg, text };
}

/** 断言失败时统一拼装"现场证据"：现在在哪一页、页面上有什么 */
async function describeCurrentPage(page, text) {
  let el = "读取失败";
  try {
    el = await page.locator("*").count();
  } catch (e) {
    // 页面可能在读取过程中被销毁，忽略
  }
  return `当前前台页: 元素数=${el}\n  可见文本前 200 字: ${JSON.stringify(String(text).slice(0, 200))}`;
}

/**
 * 断言页面上出现某段可见文本（轮询等待，等到即通过）。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number, interval?: number}} params
 *        text: 期望出现在可见文本里的片段；timeout: 等待上限（毫秒）；interval: 轮询间隔
 * @returns {Promise<import('playwright').Page>} 断言时所在的前台页
 */
async function assertTextVisible(page, { text, timeout = 8000, interval = 300 } = {}) {
  if (!text) throw new Error("assertTextVisible 缺少参数 text");
  const deadline = Date.now() + timeout;
  let fg = page;
  let t = "";
  while (true) {
    ({ page: fg, text: t } = await readForegroundText(page));
    if (t.includes(text)) {
      console.log(`断言通过: 页面出现文本「${text}」`);
      return fg;
    }
    if (Date.now() >= deadline) break;
    await sleep(interval);
  }
  throw new Error(
    `断言失败: 页面未出现文本「${text}」（等待 ${timeout}ms 超时）\n  ` +
      (await describeCurrentPage(fg, t))
  );
}

/**
 * 断言页面上**不再**出现某段可见文本（轮询等待，等到消失即通过）。
 * 典型用法：确认已经从列表页跳进了详情页。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number, interval?: number}} params
 * @returns {Promise<import('playwright').Page>} 断言时所在的前台页
 */
async function assertTextNotVisible(page, { text, timeout = 5000, interval = 300 } = {}) {
  if (!text) throw new Error("assertTextNotVisible 缺少参数 text");
  const deadline = Date.now() + timeout;
  let fg = page;
  let t = "";
  while (true) {
    ({ page: fg, text: t } = await readForegroundText(page));
    if (!t.includes(text)) {
      console.log(`断言通过: 页面已不包含文本「${text}」`);
      return fg;
    }
    if (Date.now() >= deadline) break;
    await sleep(interval);
  }
  throw new Error(
    `断言失败: 页面仍然包含文本「${text}」（等待 ${timeout}ms 超时）\n  ` +
      (await describeCurrentPage(fg, t))
  );
}

/**
 * 断言选择器至少命中 1 个元素。
 *
 * 用 `count()` 而不是 `waitFor({state:"visible"})`：小程序大量元素是零宽度的
 * 文字节点，visible 判断会直接超时（这是框架里反复踩到的坑）。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{selector: string, timeout?: number, interval?: number}} params
 * @returns {Promise<import('playwright').Page>} 断言时所在的前台页
 */
async function assertSelectorExists(page, { selector, timeout = 8000, interval = 300 } = {}) {
  if (!selector) throw new Error("assertSelectorExists 缺少参数 selector");
  const deadline = Date.now() + timeout;
  let fg = page;
  let t = "";
  let count = 0;
  while (true) {
    ({ page: fg, text: t } = await readForegroundText(page));
    try {
      count = await fg.locator(selector).count();
    } catch (e) {
      count = 0;
    }
    if (count > 0) {
      console.log(`断言通过: ${selector} 命中 ${count} 个`);
      return fg;
    }
    if (Date.now() >= deadline) break;
    await sleep(interval);
  }
  throw new Error(
    `断言失败: 页面上找不到 ${selector}（等待 ${timeout}ms 超时）\n  ` +
      (await describeCurrentPage(fg, t))
  );
}

/**
 * 断言选择器命中的元素数量恰好等于 expected。
 * 适合断言"只有一条标题"这类确定性结构。
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{selector: string, expected: number, timeout?: number, interval?: number}} params
 * @returns {Promise<import('playwright').Page>} 断言时所在的前台页
 */
async function assertSelectorCount(page, { selector, expected, timeout = 8000, interval = 300 } = {}) {
  if (!selector) throw new Error("assertSelectorCount 缺少参数 selector");
  if (typeof expected !== "number") throw new Error("assertSelectorCount 缺少必填参数 expected（数字）");
  const deadline = Date.now() + timeout;
  let fg = page;
  let t = "";
  let count = -1;
  while (true) {
    ({ page: fg, text: t } = await readForegroundText(page));
    try {
      count = await fg.locator(selector).count();
    } catch (e) {
      count = -1;
    }
    if (count === expected) {
      console.log(`断言通过: ${selector} 命中 ${count} 个（期望 ${expected}）`);
      return fg;
    }
    if (Date.now() >= deadline) break;
    await sleep(interval);
  }
  throw new Error(
    `断言失败: ${selector} 命中 ${count} 个，期望 ${expected}（等待 ${timeout}ms 超时）\n  ` +
      (await describeCurrentPage(fg, t))
  );
}

/**
 * 向上滑动（从屏幕下方向上方滑动），使用真实 adb 触摸事件。
 *
 * 【为什么不用 page.mouse】
 * 实测对照（首页，用各容器 scrollTop 变化作为判据）：
 *   page.mouse 合成滑动 → 11 个可滚动容器的 scrollTop 全部纹丝不动，完全无效
 *   adb input swipe     → wx-scroll-view 滚动 468px，有效
 * 小程序视图层只响应真实触摸事件，合成鼠标事件对它无效。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{duration?: number, startRatio?: number, endRatio?: number}} params
 *        duration: 滑动持续时间（毫秒）；startRatio/endRatio: 起止位置占屏幕高度的比例
 * @returns {Promise<import('playwright').Page>} page
 */
async function swipeUp(page, { duration = 500, startRatio = 0.75, endRatio = 0.25, timeout = 5000 } = {}) {
  try {
    const device = await getDevice();
    const view = await page.evaluate(() => ({
      dpr: window.devicePixelRatio,
      w: document.documentElement.clientWidth,
      h: document.documentElement.clientHeight,
    }));

    // 同一竖线上从下往上滑，避免碰到左右两侧的边缘元素
    const x = Math.round((view.w / 2) * view.dpr);
    const y1 = Math.round(view.h * startRatio * view.dpr);
    const y2 = Math.round(view.h * endRatio * view.dpr);

    // 滚动判据：记录页面中部若干个元素的位置，滑动后看它们有没有位移。
    // 不用 scrollHeight - clientHeight 判断（小程序动态加载时该差值不稳定，
    // 实测出现过一个可滚动容器都检测不到、导致误判"未滚动"的情况）。
    const probe = () =>
      page.evaluate(() => {
        const out = [];
        document.querySelectorAll("wx-view, wx-text, wx-scroll-view").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.height > 20 && r.top > 100 && r.top < 600) {
            out.push(Math.round(r.top));
          }
        });
        return out.slice(0, 20);
      });

    const before = await probe();
    await device.shell(`input swipe ${x} ${y1} ${x} ${y2} ${duration}`);

    // 等页面滚动动画结束，再确认是否真的滚了
    const deadline = Date.now() + timeout;
    let after = await probe();
    while (Date.now() < deadline) {
      await page.waitForTimeout(300);
      after = await probe();
      if (after.length && before.length && after.some((v, i) => before[i] !== undefined && Math.abs(v - before[i]) > 5)) {
        break;
      }
    }

    const moved =
      before.length > 0 && after.length > 0 && after.some((v, i) => before[i] !== undefined && Math.abs(v - before[i]) > 5);

    if (!moved) {
      // 明确抛错，避免"发了 swipe 就当过"的假通过
      throw new Error(
        `滑动后页面未发生位移（探测点 ${JSON.stringify(before.slice(0, 5))} → ${JSON.stringify(after.slice(0, 5))}）。` +
          `可能原因：当前页面不可滚动、滑动的容器不对、或需要先滚动到有内容的区域。`
      );
    }

    console.log(`向上滑动完成（adb input swipe ${x} ${y1} ${x} ${y2} ${duration}），页面已位移`);
    return page;
  } catch (e) {
    console.error(`滑动失败: ${e.message}`);
    throw e;
  }
}

// 返回按钮的候选选择器。第一个是专栏详情页实测可用的：
//   <wx-text class="h5-i iconfont icon-base-nav-return icon-base-nav-return- my-iconfont">
const BACK_BUTTON_SELECTORS = [
  '[class*="nav-return"]',
  '[class*="icon-return"]',
  '[class*="icon-back"]',
  '[class*="nav-back"]',
];

/**
 * 返回上一页。
 *
 * 【为什么不能用 page.goBack()】
 * 那是浏览器的历史后退，而小程序有自己的路由栈。实测 page.goBack() 之后
 * **URL 和页面内容都不变**（等于什么都没做，还不报错）。
 * 所以必须真实点击左上角的返回按钮。
 *
 * 点击前后还要比对页面内容/元素数，**确认真的换页了才算成功** ——
 * "点了没反应"绝不能被当成通过，这正是框架反复强调要避免的假通过。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{timeout?: number, selectors?: string[]}} params
 *        timeout: 等待页面变化的超时（毫秒）；
 *        selectors: 覆盖返回按钮的候选选择器（页面结构不同、或需要定向诊断时用）
 * @returns {Promise<import('playwright').Page>} 返回后的前台页
 */
async function goBack(page, { timeout = 10000, selectors = BACK_BUTTON_SELECTORS } = {}) {
  // 注意用 require 而不是顶部 import：app_common 与本文件存在循环依赖
  const { resolveForegroundPage } = require("../../common/app_common");
  try {
    const device = await getDevice();
    const before = await resolveForegroundPage(page);

    let beforeText = "";
    try {
      beforeText = await before.evaluate(() => (document.body.innerText || "").slice(0, 400));
    } catch (e) {
      // 页面可能在读取时被销毁，只做元素数比对
    }
    const beforeCount = await before.locator("*").count().catch(() => -1);

    // 找返回按钮：按候选选择器依次试，命中第一个就用它
    let locator = null;
    let usedSelector = null;
    for (const sel of selectors) {
      const n = await before.locator(sel).count().catch(() => 0);
      if (n > 0) {
        locator = before.locator(sel).first();
        usedSelector = sel;
        break;
      }
    }

    if (locator) {
      console.log(`点击返回按钮（选择器 ${usedSelector}）`);
      await tapElement(device, before, locator);
    } else {
      // 兜底：实在找不到返回按钮，用安卓系统返回键。
      // 小程序对 keyevent 4 的处理和按钮不一定等价，所以仍然要校验结果。
      console.warn(`未找到返回按钮（试过 ${selectors.join(" / ")}），改用安卓返回键 input keyevent 4`);
      await device.shell("input keyevent 4");
    }

    // 校验：内容或元素数发生变化，才算真的返回了
    const deadline = Date.now() + timeout;
    let after = before;
    let afterText = beforeText;
    let afterCount = beforeCount;
    let changed = false;
    while (Date.now() < deadline) {
      await sleep(500);
      after = await resolveForegroundPage(before);
      try {
        afterText = await after.evaluate(() => (document.body.innerText || "").slice(0, 400));
      } catch (e) {
        afterText = beforeText;
      }
      afterCount = await after.locator("*").count().catch(() => -1);
      if (afterText !== beforeText || (beforeCount > 0 && afterCount !== beforeCount)) {
        changed = true;
        break;
      }
    }

    if (!changed) {
      throw new Error(
        `已发出返回操作，但页面没有变化（元素数 ${beforeCount} -> ${afterCount}）。` +
          `可能命中的不是返回按钮，或页面切换比预期慢。`
      );
    }

    console.log(`已返回上一页（元素数 ${beforeCount} -> ${afterCount}）`);
    return after;
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
 * 在微信小程序 webview 中按文本点击元素（真实 adb tap）
 *
 * ⚠️ 本函数与 clickElementByText 实现完全相同，仅日志文案不同。
 * 保留两个名字只是照顾历史调用方，后续应合并成一个。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number}} params text: 元素文本；timeout: 等待超时（毫秒）
 * @returns {Promise<import('playwright').Page>} page
 */
async function clickWxText(page, { text, timeout = 10000 } = {}) {
  try {
    const el = page.getByText(text, { exact: false }).first();
    await el.waitFor({ state: "attached", timeout });
    const device = await getDevice();
    await tapElement(device, page, el);
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
  getDevice,
  getForegroundPage,
  findPageWith,
  waitImeShown,
  login,
  clickElementById,
  clickElementByText,
  inputText,
  assertElementExists,
  assertTextVisible,
  assertTextNotVisible,
  assertSelectorExists,
  assertSelectorCount,
  swipeUp,
  goBack,
  switchToWxWebview,
  clickWxText,
  switchToUserCenter,
  focusSearchInput,
  dumpElements,
  tapElement,
};
