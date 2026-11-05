const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
const { goBack } = require("../../app_sub_function/suprecast_app/android");
async function dump(page, name) {
  const fg = await base.foreground(page);
  const txt = await base.pageText(fg);
  fs.writeFileSync(path.join(OUT, name + ".txt"), txt, "utf8");
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(()=>{});
  console.log(`\n== ${name} ==\n${txt.slice(0, 600)}`);
  return fg;
}
(async () => {
  await appTest([[async (page) => {
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
    await base.tapBottomTab(fg, "学习中心"); await base.sleep(3000);
    fg = await base.foreground(page);
    // 取第二个「训练营课程测试」卡片的中心
    const rect = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const hits = [];
      document.querySelectorAll("span, wx-text").forEach((el) => {
        if (norm(el.innerText) !== "训练营课程测试") return;
        const r = el.getBoundingClientRect();
        if (r.width > 0) hits.push([r.x + r.width / 2, r.y + r.height / 2]);
      });
      return hits;
    });
    console.log("HITS", JSON.stringify(rect));
    if (rect.length >= 2) {
      const [cx, cy] = rect[1];
      const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
      const dev = await base.getDevice();
      await dev.shell(`input tap ${Math.round(cx * dpr)} ${Math.round(cy * dpr)}`);
      await base.sleep(4000);
      page = await dump(page, "17_camp_unpurchased");
      page = await goBack(await base.foreground(page)); await base.sleep(2000);
    }
    // 我的 -> 课程
    fg = await base.foreground(page);
    await base.tapBottomTab(fg, "我的"); await base.sleep(3000);
    fg = await base.foreground(page);
    const tab = fg.locator("wx-view, wx-text").filter({ hasText: /^课程$/ }).first();
    if (await tab.count()) {
      await base.tapLocator(fg, tab, "我的-课程tab");
      await base.sleep(3000);
      page = await dump(page, "18_my_courses");
    } else {
      console.log("[WARN] 没找到我的-课程 tab");
    }
    page = await pages.qaPage.ensureOnHomeFeed(page);
    return page;
  }, null]], { meta: { title: "未购买训练营 + 我的课程" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
