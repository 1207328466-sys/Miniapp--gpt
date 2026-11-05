const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    const deadline = Date.now() + 10 * 60 * 1000;
    let last = "";
    while (Date.now() < deadline) {
      const fg = await base.foreground(page);
      const txt = await base.pageText(fg);
      const m = txt.match(/(\d{2}:\d{2})\s+(\d{2}:\d{2})/);
      const head = m ? `${m[1]}/${m[2]}` : "?";
      if (head !== last) { console.log(`[${new Date().toISOString().slice(11,19)}] ${head} stageDone=${txt.includes("视频学习 已完成")}`); last = head; }
      if (txt.includes("视频学习 已完成")) {
        fs.writeFileSync(path.join(OUT, "46_video_finished.txt"), txt, "utf8");
        await fg.screenshot({ path: path.join(OUT, "46_video_finished.png") }).catch(()=>{});
        console.log("VIDEO DONE"); return fg;
      }
      await base.sleep(15000);
    }
    const fg = await base.foreground(page);
    console.log("TIMEOUT:", (await base.pageText(fg)).slice(0, 200));
    return fg;
  }, null]], { meta: { title: "等待视频播完" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
