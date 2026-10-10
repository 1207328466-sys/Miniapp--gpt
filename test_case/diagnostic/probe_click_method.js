/*
 * @cur_file: probe_click_method.js
 * @create_date: 2026/10/10
 *
 * 对照实验：合成点击 vs 真实 adb tap，到底哪个能用、在什么场景能用。
 *
 * 为什么需要这个实验：
 *   tapElement 已验证可用（真实 adb 事件）。但框架里其它点击函数用的是
 *   Playwright 的 .click()（合成事件）。之前 .click() 多次超时失败，
 *   但那些失败可能混杂了"元素隐藏""页面选错"等干扰因素。
 *   现在基础修好了，用干净的对照实验重新确认。
 *
 * 实验设计（每个场景都独立复位，避免状态干扰）：
 *   场景1：底部 tab 栏文字 span      → .click() vs tapElement
 *   场景2：普通可见文本元素          → .click() vs tapElement
 *
 * 用 adb screencap 指纹 + 可见文本双重判据。
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/probe_click_method.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const { tapElement, getForegroundPage } = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic", "click");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "click.log");

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

async function shoot(device, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try {
    const buf = await device.shell("screencap -p");
    fs.writeFileSync(p, buf);
    const crypto = require("crypto");
    const hash = crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
    log(`  [截图] ${name}.png 指纹=${hash}`);
    return { path: p, hash };
  } catch (e) {
    log(`  [截图失败] ${name}.png: ${e.message.split("\n")[0]}`);
    return { path: p, hash: "FAILED" };
  }
}

async function textOf(p) {
  try {
    return (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim();
  } catch (e) {
    return "";
  }
}

/** 判断当前是否在用户中心 */
async function isUserCenter(page) {
  const t = await textOf(await getForegroundPage(page));
  return t.includes("积分商城") || t.includes("编辑资料");
}

/** 判断当前是否在首页 */
async function isHome(page) {
  const t = await textOf(await getForegroundPage(page));
  return t.includes("压铸人的社区百科") || t.includes("最新提问");
}

/** 用 adb tap 底部 tab 栏的指定文字，用于复位到首页/用户中心 */
async function adbTapTab(device, page, tabText) {
  const geo = await page.evaluate((want) => {
    let found = null;
    document.querySelectorAll('[class*="tab-item"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.width < 20) return;
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t === want) found = { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    return found;
  }, tabText);

  if (!geo) return false;
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const px = Math.round((geo.x + geo.w / 2) * dpr);
  const py = Math.round((geo.y + geo.h / 2) * dpr);
  await device.shell(`input tap ${px} ${py}`);
  await page.waitForTimeout(4000);
  return true;
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("点击方式对照实验开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });

  // 统一从首页开始
  if (await isUserCenter(page)) {
    log("初始在用户中心，先切回首页");
    await adbTapTab(device, page, "有问必答");
  }
  log(`初始是否在首页: ${await isHome(page)}`);

  // ============================================================
  log("\n" + "=".repeat(72));
  log("场景 1：底部 tab 栏文字 span —— 合成 .click() 能否切换页面？");
  log("=".repeat(72));

  // 先确保在首页
  if (!(await isHome(page))) {
    log("不在首页，用 adb tap 复位");
    await adbTapTab(device, page, "有问必答");
  }

  const t1Before = await textOf(await getForegroundPage(page));
  const s1Before = await shoot(device, "s1-before-click");
  log(`点击前是否在首页: ${await isHome(page)}`);

  // 找「我的」span 并尝试合成点击
  const myTextBtn = page.getByText("我的").first();
  log("\n尝试: page.getByText('我的').first().click({ timeout: 8000 })");

  let clickErr = null;
  try {
    await myTextBtn.click({ timeout: 8000 });
    log("  .click() 未抛异常");
  } catch (e) {
    clickErr = e.message.split("\n")[0];
    log(`  .click() 抛错: ${clickErr}`);
  }
  await page.waitForTimeout(4000);

  const s1After = await shoot(device, "s1-after-click");
  const t1After = await textOf(await getForegroundPage(page));
  const switched1 = await isUserCenter(page);
  log(`\n  画面指纹变化: ${s1Before.hash !== s1After.hash}`);
  log(`  文本变化: ${t1Before !== t1After}`);
  log(`  是否进入用户中心: ${switched1}`);
  const syntheticClickWorks = switched1;

  log(`\n  >>> 场景1 结论：合成 .click() ${syntheticClickWorks ? "有效" : "无效"}`);

  // ============================================================
  log("\n" + "=".repeat(72));
  log("场景 1 对照：同样目标，改用 tapElement（真实 adb），先切回首页");
  log("=".repeat(72));

  if (syntheticClickWorks) {
    log("  合成点击已生效，先切回首页再做对照");
    await adbTapTab(device, page, "有问必答");
  }
  log(`  当前是否在首页: ${await isHome(page)}`);

  const t1bBefore = await textOf(await getForegroundPage(page));
  const s1bBefore = await shoot(device, "s1b-before-tap");

  try {
    await tapElement(device, page, page.getByText("我的").first());
    log("  tapElement 调用完成");
  } catch (e) {
    log(`  tapElement 抛错: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(4000);

  const s1bAfter = await shoot(device, "s1b-after-tap");
  const t1bAfter = await textOf(await getForegroundPage(page));
  const switched1b = await isUserCenter(page);
  log(`\n  画面指纹变化: ${s1bBefore.hash !== s1bAfter.hash}`);
  log(`  文本变化: ${t1bBefore !== t1bAfter}`);
  log(`  是否进入用户中心: ${switched1b}`);
  log(`\n  >>> 场景1对照 结论：tapElement（真实 adb）${switched1b ? "有效" : "无效"}`);

  // ============================================================
  log("\n" + "=".repeat(72));
  log("场景 2：顶部筛选栏「推荐」—— 合成 .click() 能否切换筛选？");
  log("=".repeat(72));

  // 确保在首页
  if (!(await isHome(page))) {
    log("切回首页");
    await adbTapTab(device, page, "有问必答");
  }

  const t2Before = await textOf(await getForegroundPage(page));
  const s2Before = await shoot(device, "s2-before-click");

  let clickErr2 = null;
  try {
    await page.getByText("推荐", { exact: true }).first().click({ timeout: 8000 });
    log("  .click('推荐') 未抛异常");
  } catch (e) {
    clickErr2 = e.message.split("\n")[0];
    log(`  .click('推荐') 抛错: ${clickErr2}`);
  }
  await page.waitForTimeout(3500);

  const s2After = await shoot(device, "s2-after-click");
  const t2After = await textOf(await getForegroundPage(page));
  log(`\n  画面指纹变化: ${s2Before.hash !== s2After.hash}`);
  log(`  文本变化: ${t2Before !== t2After}`);
  log(`  文本前后对比:`);
  log(`    前: ${JSON.stringify(t2Before.slice(0, 110))}`);
  log(`    后: ${JSON.stringify(t2After.slice(0, 110))}`);
  log(`\n  >>> 场景2 结论：合成 .click() 对顶部筛选栏 ${s2Before.hash !== s2After.hash ? "有效" : "无效"}`);

  // ============================================================
  log("\n" + "=".repeat(72));
  log("汇总");
  log("=".repeat(72));
  log(`场景1（tab 栏文字）  合成 .click() : ${syntheticClickWorks ? "有效" : "无效"}`);
  log(`场景1（tab 栏文字）  真实 tapElement: ${switched1b ? "有效" : "无效"}`);
  log(`场景2（顶部筛选栏）  合成 .click() : ${s2Before.hash !== s2After.hash ? "有效" : "无效"}`);
  log(`截图目录: ${OUT_DIR}`);

  await device.close();
})().catch((e) => {
  console.error("实验失败:", e);
  process.exit(1);
});
