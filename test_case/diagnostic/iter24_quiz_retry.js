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
    const retry = fg.locator("wx-view, wx-text").filter({ hasText: /^重新作答$/ }).first();
    if (await retry.count()) { await base.tapLocator(fg, retry, "重新作答"); await base.sleep(3500); }
    page = await dump(page, "35_quiz_retry");
    fg = await base.foreground(page);
    const backBtn = fg.locator("wx-view, wx-text").filter({ hasText: /^返回课程$/ }).first();
    if (await backBtn.count()) { await base.tapLocator(fg, backBtn, "返回课程"); await base.sleep(3500); }
    page = await dump(page, "36_quiz_back_course");
    return page;
  }, null]], { meta: { title: "重新作答/返回课程" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
