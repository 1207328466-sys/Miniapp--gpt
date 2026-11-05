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
  console.log(`\n== ${name} ==\n${txt.slice(0, 500)}`);
  return fg;
}
async function tapBtn(page, word) {
  const fg = await base.foreground(page);
  const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${word}$`) }).last();
  if (!(await loc.count())) throw new Error("找不到按钮 " + word);
  await base.tapLocator(fg, loc, word); await base.sleep(4000);
  return base.foreground(page);
}
async function answerPlan(page, plan) {
  for (let qi = 0; qi < plan.length; qi++) {
    for (const letter of plan[qi]) {
      const fg = await base.foreground(page);
      const group = fg.locator(".cq-options").nth(qi);
      if (!(await group.count())) return page;
      const opt = group.locator(".cq-option").filter({ has: fg.locator(".cq-option__badge", { hasText: new RegExp(`^${letter}$`) }) }).first();
      if (await opt.count()) { await base.tapLocator(fg, opt, `Q${qi+1}${letter}`); await base.sleep(700); }
    }
  }
  return base.foreground(page);
}
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    if (!(await base.pageText(fg)).includes("当前环节")) { page = await goBack(fg); await base.sleep(2500); }
    page = await dump(page, "47_course_after_video");
    page = await tapBtn(page, "去答题");
    page = await dump(page, "48_post_quiz_before");
    page = await answerPlan(page, [["A"], ["A","B","D"], ["B"]]);
    page = await dump(page, "49_post_quiz_answered");
    fg = await base.foreground(page);
    const sub = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).first();
    if (await sub.count()) { await base.tapLocator(fg, sub, "提交"); await base.sleep(4500); }
    page = await dump(page, "50_post_quiz_result");
    return page;
  }, null]], { meta: { title: "课后练习作答" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
