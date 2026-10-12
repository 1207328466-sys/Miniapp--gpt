/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**哪一页才是"屏幕上真正在显示"的那一页？**
 *
 * 为什么必须搞清：2026/10/12 一次全量 22 条全红 —— 点击生效了、屏幕上确实切到了首页，
 * 但框架的前台页解析还指着旧的**案例库**页（`probe_pages_after_tab_tap.js` 抓到的：
 * 6 个页面里 #5 是首页信息流、框架却认了 #3 案例库）。
 * 现有判据是"最近开始出帧的页 = 前台页"，一旦多页同时出帧（案例库页有动画）就会认错。
 *
 * 本探针逐页采集"可见性"候选信号，找**能区分显示中 / 后台**的那一个：
 *   visibilityState / document.hidden / body 的 display·visibility·opacity /
 *   body 尺寸 / elementFromPoint 命中 / 500ms 内出帧数
 *
 * 只读：只读页面属性，不动界面。
 * 运行：node test_case/diagnostic/probe_page_visibility_signals.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

/** 500 毫秒里数一下 requestAnimationFrame 回调次数（可见页应当明显更活跃） */
const RAF_COUNT = `(ms) => new Promise((resolve) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n += 1; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(n); };
  requestAnimationFrame(tick);
  setTimeout(() => resolve(n), ms + 200);
})`;

// ⚠️ 注意：`page.evaluate` 传**字符串**时是按"表达式"求值的 —— 传一个箭头函数字符串
// 只会得到这个函数本身（回 undefined）。所以这里直接传函数（Playwright 会序列化它）。
function collectSignals() {
  const cs = getComputedStyle(document.body);
  const r = document.body.getBoundingClientRect();
  const el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
  return {
    vis: document.visibilityState,
    hidden: document.hidden,
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    bodyRect: [Math.round(r.width), Math.round(r.height)],
    inner: [window.innerWidth, window.innerHeight],
    hitAtCenter: el ? el.tagName.toLowerCase() : "(空)",
  };
}

/** 500ms 内数一下出帧次数 */
function countFrames(ms) {
  return new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => {
      n += 1;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else resolve(n);
    };
    requestAnimationFrame(tick);
    setTimeout(() => resolve(n), ms + 300);
  });
}

async function probe(page) {
  // 【故意不先导航】—— 前台页判据坏掉时，连 ensureOnHomeFeed 都会失败；
  // 这里直接采信号，才能看清"屏幕上是谁、框架认的是谁"。
  const ctxPages = page.context().pages();
  console.log("\n===== 逐页采集可见性信号（共 %d 页）=====", ctxPages.length);
  for (let i = 0; i < ctxPages.length; i++) {
    const p = ctxPages[i];
    try {
      const s = await p.evaluate(collectSignals);
      const frames = await p.evaluate(countFrames, 500).catch(() => -1);
      const head = await p
        .evaluate(() => String(document.body.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 30))
        .catch(() => "");
      console.log(
        "  #%d vis=%s hidden=%s display=%s visibility=%s opacity=%s body=%s inner=%s 中心命中=%s 500ms出帧=%s\n      开头: %s",
        i, s.vis, s.hidden, s.display, s.visibility, s.opacity, JSON.stringify(s.bodyRect), JSON.stringify(s.inner),
        s.hitAtCenter, frames, JSON.stringify(head)
      );
    } catch (e) {
      console.log("  #%d 读不到：%s", i, e.message.split("\n")[0]);
    }
  }
  const fg = await base.foreground(page);
  console.log("\n  框架认为的前台页 = #%d", ctxPages.indexOf(fg));
  console.log("  （对照：请同时看手机屏幕上是哪一页 —— 截图才是真值）");

  // 连续多窗口采样：可见页应当是"每个窗口都在出帧"，后台页可能有空窗
  console.log("\n===== 连续 8 个 120ms 窗口的出帧数（每个还在出帧的页）=====");
  for (let i = 0; i < ctxPages.length; i++) {
    const p = ctxPages[i];
    let series;
    try {
      series = await p.evaluate(async (ms) => {
        const out = [];
        const one = () =>
          new Promise((resolve) => {
            let n = 0;
            const t0 = performance.now();
            const tick = () => {
              n += 1;
              if (performance.now() - t0 < ms) requestAnimationFrame(tick);
              else resolve(n);
            };
            requestAnimationFrame(tick);
            setTimeout(() => resolve(n), ms + 120);
          });
        for (let k = 0; k < 8; k++) out.push(await one());
        return out;
      }, 120);
    } catch (e) {
      continue;
    }
    if (!series.some((n) => n > 0)) continue; // 完全不出帧的页跳过
    console.log("  #%d 出帧序列 = %s（空窗 %d 个）", i, JSON.stringify(series), series.filter((n) => n === 0).length);
  }

  // 再来一组"根元素"信号：URL / 焦点 / body 第一层的 class 与内联样式 / 有没有 hidden 之类标记
  console.log("\n===== 根元素信号 =====");
  for (let i = 0; i < ctxPages.length; i++) {
    const p = ctxPages[i];
    let url = "";
    try {
      url = p.url();
    } catch (e) {
      url = "(取不到)";
    }
    let info;
    try {
      info = await p.evaluate(() => {
        const first = document.body.firstElementChild;
        const marks = [];
        let n = document.body;
        for (let d = 0; d < 3 && n; d++) {
          marks.push(
            `${n.tagName.toLowerCase()}.${String(n.className || "").split(/\s+/).slice(0, 3).join(".")}[${String(n.getAttribute("style") || "").slice(0, 40)}]`
          );
          n = n.firstElementChild;
        }
        return {
          hasFocus: document.hasFocus(),
          docHidden: document.hidden,
          firstCls: first ? `${first.tagName.toLowerCase()}.${String(first.className || "").slice(0, 60)}` : "(无)",
          chain: marks,
        };
      });
    } catch (e) {
      info = { err: e.message.split("\n")[0] };
    }
    console.log("  #%d url=%s", i, url.slice(-40));
    console.log("      hasFocus=%s hidden=%s 第一层=%s", info.hasFocus, info.docHidden, info.firstCls || info.err);
    if (info.chain) console.log("      前 3 层=%s", JSON.stringify(info.chain));
  }
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "前台页判据", title: "逐页可见性信号" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
