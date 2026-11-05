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
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
    await base.tapBottomTab(fg, "学习中心"); await base.sleep(3000);
    fg = await base.foreground(page);
    await base.tapText(fg, "产品分型面的设计原则123", "视频课程"); await base.sleep(4000);
    page = await dump(page, "76_video_unpurchased");
    fg = await base.foreground(page);
    const buy = fg.locator("wx-view, wx-text").filter({ hasText: /^购买视频课程/ }).first();
    if (await buy.count()) { await base.tapLocator(fg, buy, "购买视频课程"); await base.sleep(3500); }
    page = await dump(page, "77_purchase_protocol");
    return page;
  }, null]], { meta: { title: "购买协议弹层" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
