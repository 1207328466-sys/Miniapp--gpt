/*
 * @cur_file: diagnose_failures.js
 * @create_date: 2026/10/10
 *
 * 隔离诊断三个疑点：
 *   1. switchToUserCenter 单独调用是否成功？（排除前序测试的状态干扰）
 *      以及它的 waitForFunction 判据到底看到了什么
 *   2. swipeUp 真的没滚动吗？（换更可靠的判据：整页截图 + 所有容器 scrollTop）
 *   3. findClickableAncestor 对零宽 span 的判定与最终点击坐标是否合理
 *
 * 每项都独立复位，并用 adb screencap 留证。
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/diagnose_failures.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  tapElement,
  switchToUserCenter,
  swipeUp,
  getForegroundPage,
} = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic", "diagnose");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "diagnose.log");

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
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
    const hash = crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
    log(`    [截图] ${name}.png 指纹=${hash}`);
    return hash;
  } catch (e) {
    log(`    [截图失败] ${name}: ${e.message.split("\n")[0]}`);
    return "FAILED";
  }
}

/** 采集所有可滚动容器的 scrollTop，用于判断是否真的滚动了 */
async function scrollSnapshot(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollHeight - el.clientHeight <= 20) return;
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return;
      out.push({
        cls: String(el.className || "").slice(0, 40),
        scrollTop: Math.round(el.scrollTop),
        tag: el.tagName.toLowerCase(),
      });
    });
    return out;
  });
}

async function isHome(page) {
  return (await textOf(await getForegroundPage(page))).includes("压铸人的社区百科");
}
async function isUserCenter(page) {
  const t = await textOf(await getForegroundPage(page));
  return t.includes("积分商城") || t.includes("编辑资料");
}

/** 用 adb tap 底部 tab 复位 */
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
  log("隔离诊断开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });

  // ================================================================
  log("\n" + "#".repeat(72));
  log("# 疑点 1：switchToUserCenter 单独调用");
  log("#".repeat(72));

  await resetToHome(device, page);
  log(`复位后是否在首页: ${await isHome(page)}`);
  const tBefore = await textOf(await getForegroundPage(page));
  log(`调用前文本: ${JSON.stringify(tBefore.slice(0, 70))}`);
  await shoot(device, "1a-before-switchToUserCenter");

  log("\n调用 switchToUserCenter(page)...");
  const t0 = Date.now();
  try {
    await switchToUserCenter(page);
    log(`  调用成功，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    log(`  调用抛错（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）: ${e.message.split("\n")[0]}`);
  }

  await shoot(device, "1b-after-switchToUserCenter");
  const tAfter = await textOf(await getForegroundPage(page));
  log(`\n调用后文本: ${JSON.stringify(tAfter.slice(0, 90))}`);
  log(`是否在用户中心: ${await isUserCenter(page)}`);

  // 直接检查 waitForFunction 用的那三个判据分别是什么结果
  const marks = await page.evaluate(() => {
    const fgText = document.body.innerText || "";
    return {
      页面数: document.querySelectorAll("*").length,
      含积分商城: fgText.includes("积分商城"),
      含登录注册: fgText.includes("登录/注册"),
      含编辑资料: fgText.includes("编辑资料"),
      innerText长度: fgText.length,
      innerText前80: fgText.replace(/\s+/g, " ").slice(0, 80),
    };
  });
  log(`\n判据检测（在 appTest 返回的 page 上）:`);
  Object.entries(marks).forEach(([k, v]) => log(`  ${k}: ${JSON.stringify(v)}`));

  // 同时检查前台页
  const fg = await getForegroundPage(page);
  const fgMarks = await fg.evaluate(() => {
    const t = document.body.innerText || "";
    return { 含积分商城: t.includes("积分商城"), 含登录注册: t.includes("登录/注册"), 前80: t.replace(/\s+/g, " ").slice(0, 80) };
  });
  log(`\n判据检测（在 getForegroundPage 返回的页面上）:`);
  Object.entries(fgMarks).forEach(([k, v]) => log(`  ${k}: ${JSON.stringify(v)}`));
  log(`  page 与前台页是同一对象: ${fg === page}`);

  // ================================================================
  log("\n" + "#".repeat(72));
  log("# 疑点 2：swipeUp 是否真的没滚动");
  log("#".repeat(72));

  await resetToHome(device, page);
  log(`复位后是否在首页: ${await isHome(page)}`);

  const before = await scrollSnapshot(page);
  log(`\n滑动前 ${before.length} 个可滚动容器:`);
  before.forEach((s, i) => log(`  [${i}] ${s.tag}.${s.cls}  scrollTop=${s.scrollTop}`));
  const hashBefore = await shoot(device, "2a-before-swipe");

  log("\n调用 swipeUp(page, { duration: 500 })...");
  try {
    await swipeUp(page, { duration: 500 });
    log("  调用完成");
  } catch (e) {
    log(`  抛错: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(2000);

  const after = await scrollSnapshot(page);
  log(`\n滑动后 ${after.length} 个可滚动容器:`);
  after.forEach((s, i) => log(`  [${i}] ${s.tag}.${s.cls}  scrollTop=${s.scrollTop}`));
  const hashAfter = await shoot(device, "2b-after-swipe");

  log(`\nscrollTop 对比:`);
  let scrolled = false;
  const maxLen = Math.max(before.length, after.length);
  for (let i = 0; i < maxLen; i++) {
    const b = before[i] ? before[i].scrollTop : "?";
    const a = after[i] ? after[i].scrollTop : "?";
    const cls = (after[i] || before[i] || {}).cls || "?";
    if (b !== a) scrolled = true;
    log(`  [${i}] ${String(cls).slice(0, 35).padEnd(37)} ${String(b).padStart(6)} → ${String(a).padStart(6)}  ${b !== a ? "变了" : ""}`);
  }
  log(`\n  画面指纹: ${hashBefore} → ${hashAfter}  ${hashBefore !== hashAfter ? "(变了)" : "(没变)"}`);
  log(`  是否仍在首页: ${await isHome(page)}`);
  log(`  >>> swipeUp 结论: ${scrolled ? "确实触发了滚动" : "未触发任何滚动"}`);

  // ================================================================
  log("\n" + "#".repeat(72));
  log("# 疑点 3：findClickableAncestor 对零宽 span 的判定");
  log("#".repeat(72));

  await resetToHome(device, page);
  const geo = await page.evaluate(() => {
    let span = null;
    let item = null;
    document.querySelectorAll('[class*="tab-item"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.width < 20) return;
      if ((el.innerText || "").replace(/\s+/g, " ").trim() === "我的") {
        item = { x: r.x, y: r.y, w: r.width, h: r.height, area: r.width * r.height };
        const sp = el.querySelector("span");
        if (sp) {
          const sr = sp.getBoundingClientRect();
          span = { x: sr.x, y: sr.y, w: sr.width, h: sr.height, area: sr.width * sr.height };
        }
      }
    });
    return { span, item };
  });
  log(`\n「我的」的文字 span : ${JSON.stringify(geo.span)}`);
  log(`「我的」的 tab-item : ${JSON.stringify(geo.item)}`);

  const srcLocator = page.getByText("我的").first();
  const srcBox = await srcLocator.boundingBox();
  log(`getByText('我的').first().boundingBox() = ${JSON.stringify(srcBox)}`);

  const r = await tapElement(device, page, srcLocator);
  log(`\ntapElement 实际点击: (${r.x}, ${r.y})`);
  log(`  目标=${r.target}  层级=${r.level}`);
  log(`  原因=${r.reason}`);

  if (geo.item) {
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const itemCenter = { x: Math.round((geo.item.x + geo.item.w / 2) * dpr), y: Math.round((geo.item.y + geo.item.h / 2) * dpr) };
    log(`\n  对照：tab-item 容器中心的物理坐标 = (${itemCenter.x}, ${itemCenter.y})`);
    log(`  实际点击与容器中心的偏差 = (${r.x - itemCenter.x}, ${r.y - itemCenter.y})`);
    log(`  实际点击是否落在容器范围内: ${r.x >= geo.item.x * dpr && r.x <= (geo.item.x + geo.item.w) * dpr ? "是" : "否"}`);
  }

  log("\n诊断结束，日志: " + LOG_FILE);
  await device.close();
})().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
