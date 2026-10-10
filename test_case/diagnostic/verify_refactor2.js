/*
 * @cur_file: verify_refactor2.js
 * @create_date: 2026/10/10
 *
 * 验证两处新修复：
 *   1. switchToUserCenter 幂等性（已在用户中心时直接返回）
 *      以及"连续切换"场景下的可靠性（上一轮 verify_refactor 就是死在这里）
 *   2. swipeUp 的滚动校验（现在会主动判断是否真的滚动了，不再假通过）
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/verify_refactor2.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  switchToUserCenter,
  clickWxText,
  swipeUp,
  getForegroundPage,
} = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic", "refactor2");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "refactor2.log");
const RESULTS = [];

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

function record(name, ok, detail) {
  RESULTS.push({ name, ok, detail });
  log(`${ok ? "[PASS]" : "[FAIL]"} ${name} — ${detail}`);
}

async function attempt(fn) {
  try {
    const t0 = Date.now();
    const value = await fn();
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.message.split("\n")[0] };
  }
}

async function textOf(p) {
  try {
    return (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim();
  } catch (e) {
    return "";
  }
}

async function shoot(device, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try {
    const buf = await device.shell("screencap -p");
    fs.writeFileSync(p, buf);
    const crypto = require("crypto");
    return crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
  } catch (e) {
    return "FAILED";
  }
}

async function isHome(page) {
  return (await textOf(await getForegroundPage(page))).includes("压铸人的社区百科");
}
async function isUserCenter(page) {
  const t = await textOf(await getForegroundPage(page));
  return t.includes("积分商城") || t.includes("编辑资料");
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
    if (await isHome(page)) return true;
    await adbTapTab(device, page, "有问必答");
    await page.waitForTimeout(2000);
  }
  return await isHome(page);
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("第二轮验证开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });
  await resetToHome(device, page);
  log(`起点在首页: ${await isHome(page)}`);

  // ============================================================
  log("\n" + "=".repeat(70));
  log("测试 1：switchToUserCenter 从首页切换");
  log("=".repeat(70));
  const r1 = await attempt(() => switchToUserCenter(page));
  if (!r1.ok) {
    record("switchToUserCenter 从首页", false, r1.error);
  } else {
    const hit = await isUserCenter(page);
    record("switchToUserCenter 从首页", hit, `${hit ? "成功进入用户中心" : "内容不对"}，耗时 ${r1.ms}ms`);
  }

  // ============================================================
  log("\n" + "=".repeat(70));
  log("测试 2：幂等性 —— 已在用户中心时再调一次");
  log("=".repeat(70));
  const r2 = await attempt(() => switchToUserCenter(page));
  if (!r2.ok) {
    record("switchToUserCenter 幂等", false, r2.error);
  } else {
    const hit = await isUserCenter(page);
    record("switchToUserCenter 幂等", hit, `${hit ? "正确识别已在用户中心并直接返回" : "内容不对"}，耗时 ${r2.ms}ms`);
  }

  // ============================================================
  log("\n" + "=".repeat(70));
  log("测试 3：连续切换（复现上一轮 verify_refactor 的失败场景）");
  log("=".repeat(70));
  log("流程：用户中心 → clickWxText 切回首页 → 立即 switchToUserCenter");
  const r3a = await attempt(() => clickWxText(page, { text: "有问必答" }));
  await page.waitForTimeout(3000);
  log(`  切回首页: ${r3a.ok ? "调用成功" : "抛错 " + r3a.error}，当前是否首页=${await isHome(page)}`);

  const r3b = await attempt(() => switchToUserCenter(page));
  if (!r3b.ok) {
    record("连续切换可靠性", false, `连续切换失败: ${r3b.error}`);
  } else {
    const hit = await isUserCenter(page);
    record("连续切换可靠性", hit, `${hit ? "连续切换成功（重试机制或幂等生效）" : "内容不对"}，耗时 ${r3b.ms}ms`);
  }

  // ============================================================
  log("\n" + "=".repeat(70));
  log("测试 4：swipeUp 的滚动校验");
  log("=".repeat(70));
  await resetToHome(device, page);
  log(`起点在首页: ${await isHome(page)}`);
  const hashBefore = await shoot(device, "4a-before-swipe");

  const r4 = await attempt(() => swipeUp(page, { duration: 500 }));
  const hashAfter = await shoot(device, "4b-after-swipe");

  if (r4.ok) {
    record("swipeUp 滚动校验", true, `检测到页面位移，耗时 ${r4.ms}ms（画面指纹 ${hashBefore}→${hashAfter}）`);
  } else {
    record(
      "swipeUp 滚动校验",
      false,
      `${r4.error}（画面指纹 ${hashBefore}→${hashAfter}${hashBefore !== hashAfter ? "，注意画面其实变了" : ""}）`
    );
  }

  // ============================================================
  log("\n" + "=".repeat(70));
  log("汇总");
  log("=".repeat(70));
  log("");
  RESULTS.forEach((r) => log(`${(r.ok ? "PASS" : "FAIL").padEnd(6)} ${r.name.padEnd(28)} ${r.detail}`));
  const pass = RESULTS.filter((r) => r.ok).length;
  log(`\n通过 ${pass} / ${RESULTS.length} 项`);
  log(`截图与日志: ${OUT_DIR}`);

  await device.close();
})().catch((e) => {
  console.error("验证失败:", e);
  process.exit(1);
});
