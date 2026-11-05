const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
async function txt(page){return base.pageText(await base.foreground(page));}
async function tapWord(page, word, last=true){
  const fg = await base.foreground(page);
  const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${word}$`) })[last?"last":"first"]();
  if (!(await loc.count())) throw new Error("no "+word);
  await base.tapLocator(fg, loc, word); await base.sleep(2500);
  return base.foreground(page);
}
async function ans(page, qi, letter){
  const fg = await base.foreground(page);
  const g = fg.locator(".cq-options").nth(qi);
  if (!(await g.count())) return page;
  const opt = g.locator(".cq-option").filter({ has: fg.locator(".cq-option__badge", { hasText: new RegExp(`^${letter}$`) }) }).first();
  if (await opt.count()) {
    const cls = await opt.getAttribute("class").catch(()=> "");
    console.log(`Q${qi+1}${letter} before=${cls}`);
    await base.tapLocator(fg, opt, `Q${qi+1}${letter}`);
    await base.sleep(900);
    const cls2 = await opt.getAttribute("class").catch(()=> "");
    console.log(`Q${qi+1}${letter} after=${cls2}`);
  }
  return base.foreground(page);
}
(async () => {
  await appTest([[async (page) => {
    let t = await txt(page);
    if (t.includes("重新作答")) page = await tapWord(page, "重新作答");
    t = await txt(page);
    console.log("QUIZ:", t.slice(0, 80));
    page = await ans(page, 0, "A");
    page = await ans(page, 1, "A"); page = await ans(page, 1, "B"); page = await ans(page, 1, "D");
    page = await ans(page, 2, "B");
    const fg = await base.foreground(page);
    const t2 = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "54_post_quiz_retry_answered.txt"), t2, "utf8");
    console.log("ANSWERED:", t2.slice(0, 260));
    const sub = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).first();
    if (await sub.count()) { await base.tapLocator(fg, sub, "提交"); await base.sleep(4500); }
    const t3 = await base.pageText(await base.foreground(page));
    fs.writeFileSync(path.join(OUT, "55_post_quiz_retry_result.txt"), t3, "utf8");
    console.log("RESULT:", t3.slice(-220));
    return base.foreground(page);
  }, null]], { meta: { title: "课后练习重做" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
