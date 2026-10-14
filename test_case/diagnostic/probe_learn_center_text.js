/*
 * 诊断（不以 test_ 开头，pytest 不收集）：owner 的表格用例 ZW_029 第 3 步
 * 「点文字 学习中心」点完之后停在了「互动专栏」详情页 —— 想搞清它到底点到了什么。
 *
 * 要问三件事（都只读）：
 *   ① 首页（滚动 3 屏之后）上有没有「学习中心」这段文字？命中几个、分别是哪几个元素？
 *   ② 底部 tab 栏里的「学习中心」在 DOM 里排第几？（getByText 取的是**第一个**命中）
 *   ③ 不滚动 vs 滚动 3 屏，命中顺序会不会变？
 *
 * 运行：node test_case/diagnostic/probe_learn_center_text.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

/** 把「命中『学习中心』的元素」按 DOM 顺序打出来（class / 是否在底部 tab 栏里 / 坐标） */
async function dumpMatches(page, label) {
  const fg = await base.foreground(page);
  const info = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = { hits: [], counts: {} };
    const all = Array.from(document.querySelectorAll("*"));
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const t = norm(el.innerText);
      if (t !== "学习中心") continue; // 只挑"就是这四个字"的元素，跟点文字的口径接近
      const r = el.getBoundingClientRect();
      const inBottomBar = !!el.closest('[class*="tabbar"], [class*="tab-bar"], [class*="bottom"], [class*="h5-tabbar"]');
      out.hits.push({
        domIndex: i,
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") || "").slice(0, 70),
        inBottomBar,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      });
      if (out.hits.length >= 12) break;
    }
    out.counts.text = (document.body.innerText || "").split("学习中心").length - 1;
    return out;
  });
  console.log("\n[%s] 页面里「学习中心」出现 %d 次；「整个元素就是这四个字」的命中 %d 个：",
    label, info.counts.text, info.hits.length);
  info.hits.forEach((h) =>
    console.log("   DOM第%d个 <%s class=%s> 底部tab栏里=%s rect=%s",
      h.domIndex, h.tag, h.cls, h.inBottomBar, h.rect.join(","))
  );
  return info;
}

async function probe(page) {
  page = await qa.ensureOnHomeFeed(page);
  await dumpMatches(page, "滚动之前");

  const { swipeUp } = require("../../app_sub_function/suprecast_app/android");
  for (let i = 1; i <= 3; i++) {
    page = await swipeUp(page);
    await base.sleep(700);
  }
  await dumpMatches(page, "向下滑 3 次之后");

  // ---- 复现 owner 的 ZW_029 前 3 步：滑 3 屏 -> 点文字「学习中心」-> 看到底停在哪 ----
  const learnCenter = pages.learnCenter;
  const before = await base.pageText(await base.foreground(page));
  await base.tapText(await base.foreground(page), "学习中心", "「学习中心」");
  await base.sleep(2500);
  const fg = await base.foreground(page);
  const after = await base.pageText(fg);
  const onLearnCenter = await learnCenter.isOn(fg);
  const onColumnList = await learnCenter.isOnColumnList(fg);
  const cards = await base.countOf(fg, ".column-card");
  const columnDetail = pages.columnDetail;
  console.log("\n[点了「学习中心」之后]");
  console.log("  在学习中心页(isOn)=%s | 在专栏列表页(isOnColumnList)=%s | .column-card=%d",
    onLearnCenter, onColumnList, cards);
  console.log("  页面标题行附近 120 字: %s", JSON.stringify(after.slice(0, 120)));
  console.log("  （滚动前 页面前 60 字: %s）", JSON.stringify(before.slice(0, 60)));
  if (typeof columnDetail.isOn === "function") {
    console.log("  在专栏详情页=%s", await columnDetail.isOn(fg).catch(() => "判不出"));
  }
  // 收尾：把手机交回到首页
  page = await qa.ensureOnHomeFeed(page);
  return page;
}

appTest([[probe, null]], { photosPath: null }).catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
