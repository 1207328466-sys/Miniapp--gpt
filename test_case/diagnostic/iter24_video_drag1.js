const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
async function dump(page, name) {
  const fg = await base.foreground(page);
  const txt = await base.pageText(fg);
  fs.writeFileSync(path.join(OUT, name + ".txt"), txt, "utf8");
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(()=>{});
  console.log(`\n== ${name} ==\n${txt.slice(0, 400)}`);
  return fg;
}
(async () => {
  await appTest([[async (page) => {
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
    page = await pages.userCenter.switchTo(page);
    await base.sleep(1200);
    fg = await base.foreground(page);
    const tab = fg.locator("wx-view, wx-text").filter({ hasText: /^课程$/ }).first();
    if (await tab.count()) { await base.tapLocator(fg, tab, "课程tab"); await base.sleep(2500); }
    fg = await base.foreground(page);
    await base.tapText(fg, "压铸模具温控设计要点", "视频课程"); await base.sleep(4000);
    fg = await base.foreground(page);
    const lesson = fg.locator("wx-view, wx-text").filter({ hasText: /^第1课/ }).last();
    console.log("lesson count", await lesson.count());
    if (await lesson.count()) { await base.tapLocator(fg, lesson, "第1课"); await base.sleep(4500); }
    page = await dump(page, "81_video_learn_page");
    return page;
  }, null]], { meta: { title: "已购视频课程学习页" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
