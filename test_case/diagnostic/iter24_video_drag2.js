const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    console.log("START:", (await base.pageText(fg)).slice(0, 60));
    await base.tapText(fg, "压铸模具温控设计要点", "视频课程"); await base.sleep(4000);
    fg = await base.foreground(page);
    console.log("DETAIL:", (await base.pageText(fg)).slice(0, 160));
    const lesson = fg.locator("wx-view, wx-text").filter({ hasText: /^第1课/ }).last();
    console.log("lesson count", await lesson.count());
    if (await lesson.count()) { await base.tapLocator(fg, lesson, "第1课"); await base.sleep(4500); }
    fg = await base.foreground(page);
    const txt = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "81_video_learn_page.txt"), txt, "utf8");
    await fg.screenshot({ path: path.join(OUT, "81_video_learn_page.png") }).catch(()=>{});
    console.log("LEARN:", txt.slice(0, 300));
    return fg;
  }, null]], { meta: { title: "视频学习页2" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
