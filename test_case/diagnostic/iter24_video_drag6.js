const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    const read = async () => {
      const f = await base.foreground(page);
      const t = await base.pageText(f);
      const m = t.match(/(\d{2}:\d{2})\s+(\d{2}:\d{2})/);
      return { t, time: m ? m[0] : "" };
    };
    const fg = await base.foreground(page);
    const rect = await fg.evaluate(() => {
      const v = document.querySelector(".eco-video-container");
      if (!v) return null;
      const b = v.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, dpr: window.devicePixelRatio || 1 };
    });
    let r = await read(); console.log("T0:", r.time);
    if (!rect) return fg;
    const dev = await base.getDevice();
    for (const frac of [0.90, 0.94]) {
      await dev.shell(`input tap ${Math.round((rect.x+rect.w/2)*rect.dpr)} ${Math.round((rect.y+rect.h/2)*rect.dpr)}`);
      await base.sleep(600);
      const y = Math.round((rect.y + rect.h*frac) * rect.dpr);
      const x1 = Math.round((rect.x + rect.w*0.25)*rect.dpr);
      const x2 = Math.round((rect.x + rect.w*0.75)*rect.dpr);
      console.log(`DRAG frac=${frac} y=${y}`);
      await dev.shell(`input swipe ${x1} ${y} ${x2} ${y} 1500`);
      await base.sleep(1800);
      r = await read();
      console.log("  ->", r.time);
      fs.writeFileSync(path.join(OUT, "87_video_drag_attempts.txt"), `frac=${frac} ${r.time}\n\n` + r.t, "utf8");
    }
    await (await base.foreground(page)).screenshot({ path: path.join(OUT, "87_video_drag_attempts.png") }).catch(()=>{});
    return fg;
  }, null]], { meta: { title: "视频拖动再试" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
