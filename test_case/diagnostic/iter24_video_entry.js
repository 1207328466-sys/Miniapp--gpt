const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    // 确保在学习中心
    if (!(await base.pageText(fg)).includes("训练营模式")) {
      await base.tapBottomTab(fg, "学习中心"); await base.sleep(3000);
      fg = await base.foreground(page);
    }
    // 切生产经验
    const tab = fg.locator("wx-view, wx-text").filter({ hasText: /^生产经验$/ }).first();
    if (await tab.count()) { await base.tapLocator(fg, tab, "生产经验"); await base.sleep(2500); }
    fg = await base.foreground(page);
    const card = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      let best = null;
      document.querySelectorAll("wx-view").forEach((el) => {
        const t = norm(el.innerText);
        if (!t.includes("压铸模具温控设计要点")) return;
        const r = el.getBoundingClientRect();
        if (r.width < 300 || r.height < 80 || r.height > 200) return;
        if (!best || r.height < best.h) best = { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      return best;
    });
    console.log("CARD:", JSON.stringify(card));
    if (!card) return fg;
    const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
    const dev = await base.getDevice();
    // 点封面（卡片左 1/4 处）
    await dev.shell(`input tap ${Math.round((card.x + card.w*0.18)*dpr)} ${Math.round((card.y + card.h/2)*dpr)}`);
    await base.sleep(4500);
    fg = await base.foreground(page);
    const t = await base.pageText(fg);
    console.log("AFTER_CARD:", t.slice(0, 160));
    fs.writeFileSync(path.join(OUT, "85_video_page_try.txt"), t, "utf8");
    return fg;
  }, null]], { meta: { title: "点封面进视频课" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
