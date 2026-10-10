/*
 * 诊断脚本（故意不以 test_ 开头，pytest 不会收集）
 *
 * 用途：**校准"前台页判据"** —— 对比逐页 RAF 信号与设备截图真值。
 *
 * 什么时候跑它：
 *   - 换设备 / 换小程序之后
 *   - 怀疑"取到的页面不对"（定位一直超时、断言判错页）
 *   - 有人提出"RAF 判据不可靠"这类结论时（这类结论很贵，必须有证据）
 *
 * 背景：另一份工作副本（原仓库）的交接文档 §5.2 断言
 *   "requestAnimationFrame 判据不可靠：两个页面可同时活跃
 *    （首页 418 元素 + 活动详情页 118 元素）"，因此主张"截图才是唯一权威"。
 * 这个探针就是用来验证它的。2026/10/10 实测结果（16 轮采样、2 个页面状态）：
 *   **稳定态下每轮都恰好只有 1 个 page RAF 活跃，且与截图一致。**
 *   （切换过程中的瞬时双活跃确实存在，resolveForegroundPage 用"多候选二次探测"处理。）
 * 详见 docs/框架能力与问题账本.md 第十八节。
 *
 * 做法：导航到首页，然后**连续采样 8 轮**，每轮记录每个 page 的
 * RAF 活跃性、元素数、文本前缀；最后抓一张设备截图当真值人工比对。
 *
 * 运行：node test_case/diagnostic/probe_raf.js
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");

const base = pages.base;
const SEL_ACTIVITY_CARD = "[class*=qa-activity-flow-item--card]";

/** 与 app_common 内部同款的 RAF 探针 */
const RAF = (ms) =>
  new Promise((resolve) => {
    let done = false;
    requestAnimationFrame(() => {
      done = true;
      resolve(true);
    });
    setTimeout(() => {
      if (!done) resolve(false);
    }, ms);
  });

async function probeAllPages(page) {
  const rows = [];
  for (const p of page.context().pages()) {
    try {
      const raf = await p.evaluate(RAF, 500);
      const cnt = await p.locator("*").count().catch(() => -1);
      const text = String(await p.evaluate(() => String(document.body.innerText || ""))).slice(0, 26);
      rows.push({ raf, cnt, text });
    } catch (e) {
      rows.push({ raf: "ERR", cnt: -1, text: String(e.message).slice(0, 28) });
    }
  }
  return rows;
}

async function experiment(page) {
  page = await base.foreground(page);
  console.log(`起点: 元素数=${await page.locator("*").count()}`);

  // 1) 确保在首页（判据：有搜索栏）
  if ((await base.countOf(page, ".search-container")) === 0) {
    page = await base.ensureOnTabPage(page);
    await base.tapText(page, "有问必答", "底部 tab「有问必答」");
    await base.sleep(3000);
    page = await base.foreground(page);
  }
  console.log(`首页: 元素数=${await page.locator("*").count()} 活动卡=${await base.countOf(page, SEL_ACTIVITY_CARD)}`);

  // 2) 点第一张活动卡，进入活动详情页
  //    交接文档说答题活动的卡片角标是「答题·官方」，所以按文本挑，别盲点第一张
  const cards = page.locator(SEL_ACTIVITY_CARD);
  const cardCount = await cards.count().catch(() => 0);
  console.log(`活动卡数量=${cardCount}`);
  let targetIndex = -1;
  for (let i = 0; i < cardCount; i++) {
    const t = (await cards.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    console.log(`  卡片[${i}] 文本=${JSON.stringify(t.slice(0, 40))}`);
    if (t.includes("答题") && targetIndex < 0) targetIndex = i;
  }
  console.log(`准备点击的卡片下标=${targetIndex}`);
  if (targetIndex >= 0) {
    const device0 = await getDevice();
    await require("../../app_sub_function/suprecast_app/android").tapElement(
      device0,
      page,
      cards.nth(targetIndex)
    );
    await base.sleep(5000);
  }
  page = await base.foreground(page);
  console.log(`进入后: 元素数=${await page.locator("*").count()}`);
  console.log(`  文本前 60 字: ${JSON.stringify((await base.pageText(page)).slice(0, 60))}`);
  console.log(`  是否答题页(.activity-quiz-page)=${await base.countOf(page, ".activity-quiz-page")}`);

  // 3) 连续采样：看是否长期有两个 page 同时 RAF 活跃
  for (let round = 1; round <= 8; round++) {
    const rows = await probeAllPages(page);
    const alive = rows.filter((r) => r.raf === true).length;
    console.log(`---- 采样 ${round}：RAF 活跃页数 = ${alive} ----`);
    rows.forEach((r, i) => {
      console.log(`  [${i}] raf=${String(r.raf)} 元素=${r.cnt} 文本=${JSON.stringify(r.text)}`);
    });
    await base.sleep(1000);
  }

  // 4) 抓一张设备截图当"真值"
  const device = await getDevice();
  const local = path.join(__dirname, "..", "..", "report", "diagnostic", "raf_truth.png");
  const buf = await device.shell("screencap -p");
  require("fs").mkdirSync(path.dirname(local), { recursive: true });
  require("fs").writeFileSync(local, buf);
  console.log(`已保存设备截图（真值）: ${local}`);

  return page;
}

(async () => {
  await appTest([[experiment, null]], { photosPath: null, closeOnFinish: false });
  setTimeout(() => process.exit(0), 300);
})().catch((e) => {
  console.log("探测失败: " + e.message);
  setTimeout(() => process.exit(1), 300);
});
