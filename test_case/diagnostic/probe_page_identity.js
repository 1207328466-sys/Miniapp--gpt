/*
 * @cur_file: probe_page_identity.js
 * @create_date: 2026/10/10
 *
 * 关键探测：4 个并存 page 中，到底哪个是屏幕上真正显示的？
 *
 * 用三重判据交叉验证，避免再被单一判据误导：
 *   判据A requestAnimationFrame 是否活跃（框架现有方案）
 *   判据B 元素数量最多（switchToWxWebview 用的方案）
 *   判据C 同时截图 + 抓各 page 的可见文本，人工比对哪个和截图一致
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/probe_page_identity.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "page_identity.log");

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("page 身份探测开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });

  // 整屏截图：这是"屏幕上到底显示什么"的唯一权威依据
  const shot = path.join(OUT_DIR, "page_identity_screen.png");
  await page.screenshot({ path: shot });
  log(`\n已截图: ${shot}`);

  log("\n" + "=".repeat(70));
  log("逐个分析 context 里的每个 page");
  log("=".repeat(70));

  const pages = page.context().pages();
  log(`context 中共有 ${pages.length} 个 page\n`);

  const rows = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    log(`----- page[${i}] -----`);
    log(`  url: ${p.url()}`);

    // 判据A：RAF 是否活跃
    let raf = null;
    try {
      raf = await p.evaluate(
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
        800
      );
    } catch (e) {
      log(`  RAF 探测失败: ${e.message.split("\n")[0]}`);
    }

    // 判据B：元素数量
    let count = -1;
    try {
      count = await p.locator("*").count();
    } catch (e) {
      log(`  元素计数失败: ${e.message.split("\n")[0]}`);
    }

    // 判据C：可见文本（拿来做人工比对）
    let text = "";
    try {
      text = await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
    } catch (e) {
      text = `(读取失败: ${e.message.split("\n")[0]})`;
    }

    log(`  RAF 活跃(判据A): ${raf}`);
    log(`  元素数(判据B)  : ${count}`);
    log(`  可见文本(判据C): ${JSON.stringify(text.slice(0, 150))}`);
    log(`  是否我们手上这个 page: ${p === page}`);

    // 关键标记词：用于和截图比对
    const marks = {};
    ["有问必答", "学习中心", "设计专区", "我的", "压铸百科", "课程", "积分商城", "登录/注册"].forEach((k) => {
      marks[k] = text.includes(k);
    });
    log(`  标记词: ${JSON.stringify(marks)}`);
    log("");

    rows.push({ index: i, url: p.url(), raf, count, text: text.slice(0, 100), isOurs: p === page });
  }

  // ---------- 汇总 ----------
  log("=".repeat(70));
  log("汇总对比");
  log("=".repeat(70));
  log("");
  log(`${"#".padEnd(3)} ${"RAF".padEnd(7)} ${"元素数".padEnd(8)} ${"是手上这个".padEnd(12)} 可见文本开头`);
  log("-".repeat(100));
  rows.forEach((r) => {
    log(`${String(r.index).padEnd(3)} ${String(r.raf).padEnd(7)} ${String(r.count).padEnd(8)} ${String(r.isOurs).padEnd(12)} ${r.text.slice(0, 45)}`);
  });

  // 判据冲突检测
  log("\n" + "=".repeat(70));
  log("判据冲突分析");
  log("=".repeat(70));

  const rafAlive = rows.filter((r) => r.raf === true);
  log(`\nRAF 活跃的 page 有 ${rafAlive.length} 个: [${rafAlive.map((r) => r.index).join(", ")}]`);
  if (rafAlive.length > 1) {
    log(">>> 有多个 page 同时 RAF 活跃 → 框架的 getForegroundPage 用这个判据会选错！");
  }

  const maxCount = Math.max(...rows.filter((r) => r.count >= 0).map((r) => r.count));
  const maxRows = rows.filter((r) => r.count === maxCount);
  log(`\n元素最多的 page 是 [${maxRows.map((r) => r.index).join(", ")}]，元素数 ${maxCount}`);
  log(`我们手上的 page 是 [${rows.filter((r) => r.isOurs).map((r) => r.index).join(", ")}]`);

  const ourRow = rows.find((r) => r.isOurs);
  if (ourRow && ourRow.count === maxCount) {
    log(">>> 手上这个 page 就是元素最多的，判据B 与之一致");
  } else {
    log(`>>> 手上这个 page 元素数 ${ourRow ? ourRow.count : "?"}，不是最多的 → appTest 返回的可能不是主内容页`);
  }

  log("\n>>> 请打开 " + shot + " 与上面的『可见文本』比对，确认哪个 page 才是屏幕上显示的");

  await device.close();
})().catch((e) => {
  console.error("探测失败:", e);
  process.exit(1);
});
