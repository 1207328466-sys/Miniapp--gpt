/*
 * 诊断（不以 test_ 开头，pytest 不收集）：首页那张「教你玩转 仿真案例库」banner 是不是**轮播**的
 * —— 如果是，上次"首页没有含『案例库』的元素"就只是"那一刻没轮到它"。
 *
 * 依据：首页活动卡区是**自动轮播**的（实测见过同一位置依次出现「图文·官方」→「链接·官方」→「答题·官方」），
 * 所以要用"连续采样"而不是"看一眼"。
 *
 * 做法：① 停在首页，每 1.5 秒读一次页面文字，连读 10 次，看「案例库」出现过没有；
 *      ② 若一直没出现，向上滑一屏再连读 6 次（banner 可能在首屏之下）；
 *      ③ 一旦出现，点它，看落到哪一页。
 *
 * 只读：只采样 + 滑动 + （若出现）点这一处入口。
 * 运行：node test_case/diagnostic/probe_case_banner_rotation.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

const KEY = "案例库";

async function sampleRounds(page, label, rounds, gapMs) {
  for (let i = 1; i <= rounds; i++) {
    const fg = await base.foreground(page);
    const text = await base.pageText(fg);
    const hit = text.includes(KEY);
    console.log("[%s 第 %d/%d 次] 含「%s」：%s | 开头: %s", label, i, rounds, KEY, hit ? "有" : "无", JSON.stringify(text.slice(0, 70)));

    // 顺带记录活动卡/轮播的角标，佐证"它在轮播"
    const tag = await fg.evaluate(() => {
      const el = document.querySelector('[class*="qa-activity-flow-item__tag"]');
      return el ? String(el.innerText || "").replace(/\s+/g, " ").trim() : "";
    });
    if (tag) console.log("      轮播角标：%s", JSON.stringify(tag));

    if (hit) return true;
    await base.sleep(gapMs);
  }
  return false;
}

async function probe(page) {
  page = await qa.ensureOnHomeFeed(page);
  console.log("=== 首屏连续采样（每 1.5 秒一次）===");
  if (await sampleRounds(page, "首屏", 10, 1500)) {
    return await tapIt(page);
  }

  console.log("\n=== 首屏没有，向上滑一屏再采样 ===");
  const { swipeUp } = require("../../app_sub_function/suprecast_app/android");
  try {
    page = await swipeUp(page);
  } catch (e) {
    console.log("滑动失败：%s", e.message.split("\n")[0]);
  }
  if (await sampleRounds(page, "下滑一屏后", 6, 1500)) {
    return await tapIt(page);
  }

  console.log("\n结论：连续采样都没看到含「%s」的元素 —— 这张 banner 要么不在首页、要么已经下线", KEY);
  page = await qa.ensureOnHomeFeed(page);
  return page;
}

async function tapIt(page) {
  const fg = await base.foreground(page);
  const hit = await fg.evaluate((key) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const t = norm(el.innerText);
      if (t.includes(key) && t.length <= 30) return t;
    }
    return "";
  }, KEY);
  if (!hit) return page;

  console.log("\n点它：%s", JSON.stringify(hit));
  await base.tapText(await base.foreground(page), hit, "banner「" + hit + "」");
  await base.sleep(3000);
  const after = await base.foreground(page);
  const text = await base.pageText(after);
  console.log("[点之后] 元素=%d 文字开头: %s", await base.countOf(after, "*"), JSON.stringify(text.slice(0, 200)));
  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "按轮播节奏找案例库 banner" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
