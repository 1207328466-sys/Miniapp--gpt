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
    let fg = await base.foreground(page);
    const rect = await fg.evaluate(() => {
      const v = document.querySelector(".eco-video-container");
      if (!v) return null;
      const b = v.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, dpr: window.devicePixelRatio || 1 };
    });
    console.log("RECT:", JSON.stringify(rect));
    let r = await read();
    console.log("T0:", r.time);
    const dev = await base.getDevice();
    if (!rect) return fg;
    // 显示控件（点视频中心）
    await dev.shell(`input tap ${Math.round((rect.x+rect.w/2)*rect.dpr)} ${Math.round((rect.y+rect.h/2)*rect.dpr)}`);
    await base.sleep(1200);
    const y = Math.round((rect.y + rect.h - 4) * rect.dpr);
    const x1 = Math.round((rect.x + rect.w*0.2) * rect.dpr);
    const x2 = Math.round((rect.x + rect.w*0.8) * rect.dpr);
    console.log(`DRAG ${x1},${y} -> ${x2},${y}`);
    await dev.shell(`input swipe ${x1} ${y} ${x2} ${y} 1000`);
    await base.sleep(2000);
    r = await read();
    console.log("T1(after drag):", r.time);
    fs.writeFileSync(path.join(OUT, "86_video_drag_evidence.txt"), `T0=${r.time}\n\n` + r.t, "utf8");
    await (await base.foreground(page)).screenshot({ path: path.join(OUT, "86_video_drag_evidence.png") }).catch(()=>{});
    return fg;
  }, null]], { meta: { title: "视频课程拖动验证" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
