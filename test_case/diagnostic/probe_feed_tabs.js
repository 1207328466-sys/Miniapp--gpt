/*
 * 诊断脚本（故意不以 test_ 开头，pytest 不会收集）
 *
 * 用途：查清**首页那排筛选 tab（最新提问 / 推荐 / 精选问答 / 我的关注）
 * 到底怎么表示「我是当前选中的那个」**。
 *
 * 为什么要查：
 *   owner 反馈「回到首页之后，筛选 tab 停在上一次的『我的关注』，不是『最新提问』」。
 *   想把「回到首页」加强成"停在信息流 + 归位到最新提问"，就必须能**验证**归位成功 ——
 *   而"哪个 tab 是选中的"目前没有可靠判据：学习中心那排顶部 tab 用的是 class active，
 *   首页这排是不是同一套，**没实测过**。
 *   本项目的铁律：不凭猜测写断言 —— 所以先抓证据。
 *
 * 只读：不点卡片、不改任何数据；只切一下筛选 tab（和「检查活动入口」那条用例一样的操作）。
 *
 * 怎么用：
 *   1. 手机上把小程序停在**首页信息流**，并确认当前选中的是「我的关注」（或别的、只要不是最新提问）
 *   2. 运行：node test_case/diagnostic/probe_feed_tabs.js
 *   3. 看输出最后那段「两次之间变化的字段」—— 变化的那一项就是"选中态"的表达方式
 *
 * 产出：控制台输出（同时写进 report/diagnostic/feed_tabs.log）
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const FEED_TABS = pages.qaPage.FEED_TABS;
const TARGET_TAB = "最新提问"; // 这次要切过去、用来做对照的那个 tab

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "feed_tabs.log");

/** 同时写日志文件和打印到控制台 */
function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

// 可能用来表达"选中"的几个维度：类名 / 颜色 / 字重 / 字号 / 下边框 / 子元素类名 / 原始 HTML
const FIELDS = ["cls", "color", "fontWeight", "fontSize", "borderBottom", "childCls", "outer"];

/** 读出 4 个筛选 tab 的可观察属性（只读） */
async function readTabs(page, names) {
  const fg = await base.foreground(page);
  return fg.evaluate((tabs) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const all = Array.from(document.querySelectorAll("*"));
    return tabs.map((t) => {
      const hits = all.filter((el) => norm(el.innerText) === t);
      if (!hits.length) return { tab: t, found: false };
      const el = hits[hits.length - 1]; // 取最内层那个（容器会把多个 tab 的文本连在一起，不会被 exact 匹配命中）
      const cs = getComputedStyle(el);
      return {
        tab: t,
        found: true,
        matches: hits.length,
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") || ""),
        color: cs.color,
        fontWeight: cs.fontWeight,
        fontSize: cs.fontSize,
        borderBottom: cs.borderBottomWidth + " " + cs.borderBottomColor,
        childCls: Array.from(el.children)
          .map((c) => String(c.getAttribute("class") || ""))
          .join(" | "),
        outer: el.outerHTML.slice(0, 200),
      };
    });
  }, names);
}

let before = null;

function printTabs(label, rows) {
  log("\n===== " + label + " =====");
  for (const r of rows) {
    if (!r.found) {
      log("  [" + r.tab + "] 找不到这个 tab（当前页可能不在首页信息流上）");
      continue;
    }
    log("  [" + r.tab + "] 命中 " + r.matches + " 个元素");
    for (const f of FIELDS) {
      log("      " + f + ": " + r[f]);
    }
  }
}

function printDiff() {
  log("\n===== 两次之间变化的字段（这就是「选中态」的表达方式）=====");
  let changed = 0;
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    if (!a.found || !b.found) continue;
    for (const f of FIELDS) {
      if (String(a[f]) !== String(b[f])) {
        changed += 1;
        log("  [" + a.tab + "] " + f + "：");
        log("      之前: " + a[f]);
        log("      之后: " + b[f]);
      }
    }
  }
  if (!changed) {
    log("  没有任何字段变化 —— 两种可能：① 本来就已经选中「" + TARGET_TAB + "」；");
    log("  ② 这个 tab 的选中态根本不在 DOM 属性/样式里（那就要换别的办法验证）。");
  }
}

let after = null;

/** --read 模式：只打印当前状态，不点任何东西（用页面对象里那个判据，顺便验证它） */
async function printCurrent(page) {
  const info = await pages.qaPage.readFeedTabs(page);
  log("\n===== 当前状态（只读，没点任何东西）=====");
  if (!info.found) {
    log("  找不到首页的 tab 栏 —— 手机现在多半不在首页信息流上");
    return page;
  }
  for (const r of info.tabs) {
    log(
      r.found
        ? "  " + r.tab + "：alpha=" + r.alpha + "，weight=" + r.weight + (r.selected ? "   <- 选中" : "")
        : "  " + r.tab + "：找不到这个标签"
    );
  }
  log("当前选中的筛选 tab：" + JSON.stringify(info.selected || "（认不出来）"));
  return page;
}

async function snapBefore(page) {
  before = await readTabs(page, FEED_TABS);
  printTabs("第一次：现在的样子", before);
  return base.foreground(page);
}

async function tapTargetTab(page) {
  const fg = await base.foreground(page);
  await base.tapText(fg, TARGET_TAB, "筛选 tab「" + TARGET_TAB + "」");
  await base.sleep(2500);
  return base.foreground(page);
}

async function snapAfter(page) {
  after = await readTabs(page, FEED_TABS);
  printTabs("第二次：点了「" + TARGET_TAB + "」之后", after);
  printDiff();
  return base.foreground(page);
}

(async () => {
  // --read：只读模式 —— 只打印"现在选中的是哪个 tab"，不点任何东西。
  // 验收「回到首页」有没有把 tab 归位时用这个，最省事。
  const readOnly = process.argv.includes("--read");

  const funcList = readOnly
    ? [[printCurrent, null]]
    : [
        [snapBefore, null], // 打印现在的样子
        [tapTargetTab, null], // 点一下「最新提问」
        [snapAfter, null], // 再打印 + 列出变化的字段
      ];

  await appTest(funcList, {
    meta: {
      feature: "诊断",
      story: "首页筛选 tab",
      title: readOnly ? "只读：打印当前选中的筛选 tab" : "打印筛选 tab 的选中态线索",
    },
  });
  log(
    readOnly
      ? "\n想校准判据（看选中态长什么样）就去掉 --read 再跑一次"
      : "\n把上面整段输出贴回给 AI 即可（日志也写在 report/diagnostic/feed_tabs.log）"
  );
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
