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
    const input = fg.locator("wx-input, input").last();
    console.log("inputs:", await fg.locator("wx-input, input").count());
    if (await input.count()) { await base.tapLocator(fg, input, "评论输入框"); await base.sleep(1200); }
    const dev = await base.getDevice();
    await dev.shell("input text iter24-auto-test");
    await base.sleep(1200);
    page = await dump(page, "79_review_typed");
    fg = await base.foreground(page);
    const send = fg.locator("wx-view, wx-text").filter({ hasText: /^(发送|发布|评论)$/ }).last();
    console.log("send count:", await send.count());
    if (await send.count()) { await base.tapLocator(fg, send, "发送"); await base.sleep(4000); }
    page = await dump(page, "80_review_after_post");
    fg = await base.foreground(page);
    const reply = await fg.evaluate(() => Array.from(document.querySelectorAll("wx-view, wx-text")).filter((e) => String(e.innerText||"").trim() === "回复").length);
    console.log("REPLY_BUTTONS:", reply);
    return fg;
  }, null]], { meta: { title: "发表课程评论" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
