/*
 * @cur_file: probe_scroll.js
 * @create_date: 2026/10/10
 *
 * 探测首页的滚动容器结构：
 *   - 哪些元素真的可以滚动（scrollHeight > clientHeight）
 *   - 它们的位置和尺寸
 *   - swipeUp 到底让哪个容器滚动了
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/probe_scroll.js
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const { swipeUp } = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "scroll.log");

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

/** 采集页面上所有可滚动容器的状态 */
async function collectScrollables(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      // 垂直可滚动：内容高度超过可视高度
      const scrollableY = el.scrollHeight - el.clientHeight > 20;
      const scrollableX = el.scrollWidth - el.clientWidth > 20;
      if (!scrollableY && !scrollableX) return;
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return; // 忽略太小的（滚动条等）
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 55),
        top: Math.round(r.top),
        left: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        scrollTop: Math.round(el.scrollTop),
        canScrollY: scrollableY,
        canScrollX: scrollableX,
      });
    });
    return out;
  });
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("滚动结构探测开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });
  log(`页面元素数: ${await page.locator("*").count()}`);
  log(`页面可见文本开头: ${JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 80))}`);

  log("\n" + "=".repeat(78));
  log("滑动前：页面上所有可滚动容器");
  log("=".repeat(78));
  const before = await collectScrollables(page);
  log(`共找到 ${before.length} 个可滚动容器\n`);
  before.forEach((s, i) => {
    log(`[${i}] <${s.tag}> class="${s.cls}"`);
    log(`     位置 top=${s.top} left=${s.left}  尺寸 ${s.w}x${s.h}`);
    log(`     垂直: 内容${s.scrollH} / 可视${s.clientH}  scrollTop=${s.scrollTop}  可滚动=${s.canScrollY}`);
    log(`     横向可滚动=${s.canScrollX}`);
    log("");
  });

  // 记录所有可滚动容器的 scrollTop，滑动后对比
  const beforeTop = before.map((s) => s.scrollTop);

  log("=".repeat(78));
  log("执行 swipeUp(page, { duration: 800 })");
  log("=".repeat(78));
  await swipeUp(page, { duration: 800 });
  await page.waitForTimeout(2000);

  const after = await collectScrollables(page);
  log(`\n滑动后仍有 ${after.length} 个可滚动容器\n`);

  log("=".repeat(78));
  log("scrollTop 变化对比（判断到底有没有滚动）");
  log("=".repeat(78));
  log("");
  log(`${"#".padEnd(4)} ${"class".padEnd(45)} ${"滑动前".padEnd(10)} ${"滑动后".padEnd(10)} 结论`);
  log("-".repeat(95));

  let anyScrolled = false;
  after.forEach((s, i) => {
    const prev = beforeTop[i] !== undefined ? beforeTop[i] : "?";
    const changed = typeof prev === "number" && prev !== s.scrollTop;
    if (changed) anyScrolled = true;
    log(
      `${String(i).padEnd(4)} ${s.cls.slice(0, 43).padEnd(45)} ${String(prev).padEnd(10)} ${String(s.scrollTop).padEnd(10)} ${
        changed ? `滚动了 ${s.scrollTop - prev}px` : "未变化"
      }`
    );
  });

  log("");
  log(anyScrolled ? ">>> swipeUp 确实触发了滚动（合成鼠标事件对滚动是有效的）" : ">>> swipeUp 没有触发任何容器的滚动 → 合成鼠标事件对小程序滚动无效");

  // 额外验证：用 adb input swipe 对比
  log("\n" + "=".repeat(78));
  log("对照实验：用 adb input swipe 滑动，看是否有效");
  log("=".repeat(78));

  const before2 = (await collectScrollables(page)).map((s) => s.scrollTop);
  // 屏幕物理尺寸
  const size = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    w: document.documentElement.clientWidth,
    h: document.documentElement.clientHeight,
  }));
  const x = Math.round((size.w / 2) * size.dpr);
  const y1 = Math.round(size.h * 0.75 * size.dpr);
  const y2 = Math.round(size.h * 0.25 * size.dpr);
  log(`adb input swipe ${x} ${y1} ${x} ${y2} 500`);
  await device.shell(`input swipe ${x} ${y1} ${x} ${y2} 500`);
  await page.waitForTimeout(2000);

  const after2 = await collectScrollables(page);
  log("");
  log(`${"#".padEnd(4)} ${"class".padEnd(45)} ${"之前".padEnd(10)} ${"之后".padEnd(10)} 结论`);
  log("-".repeat(95));
  let anyScrolled2 = false;
  after2.forEach((s, i) => {
    const prev = before2[i] !== undefined ? before2[i] : "?";
    const changed = typeof prev === "number" && prev !== s.scrollTop;
    if (changed) anyScrolled2 = true;
    log(
      `${String(i).padEnd(4)} ${s.cls.slice(0, 43).padEnd(45)} ${String(prev).padEnd(10)} ${String(s.scrollTop).padEnd(10)} ${
        changed ? `滚动了 ${s.scrollTop - prev}px` : "未变化"
      }`
    );
  });
  log("");
  log(anyScrolled2 ? ">>> adb input swipe 有效" : ">>> adb input swipe 也无效（可能滑动坐标落点不对）");

  log("\n对比结论：");
  log(`  page.mouse 合成滑动: ${anyScrolled ? "有效" : "无效"}`);
  log(`  adb input swipe    : ${anyScrolled2 ? "有效" : "无效"}`);

  log("\n探测结束，日志: " + LOG_FILE);
  await device.close();
})().catch((e) => {
  console.error("探测失败:", e);
  process.exit(1);
});
