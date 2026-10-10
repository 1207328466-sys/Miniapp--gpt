/*
 * @cur_file: diagnose_switch.js
 * @create_date: 2026/10/10
 *
 * 逐步截图诊断 switchToUserCenter 的失败原因。
 *
 * 核心怀疑：
 *   switchToUserCenter 内部一直操作传进来的 page 引用，不做前台页刷新；
 *   而 clickElementByText 成功过。差别可能在于：
 *     - switchToUserCenter 先 await page.waitForTimeout()
 *     - 然后 getByText("我的").first() 定位、tap、waitForFunction
 *   如果页面已经切换过（page 变成后台页），这些操作就会落在错误的页面上。
 *
 * 每一步都截图 + 打印关键数据，定位到底哪一步开始不对。
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/diagnose_switch.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  tapElement,
  getForegroundPage,
  clickElementByText,
  switchToUserCenter,
} = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic", "switch");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "switch.log");

let stepNo = 0;

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

async function textOf(p) {
  try {
    return (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim();
  } catch (e) {
    return `(读取失败: ${e.message.split("\n")[0]})`;
  }
}

async function shoot(device, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try {
    const buf = await device.shell("screencap -p");
    fs.writeFileSync(p, buf);
    const crypto = require("crypto");
    const hash = crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
    log(`    [截图] ${name}.png 指纹=${hash}`);
    return hash;
  } catch (e) {
    log(`    [截图失败] ${name}: ${e.message.split("\n")[0]}`);
    return "FAILED";
  }
}

/** 打印某个 page 的关键状态 */
async function status(page, label) {
  const t = await textOf(page);
  const isUC = t.includes("积分商城") || t.includes("编辑资料");
  const isHome = t.includes("压铸人的社区百科");
  const elements = await page.locator("*").count().catch(() => -1);
  log(`    [${label}] 元素数=${elements} 在用户中心=${isUC} 在首页=${isHome}`);
  log(`    [${label}] 文本前70: ${JSON.stringify(t.slice(0, 70))}`);
  return { isUC, isHome, elements, text: t };
}

async function isHomeAnywhere(device, page) {
  const fg = await getForegroundPage(page);
  const t = await textOf(fg);
  return t.includes("压铸人的社区百科");
}

async function adbTapTab(device, page, tabText) {
  const geo = await page.evaluate((want) => {
    let found = null;
    document.querySelectorAll('[class*="tab-item"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.width < 20) return;
      if ((el.innerText || "").replace(/\s+/g, " ").trim() === want) {
        found = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    });
    return found;
  }, tabText);
  if (!geo) return false;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await device.shell(`input tap ${Math.round((geo.x + geo.w / 2) * dpr)} ${Math.round((geo.y + geo.h / 2) * dpr)}`);
  await page.waitForTimeout(4000);
  return true;
}

async function resetToHome(device, page) {
  for (let i = 0; i < 3; i++) {
    if (await isHomeAnywhere(device, page)) return true;
    await adbTapTab(device, page, "有问必答");
    await page.waitForTimeout(2000);
  }
  return await isHomeAnywhere(device, page);
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("switchToUserCenter 逐步诊断开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });

  // ================================================================
  log("\n" + "#".repeat(74));
  log("# 阶段 0：复位到首页，记录基线");
  log("#".repeat(74));
  await resetToHome(device, page);

  const fg0 = await getForegroundPage(page);
  log(`  appTest 返回的 page 是否就是前台页: ${fg0 === page}`);
  await status(page, "基线 page");
  await shoot(device, "0-baseline");

  // ================================================================
  log("\n" + "#".repeat(74));
  log("# 阶段 1：手动逐步执行 switchToUserCenter 的内部逻辑");
  log("#".repeat(74));

  log("\n  步骤 1.1：await page.waitForTimeout(1500)");
  await page.waitForTimeout(1500);
  await status(page, "等待后");

  log("\n  步骤 1.2：page.getByText('我的').first() 定位");
  let locatorInfo = null;
  try {
    const loc = page.getByText("我的").first();
    const box = await loc.boundingBox();
    const count = await page.getByText("我的").count();
    const outer = await loc.evaluate((el) => el.outerHTML.slice(0, 120));
    locatorInfo = { box, count, outer };
    log(`    getByText('我的') 匹配到 ${count} 个元素`);
    log(`    first() 的 boundingBox: ${JSON.stringify(box)}`);
    log(`    first() 的 outerHTML: ${outer}`);
  } catch (e) {
    log(`    定位失败: ${e.message.split("\n")[0]}`);
  }

  const hashBeforeTap = await shoot(device, "1-before-tap");

  log("\n  步骤 1.3：tapElement 点击「我的」");
  try {
    const loc = page.getByText("我的").first();
    const r = await tapElement(device, page, loc);
    log(`    tap 完成: 坐标(${r.x}, ${r.y}) 目标=${r.target}`);
  } catch (e) {
    log(`    tap 失败: ${e.message.split("\n")[0]}`);
  }

  log("\n  步骤 1.4：等 3 秒后看状态");
  await page.waitForTimeout(3000);
  const hashAfterTap = await shoot(device, "2-after-tap");
  const st1 = await status(page, "tap 后 page");
  const fg1 = await getForegroundPage(page);
  log(`    tap 后 appTest 的 page 是否仍是前台页: ${fg1 === page}`);
  if (fg1 !== page) {
    log(`    !! page 已变成后台页，前台页是另一个对象，其状态：`);
    await status(fg1, "tap 后前台页");
  }
  log(`    画面指纹: ${hashBeforeTap} → ${hashAfterTap}  ${hashBeforeTap !== hashAfterTap ? "(画面变了)" : "(画面没变)"}`);

  // ================================================================
  log("\n" + "#".repeat(74));
  log("# 阶段 2：对照 —— 用 clickElementByText（已知能成功）");
  log("#".repeat(74));
  await resetToHome(device, page);
  log(`  复位后是否首页: ${await isHomeAnywhere(device, page)}`);
  const hashC0 = await shoot(device, "3-before-clickElementByText");

  log("\n  调用 clickElementByText(page, { text: '我的' })");
  try {
    await clickElementByText(page, { text: "我的" });
    log("    调用未抛错");
  } catch (e) {
    log(`    抛错: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(4000);
  const hashC1 = await shoot(device, "4-after-clickElementByText");
  const fgC = await getForegroundPage(page);
  log(`    前台页是否还是 appTest 的 page: ${fgC === page}`);
  const stC = await status(fgC, "clickElementByText 后前台页");
  log(`    画面指纹: ${hashC0} → ${hashC1}  ${hashC0 !== hashC1 ? "(画面变了)" : "(画面没变)"}`);

  // ================================================================
  log("\n" + "#".repeat(74));
  log("# 阶段 3：再调一次 switchToUserCenter，看完整日志");
  log("#".repeat(74));
  await resetToHome(device, page);
  log(`  复位后是否首页: ${await isHomeAnywhere(device, page)}`);
  const hashS0 = await shoot(device, "5-before-switchToUserCenter");

  try {
    await switchToUserCenter(page);
    log("  switchToUserCenter 调用成功");
  } catch (e) {
    log(`  switchToUserCenter 抛错: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(2000);
  const hashS1 = await shoot(device, "6-after-switchToUserCenter");
  const fgS = await getForegroundPage(page);
  const stS = await status(fgS, "switchToUserCenter 后前台页");
  log(`  画面指纹: ${hashS0} → ${hashS1}  ${hashS0 !== hashS1 ? "(画面变了)" : "(画面没变)"}`);

  // ================================================================
  log("\n" + "#".repeat(74));
  log("# 结论汇总");
  log("#".repeat(74));
  log(`  手动逐步执行（tap 后）: 进用户中心=${st1.isUC}`);
  log(`  clickElementByText: 进用户中心=${stC.isUC}`);
  log(`  switchToUserCenter: 进用户中心=${stS.isUC}`);
  log("");
  log("  对比这三条路径，哪一步开始出现差异，问题就出在那里。");
  log(`  截图目录: ${OUT_DIR}`);

  await device.close();
})().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
