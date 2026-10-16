/*
 * 离线自检（**不连手机、不需要浏览器**）：小程序 WebView 没了的时候，
 * `base.foreground()` 会不会**立刻报错**？
 *
 * 【为什么盯这条】2026/10/16 真机跑批时设备/WebView 掉了（日志里是
 * `androidDevice.shell: Device is closed`、`Target page, context or browser has been closed`），
 * 框架却"沿用当前 page"一路重试 —— **一个步骤耗掉 19 分钟**才报出「context 里没有任何可用页面」。
 *
 * 现在的约定：
 *   · 一个活着的 webview 都没有 → **立刻抛**，message 里说清"这是环境问题，重开小程序再跑"；
 *   · 其它解析失败（多候选一时分不清之类）→ 仍然沿用当前 page（老行为，不动）。
 *
 * 怎么在离线环境里复现：**造假对象**。`resolveForegroundPage` 用到的就那几样
 *（`page.isClosed()` / `page.context().pages()`），所以传一个"context 里一页都没有"的假 page，
 * 它必然走到「context 里没有任何可用页面」那条分支 —— 不用起浏览器、不用连手机。
 *
 * 运行：node test_case/diagnostic/selftest_foreground_dead.js
 * 退出码：0 = 符合预期；1 = 不符合
 */

const base = require("../../app_sub_function/suprecast_app/pages/base_page");

let passed = 0;
const failed = [];

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed.push(`${name}：${detail}`);
    console.log(`FAIL ${name} —— ${detail}`);
  }
}

/** 假 page：context 里一个页面都没有（= 小程序 WebView 全没了） */
function deadPage() {
  return {
    isClosed: () => false,
    context: () => ({ pages: () => [] }),
    url: () => "https://servicewechat.com/wx3de2e1d179b60303/0/page-frame.html",
  };
}

/** 假 page：连 context 都拿不到（另一种"解析失败"，但**不该**被当成环境掉了） */
function noContextPage() {
  return {
    isClosed: () => false,
    context: () => {
      throw new Error("page 已失效");
    },
    url: () => "x",
  };
}

(async () => {
  /*
   * ⚠️ 顺序有讲究：**先**跑"别的解析失败"那条。
   * 因为 `resolveForegroundPage` 会把用过的 context **缓存起来**（模块级 `cachedContext`），
   * 先跑"没有可用页面"那条的话，后面这次会直接复用到那个空 context、也走"没有可用页面"分支 ——
   * 那是模块的真实行为（缓存过就继续用），不是误伤，但对这条自检来说是"测错了对象"。
   */
  // ① 反向：**别的**解析失败不该被误伤 —— 仍然沿用当前 page（老行为）
  const p = noContextPage();
  let ret = null;
  let threw = null;
  try {
    ret = await base.foreground(p);
  } catch (e) {
    threw = e;
  }
  check(
    "别的解析失败仍然沿用当前 page（没被误伤）",
    !threw && ret === p,
    threw ? `抛了：${threw.message.split("\n")[0]}` : "返回的不是原 page"
  );

  // ② 一个活着的 webview 都没有 → 必须立刻抛，且说清是环境问题
  let err = null;
  try {
    await base.foreground(deadPage());
  } catch (e) {
    err = e;
  }
  check("没有可用页面时 → 直接抛错（不再沿用死页面）", !!err, "它没抛，说明还在沿用死页面");
  if (err) {
    check(
      "错误信息里说明了这是环境问题（重开小程序再跑）",
      /环境问题/.test(err.message) && /重新打开小程序/.test(err.message),
      `错误信息里没有环境说明：${JSON.stringify(err.message.slice(0, 120))}`
    );
    console.log(`     错误信息首行：${JSON.stringify(err.message.split("\n")[0].slice(0, 70))}`);
  }

  console.log();
  if (failed.length) {
    console.log(`有 ${failed.length} 项不符合预期：`);
    for (const f of failed) console.log("  · " + f);
    process.exit(1);
  }
  console.log(`全部通过（${passed} 项）`);
})().catch((e) => {
  console.error("自检本身出错: " + e.message);
  process.exit(1);
});
