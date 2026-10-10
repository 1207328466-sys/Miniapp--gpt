/*
 * @cur_file: probe_selector.js
 * @create_date: 2026/10/10
 *
 * 针对性探测：验证几个"修法假设"是否成立
 *   1. id 选择器为什么失效？属性选择器 [id="..."] 能否替代？
 *   2. getByText("我的") 严格模式冲突怎么解决？
 *   3. adb tap 到底能不能触发 tab 切换？点 tab 文字 vs 点父级容器
 *
 * 运行：
 *   cd C:\Users\admin\Desktop\miniapp_test_case
 *   node test_case/probe_selector.js
 */

const fs = require("fs");
const path = require("path");
const { _android: android } = require("playwright");
const { appTest } = require("../../common/app_common");
const { tapElement, getForegroundPage } = require("../../app_sub_function/suprecast_app/android");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = path.join(OUT_DIR, "probe.log");

function log(msg) {
  const line = typeof msg === "string" ? msg : String(msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
}

async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e.message.split("\n")[0] };
  }
}

(async () => {
  fs.writeFileSync(LOG_FILE, "", "utf8");
  log("探测开始 " + new Date().toISOString());

  const { device, page } = await appTest([], { photosPath: null, closeOnFinish: false });
  log(`设备 ${device.serial()}，页面元素数 ${await page.locator("*").count()}`);

  // ============ 探测 1：id 选择器的各种写法 ============
  log("\n" + "=".repeat(60));
  log("探测 1：怎么才能按 id 定位到小程序元素");
  log("=".repeat(60));

  const sampleId = await page.evaluate(() => {
    const el = document.querySelector("[id]");
    return el ? el.id : null;
  });
  log(`样本 id: ${JSON.stringify(sampleId)}`);

  const selectors = [
    ["#id（CSS 井号写法，当前框架用法）", `#${sampleId}`],
    ["[id=\"...\"]（属性选择器）", `[id="${sampleId}"]`],
    ["css=[id=\"...\"]（显式指定 css 引擎）", `css=[id="${sampleId}"]`],
  ];
  for (const [name, sel] of selectors) {
    const r = await attempt(() => page.locator(sel).count());
    log(`  ${r.ok ? "[OK]  " : "[FAIL]"} ${name}`);
    log(`         选择器: ${sel}`);
    log(`         ${r.ok ? `匹配到 ${r.value} 个元素` : `报错: ${r.error}`}`);
  }

  // ============ 探测 2：id 里到底有什么字符 ============
  log("\n" + "=".repeat(60));
  log("探测 2：小程序 id 的字符构成规律");
  log("=".repeat(60));

  const idStats = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
    const total = ids.length;
    const startsWithDigit = ids.filter((i) => /^[0-9]/.test(i)).length;
    const hasDoubleDash = ids.filter((i) => i.includes("--")).length;
    const pureValid = ids.filter((i) => /^[A-Za-z_][\w-]*$/.test(i)).length;
    return { total, startsWithDigit, hasDoubleDash, pureValid, samples: ids.slice(0, 6) };
  });
  log(`  带 id 元素总数        : ${idStats.total}`);
  log(`  以数字开头            : ${idStats.startsWithDigit}  ← 这些在 CSS 里必须转义才能用 # 语法`);
  log(`  含连续双横线 '--'      : ${idStats.hasDoubleDash}`);
  log(`  符合 CSS id 命名规范  : ${idStats.pureValid}  ← 几乎全都不合规`);
  log(`  样本: ${idStats.samples.join(", ")}`);

  // ============ 探测 3：getByText 严格模式冲突怎么解 ============
  log("\n" + "=".repeat(60));
  log("探测 3：getByText('我的') 的匹配范围与解法");
  log("=".repeat(60));

  const variants = [
    ["getByText('我的')", () => page.getByText("我的")],
    ["getByText('我的', {exact:true})", () => page.getByText("我的", { exact: true })],
    ["getByText('我的').first()", () => page.getByText("我的").first()],
    ["getByText('我的', {exact:true}).first()", () => page.getByText("我的", { exact: true }).first()],
  ];
  for (const [name, make] of variants) {
    const r = await attempt(() => make().count());
    log(`  ${name}  →  匹配 ${r.ok ? r.value + " 个" : "报错: " + r.error}`);
  }

  // 打印每个匹配项的上下文，看清「我的」到底匹配了什么
  const matched = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("span, wx-text, wx-view").forEach((el) => {
      const t = (el.innerText || "").trim();
      if (t === "我的" || t === "我的关注") {
        const rect = el.getBoundingClientRect();
        out.push({ text: t, tag: el.tagName.toLowerCase(), y: Math.round(rect.top), parentClass: el.parentElement ? el.parentElement.className : "" });
      }
    });
    return out;
  });
  log(`  页面上文本正好是「我的」或「我的关注」的元素：`);
  matched.forEach((m) => log(`    "${m.text}"  <${m.tag}>  y=${m.y}  父class=${String(m.parentClass).slice(0, 60)}`));

  // ============ 探测 4：adb tap 能否触发 tab 切换 ============
  log("\n" + "=".repeat(60));
  log("探测 4：真实 adb tap 点 tab 文字，能否切换页面");
  log("=".repeat(60));

  // 用属性选择器精确定位底部 tab 栏里的「我的」（父级 class 含 tab-item）
  const tabLocator = page.locator('[class*="tab-item"] span', { hasText: "我的" }).first();
  log(`用的定位器: [class*="tab-item"] span  (hasText=我的)`);

  const tabBox = await attempt(async () => {
    const b = await tabLocator.boundingBox();
    return b;
  });
  log(`  tab 文字 boundingBox: ${JSON.stringify(tabBox.value || tabBox.error)}`);

  // 顺便把父级 tab-item 的盒子也取出来，看两者差多少
  const parentBox = await attempt(async () => {
    return page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll("span"));
      const target = spans.find((s) => (s.innerText || "").trim() === "我的");
      if (!target) return null;
      let cur = target;
      for (let i = 0; i < 4 && cur; i++) {
        if (String(cur.className || "").includes("tab-item")) {
          const r = cur.getBoundingClientRect();
          return { tag: cur.tagName.toLowerCase(), x: r.x, y: r.y, w: r.width, h: r.height };
        }
        cur = cur.parentElement;
      }
      return null;
    });
  });
  log(`  父级 tab-item 盒子: ${JSON.stringify(parentBox.value || parentBox.error)}`);

  const beforeText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  const beforeHasUC = await page.evaluate(() => document.body.innerText.includes("积分商城"));
  log(`  点击前: 有「积分商城」=${beforeHasUC}`);

  if (tabBox.ok && tabBox.value) {
    const r = await attempt(() => tapElement(device, page, tabLocator));
    log(`  真实 tap 结果: ${r.ok ? "已发出" : "失败 " + r.error}`);
  } else {
    log("  取不到 tab 文字坐标，跳过点击");
  }

  await page.waitForTimeout(4000);
  const afterHasUC = await page.evaluate(() => document.body.innerText.includes("积分商城"));
  const afterText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  log(`  点击后: 有「积分商城」=${afterHasUC}`);
  log(`  页面文本是否变化: ${beforeText !== afterText}`);
  log(`  点击后文本开头: ${JSON.stringify(afterText.slice(0, 100))}`);

  log("\n" + (afterHasUC ? ">>> adb tap 可以触发 tab 切换" : ">>> adb tap 未能触发 tab 切换，需要换策略"));

  log("\n探测结束，日志: " + LOG_FILE);
  await device.close();
})().catch((e) => {
  console.error("探测失败:", e);
  process.exit(1);
});
