/*
 * 离线自检（不连手机）：`buildNoWebviewError` 拼出来的报错，必须**把人指对方向**。
 *
 * 【为什么值得单独钉】2026/10/19 真机踩到：`adb devices` 有设备、小程序也在前台，
 * 框架却等 30 秒后只报一句「找不到前台小程序webview（检查：微信已打开目标小程序，且小程序处于前台）」
 * —— 前两条明明都成立，真正原因是**微信侧调试端口没了**（vConsole 角标是小程序自己开的，不算数）。
 * 报错文案也是判据的一部分：写错方向，人会去重启小程序、拔插数据线，白折腾半小时。
 *
 * 钉三件事：
 *   ① 一个 webview 都没有 -> 要说"调试端口"，并且给出三条恢复办法 + 一条可验证的恢复判据；
 *   ② 有 webview 但都不是小程序页 -> 要说"服务商页面没找到、先切到前台"，并列出看到的是哪些；
 *   ③ 知道 appid 就带上 appid（排查时第一眼看的就是"是不是测错小程序"）。
 *
 * 运行：node test_case/diagnostic/selftest_no_webview_error.js
 */

const { buildNoWebviewError } = require("../../common/app_common");

const APPID = "wx3de2e1d179b60303";
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

function must(text, words, label) {
  for (const w of words) {
    if (!text.includes(w)) throw new Error(`${label} 里缺少「${w}」：\n${text}`);
  }
}

let err = buildNoWebviewError({ appId: APPID, pkg: "com.tencent.mm:appbrand0", webviews: [] });
check("0 个 webview：指向「调试端口」，不是「小程序没在前台」", () => {
  const t = err.message;
  must(t, ["可调试的 webview", "调试端口", "vConsole", "真机调试", "devtools_remote", APPID], "报错");
  if (t.includes("微信已打开目标小程序，且小程序处于前台")) {
    throw new Error("又退回了那句会误导人的旧话（「检查：微信已打开目标小程序，且小程序处于前台」）");
  }
});

err = buildNoWebviewError({
  appId: APPID,
  pkg: "com.tencent.mm:appbrand0",
  webviews: [
    { pid: 111, url: "https://servicewechat.com/preload/page-frame.html" },
    { pid: 222, url: "about:blank" },
  ],
});
check("有 webview 但都不是小程序页：列出看到的是哪些 + 让先切前台", () => {
  const t = err.message;
  must(t, ["2 个 webview", "servicewechat.com", "pid=111", "pid=222", "preload", "前台"], "报错");
});

err = buildNoWebviewError({ pkg: "com.tencent.mm:appbrand0", webviews: [] });
check("不知道 appid 时不要硬编一个 appid 出来", () => {
  const t = err.message;
  if (t.includes("appid=")) throw new Error(`没给 appid 却出现了 appid=：\n${t}`);
  must(t, ["pkg=com.tencent.mm:appbrand0"], "报错");
});

if (failed) {
  console.log(`\n${failed} 项不通过`);
  process.exit(1);
}
console.log("\n全部通过（3 项）");
