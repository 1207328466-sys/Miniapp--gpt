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
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
    const home = await base.pageText(fg);
    console.log("HOME_HAS_榜单:", home.includes("榜单"));
    await base.tapBottomTab(fg, "我的"); await base.sleep(3000);
    fg = await base.foreground(page);
    const msg = fg.locator("wx-view, wx-text").filter({ hasText: /^消息$/ }).first();
    if (await msg.count()) { await base.tapLocator(fg, msg, "消息tab"); await base.sleep(3000); }
    page = await dump(page, "19_messages");
    page = await pages.qaPage.ensureOnHomeFeed(page);
    return page;
  }, null]], { meta: { title: "消息/榜单入口" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
