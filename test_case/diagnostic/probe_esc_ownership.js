/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**发一次 ESC，到底哪几页收到了 keydown？**
 *
 * 【为什么问】「输入归属」是整个前台页判定里最硬的信号（发 ESC，只有屏幕上那页收到键；
 * 后台页收不到）。2026/10/16 修掉 `isKeyboardShown` 那个"永远为 true"的误判之后，
 * 这条判据**终于真的会跑**了 —— 但实测单次解析从 1793ms 涨到 2134ms，
 * 说明它**没定论**（不然就不会继续走 RAF 那条贵路径了）。所以直接量：
 * 每个候选页各收到几次 keydown、时间戳是多少。
 *
 * 只读：只发一个 ESC（它只影响输入法，不改界面、不改数据）。
 * 运行（手机停在小程序任意一页）：node test_case/diagnostic/probe_esc_ownership.js
 */

const { appTest, resolveForegroundPage } = require("../../common/app_common");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(page) {
  const device = await getDevice();
  const fg = await resolveForegroundPage(page);
  const ctx = page.context();
  const all = ctx.pages().filter((p) => !p.isClosed());
  console.log(`候选页 ${all.length} 个；当前认定的前台页 url 尾段 ${fg.url().split("/").slice(-2).join("/")}`);

  // 每页装一个计数器（装上之后连点几次都能累计）
  for (const p of all) {
    await p
      .evaluate(() => {
        if (window.__escProbeInstalled) return;
        window.__escProbeInstalled = true;
        window.__escProbeCount = 0;
        window.__escProbeAt = 0;
        document.addEventListener("keydown", (e) => {
          window.__escProbeCount += 1;
          window.__escProbeAt = Date.now();
          window.__escProbeKey = e && e.key;
        }, true);
      })
      .catch(() => {});
  }

  const sentAt = Date.now();
  await device.shell("input keyevent 111");
  await sleep(800);

  console.log(`\n发 ESC 的时刻：${sentAt}；下面各页的收到情况（count / key / 距发送 ms）：`);
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const info = await p
      .evaluate(() => ({
        count: window.__escProbeCount || 0,
        key: window.__escProbeKey || "",
        at: window.__escProbeAt || 0,
        probeOk: !!window.__escProbeInstalled,
      }))
      .catch((e) => ({ count: -1, key: "(读不到: " + e.message.split("\n")[0] + ")" }));
    const isFg = p === fg ? " ←当前认定的前台页" : "";
    const dt = info.at ? info.at - sentAt : "";
    console.log(`  ${i + 1}. count=${info.count} key=${JSON.stringify(info.key)} dt=${dt}${isFg}`);
  }
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "性能", title: "ESC 的输入归属到底准不准" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
