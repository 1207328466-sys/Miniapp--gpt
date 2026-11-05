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
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    for (let i = 1; i <= 3; i++) {
      fg = await base.foreground(page);
      if ((await base.pageText(fg)).includes("答题说明")) break;
      const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
      if (!(await btn.count())) break;
      await base.tapLocator(fg, btn, `去答题#${i}`);
      await base.sleep(3500);
    }
    page = await dump(page, "51_post_quiz_open");
    return page;
  }, null]], { meta: { title: "进入课后练习" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
