/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**"现在屏幕上哪一页"这个解析到底花多久？**
 *
 * 【为什么问】owner 2026/10/16：「为什么变成要跑那么久」。现场数据：
 *   · 10/13 的历史日志里，单步「回到首页」3.66 秒；10/16 变成 12.5~30 秒；
 *   · 一次全量从 34 项 / 24:48 变成 43 项 / 预计 90 分钟。
 * 而 `resolveForegroundPage`（每次动作前都要解析一遍）在 10/15 为了修坑 46
 * （微信里多个页面**都在 60fps 出帧**，"还出不出帧"分不出前台页）加了两条更贵的东西：
 *   ① 候选 >1 但只有 1 个"在出帧"时，把落选的用 **1200ms** 超时再探一次；
 *   ② 多候选时用**输入归属**（发一次 ESC，看谁收到 keydown）来定。
 * 这份探针把"单次解析"和"回到首页一次要用几次"分别量出来 —— 先有数，再动手改。
 *
 * 只读：不点、不改数据。
 * 运行（手机停在首页信息流）：node test_case/diagnostic/probe_foreground_cost.js
 */

const { appTest, resolveForegroundPage } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

async function probe(page) {
  const ctx = page.context();
  const all = ctx.pages().filter((p) => !p.isClosed());
  console.log(`context 里活着的页面：${all.length} 个`);
  all.slice(0, 8).forEach((p) => {
    let u = "";
    try {
      u = p.url();
    } catch (e) {
      u = "(读不到)";
    }
    console.log(`   · ${u}`);
  });

  // ① 单次解析：连量 5 次（页面没变的情况下应当很快 —— 慢就说明每次都在等超时）
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    const fg = await resolveForegroundPage(page);
    times.push(ms(t0));
    if (i === 0) console.log(`  第 1 次解析到的前台页 url 尾段：${fg.url().split("/").slice(-2).join("/")}`);
  }
  console.log(`\n① resolveForegroundPage ×5：${times.join(" / ")} ms（平均 ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms）`);

  // ② 一次「回到首页」整体：它内部会解析好几次
  const t1 = process.hrtime.bigint();
  await qaPage.ensureOnHomeFeed(page);
  console.log(`② ensureOnHomeFeed 一次：${ms(t1)} ms`);

  // ③ 表格动作「回到首页」走的同一个入口，再量一次（看有没有"越跑越慢"）
  const t2 = process.hrtime.bigint();
  await qaPage.ensureOnHomeFeed(page);
  console.log(`③ ensureOnHomeFeed 再一次：${ms(t2)} ms`);

  return base.foreground(page);
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "性能", title: "前台页解析的耗时" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
