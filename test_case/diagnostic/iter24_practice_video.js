const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
const { goBack } = require("../../app_sub_function/suprecast_app/android");
async function dump(page, name) {
  const fg = await base.foreground(page);
  const txt = await base.pageText(fg);
  fs.writeFileSync(path.join(OUT, name + ".txt"), txt, "utf8");
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(()=>{});
  console.log(`\n== ${name} ==\n${txt.slice(0, 600)}`);
  return fg;
}
async function tapWord(page, word) {
  const fg = await base.foreground(page);
  const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${word}$`) }).first();
  if (!(await loc.count())) throw new Error("找不到 " + word);
  await base.tapLocator(fg, loc, word);
  await base.sleep(4000);
  return base.foreground(page);
}
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    console.log("START:", (await base.pageText(fg)).slice(0, 60));
    page = await goBack(fg); await base.sleep(2500);
    page = await tapWord(page, "课后实操"); page = await dump(page, "37_practice_empty");
    page = await goBack(await base.foreground(page)); await base.sleep(2500);
    page = await tapWord(page, "视频学习"); page = await dump(page, "38_video_pending");
    return page;
  }, null]], { meta: { title: "实操空态/视频学习" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
