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
    const btn = fg.locator(".action-card__btn").first();
    if (await btn.count()) { await base.tapLocator(fg, btn, "行动卡按钮"); await base.sleep(4500); }
    page = await dump(page, "60_practice_empty_page");
    fg = await base.foreground(page);
    const go = fg.locator("wx-view, wx-text").filter({ hasText: /^去提交实操$/ }).first();
    console.log("go count", await go.count());
    if (await go.count()) { await base.tapLocator(fg, go, "去提交实操"); await base.sleep(3500); }
    page = await dump(page, "61_practice_submit_popup");
    fg = await base.foreground(page);
    const cancel = fg.locator("wx-view, wx-text").filter({ hasText: /^取消$/ }).first();
    if (await cancel.count()) { await base.tapLocator(fg, cancel, "取消"); await base.sleep(2000); }
    page = await dump(page, "62_practice_canceled");
    return page;
  }, null]], { meta: { title: "实操空态与弹层" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
