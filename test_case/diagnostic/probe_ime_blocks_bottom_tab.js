/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**软键盘挡着底部 tab 时，「回到首页」还能不能走通？**
 *
 * 背景（2026/10/12 真机踩到的一次红）：
 *   手机停在搜索页、**软键盘弹着**（上一步输入过字 / 有人手动点过），这时「回到首页」去点底部 tab ——
 *   坐标落在**键盘**上，adb 照样"执行成功"，页面一动不动，最后报
 *   「点击底部 tab「有问必答」后没有进入有问必答页」—— 看着像导航坏了，其实是键盘吃了这一下。
 *   ⚠️ 命中测试（坑 25 那道护栏）也抓不到：软键盘是**原生窗口**，不在页面 DOM 里。
 *
 * 做法（构造那个状态，再验证修好没有）：
 *   1. 打开搜索页 → 输入关键词（这会让软键盘弹起来）
 *   2. 从系统层确认 `mInputShown=true`（否则这次测不出东西，记跳过）
 *   3. 调「回到首页」—— 期望它成功（内部会先收起键盘）
 *   4. 断言：前台页确实是首页信息流（能看到四个筛选 tab）
 *
 * 只读：只打字 + 导航，不改数据（搜索是只读查询）。
 * 运行：node test_case/diagnostic/probe_ime_blocks_bottom_tab.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

async function imeShown() {
  const device = await base.getDevice();
  const out = String(await device.shell("dumpsys input_method").catch(() => ""));
  return /mInputShown=true|mIsInputViewShown=true/.test(out);
}

async function probe(page) {
  page = await qaPage.ensureOnHomeFeed(page);

  // 1) 打开搜索页并输入 —— 软键盘会弹起来
  page = await qaPage.openSearch(page);
  page = await qaPage.typeKeyword(page, { keyword: "aaa" });
  await base.sleep(1200);

  const shown = await imeShown();
  console.log("\n软键盘现在开着吗：%s", shown ? "是" : "否");
  if (!shown) {
    const e = new Error("没构造出「软键盘开着」的状态（可能输入方式不触发输入法）—— 这一步测不了");
    e.preconditionNotMet = true;
    throw e;
  }

  // 2) 关键一步：带着软键盘回首页
  console.log("\n=== 带着软键盘执行「回到首页」 ===");
  page = await qaPage.ensureOnHomeFeed(page);

  const text = await base.pageText(await base.foreground(page));
  const tabsOk = /最新提问/.test(text) && /推荐/.test(text);
  console.log("  回到首页后的页面文字开头: %s", JSON.stringify(text.slice(0, 60)));
  if (!tabsOk) {
    throw new Error(
      "带着软键盘回首页之后，前台页不是首页信息流（看不到筛选 tab）——键盘这一下还是被吃掉了。\n" +
        `  当前页面前 120 字: ${JSON.stringify(text.slice(0, 120))}`
    );
  }

  const after = await imeShown();
  console.log("  软键盘现在开着吗：%s", after ? "是" : "否（已被收起）");
  console.log("\n✅ 通过：软键盘开着的时候，「回到首页」也能走通");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "回到首页", title: "软键盘挡着底部 tab 时回到首页" },
  });
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
