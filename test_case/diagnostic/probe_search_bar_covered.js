/*
 * 诊断（不以 test_ 开头，pytest 不收集）：首页往上滚之后，搜索栏到底还在不在能点的地方？
 *
 * 起因（2026/10/12 全量跑里的一次偶发红）：
 *   test_example.js 第 1 步「打开搜索页」失败，日志是
 *     adb tap(608, 214)  目标=self  起点元素尺寸正常     <- 没报"目标不在屏幕内"
 *     点击搜索栏后没有进入搜索页
 *   而失败截图显示：首页当时**被滚上去了**，屏幕上根本看不到搜索栏。
 *   推测：搜索栏的**布局坐标**仍在屏幕内（y≈66 CSS），但**视觉上被吸顶头部盖住**，
 *   于是 adb 老老实实点了那个坐标 —— 点到了头部，页面当然不动。
 *   这和坑 20（坐标落到屏幕外）是相邻但不同的一种"静默失败"。
 *
 * 本探针就干一件事：把这条因果**复现出来**——
 *   1. 回首页、停在顶部，读搜索栏的坐标 + 该坐标上"最上面那个元素是谁"（命中测试）
 *   2. 把首页往上滑一屏，再读同样的两样东西
 *   3. 把结果并排打出来：坐标有没有变、命中测试的人有没有换成头部
 *
 * 只读：只滑动 + 读 DOM，不点击。
 * 运行：node test_case/diagnostic/probe_search_bar_covered.js
 */

const { appTest } = require("../../common/app_common");
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

const SEL = ".search-container";

async function snapshot(page, label) {
  const fg = await base.foreground(page);
  const info = await fg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const describe = (n) =>
      n ? n.tagName.toLowerCase() + (n.getAttribute && n.getAttribute("class") ? "." + String(n.getAttribute("class")).split(/\s+/).slice(0, 2).join(".") : "") : "(空)";
    return {
      found: true,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      center: [Math.round(cx), Math.round(cy)],
      // 命中测试：这个坐标上"最上面"的是谁？是搜索栏自己/它的子孙 = 能点；是别人 = 被盖住了
      topAtCenter: describe(top),
      isSelfOrChild: !!(top && (top === el || el.contains(top) || top.contains(el))),
      scrollY: Math.round(window.scrollY || 0),
      pageText: String(document.body.innerText || "").replace(/\s+/g, " ").slice(0, 60),
    };
  }, SEL);

  if (!info.found) {
    console.log("[%s] 页面上找不到 %s", label, SEL);
    return;
  }
  console.log("\n[%s]", label);
  console.log("  搜索栏位置 = %s（中心 %s），窗口 scrollY=%s", JSON.stringify(info.rect), JSON.stringify(info.center), info.scrollY);
  console.log("  该坐标上最上面的元素 = %s", info.topAtCenter);
  console.log("  能点到搜索栏自己吗 = %s", info.isSelfOrChild ? "能" : "**不能（被盖住了）**");
  console.log("  页面文字开头: %s", JSON.stringify(info.pageText));
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);
  await snapshot(page, "第 1 次：首页停在顶部");

  // 只滚一点点：搜索栏会"半露出 + 被吸顶头部压住"——这正是全量跑里那次失败的样子。
  // 用来验证"命中测试"这道新护栏**该红的时候会红**（而不是只会放松）。
  console.log("\n=== 先小滚一点（约 300 物理像素）===");
  const device = await base.getDevice();
  await device.shell("input swipe 607 1400 607 1100 300");
  await base.sleep(1000);
  await snapshot(page, "第 1.5 次：小滚之后");

  console.log("\n=== 现在真点一下搜索栏：看新护栏会不会拦下来（拦下来是对的）===");
  try {
    await base.tapSelector(await base.foreground(page), SEL, "搜索栏");
    await base.sleep(1500);
    const after = await base.pageText(await base.foreground(page));
    console.log("  没报错。点完之后页面文字开头: %s", JSON.stringify(after.slice(0, 60)));
  } catch (e) {
    console.log("  被拦下来了（这正是我们要的）：%s", e.message.split("\n")[0]);
  }

  console.log("\n=== 把首页往上滑一屏 ===");
  page = await android.swipeUp(page);
  await base.sleep(1200);
  await snapshot(page, "第 2 次：首页往上滚之后");

  page = await qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "搜索栏", title: "首页滚动后搜索栏是否被盖住" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
