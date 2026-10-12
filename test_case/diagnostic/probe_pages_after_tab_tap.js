/*
 * 诊断（不以 test_ 开头，pytest 不收集）：底部 tab 点击之后，框架"看见"的是哪一页？
 *
 * 已知事实（2026/10/12）：
 *   · 手机停在**案例库**时，框架的「回到首页」报「点底部 tab 后没有进入有问必答页（未出现 .search-container）」
 *   · 但**手动** `adb shell input tap 122 2463` 能正常切到有问必答 —— 点击坐标没问题
 * 所以怀疑：点击其实生效了，是框架**前台页解析**认了旧的那一页（坑 19/22 的老毛病）。
 *
 * 做法：把小程序 context 里的每一页都列出来（谁是首页信息流 / 谁是案例库 / 有没有底部 tab 栏），
 * 执行一次「回到首页」，再列一遍 —— 对比前后两次，就能看出"到底切没切、框架看的是谁"。
 *
 * 只读：只导航 + 读 DOM。
 * 运行：node test_case/diagnostic/probe_pages_after_tab_tap.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;
const caseLibrary = pages.caseLibrary;

/** 把 context 里每一页都描述一遍 */
async function dumpPages(page, label) {
  const ctxPages = page.context().pages();
  console.log("\n===== %s（共 %d 页）=====", label, ctxPages.length);
  for (let i = 0; i < ctxPages.length; i++) {
    const p = ctxPages[i];
    let info;
    try {
      info = await p.evaluate(() => {
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const q = (sel) => document.querySelectorAll(sel).length;
        return {
          hasFeed: q(".search-container") > 0,
          hasCases: q(".cases-page") > 0,
          tabBar: q('[class*="custom-tab-bar"]'),
          tabTexts: ["有问必答", "学习中心", "设计专区", "我的"].filter((t) => norm(document.body.innerText).includes(t)),
          head: norm(document.body.innerText).slice(0, 40),
        };
      });
    } catch (e) {
      info = { err: e.message.split("\n")[0] };
    }
    console.log(
      "  #%d 首页信息流=%s 案例库=%s 底部tab栏=%s tab文案=%s | 开头: %s",
      i,
      info.hasFeed,
      info.hasCases,
      info.tabBar,
      JSON.stringify(info.tabTexts),
      JSON.stringify(info.head || info.err || "")
    );
  }
  const fg = await base.foreground(page);
  const fgIdx = ctxPages.indexOf(fg);
  console.log("  框架认为的「前台页」= #%d", fgIdx);
  return fgIdx;
}

async function probe(page) {
  // 【先看再动】不先导航 —— 直接看框架此刻认的是哪一页（屏幕上是什么，用截图对照）
  await dumpPages(page, "① 开局：框架此刻认的页面");

  page = await qaPage.ensureOnHomeFeed(page);
  page = await caseLibrary.ensureOn(page);
  await base.sleep(1200);
  await dumpPages(page, "② 停在案例库之后");

  console.log("\n===== 执行「回到首页」 =====");
  let err = "";
  try {
    page = await qaPage.ensureOnHomeFeed(page);
  } catch (e) {
    err = e.message;
  }
  if (err) console.log("  报错：%s", err.split("\n")[0]);
  await dumpPages(page, "③ 回到首页之后");

  // 直接再点一次底部 tab（绕过框架的解析），看页面本身能不能切
  console.log("\n===== 直接 adb 点一次底部「有问必答」(122,2463) =====");
  const device = await base.getDevice();
  await device.shell("input tap 122 2463");
  await base.sleep(2500);
  await dumpPages(page, "④ 手动点一次之后");

  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "前台页解析", title: "底部 tab 点击后框架看见的是哪一页" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
