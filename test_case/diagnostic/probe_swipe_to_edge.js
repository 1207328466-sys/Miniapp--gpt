/*
 * 诊断（不以 test_ 开头，pytest 不收集）：验证「滑动」= **一直滑到不动**（滑到底/滑到顶）。
 *
 * owner 2026/10/14 定稿：滑动不再让人填"每次滑多少 / 滑几次"，它自己滑到页面不再移动为止；
 * 参数2 只在"想限制最多滑几次"时才填（安全上限）。这里在真机上量三件事（只读，不点卡片）：
 *   ① 案例库列表（长列表）：`上`（默认上限 10）-> 到底要滑几次？到底之后还动不动？
 *   ② 上限被用满时（max=1）：应如实报"还能继续滚"（reached=false），而不是假装到底；
 *   ③ `下`：应一路滚回顶部并停住（scrollTop 回到 0）。
 *
 * 运行：node test_case/diagnostic/probe_swipe_to_edge.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const { swipeToEdge, swipeUpEx } = require("../../app_sub_function/suprecast_app/android");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

async function scrollTop(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(() => {
    let best = 0;
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop > best) best = el.scrollTop;
    });
    return Math.round(best);
  });
}

async function probe(page) {
  page = await caseLibrary.ensureOn(page); // 案例库列表：内容长、可滚动
  const start = await scrollTop(page);
  console.log("\n起点 scrollTop = " + start);

  // ① 滑到底（默认上限 10）
  const r1 = await swipeToEdge(page, { dir: "上", max: 10 });
  page = r1.page;
  const mid = await scrollTop(page);
  const probe = await swipeUpEx(page, { startRatio: 0.75, endRatio: 0.25 }); // 到底之后再滑一次
  const stillMoves = probe.moved;
  console.log(
    "① 上（上限 10）：滑了 " + r1.swipes + " 次，reached=" + r1.reached +
      "，scrollTop " + start + " -> " + mid +
      "；到底之后再滑一次还动不动 = " + stillMoves
  );

  // ② 上限被用满：从中间位置只给 1 次机会
  const r2 = await swipeToEdge(page, { dir: "下", max: 1 }); // 先往下 1 次（回到中间）
  page = r2.page;
  const r3 = await swipeToEdge(page, { dir: "上", max: 1 });
  page = r3.page;
  console.log(
    "② 上（上限 1）：滑了 " + r3.swipes + " 次，reached=" + r3.reached +
      "（false = 如实报「还能继续滚」，没假装到底），scrollTop = " + (await scrollTop(page))
  );

  // ③ 滑回顶部
  const r4 = await swipeToEdge(page, { dir: "下", max: 20 });
  page = r4.page;
  const end = await scrollTop(page);
  console.log("③ 下（上限 20）：滑了 " + r4.swipes + " 次，reached=" + r4.reached + "，scrollTop = " + end);

  const problems = [];
  if (r1.reached && stillMoves) problems.push("报到底了，可再滑一次还在动（到底判定不可信）");
  if (!r1.reached) problems.push("案例库列表这么长都到不了底？（上限 10 不够用，或页面上有无限加载）");
  if (r3.reached) problems.push("上限=1 却报 reached（只有一滑不该认为到到底）");
  if (end > 5) problems.push("向下滑回顶部后 scrollTop 还是 " + end + "（没回到顶部）");

  console.log("\n[结论] " + (problems.length ? "❌ " + problems.join("；") : "✅ 滑到底/到顶的行为符合预期"));
  if (problems.length) throw new Error(problems.join("；"));
  return page;
}

appTest([[probe, null]], { photosPath: null }).catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
