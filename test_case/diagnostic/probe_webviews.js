/*
 * 诊断（只读）：手机上现在**能被 Playwright 看见的 webview** 有几个、各自的 pid 和 url 是什么。
 *
 * 什么时候用它：跑用例前先确认"通道在不在"。2026/10/19 踩到过 —— `adb devices` 有设备、
 * 小程序也在前台、vConsole 角标还亮着，但 `webViews()` 返回 0（微信侧 CDP 调试开关掉了）。
 * 那时任何用例都会在 30 秒后报「找不到前台小程序webview」；用这个探针 3 秒就能分清
 * "没端口" 和 "有端口但小程序在后台"（见 docs/踩坑记录.md 坑 59）。
 *
 * 运行：node test_case/diagnostic/probe_webviews.js
 * 退出码：0 = 至少 1 个；1 = 0 个（通道没开）
 */

const { _android: android } = require("playwright");

(async () => {
  const t0 = Date.now();
  const [device] = await android.devices();
  if (!device) {
    console.log("没有可用设备（adb devices 里有 device 状态的吗？）");
    process.exit(1);
  }
  const list = [];
  for (const wv of await device.webViews()) {
    let url = "";
    try {
      url = (await wv.page()).url();
    } catch (e) {
      url = `（取 page 失败：${e.message.split("\n")[0]}）`;
    }
    list.push({ pid: wv.pid(), url });
  }
  console.log(`webview 数量 = ${list.length}（耗时 ${Date.now() - t0} ms）`);
  list.forEach((w, i) => console.log(`  ${i + 1}. pid=${w.pid} url=${w.url}`));
  if (!list.length) {
    console.log(
      "\n0 个 = 微信侧的小程序调试端口没开（vConsole 角标不算数）。" +
        "\n恢复：小程序右上角「…」→「打开调试 / 开发调试」；或让前端用微信开发者工具「真机调试」连一次。"
    );
    process.exit(1);
  }
})().catch((e) => {
  console.error("探针失败：" + e.message.split("\n")[0]);
  process.exit(1);
});
