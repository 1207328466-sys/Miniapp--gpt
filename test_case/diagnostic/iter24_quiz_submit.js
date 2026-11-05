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
  console.log(`\n== ${name} ==\n${txt.slice(0, 700)}`);
  return fg;
}
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    console.log("START:", (await base.pageText(fg)).slice(0, 80));
    // 退出再进：验"退出保存上次已选"
    page = await goBack(fg);
    await base.sleep(2500);
    fg = await base.foreground(page);
    const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
    if (await btn.count()) { await base.tapLocator(fg, btn, "去答题"); await base.sleep(4000); }
    page = await dump(page, "29_quiz_reenter_persist");
    // 作答剩余两题
    fg = await base.foreground(page);
    for (const opt of ["产品结构", "正确"]) {
      const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${opt}$`) }).first();
      if (await loc.count()) { await base.tapLocator(fg, loc, opt); await base.sleep(900); fg = await base.foreground(page); }
    }
    page = await dump(page, "30_quiz_answered");
    const sub = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).first();
    if (await sub.count()) { await base.tapLocator(fg, sub, "提交"); await base.sleep(4000); }
    page = await dump(page, "31_quiz_result");
    return page;
  }, null]], { meta: { title: "自测保存与提交" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
