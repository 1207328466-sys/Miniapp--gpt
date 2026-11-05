const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    const dev = await base.getDevice();
    const rect = await fg.evaluate(() => {
      const v = document.querySelector(".eco-video-container") || document.querySelector("wx-video");
      if (!v) return null;
      const r = v.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, dpr: window.devicePixelRatio || 1 };
    });
    console.log("VIDEO_RECT", JSON.stringify(rect));
    if (!rect) return fg;
    for (let i = 0; i < 4; i++) {
      await dev.shell(`input tap ${Math.round(rect.x * rect.dpr)} ${Math.round(rect.y * rect.dpr)}`);
      await base.sleep(15000);
      fg = await base.foreground(page);
      const txt = await base.pageText(fg);
      const bar = await fg.evaluate(() => {
        const b = document.querySelector(".lesson-progress-bar");
        const t = document.querySelector(".lesson-progress-track");
        return b && t ? { bar: Math.round(b.getBoundingClientRect().width), track: Math.round(t.getBoundingClientRect().width) } : null;
      });
      console.log(`TAP${i + 1}: videoStageDone=${txt.includes("视频学习 已完成")} progress=${JSON.stringify(bar)}`);
      if (txt.includes("视频学习 已完成")) {
        fs.writeFileSync(path.join(OUT, "44_video_completed.txt"), txt, "utf8");
        await fg.screenshot({ path: path.join(OUT, "44_video_completed.png") }).catch(()=>{});
        break;
      }
    }
    fg = await base.foreground(page);
    fs.writeFileSync(path.join(OUT, "45_video_progress.txt"), await base.pageText(fg), "utf8");
    console.log("FINAL:", (await base.pageText(fg)).slice(0, 200));
    return fg;
  }, null]], { meta: { title: "视频学习播放" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
