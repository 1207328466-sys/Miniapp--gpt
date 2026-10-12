/*
 * 诊断脚本（故意不以 test_ 开头，pytest 不会收集）
 *
 * 用途：修坑 19（"认错前台页"）取证据 —— 在**跳转发生的那几秒**连续采样，
 * 看每个页面的信号怎么变，从而找出"哪个信号真能区分前台页"。
 *
 * 背景：现在的判据是"还在产出动画帧的 page = 前台页"；多页同时出帧时兜底成
 * "元素数最多的那个" —— 真机上就因此挑中了学习中心·专栏列表，而真前台是搜索页。
 *
 * 用法：
 *   node test_case/diagnostic/probe_pages.js            # 一次快照
 *   node test_case/diagnostic/probe_pages.js --timeline # 连续采样：先闲着 -> 点搜索栏 -> 再看 2.4 秒
 *
 * 产出：控制台表格 + report/diagnostic/page_identity.png（设备截图真值）
 *
 * 教训（写这个探针时自己踩的）：RAF 探针**必须传超时毫秒数**！
 * 第一版漏了参数 -> setTimeout(..., undefined) 立刻触发 -> 所有页面都报"不出帧"，
 * 整张表是废的。判据类探针要先自证"它在该出结果时会出结果"。
 */

const fs = require("fs");
const path = require("path");
const { appTest, resolveForegroundPage } = require("../../common/app_common");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");
const pagesMod = require("../../app_sub_function/suprecast_app/pages");

const OUT_DIR = path.join(__dirname, "..", "..", "report", "diagnostic");
fs.mkdirSync(OUT_DIR, { recursive: true });

/** 与 app_common 内部同款的 RAF 探针（记得传 ms） */
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

const TIMELINE = process.argv.includes("--timeline");
const RAF_TIMEOUT = 500;

async function describe(p) {
  const info = await p
    .evaluate(() => {
      const t = String((document.body && document.body.innerText) || "")
        .replace(/\s+/g, " ")
        .trim();
      return {
        vis: document.visibilityState,
        focus: document.hasFocus(),
        len: t.length,
        text: t.slice(0, 34),
      };
    })
    .catch(() => null);
  let url = "(拿不到)";
  try {
    url = p.url();
  } catch (e) {
    /* 页面刚被销毁 */
  }
  const raf = await p.evaluate(RAF, RAF_TIMEOUT).catch(() => null);
  const count = await p.locator("*").count().catch(() => -1);
  return {
    url,
    raf,
    count,
    ...(info || { vis: "(读不到)", focus: null, len: 0, text: "" }),
  };
}

async function sample(page, label) {
  const all = page.context().pages().filter((p) => {
    try {
      return !p.isClosed();
    } catch (e) {
      return false;
    }
  });
  const rows = [];
  for (const p of all) rows.push(await describe(p));
  console.log(`\n[${label}] 共 ${rows.length} 个页面：`);
  rows.forEach((r, i) => {
    console.log(
      `  ${i + 1}) RAF=${String(r.raf).padEnd(5)} 元素=${String(r.count).padEnd(4)} ` +
        `字数=${String(r.len).padEnd(5)} vis=${String(r.vis).padEnd(8)} ` +
        `focus=${String(r.focus).padEnd(5)} | ${r.url.replace("https://servicewechat.com/", "")}`
    );
    console.log(`      文字: ${r.text}`);
  });
  return page;
}

async function shot(page) {
  const device = await getDevice();
  const out = path.join(OUT_DIR, "page_identity.png");
  fs.writeFileSync(out, await device.shell("screencap -p"));
  console.log(`截图真值：${out}（人工对照：截图里的内容 = 上面哪一行的文字前缀）`);
}

async function oneShot(page) {
  await sample(page, "当前快照");
  const picked = await resolveForegroundPage(page).catch(() => null);
  const idx = picked ? page.context().pages().indexOf(picked) + 1 : 0;
  console.log(`\n现有判据挑中的是：第 ${idx || "?"} 个页面`);
  await shot(page);
  return page;
}

/* ------------------- timeline 模式：把跳转过程拍下来 ------------------- */

async function tlBefore(page) {
  // 先自己回到首页信息流（可重复运行：否则上一次采样留在搜索页，这一步就没得点了）
  page = await pagesMod.qaPage.ensureOnHomeFeed(page);
  await sample(page, "① 跳转前（首页，闲着）");
  return page;
}

async function tlTap(page) {
  const fg = await pagesMod.base.foreground(page);
  console.log("\n>>> 现在点搜索栏，制造一次跳转");
  await pagesMod.base.tapSelector(fg, pagesMod.qaPage.SEL.searchBar, "搜索栏");
  return fg;
}

async function tlAfter(page) {
  for (let i = 1; i <= 6; i++) {
    await new Promise((r) => setTimeout(r, 400));
    await sample(page, `② 点击后第 ${i} 次采样`);
  }
  await shot(page);
  return page;
}

(async () => {
  const funcList = TIMELINE
    ? [
        [tlBefore, null],
        [tlTap, null],
        [tlAfter, null],
      ]
    : [[oneShot, null]];
  await appTest(funcList, {
    meta: {
      feature: "诊断",
      story: "前台页判据",
      title: TIMELINE ? "跳转过程中各页面的信号变化" : "各页面身份与可见性信号快照",
    },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
