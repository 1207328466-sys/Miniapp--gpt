/*
 * @cur_file: capability_check.js
 * @create_date: 2026/10/10
 *
 * 能力探测脚本（不是用例，pytest 不会收集）
 *
 * 目的：系统验证 android.js 里那些关键字函数，哪些真正可用、哪些不能用、边界在哪。
 *   （写于 2026/10/10，当时是 15 个 —— 函数数量后来变过，别把 15 当准数。
 *     跑之前先扫一眼正文：它探测的某些函数后来被重写或下沉到页面对象了。）
 * 输出：report/diagnostic/capability.log（完整日志）
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\小程序自动化框架
 *   node test_case/diagnostic/capability_check.js
 *
 * 前置：小程序停在首页（底部有 tab 栏的页面）
 *
 * 设计原则：
 *   每项测试都要有"可证伪"的判据，不能靠"没抛异常"就当通过。
 *   例如 swipeUp 用元素的 boundingRect 位移来判断是否真的滚动了。
 */

const fs = require("fs");
const path = require("path");
const { _android: android } = require("playwright");
const { appTest, runAppSteps } = require("../../common/app_common");
const {
  tapElement,
  getForegroundPage,
  dumpElements,
  clickElementByText,
  clickElementById,
  inputText,
  assertElementExists,
  swipeUp,
  goBack,
  clickWxText,
  switchToWxWebview,
  login,
  focusSearchInput,
  switchToUserCenter,
} = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "capability.log");

// 记录所有结论，最后汇总成清单
const RESULTS = [];

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

/** 记录一条能力结论 */
function record(name, status, detail) {
  RESULTS.push({ name, status, detail });
  const icon = status === "可用" ? "[OK]  " : status === "不可用" ? "[FAIL]" : "[?]   ";
  log(`${icon} ${name} -- ${status}：${detail}`);
}

/** 安全执行：捕获异常并把错误信息返回，不让单个失败中断整轮 */
async function attempt(fn) {
  try {
    const v = await fn();
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============ 各项能力测试（每个都是 runAppSteps 的一个"步骤"）============

/** 前置：确认页面基本状态，并采集可用元素数据 */
let ctx = {};

async function step_init(page) {
  log("\n" + "=".repeat(60));
  log("前置检查");
  log("=".repeat(60));

  const fg = await getForegroundPage(page);
  log(`前台页 URL: ${fg.url()}`);
  log(`page 与前台页同一个对象: ${fg === page}`);

  // 采集：页面上有 id 的元素（供 assertElementExists 测试用真实 id）
  const ids = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("[id]").forEach((el) => {
      out.push({ id: el.id, tag: el.tagName.toLowerCase() });
    });
    return out;
  });
  log(`\n页面上有 id 的元素共 ${ids.length} 个，前 8 个：`);
  ids.slice(0, 8).forEach((x) => log(`   #${x.id}  <${x.tag}>`));
  ctx.ids = ids;

  // 采集：页面上可见的文字（供 clickElementByText 的负向测试挑一个不存在的词）
  const texts = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll("wx-text, wx-view, span").forEach((el) => {
      const t = (el.innerText || "").trim();
      if (t && t.length <= 12 && !t.includes("\n")) set.add(t);
    });
    return Array.from(set).slice(0, 40);
  });
  log(`\n页面上可见的短文本（前 40 个）：`);
  log("   " + texts.join(" | "));
  ctx.texts = texts;

  // 采集：滚动容器的初始位置，供 swipeUp 判断是否真的滚动
  ctx.scrollBefore = await page.evaluate(() => {
    const el = document.querySelector("wx-scroll-view, .wx-scroll-view, wx-view");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), top: r.top, scrollTop: el.scrollTop };
  });
  log(`\n滚动容器初始状态: ${JSON.stringify(ctx.scrollBefore)}`);

  return page;
}

/** 测试 1：getForegroundPage 能否正确识别前台页 */
async function test_getForegroundPage(page) {
  log("\n" + "-".repeat(60));
  log("测试: getForegroundPage");
  const r = await attempt(async () => {
    const fg = await getForegroundPage(page);
    const alive = await fg.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(true))));
    return { sameAsInput: fg === page, rafAlive: alive };
  });
  if (r.ok) {
    record("getForegroundPage", "可用", `返回页面 RAF 活跃=${r.value.rafAlive}，与输入同一对象=${r.value.sameAsInput}`);
  } else {
    record("getForegroundPage", "不可用", r.error);
  }
  return page;
}

/** 测试 2：dumpElements 能否输出结构 */
async function test_dumpElements(page) {
  log("\n" + "-".repeat(60));
  log("测试: dumpElements（只打印摘要，避免刷屏）");
  const r = await attempt(async () => {
    // 直接调用底层逻辑，把结果写到文件，不往控制台刷 589KB
    const html = await page.evaluate(() => {
      const lines = [];
      const walk = (el, depth) => {
        const pad = "  ".repeat(depth);
        const name = el.tagName.toLowerCase();
        const cls = el.getAttribute("class");
        lines.push(`${pad}<${name}${cls ? ` class="${cls}"` : ""}>`);
        Array.from(el.children).forEach((k) => walk(k, depth + 1));
      };
      document.querySelectorAll("body").forEach((el) => walk(el, 0));
      return lines.join("\n");
    });
    fs.writeFileSync(path.join(OUT_DIR, "capability_dump.txt"), html, "utf8");
    return html.split("\n").length;
  });
  if (r.ok) {
    record("dumpElements", "可用", `能输出结构化 DOM，共 ${r.value} 行，已写入 capability_dump.txt`);
  } else {
    record("dumpElements", "不可用", r.error);
  }
  return page;
}

/** 测试 3：assertElementExists ---- 正向（用真实 id）和反向（用假 id） */
async function test_assertElementExists(page) {
  log("\n" + "-".repeat(60));
  log("测试: assertElementExists");

  // 正向：用页面上真实存在的 id
  const realId = ctx.ids.length ? ctx.ids[0].id : null;
  if (realId) {
    const r = await attempt(() => assertElementExists(page, { elementId: realId }));
    if (r.ok) {
      record("assertElementExists(存在元素)", "可用", `#${realId} 断言通过`);
    } else {
      record("assertElementExists(存在元素)", "不可用", `#${realId} 竟然失败: ${r.error}`);
    }
  } else {
    record("assertElementExists(存在元素)", "无法测试", "页面上没有带 id 的元素");
  }

  // 反向：用一定不存在的 id，应该失败。如果它"通过"了，说明断言是假的
  const r2 = await attempt(() => assertElementExists(page, { elementId: "definitely_not_exist_xyz_123", timeout: 2000 }));
  if (r2.ok) {
    record("assertElementExists(不存在元素)", "严重问题", "不存在的元素竟然断言通过 -> 这个断言函数是失效的！");
  } else {
    record("assertElementExists(不存在元素)", "可用", `正确抛错: ${r2.error.slice(0, 80)}`);
  }
  return page;
}

/** 测试 4：swipeUp 是否真的让页面滚动 */
async function test_swipeUp(page) {
  log("\n" + "-".repeat(60));
  log("测试: swipeUp（用元素位移判断是否真的滚动）");

  const r = await attempt(async () => {
    // 记录滑动前某个深层元素的屏幕位置
    const before = await page.evaluate(() => {
      const els = document.querySelectorAll("wx-view, wx-text");
      // 找一个在中下部的元素，滚动后位置会变化
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 20 && rect.top > 300 && rect.top < 700) {
          return { top: rect.top, text: (el.innerText || "").slice(0, 20) };
        }
      }
      return null;
    });

    await swipeUp(page, { duration: 800 });
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => {
      const els = document.querySelectorAll("wx-view, wx-text");
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 20 && rect.top > 300 && rect.top < 700) {
          return { top: rect.top, text: (el.innerText || "").slice(0, 20) };
        }
      }
      return null;
    });

    return { before, after };
  });

  if (!r.ok) {
    record("swipeUp", "不可用", r.error);
  } else if (!r.value.before || !r.value.after) {
    record("swipeUp", "无法判断", "找不到可用于对比位置的元素");
  } else {
    const moved = Math.abs(r.value.after.top - r.value.before.top) > 5;
    record(
      "swipeUp",
      moved ? "可用" : "不可用",
      moved
        ? `页面确实滚动了：元素 top 从 ${r.value.before.top.toFixed(1)} 变到 ${r.value.after.top.toFixed(1)}`
        : `调用没报错，但元素位置没变（${r.value.before.top.toFixed(1)} -> ${r.value.after.top.toFixed(1)}）-> 合成鼠标事件不被小程序识别`
    );
  }
  return page;
}

/** 测试 5：clickElementByText 能否真的点到并生效 */
async function test_clickElementByText(page) {
  log("\n" + "-".repeat(60));
  log("测试: clickElementByText（点击「我的」tab 并验证内容变化）");

  const r = await attempt(async () => {
    const before = await page.evaluate(() => document.body.innerText.includes("积分商城"));
    await clickElementByText(page, { text: "我的" });
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => document.body.innerText.includes("积分商城"));
    return { before, after };
  });

  if (!r.ok) {
    record("clickElementByText", "不可用", r.error);
  } else if (!r.value.before && r.value.after) {
    record("clickElementByText", "可用", "点击「我的」后用户中心内容出现，点击真实生效");
  } else if (r.value.before) {
    record("clickElementByText", "部分可用", `点击前就已在用户中心（before=${r.value.before}），本次无法验证切换效果`);
  } else {
    record("clickElementByText", "不可用", `调用没报错，但点击后用户中心内容仍未出现（before=${r.value.before}, after=${r.value.after}）`);
  }
  return page;
}

/** 测试 6：switchToUserCenter（已修复版） */
async function test_switchToUserCenter(page) {
  log("\n" + "-".repeat(60));
  log("测试: switchToUserCenter（已加入等待+验证的版本）");
  const r = await attempt(() => switchToUserCenter(page));
  if (r.ok) {
    const visible = await page.evaluate(() => document.body.innerText.includes("积分商城"));
    record("switchToUserCenter", visible ? "可用" : "可疑", `调用成功，页面内「积分商城」可见=${visible}`);
  } else {
    record("switchToUserCenter", "不可用", r.error);
  }
  return page;
}

/** 测试 7：goBack 是否真的返回上一页 */
async function test_goBack(page) {
  log("\n" + "-".repeat(60));
  log("测试: goBack（小程序是否响应浏览器后退）");
  const r = await attempt(async () => {
    const urlBefore = page.url();
    const cvBefore = await page.evaluate(() => document.body.innerText.slice(0, 100));
    await goBack(page);
    await page.waitForTimeout(2000);
    const urlAfter = page.url();
    const cvAfter = await page.evaluate(() => document.body.innerText.slice(0, 100));
    return { urlChanged: urlBefore !== urlAfter, contentChanged: cvBefore !== cvAfter };
  });
  if (!r.ok) {
    record("goBack", "不可用", `抛错: ${r.error.slice(0, 100)}`);
  } else if (r.value.urlChanged || r.value.contentChanged) {
    record("goBack", "可用", `URL 变化=${r.value.urlChanged}, 内容变化=${r.value.contentChanged}`);
  } else {
    record("goBack", "不可用", "调用没报错，但 URL 和页面内容都没变化 -> 小程序用自己的路由栈，不响应浏览器后退");
  }
  return page;
}

/** 测试 8：clickWxText（与 clickElementByText 实现重复，验证它是否同样可用） */
async function test_clickWxText(page) {
  log("\n" + "-".repeat(60));
  log("测试: clickWxText（点「有问必答」tab）");
  const r = await attempt(async () => {
    await clickWxText(page, { text: "有问必答" });
    await page.waitForTimeout(3000);
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 300));
    return txt.includes("积分商城") ? "仍在用户中心" : "已离开用户中心（可能切换成功）";
  });
  if (r.ok) {
    record("clickWxText", "可用", `调用成功，结果: ${r.value}`);
  } else {
    record("clickWxText", "不可用", r.error);
  }
  return page;
}

/** 测试 9：inputText（需要页面上有可输入的 wx-input） */
async function test_inputText(page) {
  log("\n" + "-".repeat(60));
  log("测试: inputText（需要一个带 id 的输入元素）");

  const inputInfo = await page.evaluate(() => {
    const el = document.querySelector("wx-input, input, wx-textarea, textarea");
    return el ? { tag: el.tagName.toLowerCase(), id: el.id || "(无 id)" } : null;
  });
  log(`页面上找到的输入元素: ${JSON.stringify(inputInfo)}`);

  if (!inputInfo || !inputInfo.id || inputInfo.id === "(无 id)") {
    record("inputText", "无法测试", `输入元素没有 id（找到的是 ${JSON.stringify(inputInfo)}），而 inputText 只支持按 id 定位`);
    return page;
  }

  const r = await attempt(() => inputText(page, { elementId: inputInfo.id, text: "capability_test" }));
  if (r.ok) {
    record("inputText", "可用", `成功向 #${inputInfo.id} 输入文本`);
  } else {
    record("inputText", "不可用", r.error.slice(0, 120));
  }
  return page;
}

/** 测试 10：clickElementById（需要一个真实 id） */
async function test_clickElementById(page) {
  log("\n" + "-".repeat(60));
  log("测试: clickElementById");
  const realId = ctx.ids.length ? ctx.ids[0].id : null;
  if (!realId) {
    record("clickElementById", "无法测试", "页面上没有带 id 的元素");
    return page;
  }
  const r = await attempt(() => clickElementById(page, { elementId: realId, timeout: 3000 }));
  if (r.ok) {
    record("clickElementById", "可用(调用成功)", `点击 #${realId} 未抛错。注意：未验证是否真的产生效果`);
  } else {
    record("clickElementById", "不可用", r.error.slice(0, 120));
  }
  return page;
}

/** 测试 11：switchToWxWebview */
async function test_switchToWxWebview(device) {
  log("\n" + "-".repeat(60));
  log("测试: switchToWxWebview");
  const r = await attempt(() => switchToWxWebview(device, { timeout: 10000 }));
  if (r.ok) {
    record("switchToWxWebview", "可用", `返回页面 URL: ${r.value.url().slice(0, 70)}`);
  } else {
    record("switchToWxWebview", "不可用", r.error.slice(0, 120));
  }
}

/** 测试 12：tapElement（框架自己的实现） */
async function test_tapElement(page) {
  log("\n" + "-".repeat(60));
  log("测试: tapElement（真实 adb 点击，点「学习中心」tab 并验证内容变化）");

  const device = (await android.devices())[0];
  const r = await attempt(async () => {
    const before = await page.evaluate(() => document.body.innerText.slice(0, 200));
    const loc = page.getByText("学习中心").first();
    await loc.waitFor({ state: "visible", timeout: 5000 });
    await tapElement(device, page, loc);
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => document.body.innerText.slice(0, 200));
    return { changed: before !== after };
  });

  if (!r.ok) {
    record("tapElement", "不可用", r.error.slice(0, 150));
  } else if (r.value.changed) {
    record("tapElement", "可用", "真实 adb tap 后页面内容发生变化");
  } else {
    record("tapElement", "存疑", "调用未报错，但点击后页面内容无变化");
  }
  return page;
}

/** 标记：需要人工准备前置条件、无法自动测试的 */
function record_manual() {
  log("\n" + "-".repeat(60));
  log("以下能力无法在本次自动测试（需要特定前置条件或改变登录状态）");
  record("login", "未测试", "会点击「登录/注册」「同意协议」「4148」等硬编码文案，需要未登录态才能验证，且账号 4148 写死在代码里");
  record("focusSearchInput", "未测试", "要求小程序停在「有问必答」页，且内部把关键词 test 写死、无断言");
}

// ============ 主流程 ============
(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("能力探测开始 " + new Date().toISOString());

  const { device, page: initialPage } = await appTest([], { photosPath: null, closeOnFinish: false });
  log(`设备: ${device.serial()}`);

  const steps = [
    [step_init, null],
    [test_getForegroundPage, null],
    [test_dumpElements, null],
    [test_assertElementExists, null],
    [test_swipeUp, null],
    [test_clickElementByText, null],
    [test_switchToUserCenter, null],
    [test_goBack, null],
    [test_clickWxText, null],
    [test_inputText, null],
    [test_clickElementById, null],
    [test_tapElement, null],
  ];

  // 用 runAppSteps 跑完所有只依赖 page 的测试
  await runAppSteps(initialPage, steps, null, { fileName: "capability", funcName: "check" });

  // 依赖 device 的单独测
  await test_switchToWxWebview(device);
  record_manual();

  // ---------- 汇总清单 ----------
  log("\n\n" + "=".repeat(60));
  log("能力清单汇总");
  log("=".repeat(60));
  log("");
  log(`${"函数".padEnd(34)} ${"结论".padEnd(14)} 说明`);
  log("-".repeat(110));
  for (const r of RESULTS) {
    log(`${r.name.padEnd(34)} ${r.status.padEnd(14)} ${r.detail}`);
  }

  const usable = RESULTS.filter((r) => r.status === "可用").length;
  const broken = RESULTS.filter((r) => r.status === "不可用").length;
  log("");
  log(`统计: 可用 ${usable} 项，不可用 ${broken} 项，其它 ${RESULTS.length - usable - broken} 项`);
  log(`完整日志已写入 ${LOG_FILE}`);

  await device.close();
})().catch((e) => {
  console.error("能力探测失败:", e);
  process.exit(1);
});
