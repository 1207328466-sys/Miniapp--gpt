/*
 * @cur_file: probe_tap.js
 * @create_date: 2026/10/10
 *
 * 验证 tapElement 的修复：从"点文字 span"改为"点可点击祖先容器"
 *
 * 背景（已由实验确认）：
 *   首页底部 tab 栏的文字 span 宽度实测为 0：
 *     [4] "我的"  tab-item 盒子 x=278 y=673 w=69 h=61   ← 容器正常
 *                 文字 span 盒子 x=323 y=686 w=0  h=22   ← 宽度为 0
 *   按 span 中心算出的坐标会偏，点不中真正的响应区域。
 *   实测：tap tab-item 中心 (1094, 2462) 成功切换到用户中心；
 *         tap span 中心 (1131, 2440) 无效果。
 *
 * 本脚本用 adb 原生截屏（screencap）判断画面变化，不用 page.screenshot()：
 * 实测后者在小程序 webview 上会反复超时（框架注释也承认这一点）。
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/probe_tap.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const { tapElement, getForegroundPage } = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic", "tap");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "tap.log");

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

/** adb 原生截屏，返回指纹用于判断画面是否变化 */
async function shoot(device, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try {
    const buf = await device.shell("screencap -p");
    fs.writeFileSync(p, buf);
    const crypto = require("crypto");
    const hash = crypto.createHash("md5").update(buf).digest("hex").slice(0, 12);
    log(`  截图 ${name}.png  大小=${buf.length}  指纹=${hash}  (adb screencap)`);
    return { path: p, size: buf.length, hash };
  } catch (e) {
    log(`  截图 ${name}.png 失败: ${e.message.split("\n")[0]}`);
    return { path: p, size: -1, hash: `FAILED:${e.message.slice(0, 40)}` };
  }
}

/** 读取某个 page 的可见文本 */
async function textOf(p) {
  try {
    return (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim();
  } catch (e) {
    return `(读取失败 ${e.message.split("\n")[0]})`;
  }
}

/** 取「我的」这个 tab 的可点击容器和文字 span，用于对比 */
async function tabGeometry(page) {
  return page.evaluate(() => {
    const tabs = [];
    document.querySelectorAll('[class*="tab-item"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.width < 20) return;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      const span = el.querySelector("span");
      const sr = span ? span.getBoundingClientRect() : null;
      tabs.push({
        text: text.slice(0, 10),
        item: { x: r.x, y: r.y, w: r.width, h: r.height },
        span: sr ? { x: sr.x, y: sr.y, w: sr.width, h: sr.height } : null,
      });
    });
    return tabs;
  });
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("tap 验证开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });

  log("\n" + "=".repeat(70));
  log("步骤 1：初始状态");
  log("=".repeat(70));

  const fg0 = await getForegroundPage(page);
  const t0 = await textOf(fg0);
  const s0 = await shoot(device, "1-initial");
  log(`前台页: ${fg0.url()}`);
  log(`可见文本: ${JSON.stringify(t0.slice(0, 90))}`);
  const onUserCenter0 = t0.includes("积分商城") || t0.includes("编辑资料");
  log(`当前是否已在用户中心: ${onUserCenter0}`);

  // 若已经在用户中心，先切回首页，否则测不出切换效果
  if (onUserCenter0) {
    log("\n当前已在用户中心，先点「有问必答」切回首页再测...");
    const tabsBack = await tabGeometry(page);
    const homeTab = tabsBack.find((t) => t.text === "有问必答");
    if (homeTab) {
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      const hx = Math.round((homeTab.item.x + homeTab.item.w / 2) * dpr);
      const hy = Math.round((homeTab.item.y + homeTab.item.h / 2) * dpr);
      log(`  adb shell input tap ${hx} ${hy}  (有问必答 tab 容器中心)`);
      await device.shell(`input tap ${hx} ${hy}`);
      await page.waitForTimeout(4000);
      const tBack = await textOf(await getForegroundPage(page));
      log(`  切回后文本: ${JSON.stringify(tBack.slice(0, 80))}`);
    } else {
      log("  找不到「有问必答」tab，跳过");
    }
  }

  log("\n" + "=".repeat(70));
  log("步骤 2：采集「我的」tab 的几何信息");
  log("=".repeat(70));

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const cssW = await page.evaluate(() => document.documentElement.clientWidth);
  log(`CSS 视口宽 ${cssW}   dpr=${dpr}`);

  const tabs = await tabGeometry(page);
  const myTab = tabs.find((t) => t.text === "我的");
  if (!myTab) {
    log("!! 找不到「我的」tab，终止");
    await device.close();
    return;
  }

  log(`\n「我的」tab：`);
  log(`  容器 tab-item : x=${myTab.item.x.toFixed(1)} y=${myTab.item.y.toFixed(1)} w=${myTab.item.w.toFixed(1)} h=${myTab.item.h.toFixed(1)}`);
  log(`  容器中心物理坐标: (${Math.round((myTab.item.x + myTab.item.w / 2) * dpr)}, ${Math.round((myTab.item.y + myTab.item.h / 2) * dpr)})`);
  if (myTab.span) {
    log(`  文字 span     : x=${myTab.span.x.toFixed(1)} y=${myTab.span.y.toFixed(1)} w=${myTab.span.w.toFixed(1)} h=${myTab.span.h.toFixed(1)}`);
    log(`  span 中心物理坐标: (${Math.round((myTab.span.x + myTab.span.w / 2) * dpr)}, ${Math.round((myTab.span.y + myTab.span.h / 2) * dpr)})`);
    if (myTab.span.w === 0) {
      log(`  !! 注意：span 宽度为 0，按它算中心坐标不可靠`);
    }
  }

  log("\n" + "=".repeat(70));
  log("步骤 3：用框架的 tapElement 点击「我的」（验证修复是否生效）");
  log("=".repeat(70));

  const tBefore = await textOf(await getForegroundPage(page));
  log(`点击前文本: ${JSON.stringify(tBefore.slice(0, 90))}`);

  // tapElement 现在会自己向上找可点击祖先容器
  const locator = page.getByText("我的").first();
  await tapElement(device, page, locator);
  log("已调用 tapElement(device, page, getByText('我的').first())");

  await page.waitForTimeout(4000);

  const s1 = await shoot(device, "2-after-tapElement");
  const fg1 = await getForegroundPage(page);
  const tAfter = await textOf(fg1);
  log(`\n点击后前台页: ${fg1.url()}`);
  log(`点击后文本: ${JSON.stringify(tAfter.slice(0, 90))}`);

  const switched = tAfter.includes("积分商城") || tAfter.includes("编辑资料");
  log(`\n画面指纹是否变化: ${s0.hash !== s1.hash ? "变了" : "没变"}`);
  log(`文本是否变化: ${tBefore !== tAfter}`);
  log(`是否进入用户中心: ${switched}`);

  log("\n" + "=".repeat(70));
  log("结论");
  log("=".repeat(70));
  if (switched) {
    log(">>> tapElement 修复生效：能正确点击 tab 并完成切换");
  } else {
    log(">>> tapElement 仍未生效，需要继续排查");
    log("    可对照：直接 adb tap tab-item 容器中心是否有效");
  }
  log(`截图目录: ${OUT_DIR}`);

  await device.close();
})().catch((e) => {
  console.error("验证失败:", e);
  process.exit(1);
});
