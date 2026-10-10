/*
 * @cur_file: dump_page.js
 * @create_date: 2026/10/10
 *
 * 诊断脚本（不是测试用例，故意不叫 test_ 开头，pytest 不会收集它）
 *
 * 目的：查清两件事
 *   1. 「我的」这个文本到底存在于哪个 page 的 DOM 里、位于什么位置
 *   2. 真实 adb 点击它之后，页面到底有没有变化
 *
 * 为什么需要它：
 *   同步执行的 switchToUserCenter 报"成功"，但截图显示页面零变化。
 *   而 dumpElements 的输出里找不到底部 tab 栏的文字（有问必答/学习中心/我的）。
 *   需要拿到完整 DOM（写进文件，不截断）才能定位。
 *
 * 运行方式：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/dump_page.js
 *
 * 产出：
 *   report/diagnostic/page1.html     点击前：前端页面实时 DOM（完整）
 *   report/diagnostic/page1.clean.html  点击前：清理后的结构（含 class）
 *   report/diagnostic/page2.html     点击后：同 page1.html
 *   report/diagnostic/page2.clean.html  点击后：同 page1.clean.html
 *   report/diagnostic/run.log        全过程日志
 */

const fs = require("fs");
const path = require("path");
const { _android: android } = require("playwright");
const { appTest, runAppSteps } = require("../../common/app_common");
const { tapElement, getForegroundPage } = require("../../app_sub_function/suprecast_app/android");

// ---------- 输出目录 ----------
const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });

const LOG_FILE = path.join(OUT_DIR, "run.log");

/** 同时写日志文件和打印到控制台 */
function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

/** 保留 class 属性、按层级缩进的结构化视图（和 dumpElements 同一套逻辑，但返回字符串） */
async function cleanStructure(page, selector = "body") {
  return page.evaluate((sel) => {
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
}

/** 把一次 page 快照写进文件，并统计关键文本是否出现 */
async function savePageSnapshot(page, tag, label) {
  log(`\n----- ${label} -----`);

  // 1. 实时 DOM：反映当前真实状态（含运行时生成的内容）
  const liveHtml = await page.content();
  fs.writeFileSync(path.join(OUT_DIR, `${tag}.html`), liveHtml, "utf8");

  // 2. 结构化视图：便于人眼阅读
  const clean = await cleanStructure(page);
  fs.writeFileSync(path.join(OUT_DIR, `${tag}.clean.html`), clean, "utf8");

  log(`  URL        : ${page.url()}`);
  log(`  实时DOM大小: ${liveHtml.length} 字符 -> ${tag}.html`);
  log(`  结构视图行数: ${clean.split("\n").length} 行 -> ${tag}.clean.html`);

  // 3. 关键文本检测（用实时 DOM 检索，最可靠）
  const keywords = ["我的", "有问必答", "学习中心", "设计专区", "登录/注册", "压铸", "课程", "专栏"];
  log("  关键文本检测（基于实时 DOM）：");
  for (const kw of keywords) {
    const n = liveHtml.split(kw).length - 1;
    log(`    ${n > 0 ? "命中" : "未找到"}  "${kw}"  出现 ${n} 次`);
  }
  return liveHtml;
}

/** 找出含指定文本的 page，并返回 [page, locator] */
async function locateText(page, text) {
  for (const p of page.context().pages()) {
    try {
      const loc = p.getByText(text, { exact: false }).first();
      const count = await loc.count();
      if (count > 0) {
        return { page: p, locator: loc, url: p.url() };
      }
    } catch (e) {
      // 页面不可用，跳过
    }
  }
  return null;
}

// ---------- 诊断步骤（通过 runAppSteps 执行，复用框架的截图与计时能力）----------

/**
 * 步骤1：记录点击前的页面状态
 */
async function diagBefore(page) {
  log("\n========== 步骤1：点击前 ==========");

  const pages = page.context().pages();
  log(`context 中共有 ${pages.length} 个 page：`);
  for (let i = 0; i < pages.length; i++) {
    try {
      const cnt = await pages[i].locator("*").count();
      log(`  [${i}] 元素数=${String(cnt).padStart(5)}  url=${pages[i].url().slice(0, 90)}`);
    } catch (e) {
      log(`  [${i}] 读取失败: ${e.message}`);
    }
  }

  const fg = await getForegroundPage(page);
  log(`\n前台页面判定: url=${fg.url().slice(0, 90)}`);
  log(`传入的 page 与前台页是否同一个对象: ${fg === page}`);

  await savePageSnapshot(page, "page1", "点击前 - 传入的 page");
  return page;
}

/**
 * 步骤2：定位「我的」并打印它的真实坐标
 */
async function diagLocate(page) {
  log("\n========== 步骤2：定位「我的」==========");

  const found = await locateText(page, "我的");
  if (!found) {
    log("!! 任何 page 里都找不到文本「我的」，无法继续诊断");
    return page;
  }

  log(`「我的」存在于 page: ${found.url.slice(0, 90)}`);
  log(`这个 page 是否就是传入的 page: ${found.page === page}`);

  const box = await found.locator.boundingBox();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  log(`boundingBox : ${JSON.stringify(box)}`);
  log(`devicePixelRatio : ${dpr}`);
  if (box) {
    log(`将点击的物理坐标 : x=${Math.round((box.x + box.width / 2) * dpr)}, y=${Math.round((box.y + box.height / 2) * dpr)}`);
  }

  // 打印「我的」所在元素的 tag/class，以及它的父元素链，判断它在页面里的层级位置
  const info = await found.locator.evaluate((el) => {
    const chain = [];
    let cur = el;
    for (let i = 0; i < 5 && cur; i++) {
      chain.push(`${cur.tagName.toLowerCase()}${cur.className ? "." + String(cur.className).split(" ").join(".") : ""}`);
      cur = cur.parentElement;
    }
    return { outerStart: el.outerHTML.slice(0, 300), chain };
  });
  log(`元素 outerHTML(前300字符): ${info.outerStart}`);
  log(`父元素链(由内到外): ${info.chain.join("  <  ")}`);

  return page;
}

/**
 * 步骤3：真实点击「我的」，然后等 3 秒让页面切换完成
 */
async function diagTapAndWait(page) {
  log("\n========== 步骤3：真实点击「我的」==========");

  const device = (await android.devices())[0];
  const found = await locateText(page, "我的");
  if (!found) {
    log("!! 找不到「我的」，跳过点击");
    return page;
  }

  await tapElement(device, found.page, found.locator);
  log("已发出 adb tap，现在等 3 秒让页面切换...");
  await page.waitForTimeout(3000);
  return page;
}

/**
 * 步骤4：记录点击后的页面状态
 */
async function diagAfter(page) {
  log("\n========== 步骤4：点击后 ==========");
  await savePageSnapshot(page, "page2", "点击后 - 传入的 page");
  return page;
}

// ---------- 主流程 ----------
(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8"); // 清空旧日志
  log("诊断开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });
  log(`\n设备已连接: ${device.serial()}`);
  log(`小程序 page url: ${page.url()}`);

  await runAppSteps(page, [
    [diagBefore, null],
    [diagLocate, null],
    [diagTapAndWait, null],
    [diagAfter, null],
  ], null, { fileName: "diagnostic", funcName: "dump_page" });

  log("\n诊断结束，完整结果见 report/diagnostic/ 目录");
  await device.close();
})().catch((e) => {
  console.error("诊断脚本执行失败:", e);
  process.exit(1);
});
