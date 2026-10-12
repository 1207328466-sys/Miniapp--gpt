/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**反向验证**点击护栏的"被盖住"分支。
 *
 * 背景（2026/10/12 全量跑里的一次偶发红）：点搜索栏的 adb 坐标明明在屏幕内，
 * 可页面没动 —— 失败截图显示那一刻屏幕上根本没有搜索栏。也就是说：
 * **坐标合法 ≠ 点得到它**。于是 tapElement 加了一道命中测试护栏：
 * 该坐标上"最上面"的元素必须是自己或自己的亲属，否则先滚动、再不行就报错。
 *
 * 护栏这种东西最怕"只会放松、不会收紧"—— 所以要**构造一次必然被盖住的场景**，
 * 确认它真的会红：这里用 JS 往页面上盖一个透明遮罩（`.__probe_overlay`）挡住搜索栏，
 * 然后真的去点它。
 *
 *   期望：点击被拦下，报错里出现 `__probe_overlay`（说明它认出了"盖在上面的是谁"）
 *
 * 只读：只加一个临时的 DOM 遮罩（跑完就删），不改任何数据。
 * 运行：node test_case/diagnostic/probe_tap_guard.js
 */

const { appTest } = require("../../common/app_common");
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

const SEL = ".search-container";
const OVERLAY = "__probe_overlay";

async function searchBarBox(page) {
  const fg = await base.foreground(page);
  return fg.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, SEL);
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);

  // 先把首页滚回顶部：只有搜索栏在屏幕内，才能测"被盖住"这一支
  for (let i = 0; i < 5; i++) {
    page = await android.swipeUp(page, { startRatio: 0.25, endRatio: 0.75 });
    await base.sleep(500);
  }
  let box = await searchBarBox(page);
  console.log("\n搜索栏现在的位置: %s", JSON.stringify(box));
  if (!box || box.y < 0) {
    console.log("  [跳过] 没能把它滚回屏幕内，这一步测不了（不是失败，是前置条件不满足）");
    page = await qaPage.ensureOnHomeFeed(page);
    const e = new Error("前置条件不满足：搜索栏没能滚回屏幕内，无法构造「被盖住」的场景");
    e.preconditionNotMet = true;
    throw e;
  }

  // 1) 先说明正常情况是能点的（护栏不该误伤）
  const fg = await base.foreground(page);
  const clean = await fg.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top) || top.contains(el);
  }, SEL);
  console.log("  没盖遮罩时，命中测试 = %s（应当为 true，否则护栏会误伤正常点击）", clean);

  // 2) 盖一个遮罩上去，座位正对搜索栏
  // ⚠️ Playwright 的 locator.evaluate 只收一个参数 —— 多个值要包成对象传（这次踩了一次）
  await fg.evaluate(
    ({ sel, cls }) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const o = document.createElement("div");
      o.className = cls;
      o.style.cssText =
        `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;` +
        `z-index:999999;background:rgba(255,0,0,0.01)`;
      document.body.appendChild(o);
    },
    { sel: SEL, cls: OVERLAY }
  );
  console.log("  已盖上遮罩 .%s（透明，只为了让命中测试认出「盖住它的是谁」）", OVERLAY);

  // 3) 真的去点 —— 期望被护栏拦下
  let caught = "";
  try {
    await base.tapSelector(await base.foreground(page), SEL, "搜索栏（被遮罩盖住）");
  } catch (e) {
    caught = e.message;
  }

  // 4) 收尾：把遮罩删掉（不管上面结果如何）
  await (await base.foreground(page)).evaluate((cls) => {
    document.querySelectorAll("." + cls).forEach((n) => n.remove());
  }, OVERLAY);

  if (!caught) {
    throw new Error(
      "护栏没拦下被盖住的点击 —— 也就是说点了一个被遮罩压住的元素还是放行了。\n" +
      "  这意味着那道「命中测试」没生效（或者被 catch 吞掉了），静默误点会照旧发生。"
    );
  }
  if (!caught.includes(OVERLAY)) {
    throw new Error(`护栏拦下了，但报错里没说清"是谁盖住的"（期望出现 ${OVERLAY}）：\n  ${caught.split("\n")[0]}`);
  }
  console.log("\n✅ 反向验证通过：护栏拦下了被盖住的点击，并指出盖住它的是 .%s", OVERLAY);
  console.log("   报错全文第一行：%s", caught.split("\n")[0]);

  page = await qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "点击护栏", title: "反向验证：被盖住的元素点不到时会报错" },
  });
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
