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
async function tapWord(page, word, last=false) {
  const fg = await base.foreground(page);
  const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${word}$`) })[last?"last":"first"]();
  if (!(await loc.count())) throw new Error("no "+word);
  await base.tapLocator(fg, loc, word); await base.sleep(4000);
  return base.foreground(page);
}
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    if ((await base.pageText(fg)).includes("返回课程")) page = await tapWord(page, "返回课程");
    page = await dump(page, "56_course_after_post_quiz");
    // 行动卡现在应是「去提交」（课后实操）
    fg = await base.foreground(page);
    let t = await base.pageText(fg);
    if (!t.includes("课后实操 进行中")) {
      const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^(去提交|去答题|视频学习)$/ }).last();
      if (await btn.count()) { await base.tapLocator(fg, btn, "行动卡"); await base.sleep(3500); }
    }
    page = await dump(page, "57_practice_page");
    fg = await base.foreground(page);
    t = await base.pageText(fg);
    const go = fg.locator("wx-view, wx-text").filter({ hasText: /^去提交实操$/ }).first();
    if (await go.count()) { await base.tapLocator(fg, go, "去提交实操"); await base.sleep(3500); }
    page = await dump(page, "58_practice_submit_popup");
    fg = await base.foreground(page);
    const cancel = fg.locator("wx-view, wx-text").filter({ hasText: /^取消$/ }).first();
    if (await cancel.count()) { await base.tapLocator(fg, cancel, "取消"); await base.sleep(2000); }
    page = await dump(page, "59_practice_after_cancel");
    return page;
  }, null]], { meta: { title: "课后实操空态/提交弹层" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
