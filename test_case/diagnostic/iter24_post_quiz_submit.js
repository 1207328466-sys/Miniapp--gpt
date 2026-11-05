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
  console.log(`\n== ${name} ==\n${txt.slice(0, 400)}`);
  return fg;
}
async function ans(page, qi, letter) {
  const fg = await base.foreground(page);
  const g = fg.locator(".cq-options").nth(qi);
  if (!(await g.count())) return page;
  const opt = g.locator(".cq-option").filter({ has: fg.locator(".cq-option__badge", { hasText: new RegExp(`^${letter}$`) }) }).first();
  if (await opt.count()) { await base.tapLocator(fg, opt, `Q${qi+1}${letter}`); await base.sleep(700); }
  return base.foreground(page);
}
(async () => {
  await appTest([[async (page) => {
    page = await ans(page, 1, "A"); page = await ans(page, 1, "B"); page = await ans(page, 1, "D");
    page = await ans(page, 2, "B");
    page = await dump(page, "52_post_quiz_all_answered");
    const fg = await base.foreground(page);
    const sub = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).first();
    if (await sub.count()) { await base.tapLocator(fg, sub, "提交"); await base.sleep(4500); }
    page = await dump(page, "53_post_quiz_result");
    return page;
  }, null]], { meta: { title: "课后练习提交" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
