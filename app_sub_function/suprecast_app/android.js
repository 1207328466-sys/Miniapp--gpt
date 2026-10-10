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
 * - 面积不超过起始元素的 8 倍（避免一路爬到整页容器，那会点到页面正中间）
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

    let cur = start;
    for (let i = 0; i < 4; i++) {
      const parent = cur.parentElement;
      if (!parent) break;
      cur = parent;

      const r = rectOf(cur);
      if (r.area > 400) {
        // 尺寸增长过多说明爬到整页容器了，会点到页面正中间，放弃
        if (r.area <= startRect.area * 8 + 2000) {
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
 * 【设计要点】
 * 1. 点击后必须等"切换完成"的可观测信号，否则调用方拿到的是过渡中的中间状态。
 *    历史上这个函数点击后立即 return，导致用例报 passed 但页面零变化。
 * 2. 必须幂等：如果已经在用户中心，直接返回，不再点击。
 *    否则在"刚从一个 tab 切回来"的时序下，重复点击会落在过渡态上而失败。
 * 3. 点击后若未切换成功，允许重试一次。小程序 tab 切换在连续操作时偶发失败。
 *
 * 【判据】「积分商城」在登录态和未登录态都存在；「登录/注册」是未登录时的标题。
 * 这两个文本在「压铸百科」等其它页面的可见文本中出现 0 次（实测），可作可靠依据。
 * 用 document.body.innerText 检索：它只返回可见文本，自动排除隐藏元素与
 * <style>/<script> 里的同名字符串（用 page.content() 会误判）。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{timeout?: number, retries?: number}} params timeout: 单次等待超时（毫秒）；retries: 失败重试次数
 * @returns {Promise<import('playwright').Page>} page
 */
async function switchToUserCenter(page, { timeout = 10000, retries = 1 } = {}) {
  // 注意用 require 而不是顶部 import：app_common 与本文件存在循环依赖
  // （app_common 的 appTest 需要本文件的操作函数）。延迟到运行时取，
  // 此时 app_common 已加载完毕，可以安全拿到。
  const { pickForegroundPage } = require("../../common/app_common");

  /** 在【当前前台页】上判断是否已在用户中心 */
  const checkOnForeground = async () => {
    const fg = await pickForegroundPage(page);
    return fg.evaluate(() => {
      const t = document.body.innerText || "";
      return t.includes("积分商城") || t.includes("登录/注册");
    });
  };

  try {
    // 幂等：已经在用户中心就直接返回
    if (await checkOnForeground()) {
      console.log("已在用户中心，无需切换");
      return await pickForegroundPage(page);
    }

    await page.waitForTimeout(1500);
    const device = await getDevice();

    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      try {
        // 必须加 .first()：首页上同时存在「我的」和「我的关注」，
        // 不加会在 strict mode 下抛 "resolved to 2 elements"。
        const userCenterButton = page.getByText("我的").first();
        await userCenterButton.waitFor({ state: "attached", timeout: 10000 });

        // 用真实 adb tap，不用 .click()：实测 .click() 在小程序上会因
        // 页面持续重绘导致 "stable" 检查永不满足，从而超时或误报失败。
        await tapElement(device, page, userCenterButton);

        // 【关键】点击后必须重新获取前台页再验证。
        // 小程序切 tab 会创建新的 page 对象，旧的 page 变成后台页，
        // 其内容冻结在切换前（实测：旧 page 的 innerText 永远是首页内容）。
        // 在旧 page 上等「积分商城」会必然超时 —— 这正是本函数曾经失败的原因。
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (await checkOnForeground()) {
            const fg = await pickForegroundPage(page);
            console.log("已切换到用户中心");
            return fg; // 返回前台页，不能用旧 page
          }
          await page.waitForTimeout(400);
        }
        throw new Error(`等待用户中心内容超时（${timeout}ms）`);
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          console.warn(`切换到用户中心第 ${i + 1} 次失败，重试中: ${e.message.split("\n")[0]}`);
          await page.waitForTimeout(2000);
        }
      }
    }
    throw lastErr;
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
    const actual = await el.evaluate((node) => {
      if ("value" in node) return node.value;
      const inner = node.querySelector("input, textarea");
      return inner ? inner.value : "";
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
  tapElement,
};
