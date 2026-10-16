/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**"软键盘开着吗"到底该看哪个字段？**
 *
 * 【为什么问】2026/10/16 查"为什么跑得这么慢"时发现：真机上键盘**没弹出来**，
 * `dumpsys input_method` 却写着 `mIsInputViewShown=true` —— 而框架的 `isKeyboardShown()`
 * 认的就是这两个字段的**或**。于是"键盘开着就跳过 ESC 探针"这道闸门**一直在误判**，
 * 把「输入归属」（最便宜、最硬的判据）整个关掉了，只剩"并行 RAF 探测 500ms + 单候选复核 1200ms"
 * 那条贵路径 —— 实测单次解析 1.79 秒、一次「回到首页」12.5 秒。
 *
 * 这个探针把两种情况下的字段都打出来（键盘没开 / 真把输入框点开），拿到对照再改判据。
 *
 * 只读（会进搜索页、点一下输入框、再按 ESC 收键盘，最后回首页）：不改任何数据。
 * 运行：node test_case/diagnostic/probe_ime_fields.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");

const base = pages.base;
const qaPage = pages.qaPage;

const FIELDS = ["mInputShown", "mIsInputViewShown", "mImeWindowVis", "mWindowVisible", "mShowRequested"];

async function readFields(device, label) {
  const out = await device.shell("dumpsys input_method").catch(() => "");
  const s = String(out);
  const got = {};
  for (const f of FIELDS) {
    const m = new RegExp(f + "=([^\\s]+)").exec(s);
    got[f] = m ? m[1] : "(没有)";
  }
  console.log(`[${label}] ` + FIELDS.map((f) => `${f}=${got[f]}`).join("  "));
  return got;
}

async function probe(page) {
  const device = await getDevice();
  await readFields(device, "① 现在（首页，键盘应当是关的）");

  // ② 进搜索页并点开输入框 → 键盘应该真的弹出来
  page = await qaPage.openSearch(page);
  const fg = await base.foreground(page);
  await base.tapSelector(fg, qaPage.SEL.searchInput, "搜索输入框");
  await base.sleep(1500);
  await readFields(device, "② 点开输入框之后（键盘应当是开的）");

  // ③ 发一次 ESC 收键盘，再读一遍（确认"收起来"之后那几个字段怎么变）
  await device.shell("input keyevent 111");
  await base.sleep(1200);
  await readFields(device, "③ 发过 ESC 之后（键盘应当是关的）");

  // 收尾：回首页，别把手机留在搜索页
  page = await qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "性能", title: "软键盘状态该看哪个字段" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
