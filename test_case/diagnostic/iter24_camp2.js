const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
    await base.tapBottomTab(fg, "学习中心"); await base.sleep(3000);
    fg = await base.foreground(page);
    const box = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const hits = [];
      document.querySelectorAll("span, wx-text").forEach((el) => {
        if (norm(el.innerText) !== "训练营课程测试") return;
        const r = el.getBoundingClientRect();
        if (r.width > 0) hits.push([r.x + r.width / 2, r.y + r.height / 2]);
      });
      return hits;
    });
    console.log("HITS", JSON.stringify(box));
    if (box.length >= 2) {
      const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
      const dev = await base.getDevice();
      await dev.shell(`input tap ${Math.round(box[1][0]*dpr)} ${Math.round(box[1][1]*dpr)}`);
      await base.sleep(4500);
      fg = await base.foreground(page);
      const txt = await base.pageText(fg);
      fs.writeFileSync(path.join(OUT, "20_camp_second_detail.txt"), txt, "utf8");
      await fg.screenshot({ path: path.join(OUT, "20_camp_second_detail.png") }).catch(()=>{});
      console.log("TEXT:", txt.slice(0, 700));
    }
    return fg;
  }, null]], { meta: { title: "第二个训练营（未购买）" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
