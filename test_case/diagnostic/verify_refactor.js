/*
 * @cur_file: verify_refactor.js
 * @create_date: 2026/10/10
 *
 * 验证本轮重构：所有点击/滑动函数改用真实 adb 事件后的实际效果。
 *
 * 每个测试独立复位（用 adb tap 切回首页），避免状态互相干扰。
 * 判据：可见文本变化 + adb screencap 画面指纹。
 *
 * 测试项：
 *   A. clickElementByText("我的")   → 应进入用户中心
 *   B. clickWxText("有问必答")      → 应回到首页
 *   C. switchToUserCenter()         → 应进入用户中心（含内部等待验证）
 *   D. swipeUp()                    → wx-scroll-view 的 scrollTop 应变化
 *   E. tapElement 返回值            → 应报告实际点击目标和向上层级
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/verify_refactor.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  tapElement,
  clickElementByText,
  clickWxText,
  switchToUserCenter,
  swipeUp,
  getForegroundPage,
} = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic", "refactor");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "refactor.log");

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
    return { ok: true, value: await fn() };
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

/** 用 adb tap 底部 tab 的文字容器，用于复位 */
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

async function isHome(page) {
  return (await textOf(await getForegroundPage(page))).includes("压铸人的社区百科");
}
async function isUserCenter(page) {
  const t = await textOf(await getForegroundPage(page));
  return t.includes("积分商城") || t.includes("编辑资料");
}

/** 回到首页（后续测试的统一起点） */
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
  log("重构验证开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });
  await resetToHome(device, page);
  log(`起点是否在首页: ${await isHome(page)}`);

  // ---------- A. clickElementByText ----------
  log("\n" + "=".repeat(70));
  log("A. clickElementByText({ text: '我的' }) —— 合成点击改真实 tap");
  log("=".repeat(70));
  await resetToHome(device, page);
  const rA = await attempt(() => clickElementByText(page, { text: "我的" }));
  await page.waitForTimeout(4000);
  if (!rA.ok) {
    record("clickElementByText", false, `抛错: ${rA.error}`);
  } else {
    const hit = await isUserCenter(page);
    record("clickElementByText", hit, hit ? "成功进入用户中心" : "未抛错但没进入用户中心");
  }

  // ---------- B. clickWxText ----------
  log("\n" + "=".repeat(70));
  log("B. clickWxText({ text: '有问必答' }) —— 切回首页");
  log("=".repeat(70));
  const rB = await attempt(() => clickWxText(page, { text: "有问必答" }));
  await page.waitForTimeout(4000);
  if (!rB.ok) {
    record("clickWxText", false, `抛错: ${rB.error}`);
  } else {
    const hit = await isHome(page);
    record("clickWxText", hit, hit ? "成功切回首页" : "未抛错但没回到首页");
  }

  // ---------- C. switchToUserCenter ----------
  log("\n" + "=".repeat(70));
  log("C. switchToUserCenter() —— 含内部等待验证");
  log("=".repeat(70));
  await resetToHome(device, page);
  const rC = await attempt(() => switchToUserCenter(page));
  if (!rC.ok) {
    record("switchToUserCenter", false, `抛错: ${rC.error}`);
  } else {
    const hit = await isUserCenter(page);
    record("switchToUserCenter", hit, hit ? "成功进入用户中心（内部等待判据已满足）" : "未抛错但内容不对");
  }

  // ---------- D. swipeUp ----------
  log("\n" + "=".repeat(70));
  log("D. swipeUp() —— 合成滑动改 adb input swipe");
  log("=".repeat(70));
  await resetToHome(device, page);

  const scrollBefore = await page.evaluate(() => {
    const el = document.querySelector(".wx-scroll-view");
    return el ? Math.round(el.scrollTop) : null;
  });
  const hashBefore = await shoot(device, "d-before-swipe");

  const rD = await attempt(() => swipeUp(page, { duration: 500 }));
  await page.waitForTimeout(1500);

  const scrollAfter = await page.evaluate(() => {
    const el = document.querySelector(".wx-scroll-view");
    return el ? Math.round(el.scrollTop) : null;
  });
  const hashAfter = await shoot(device, "d-after-swipe");

  if (!rD.ok) {
    record("swipeUp", false, `抛错: ${rD.error}`);
  } else if (scrollBefore === null) {
    record("swipeUp", false, "找不到 .wx-scroll-view 容器，无法判断");
  } else {
    const moved = scrollAfter !== scrollBefore;
    record(
      "swipeUp",
      moved,
      moved
        ? `滚动生效：scrollTop ${scrollBefore} → ${scrollAfter}（变化 ${scrollAfter - scrollBefore}px）`
        : `未滚动：scrollTop 保持 ${scrollBefore}`
    );
    log(`    画面指纹: ${hashBefore} → ${hashAfter}  ${hashBefore !== hashAfter ? "(变了)" : "(没变)"}`);
  }

  // ---------- E. tapElement 返回值信息 ----------
  log("\n" + "=".repeat(70));
  log("E. tapElement 返回的点击目标信息");
  log("=".repeat(70));
  await resetToHome(device, page);
  const rE = await attempt(async () => {
    const locator = page.getByText("我的").first();
    return tapElement(device, page, locator);
  });
  if (rE.ok) {
    record(
      "tapElement 返回值",
      true,
      `坐标(${rE.value.x}, ${rE.value.y}) 目标=${rE.value.target} 层级=${rE.value.level} 原因=${rE.value.reason}`
    );
  } else {
    record("tapElement 返回值", false, rE.error);
  }

  // ---------- 汇总 ----------
  log("\n" + "=".repeat(70));
  log("汇总");
  log("=".repeat(70));
  log("");
  log(`${"测试项".padEnd(24)} ${"结果".padEnd(8)} 说明`);
  log("-".repeat(90));
  RESULTS.forEach((r) => log(`${r.name.padEnd(24)} ${(r.ok ? "PASS" : "FAIL").padEnd(8)} ${r.detail}`));

  const pass = RESULTS.filter((r) => r.ok).length;
  log("");
  log(`通过 ${pass} / ${RESULTS.length} 项`);
  log(`截图目录: ${OUT_DIR}`);

  await device.close();
})().catch((e) => {
  console.error("验证失败:", e);
  process.exit(1);
});
