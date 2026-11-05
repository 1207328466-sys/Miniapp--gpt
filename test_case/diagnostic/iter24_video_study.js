const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^视频学习$/ }).last();
    if (await btn.count()) { await base.tapLocator(fg, btn, "视频学习"); await base.sleep(4500); }
    fg = await base.foreground(page);
    const txt = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "43_video_study_page.txt"), txt, "utf8");
    await fg.screenshot({ path: path.join(OUT, "43_video_study_page.png") }).catch(()=>{});
    console.log("TEXT:", txt.slice(0, 700));
    const dom = await fg.evaluate(() => {
      const out = [];
      document.querySelectorAll("wx-video, video, wx-view").forEach((el) => {
        const c = String(el.getAttribute("class") || "");
        if (!/video|player|duration|progress/i.test(c)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 5) return;
        out.push({ tag: el.tagName.toLowerCase(), cls: c.slice(0, 50), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      });
      return out.slice(0, 12);
    });
    console.log("VIDEO_DOM:", JSON.stringify(dom));
    return fg;
  }, null]], { meta: { title: "视频学习页" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
