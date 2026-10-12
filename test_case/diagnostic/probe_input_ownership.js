/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**用一个"无副作用输入"判断哪一页真正在显示。**
 *
 * 背景（2026/10/12 全量 22 条全红的根因）：框架的"前台页"判据是
 * 「最近开始出帧的页」；可当**多个页面同时以 60fps 出帧**时（案例库页就一直在动画），
 * 它会认错 —— 实测：屏幕上明明是首页信息流（截图为证），框架却认了案例库页，
 * 于是后面每一步的"校验"都在错的页上做，整轮全红。
 *
 * 已排除的信号（实测都无差别）：visibilityState / document.hidden / hasFocus /
 * body 的 display·visibility·opacity / body 尺寸 / elementFromPoint / 出帧节奏（都是 8/8/8…）。
 *
 * 还剩一条路：**输入归属** —— 真正显示的那一页才收得到输入事件。
 * 本探针在每一页上装一个监听，然后发一个"最安全的输入"（按键 ESC / 一次极短触摸），
 * 看哪一页收到了它。
 *
 * 只读：装的监听不改界面，发的输入也刻意选最无害的。
 * 运行：node test_case/diagnostic/probe_input_ownership.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;

/** 在每一页装监听：keydown / touchstart / click 各打一个时间戳 */
async function installListeners(p) {
  return p
    .evaluate(() => {
      if (window.__uitestProbeInstalled) return true;
      window.__uitestProbeInstalled = true;
      window.__uitestEvents = { keydown: 0, touchstart: 0, click: 0 };
      const mark = (k) => () => {
        window.__uitestEvents[k] = Date.now();
      };
      document.addEventListener("keydown", mark("keydown"), true);
      document.addEventListener("touchstart", mark("touchstart"), true);
      document.addEventListener("click", mark("click"), true);
      return true;
    })
    .catch(() => false);
}

async function readEvents(p) {
  try {
    return await p.evaluate(() => window.__uitestEvents || null);
  } catch (e) {
    return null;
  }
}

async function probe(page) {
  const ctxPages = page.context().pages();
  console.log("\n===== 在 %d 页上装监听 =====", ctxPages.length);
  for (let i = 0; i < ctxPages.length; i++) {
    const ok = await installListeners(ctxPages[i]);
    console.log("  #%d 装监听：%s", i, ok ? "OK" : "失败");
  }

  const device = await base.getDevice();

  // ① 先试按键（最安全：ESC 只收键盘，不改界面）
  console.log("\n===== 发一个 ESC（keyevent 111）看谁收到 =====");
  await device.shell("input keyevent 111");
  await base.sleep(1200);
  for (let i = 0; i < ctxPages.length; i++) {
    const ev = await readEvents(ctxPages[i]);
    if (!ev) continue;
    if (ev.keydown) console.log("  #%d 收到 keydown：%s", i, new Date(ev.keydown).toISOString().slice(11, 23));
  }

  // ② 再试触摸（极短、位于标题栏中部，最不容易触发业务）
  console.log("\n===== 发一次极短触摸（标题栏中部 607,190）看谁收到 =====");
  await device.shell("input tap 607 190");
  await base.sleep(1200);
  const got = [];
  for (let i = 0; i < ctxPages.length; i++) {
    const ev = await readEvents(ctxPages[i]);
    if (!ev) continue;
    if (ev.touchstart || ev.click) {
      got.push({ i, touchstart: ev.touchstart, click: ev.click });
      console.log("  #%d 收到 touchstart=%s click=%s", i, ev.touchstart ? "有" : "无", ev.click ? "有" : "无");
    }
  }
  const fg = await base.foreground(page);
  console.log("\n  框架认为的前台页 = #%d；收到触摸的页 = %s", ctxPages.indexOf(fg), JSON.stringify(got.map((g) => g.i)));
  console.log("  （请同时看手机屏幕是哪一页 —— 截图才是真值）");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "前台页判据", title: "用输入归属判断显示中的页面" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
