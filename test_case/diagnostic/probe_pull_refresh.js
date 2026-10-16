/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**adb 的下拉手势能不能触发「下拉刷新」？**
 *
 * 【为什么问这个】owner 2026/10/15 交代：需要刷新的时候统一走"切换页面"或"下拉刷新"，
 * 让我去验证哪种真的有效。已经验过的是「真切 tab」（坑 49：真切 tab 会重新拉列表，
 * 而"进用户中心再回首页"和"本来就在这一栏"都是幂等空操作，等于什么都没做）。
 * 还没验的是**下拉刷新**。
 *
 * 源码依据（`src/pages/qa/index.tsx`）：首页信息流用的是 Taro `<ScrollView refresherEnabled
 * refresherTriggered onRefresherRefresh>` —— 也就是 scroll-view 的**自定义下拉刷新**，
 * 不是页面级的 `enablePullDownRefresh`（源码里全局搜不到这个配置）。它的回调里会
 * `getDataList` + `fetchActivities`，是**真的重新取数**。
 *
 * 这个探针做三件事（只读，不改任何数据）：
 *   ① 找到 DOM 里的 refresher 元素（类名带 refresher 的那些）并打出它的位置；
 *   ② 用三种"下拉力度"各拖一次，每次拖完立刻看 refresher 有没有变成"拉开/触发"的样子；
 *   ③ 打印信息流卡片数/第一张卡的文字 —— 用来判断列表有没有重新渲染。
 *
 * 运行（手机停在首页信息流、列表在顶部）：
 *     node test_case/diagnostic/probe_pull_refresh.js                 # 三种力度各拖一次（默认）
 *     node test_case/diagnostic/probe_pull_refresh.js --gestures 1    # 只拖一次（做数据对照实验时用）
 *     node test_case/diagnostic/probe_pull_refresh.js --gestures 0    # 只读现场，不拖（对照组）
 *     node test_case/diagnostic/probe_pull_refresh.js --watch 6000    # 每 200ms 采一次样，看刷新过程中 DOM 怎么变
 *
 * 【做"数据级对照"的用法（2026/10/16 验刷新就是这么做的）】
 *   ① `--gestures 0` 读一次现场 → 后台改一条数据（例如置顶一条帖子）；
 *   ② **不做任何刷新**，再 `--gestures 0` 读一次 → 应该还是旧的（证明"不刷新就是看不到"）；
 *   ③ `--gestures 1`：下拉一次，再看 → 新的出来了 = **下拉刷新真的重新取数了**。
 */

const { appTest, resolveForegroundPage } = require("../../common/app_common");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读一次现场：refresher 元素、信息流卡片 */
async function snap(fg, label) {
  const info = await fg.evaluate(() => {
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const cls = String(el.getAttribute("class") || "");
      if (/refresher/i.test(cls)) {
        const r = el.getBoundingClientRect();
        out.push({
          cls,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","),
        });
      }
    });
    const cards = Array.from(document.querySelectorAll(".flow-item"));
    return {
      refresher: out,
      cardCount: cards.length,
      // 「置顶」两个字只会出现在置顶那条卡上，用数字数它最直观
      topCount: cards.filter((c) => String(c.innerText || "").includes("置顶")).length,
      first3: cards
        .slice(0, 3)
        .map((c) => String(c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24)),
    };
  });
  console.log(
    `[${label}] refresher ${info.refresher.length} 个；flow-item ${info.cardCount} 个；含「置顶」的卡 ${info.topCount} 个；前 3 张 ${JSON.stringify(info.first3)}`
  );
  info.refresher.slice(0, 8).forEach((r) => console.log(`      ${r.cls}  @${r.rect}`));
  return info;
}

async function probe(page) {
  const device = await getDevice();
  // `--page case`：先打开案例库再测（下拉刷新在那一页的表现跟首页不一样，2026/10/16 遇到超时）
  if (process.argv.includes("--page") && (process.argv[process.argv.indexOf("--page") + 1] || "") === "case") {
    page = await pages.caseLibrary.ensureOn(page);
    console.log("已打开案例库（--page case）");
  }
  const fg = await resolveForegroundPage(page);
  const argv0 = process.argv.slice(2);
  const wi = argv0.findIndex((a) => a.replace(/^--/, "").split("=")[0] === "watch");
  const watchMs = wi >= 0 ? Number(argv0[wi].includes("=") ? argv0[wi].split("=")[1] : argv0[wi + 1]) : 0;
  const screen = await fg.evaluate(() => ({
    w: Math.round((window.innerWidth || 0) * (window.devicePixelRatio || 1)),
    h: Math.round((window.innerHeight || 0) * (window.devicePixelRatio || 1)),
    cssH: window.innerHeight,
  }));
  console.log(`屏幕（设备像素）${screen.w}x${screen.h}，CSS 视口高 ${screen.cssH}`);

  await snap(fg, "下拉之前");

  // `--scrollinfo`：把"能滚的容器"各自滚到哪儿了打出来（判断"是不是真的到顶了"）
  if (process.argv.includes("--scrollinfo")) {
    const info = await fg.evaluate(() => {
      const out = [];
      document.querySelectorAll("div, wx-view, wx-scroll-view").forEach((el) => {
        const over = el.scrollHeight - el.clientHeight;
        if (over > 20) {
          out.push({
            cls: String(el.getAttribute("class") || "").slice(0, 40),
            top: Math.round(el.scrollTop),
            sh: el.scrollHeight,
            ch: el.clientHeight,
          });
        }
      });
      return out.sort((a, b) => b.sh - b.ch - (a.sh - a.ch));
    });
    console.log(`能滚的容器 ${info.length} 个（按可滚距离排序）：`);
    info.slice(0, 8).forEach((r) => {
      console.log(
        `   scrollTop=${String(r.top).padStart(6)}  可滚 ${r.sh - r.ch}px  class=${JSON.stringify(r.cls)}`
      );
    });
  }

  /**
   * 采样模式：每 200ms 读一次"刷新中"的判据，用来定"刷新开始/结束"到底看什么。
   * 读三样东西（都是真机上真实变化的）：
   *   · blinkAnim：refresher 上带闪烁动画那几个点（= 正在转圈）
   *   · fold：静止状态的折叠点
   *   · cards：信息流卡片数（刷新时列表会清空重来）
   */
  if (watchMs > 0) {
    const read = () =>
      fg.evaluate(() => {
        const all = Array.from(document.querySelectorAll("*"));
        const clsOf = (el) => String(el.getAttribute("class") || "");
        const blink = all.filter((el) => /blink-anim/.test(clsOf(el))).length;
        const fold = all.filter((el) => /-fold/.test(clsOf(el))).length;
        const cont = all.find((el) => /wx--refresher--container--private/.test(clsOf(el)));
        const r = cont ? cont.getBoundingClientRect() : null;
        const scroll = all.find((el) => /wx--refresher--content--private/.test(clsOf(el)));
        const sr = scroll ? scroll.getBoundingClientRect() : null;
        return {
          blink,
          fold,
          containerY: r ? Math.round(r.y) : null,
          contentY: sr ? Math.round(sr.y) : null,
          cards: document.querySelectorAll(".flow-item").length,
        };
      });
    const x = Math.round(screen.w / 2);
    // 起手/落点比例可以调：某些页面（案例库那种上面有吸顶分类区的）在 0.34 屏高起手会被挡住
    const argvW = process.argv.slice(2);
    const num = (name, def) => {
      const i = argvW.findIndex((a) => a.replace(/^--/, "").split("=")[0] === name);
      const v = i >= 0 ? (argvW[i].includes("=") ? argvW[i].split("=")[1] : argvW[i + 1]) : def;
      return Number(v == null || v === "" ? def : v);
    };
    const y1 = Math.round(screen.h * num("from", 0.34));
    const y2 = Math.round(screen.h * num("to", 0.7));
    const t0 = Date.now();
    let fired = false;
    while (Date.now() - t0 < watchMs) {
      const t = Date.now() - t0;
      const msG = num("ms", 400);
      if (!fired && t >= 1200) {
        console.log(`  t=${t}ms  >>> 发手势 input swipe ${x} ${y1} ${x} ${y2} ${msG}`);
        device.shell(`input swipe ${x} ${y1} ${x} ${y2} ${msG}`).catch(() => {});
        fired = true;
      }
      const s = await read();
      console.log(
        `  t=${String(Date.now() - t0).padStart(4)}ms  blink=${s.blink} fold=${s.fold} containerY=${s.containerY} contentY=${s.contentY} cards=${s.cards}`
      );
      await sleep(180);
    }
    return;
  }

  const x = Math.round(screen.w / 2);
  const all = [
    { name: "慢拖 800ms", y1: Math.round(screen.h * 0.34), y2: Math.round(screen.h * 0.7), ms: 800 },
    { name: "中速 400ms", y1: Math.round(screen.h * 0.34), y2: Math.round(screen.h * 0.7), ms: 400 },
    { name: "快速 150ms", y1: Math.round(screen.h * 0.34), y2: Math.round(screen.h * 0.7), ms: 150 },
  ];
  const argv = process.argv.slice(2);
  const gi = argv.findIndex((a) => a.replace(/^--/, "").split("=")[0] === "gestures");
  const rawWant = gi >= 0 ? (argv[gi].includes("=") ? argv[gi].split("=")[1] : argv[gi + 1]) : "3";
  const want = Number(rawWant == null || rawWant === "" ? 3 : rawWant);
  const gestures = all.slice(0, Math.max(0, Math.min(3, want)));
  if (!gestures.length) {
    console.log("\n（--gestures 0：只读现场，不拖）");
    return;
  }

  for (const g of gestures) {
    console.log(`\n===== 手势：${g.name}（x=${x}, ${g.y1} -> ${g.y2}） =====`);
    await device.shell(`input swipe ${x} ${g.y1} ${x} ${g.y2} ${g.ms}`);
    await sleep(250);
    await snap(fg, "松手后 0.25s");
    await sleep(2500);
    await snap(fg, "松手后 2.75s");
  }

  // 收尾：把页面滚回顶部，别让下一条用例从半中间开始
  await device.shell(`input swipe ${x} ${Math.round(screen.h * 0.4)} ${x} ${Math.round(screen.h * 0.85)} 400`);
  await sleep(800);
  await snap(fg, "归位后");
  await snap(fg, "最终现场");
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "刷新口径", title: "下拉刷新能不能用 adb 触发" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
