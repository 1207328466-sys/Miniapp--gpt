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
  console.log(`\n== ${name} ==\n${txt.slice(0, 600)}`);
  return fg;
}
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    console.log("START:", (await base.pageText(fg)).slice(0, 70));
    for (const opt of ["产品结构", "正确"]) {
      fg = await base.foreground(page);
      const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${opt}$`) }).first();
      if (await loc.count()) { await base.tapLocator(fg, loc, opt); await base.sleep(1000); }
    }
    page = await dump(page, "33_quiz_all_answered");
    fg = await base.foreground(page);
    const sub = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).first();
    if (await sub.count()) { await base.tapLocator(fg, sub, "提交"); await base.sleep(4000); }
    page = await dump(page, "34_quiz_submit_result");
    return page;
  }, null]], { meta: { title: "自测作答与提交" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
