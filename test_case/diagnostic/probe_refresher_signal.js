/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**下拉刷新的"正在刷新"到底有没有可观测信号？**
 *
 * 【为什么问】2026/10/16：案例库这页的下拉**确实会重新取数**（实测：库里把复制数改成 15，
 * 下拉一次界面就从 14 变成 15），但 DOM 里**看不到任何迹象** —— 没有转圈的点（`blink-anim`）、
 * 刷新容器也不动。而框架的「下拉刷新」动作原本靠"转圈出现"当判据，在这页会误判成"没触发"。
 *
 * 这条探针在下拉前后密集采样，把**所有可能有关的信号**都打出来，用来定一个在这页也认得的判据：
 *   · 类名里带 refresher 的元素（含 rect）；
 *   · 类名里带 loading / skeleton / 加载 状态的元素；
 *   · 能滚的那个容器的 scrollTop / scrollHeight；
 *   · 页面上元素总数（重新渲染时通常会变）。
 *
 * 只读：只发一次下拉手势，不改数据。
 * 运行：node test_case/diagnostic/probe_refresher_signal.js            # 默认在案例库上做
 *       node test_case/diagnostic/probe_refresher_signal.js --page qa  # 换首页（对照组：首页有转圈）
 */

const { appTest, resolveForegroundPage } = require("../../common/app_common");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(page) {
  const argv = process.argv.slice(2);
  const which = argv[argv.indexOf("--page") + 1] || "case";
  if (which === "qa") page = await pages.qaPage.ensureOnHomeFeed(page);
  else page = await pages.caseLibrary.ensureOn(page);
  const device = await getDevice();
  const fg = await resolveForegroundPage(page);

  const read = () =>
    fg.evaluate(() => {
      const clsOf = (el) => String(el.getAttribute("class") || "");
      const all = Array.from(document.querySelectorAll("*"));
      const refresherEls = all
        .filter((el) => /refresher/i.test(clsOf(el)))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${clsOf(el).slice(0, 46)}@${Math.round(r.y)}`;
        });
      const loadingEls = all
        .filter((el) => /loading|skeleton|ellipsis-anim|animate/i.test(clsOf(el)))
        .map((el) => clsOf(el).slice(0, 46));
      let maxScrollTop = 0;
      all.forEach((el) => {
        if (el.scrollTop > maxScrollTop) maxScrollTop = el.scrollTop;
      });
      return {
        n: all.length,
        scrollTop: Math.round(maxScrollTop),
        blink: all.filter((el) => /blink-anim/.test(clsOf(el))).length,
        refresher: Array.from(new Set(refresherEls)).slice(0, 4),
        loading: Array.from(new Set(loadingEls)).slice(0, 4),
      };
    });

  const screen = await fg.evaluate(() => ({
    w: Math.round(window.innerWidth * window.devicePixelRatio),
    h: Math.round(window.innerHeight * window.devicePixelRatio),
  }));
  const x = Math.round(screen.w / 2);
  const y1 = Math.round(screen.h * 0.25);
  const y2 = Math.round(screen.h * 0.75);

  console.log(`=== 在「${which}」上采样（手势 ${x} ${y1} -> ${y2}，800ms）===`);
  const t0 = Date.now();
  let fired = false;
  while (Date.now() - t0 < 7000) {
    const t = Date.now() - t0;
    if (!fired && t >= 1000) {
      console.log(`  t=${t}ms >>> 发手势`);
      device.shell(`input swipe ${x} ${y1} ${x} ${y2} 800`).catch(() => {});
      fired = true;
    }
    const s = await read();
    console.log(
      `  t=${String(Date.now() - t0).padStart(4)}ms n=${String(s.n).padStart(4)} scrollTop=${String(s.scrollTop).padStart(5)} blink=${s.blink}` +
        ` refresher=${JSON.stringify(s.refresher)} loading=${JSON.stringify(s.loading)}`
    );
    await sleep(200);
  }
  return fg;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "刷新", title: "下拉刷新的可观测信号" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
