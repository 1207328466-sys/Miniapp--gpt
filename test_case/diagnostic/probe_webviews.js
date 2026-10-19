/*
 * 诊断（只读）：手机上现在**能被 Playwright 看见的 webview** 有几个、各自的 pid 和 url 是什么。
 *
 * 什么时候用它：跑用例前先确认"通道在不在"。2026/10/19 踩到过 —— `adb devices` 有设备、
 * 小程序也在前台、vConsole 角标还亮着，但 `webViews()` 返回 0（微信侧 CDP 调试开关掉了）。
 * 那时任何用例都会在 30 秒后报「找不到前台小程序webview」；用这个探针 3 秒就能分清
 * "没端口" 和 "有端口但小程序在后台"（见 docs/踩坑记录.md 坑 59）。
 *
 * 运行：node test_case/diagnostic/probe_webviews.js
 *       node test_case/diagnostic/probe_webviews.js --watch   # 重开一次小程序，边开边看（8 秒）
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

  // --watch：模拟"退出小程序 -> 最近使用里重新打开"，边开边轮询 8 秒。
  // 为什么要有它：有的 WeChat 版本是**开着小程序那一刻**才建 devtools 端口，之后再收掉；
  // 只在"已经停在首页"时探一次，会得出错误结论（"端口没开"）。
  if (process.argv.includes("--watch")) {
    console.log("watch 模式：退出小程序 -> 最近使用里重开 -> 每 400ms 探一次，共 8 秒");
    await device.shell("input keyevent 4");
    await new Promise((r) => setTimeout(r, 1500));
    await device.shell("input swipe 600 320 600 1100 400");
    await new Promise((r) => setTimeout(r, 1500));
    await device.shell("input tap 179 708");
    let best = 0;
    for (let i = 0; i < 20; i++) {
      const n = (await device.webViews()).length;
      best = Math.max(best, n);
      console.log(`  +${(i * 400).toString().padStart(4)}ms webviews=${n}`);
      if (n > 0) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(best > 0 ? `\n✅ 看见端口了（最多 ${best} 个）` : "\n❌ 8 秒内一次都没看见端口");
    process.exit(best > 0 ? 0 : 1);
  }

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
