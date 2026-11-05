const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    // 回首页 -> 我的 -> 课程
    page = await pages.qaPage.ensureOnHomeFeed(page);
    page = await pages.userCenter.switchTo(page); await base.sleep(1500);
    fg = await base.foreground(page);
    const tab = fg.locator("wx-view, wx-text").filter({ hasText: /^课程$/ }).first();
    if (await tab.count()) { await base.tapLocator(fg, tab, "课程tab"); await base.sleep(2500); }
    fg = await base.foreground(page);
    const t = await base.pageText(fg);
    console.log("LIST:", t.slice(0, 300));
    // 找「训练营课程测试1」卡片封面
    const card = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      let best = null;
      document.querySelectorAll("wx-view").forEach((el) => {
        const txt = norm(el.innerText);
        if (!txt.includes("训练营课程测试1")) return;
        const r = el.getBoundingClientRect();
        if (r.width < 300 || r.height < 60 || r.height > 200) return;
        if (!best || r.height < best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      return best;
    });
    console.log("CARD:", JSON.stringify(card));
    if (!card) return fg;
    const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
    const dev = await base.getDevice();
    await dev.shell(`input tap ${Math.round((card.x+card.w*0.18)*dpr)} ${Math.round((card.y+card.h/2)*dpr)}`);
    await base.sleep(4500);
    fg = await base.foreground(page);
    const t2 = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "88_camp1_learn.txt"), t2, "utf8");
    await fg.screenshot({ path: path.join(OUT, "88_camp1_learn.png") }).catch(()=>{});
    console.log("PAGE:", t2.slice(0, 260));
    return fg;
  }, null]], { meta: { title: "训练营未看视频样本" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
