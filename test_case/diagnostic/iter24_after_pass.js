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
  console.log(`\n== ${name} ==\n${txt.slice(0, 500)}`);
  return fg;
}
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    const back = fg.locator("wx-view, wx-text").filter({ hasText: /^返回课程$/ }).first();
    if (await back.count()) { await base.tapLocator(fg, back, "返回课程"); await base.sleep(4500); }
    page = await dump(page, "42_course_after_pass");
    return page;
  }, null]], { meta: { title: "通过后返回课程" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
