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

    /**
     * 命中测试：这个元素的中心点，最上面压着的是不是它（或它的亲属）？
     *
     * 【为什么必须按"真正要点的那一层"来判】2026/10/12 踩了两次：
     *   ① 首页滚上去之后，搜索栏的坐标还在屏幕内、却被吸顶头部压住 —— 点了个空、还不报错（坑 25）；
     *   ② 第一版护栏拿"原始元素"去比（比如一行文字里的 span），而实际点击用的是**向上找到的
     *      可点击容器**（比如整行）—— 于是正常的点击也被判成"被盖住"，误伤了一个好用例。
     * 所以：**用哪一层的坐标去点，就用哪一层来判命中**。
     *
     * @returns {string} 空串 = 能点到；否则是"盖在上面的那个元素"的描述
     */
    const coveredByOf = (el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!top) return "(空：那个坐标上没有元素)";
      if (top === el || el.contains(top) || top.contains(el)) return "";
      return describe(top);
    };

    const startRect = rectOf(start);

    // 起点本身尺寸正常，不必向上找
    if (startRect.area > 400) {
      return {
        selector: "self",
        level: 0,
        box: startRect,
        reason: "起点元素尺寸正常",
        coveredBy: coveredByOf(start),
      };
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
            coveredBy: coveredByOf(cur), // 按"真正要点的这一层"判命中（见上面说明）
          };
        }
        return {
          selector: "self",
          level: 0,
          box: startRect,
          reason: `向上第 ${i + 1} 层容器过大（${describe(cur)} 面积 ${Math.round(r.area)}），改用起点`,
          coveredBy: coveredByOf(start),
        };
      }
    }

    return {
      selector: "self",
      level: 0,
      box: startRect,
      reason: "未找到合适的祖先，改用起点",
      coveredBy: coveredByOf(start),
    };
  });
}

/**
 * 软键盘（输入法）开着吗？开着就先收起来。
 *
 * 【为什么需要】2026/10/12 真机踩到：手机停在搜索页、**软键盘弹着**（有人手动点过 / 上一步输过字），
 * 这时「回到首页」去点底部 tab —— 坐标落在**键盘**上，adb 照样"执行成功"，页面一动不动，
 * 最后报出「点击底部 tab 后没有进入有问必答页」，看着像导航坏了。
 *
 * ⚠️ 这一例**命中测试也救不了**：软键盘是**原生窗口**，不在页面 DOM 里，
 * `document.elementFromPoint` 在那个坐标上照样返回页面元素（返回的是被键盘盖住的那个）。
 * 只能到系统层问一句：`dumpsys input_method` 的 `mInputShown`。
 *
 * 收起用 `keyevent 111`（ESC）：它只收输入法、**不会返回上一页**（真机实测过）。
 * 不用 keyevent 4（BACK）—— 那在部分页面上会真的返回，属于"用一个坑换另一个坑"。
 *
 * @param {import('playwright').AndroidDevice} device
 * @returns {Promise<boolean>} 是否真的收过一次
 */
async function hideKeyboardIfShown(device) {
  const out = await device.shell("dumpsys input_method").catch(() => "");
  if (!/mInputShown=true|mIsInputViewShown=true/.test(String(out))) return false;
  await device.shell("input keyevent 111");
  await new Promise((r) => setTimeout(r, 600));
  console.log("  [提示] 软键盘正开着（会盖住屏幕底部）—— 已先收起它再继续");
  return true;
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
  /** 量一次目标（含"往上找可点击祖先"那套逻辑），返回 CSS 尺寸与换算成设备像素的中心点 */
  const measure = async () => {
    const found = await findClickableAncestor(locator);
    let { x, y, w, h } = found.box;
    if (found.selector === "self") {
      const box = await locator.boundingBox();
      if (!box) throw new Error("元素取不到坐标，可能不可见");
      ({ x, y, width: w, height: h } = box);
    }
    if (!w || !h) throw new Error("元素取不到有效尺寸，可能不可见");
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    return {
      found,
      // CSS 坐标也留着：下面做"命中测试"要用 CSS 坐标（elementFromPoint 认的是 CSS 像素）
      cx: Math.round(x + w / 2),
      cy: Math.round(y + h / 2),
      px: Math.round((x + w / 2) * dpr),
      py: Math.round((y + h / 2) * dpr),
    };
  };

  let m = await measure();

  // 【屏幕外保护】2026/10/10 真机踩到：滑动之后搜索栏被顶到屏幕上方，元素坐标成了
  // y = -1272（负数）。adb 照样"执行"了这个 tap —— **点了等于没点，而且不报错**，
  // 一直到后面某一步才以一个看不懂的原因失败（「点击搜索栏后没有进入搜索页」）。
  // 这是典型的静默失败，必须挡住：
  //   1) 先试着把它滚进可视区（小程序大部分列表是真实的 DOM 滚动容器，通常有效）
  //   2) 再量一次，还在屏幕外就明确报错，把元素、坐标、屏幕尺寸都带上
  const screen = await page
    .evaluate(() => ({
      w: Math.round((window.innerWidth || 0) * (window.devicePixelRatio || 1)),
      h: Math.round((window.innerHeight || 0) * (window.devicePixelRatio || 1)),
    }))
    .catch(() => ({ w: 0, h: 0 }));
  const offScreen = (px, py) =>
    px < 0 || py < 0 || (screen.w > 0 && px > screen.w) || (screen.h > 0 && py > screen.h);

  if (offScreen(m.px, m.py)) {
    console.warn(
      `  [提示] 目标不在屏幕内（adb tap 坐标 ${m.px},${m.py}，屏幕 ${screen.w}x${screen.h}）—— 先尝试滚动到可视区`
    );
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    m = await measure();
  }

  if (offScreen(m.px, m.py)) {
    throw new Error(
      `点不到：目标在屏幕外（adb tap 坐标 ${m.px},${m.py}，屏幕 ${screen.w}x${screen.h}）。\n` +
        `  这种情况 adb 依然会"执行"点击，但点了等于没点 —— 所以这里直接报错，\n` +
        `  而不是留到后面变成一条看不懂的失败。常见原因：页面上滑之后目标被顶出屏幕了。\n` +
        `  表格里的办法：先加一步「滑动」（方向=下）把页面滚回顶部，再点它。`
    );
  }

  /*
   * 【被盖住保护】坐标在屏幕内 ≠ 点得到它。
   *
   * 2026/10/12 真机踩到：首页被滚上去之后，搜索栏的布局坐标仍在屏幕内，但被吸顶头部压住 ——
   * adb 老老实实点了那个坐标，**点到了头部**：页面没动，而且不报错（一直到后面某一步才以
   * 一个看不懂的原因失败）。失败截图 + `probe_search_bar_covered.js` 的复现都证明了这条因果。
   *
   * 这与坑 20（坐标落到屏幕外）是**相邻但不同**的一类静默失败：
   *   · 屏幕外：坐标是负的 / 超过屏幕尺寸 —— 用坐标就能判出来
   *   · 被盖住：坐标漂漂亮亮在屏幕里，就是点不到它 —— **只能靠命中测试判**
   *
   * 判据由 findClickableAncestor 给出（`coveredBy`）：**用哪一层的坐标去点，就用哪一层来判**。
   * 第一版拿"原始元素"去比，误伤了一个正常用例（点「积分商城」时，盖着它的是同一行里的文字节点）
   * —— 这条错也记在坑 25 里。
   */
  let coveredBy = m.found.coveredBy;
  if (coveredBy) {
    console.warn(`  [提示] 目标坐标上被 ${coveredBy} 盖着（adb tap 坐标 ${m.px},${m.py}）—— 先尝试滚动，再量一次`);
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    m = await measure();
    coveredBy = m.found.coveredBy;
  }

  if (coveredBy) {
    throw new Error(
      `点不到：目标被 ${coveredBy} 盖住了（adb tap 坐标 ${m.px},${m.py}）。\n` +
        `  这种情况 adb 照样会"执行"点击，但点到的是盖在上面的那个元素 —— 页面不会动，也不会报错，\n` +
        `  属于最坑的一类静默失败。命中测试（document.elementFromPoint）就是专门用来抓它的。\n` +
        `  常见原因：页面被滚上去了一段，目标虽然还在布局里，但被吸顶的头部压住了。\n` +
        `  表格里的办法：在点它之前先加一步「滑动」（方向=下）把页面滚回顶部。`
    );
  }

  // 【软键盘保护】点屏幕下缘（底部 tab 就在那儿）之前，先确认输入法没开着。
  // 它盖住的是**原生层**，DOM 命中测试看不见 —— 只有系统层能问出来（见 hideKeyboardIfShown）。
  if (screen.h > 0 && m.py > screen.h * 0.75) {
    if (await hideKeyboardIfShown(device)) {
      m = await measure(); // 键盘收起后布局可能变，重量一次再点
    }
  }

  await device.shell(`input tap ${m.px} ${m.py}`);
  console.log(`adb tap(${m.px}, ${m.py})  目标=${m.found.selector}  ${m.found.reason}`);
  return {
    x: m.px,
    y: m.py,
    target: m.found.selector,
    level: m.found.level,
    reason: m.found.reason,
  };
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
      (await describeCurrentPage(fg, t)) +
      (await require("./pages/base_page").selectorMissHint(fg, selector))
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
      (await describeCurrentPage(fg, t)) +
      (await require("./pages/base_page").selectorMissHint(fg, selector))
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
 * @param {{duration?: number, startRatio?: number, endRatio?: number, ignoreNoMove?: boolean}} params
 *        duration: 滑动持续时间（毫秒）；startRatio/endRatio: 起止位置占屏幕高度的比例
 *        ignoreNoMove: 页面没动时**不报错**（给"滑到顶/滑到底"这类循环用：
 *                      那时"没动"是**正常结果**，不是失败 —— 2026/10/14 写探针时踩到）
 * @returns {Promise<import('playwright').Page>} page
 */
async function swipeUp(
  page,
  { duration = 500, startRatio = 0.75, endRatio = 0.25, timeout = 5000, ignoreNoMove = false } = {}
) {
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

    /* 滚动判据（2026/10/14 修正）：**两个信号，任意一个变过就算动了** ——
     *   ① 所有元素里最大的 scrollTop（原生滚动，最直接）；
     *   ② 页面中部若干元素的 top（滚动可能是用 transform 做的，那时 scrollTop 恒为 0，只能看这个）。
     *
     * 【为什么要加第①个】当天在案例库页上实测到：页面**真的滚了 159 px**，
     * 但采样窗口（top 100~600、高>20）里只有**吸顶元素**（top 恒为 123），
     * 于是旧判据（只看元素 top）报「未发生位移」—— 一天里冤枉了 3 条用例
     * （案例库_003、ZW_029、以及一条临时用例）。证据见 test_case/diagnostic/probe_swipe_judge.js。
     *
     * 另外仍然**不**用 scrollHeight - clientHeight 判断"能不能滚"：小程序动态加载时那个差值不稳，
     * 实测出现过"一个可滚动容器都检测不到"的误判 —— 那说的是**能力**，这里量的是**有没有动**。
     */
    const probe = () =>
      page.evaluate(() => {
        let scrollTop = 0;
        document.querySelectorAll("*").forEach((el) => {
          if (el.scrollTop > scrollTop) scrollTop = el.scrollTop;
        });
        const tops = [];
        document.querySelectorAll("wx-view, wx-text, wx-scroll-view").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.height > 20 && r.top > 100 && r.top < 600) tops.push(Math.round(r.top));
        });
        return { scrollTop: Math.round(scrollTop), tops: tops.slice(0, 20) };
      });

    const movedBetween = (before, after) => {
      if (Math.abs(after.scrollTop - before.scrollTop) > 5) return true; // ① 页面真的滚了
      return (
        before.tops.length > 0 && after.tops.length > 0 && // ② 元素挪位了（transform 滚动的情况）
        after.tops.some((v, i) => before.tops[i] !== undefined && Math.abs(v - before.tops[i]) > 5)
      );
    };

    // 一次滑动 = "发一次 adb swipe，然后等它动"。抽成函数是为了能在"没动"时**重试一次**（见下）。
    const swipeOnce = async () => {
      const before = await probe();
      await device.shell(`input swipe ${x} ${y1} ${x} ${y2} ${duration}`);
      // 等页面滚动动画结束，再确认是否真的滚了
      const deadline = Date.now() + timeout;
      let after = await probe();
      while (!movedBetween(before, after) && Date.now() < deadline) {
        await page.waitForTimeout(300);
        after = await probe();
      }
      return { ok: movedBetween(before, after), before, after };
    };

    let res = await swipeOnce();
    if (!res.ok && !ignoreNoMove) {
      // 一次不成就判死太急：**刚跳到某页时列表内容可能还没渲染出来**，那一刻页面滚不动 ——
      // 实测（2026/10/14）：`打开案例库` 之后立刻滑 -> "未发生位移"；等约 1.5 秒再滑就正常了
      // （到达判据只等"页面容器出现"，不等"卡片渲染完"）。所以这里重试一次，
      // **重试还不动才算失败**：错误文案与判据都没放松，仍然不会"发了 swipe 就当过"。
      console.log("  这次滑动页面没有位移，等 800ms 再试一次（刚跳过来的页面，内容可能还没渲染完）");
      await page.waitForTimeout(800);
      res = await swipeOnce();
    }

    if (!res.ok) {
      if (ignoreNoMove) {
        // 循环场景：没动 = 已经到顶/到底（或这一页本来就不滚）—— 如实说一句就返回，不当失败
        console.log("  页面没有位移（可能已经到顶/到底，或这一页本来就不可滚动）");
        return page;
      }
      // 明确抛错，避免"发了 swipe 就当过"的假通过
      throw new Error(
        `滑动后页面未发生位移（scrollTop ${res.before.scrollTop} → ${res.after.scrollTop}；` +
          `元素 top ${JSON.stringify(res.before.tops.slice(0, 5))} → ${JSON.stringify(res.after.tops.slice(0, 5))}）。` +
          `可能原因：当前页面不可滚动、滑动的容器不对、或需要先滚动到有内容的区域。\n` +
          `  （已经重试过一次：等 800ms 再滑，仍然没动）`
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
 * ADBKeyboard：手机上装的那个「只收广播、不显示键盘」的输入法。
 *
 * 【为什么需要它】`adb shell input text` **只认 ASCII**（中文发过去不报错也不生效）。
 * 装上这个输入法之后，文本可以通过**广播**提交给当前焦点输入框 —— 中文、空格、引号都能送，
 * 而且我们用 **base64** 那一种广播（`ADB_INPUT_B64`），文本里带 `$`/`;`/引号也不会有 shell 注入风险。
 *
 * 【一次性准备】换手机 / 重装系统后要重装它（约 17KB 的开源输入法）：
 *     adb install -r ADBKeyboard.apk
 *   APK 来源见 knowledge/环境与目标小程序.md 的「中文输入」一节（走 CDN 镜像下载，GitHub 直连会超时）。
 * 装完**不需要**手动切输入法：框架用的时候自己切过去、用完切回原来的（见 typeKeyword 的中文分支）。
 */
const ADB_KEYBOARD_IME = "com.android.adbkeyboard/.AdbIME";

/** 当前系统输入法（用于"用完切回"） */
async function currentIme(device) {
  return String(await device.shell("settings get secure default_input_method")).trim();
}

/** 切换系统输入法 */
async function setIme(device, ime) {
  await device.shell(`ime set ${ime}`);
}

/** 用 ADBKeyboard 把文本提交给当前焦点输入框（base64 广播，天然无注入风险） */
async function adbKeyboardType(device, text) {
  const b64 = Buffer.from(String(text), "utf8").toString("base64");
  await device.shell(`am broadcast -a ADB_INPUT_B64 --es msg ${b64}`);
}

/** 用 ADBKeyboard 清空当前焦点输入框（比连按 20 次 DEL 干净） */
async function adbKeyboardClear(device) {
  await device.shell("am broadcast -a ADB_CLEAR_TEXT");
}

/**
 * 输出当前页面的 DOM 结构，方便挑锚点（找 id / 找唯一文案）。
 *
 * 相比旧版多了 4 件事（2026/10/13 照 webzdh4.7 那版的思路补的）：
 *   1. **打印 id** —— 定位一般只有 id / class / 文本三个入口，旧版只打 class，等于把一种入口丢了；
 *   2. **过滤编译器噪声 class** —— Taro 会把每个类名再重复一份 `index--xxx`，
 *      这些对我们挑锚点毫无用处，却能把输出撑大一倍；
 *   3. **onlyText** —— 只看"内部有文字的分支"，几百行能压到几十行（挑文案时最好用）；
 *   4. **控制台限量 + 落盘** —— 控制台最多 300 行（否则一次刷屏上千行，真正要看的东西冲没了），
 *      完整内容写到 `report/dump_<月日_时分秒>.txt`，可以在编辑器里慢慢搜。
 *
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{tag?: string|string[], onlyText?: boolean, maxLines?: number, save?: boolean}} params
 *   tag      只输出这些元素类型（如 "wx-text"，可传数组）；不传则输出整个 body
 *   onlyText 只保留"内部有文字"的分支（默认 false，跟旧版一样全输出）
 *   maxLines 控制台最多打印多少行（默认 300；完整内容仍在文件里）
 *   save     是否落盘到 report/dump_*.txt（默认 true）
 * @returns {Promise<import('playwright').Page>} page
 */
async function dumpElements(page, { tag, onlyText = false, maxLines = 300, save = true } = {}) {
  const fs = require("fs");
  const path = require("path");
  try {
    const selector = !tag ? "body" : (Array.isArray(tag) ? tag : [tag]).join(",");
    const result = await page.evaluate(
      ({ sel, onlyText, maxLines }) => {
        const lines = [];
        let pageTotal = 0;
        let visited = 0;

        const cleanClass = (raw) => {
          const out = [];
          (raw || "").split(/\s+/).forEach((c) => {
            if (!c || c.startsWith("index--")) return; // Taro 的重复类名，挑锚点没用
            if (!out.includes(c)) out.push(c);
          });
          return out.join(" ");
        };

        const directText = (el) =>
          Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent.replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" ");

        const hasTextInside = (el) => (directText(el) ? true : Array.from(el.children).some(hasTextInside));

        const walk = (el, depth) => {
          visited++;
          if (onlyText && !hasTextInside(el)) return;

          const pad = "  ".repeat(depth);
          const name = el.tagName.toLowerCase();
          const id = el.getAttribute("id");
          const cls = cleanClass(el.getAttribute("class"));
          const text = directText(el);
          const kids = Array.from(el.children);
          const open = `<${name}${id ? ` id="${id}"` : ""}${cls ? ` class="${cls}"` : ""}>`;

          if (!kids.length) {
            lines.push(`${pad}${open}${text}</${name}>`);
            return;
          }
          lines.push(`${pad}${open}`);
          if (text) lines.push(`${pad}  ${text}`);
          kids.forEach((k) => walk(k, depth + 1));
          lines.push(`${pad}</${name}>`);
        };

        pageTotal = document.querySelectorAll("*").length;
        document.querySelectorAll(sel).forEach((el) => walk(el, 0));

        const total = lines.length;
        return {
          text: lines.slice(0, maxLines).join("\n"),
          // 落盘要的是**完整内容**：之前把 text（已经截到 maxLines 的那份）写进文件，
          // 于是"完整内容见文件"这句话是假的 —— 文件里也只有前 300 行。
          // 实测：页面上统计说输出 707 行，文件里只有 300 行（2026/10/13 自己踩到并修掉）。
          full: lines.join("\n"),
          total,
          pageTotal,
          visited,
          truncated: total > maxLines,
        };
      },
      { sel: selector, onlyText, maxLines }
    );

    console.log(result.text);
    console.log(
      `\n[dumpElements] 本页元素 ${result.pageTotal} 个；本次遍历 ${result.visited} 个，输出 ${result.total} 行` +
        (result.truncated ? `（控制台只显示前 ${maxLines} 行，完整内容见文件）` : "")
    );
    // 这份 dump 是给人挑锚点用的，所以把"哪一列能抄、哪一列别抄"直接说在结尾 ——
    // 2026/10/14 删掉按 id 定位之后，id 只剩"看结构"这一个用途（它每次重建页面都会变）。
    console.log(
      "[dumpElements] 挑锚点提醒：**抄 class**（形如 .search-container；带 index-- 前缀的是编译器噪声，已过滤掉），" +
        "或者直接用页面上看得见的文字；**别抄 id** —— 同一个页面重建一次（退出去再进来）id 就全换，" +
        "按它定位的动作已经从框架里删掉了（见 docs/踩坑记录.md 坑 38）"
    );

    if (save) {
      try {
        const dir = path.join(__dirname, "..", "..", "report");
        fs.mkdirSync(dir, { recursive: true });
        const d = new Date();
        const p2 = (n) => String(n).padStart(2, "0");
        const stamp = `${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const file = path.join(dir, `dump_${stamp}.txt`);
        fs.writeFileSync(file, result.full, "utf8");
        console.log(`[dumpElements] 完整内容已写入 ${file}`);
      } catch (e) {
        console.log(`[dumpElements] 落盘失败（不影响本次输出）: ${e.message}`);
      }
    }
    return page;
  } catch (e) {
    console.error(`输出HTML失败: ${e.message}`);
    throw e;
  }
}

module.exports = {
  getDevice,
  getForegroundPage,
  waitImeShown,
  assertTextVisible,
  assertTextNotVisible,
  assertSelectorExists,
  assertSelectorCount,
  swipeUp,
  goBack,
  switchToUserCenter,
  focusSearchInput,
  dumpElements,
  tapElement,
  hideKeyboardIfShown,
  ADB_KEYBOARD_IME,
  currentIme,
  setIme,
  adbKeyboardType,
  adbKeyboardClear,
};
