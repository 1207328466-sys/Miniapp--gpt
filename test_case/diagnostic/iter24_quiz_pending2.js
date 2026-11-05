const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    const fg = await base.foreground(page);
    console.log("BEFORE:", (await base.pageText(fg)).slice(0, 120));
    const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
    console.log("btn count:", await btn.count());
    if ((await btn.count()) > 0) {
      await base.tapLocator(fg, btn, "去答题");
      await base.sleep(4500);
      const f2 = await base.foreground(page);
      const txt = await base.pageText(f2);
      fs.writeFileSync(path.join(OUT, "28_pre_quiz_pending.txt"), txt, "utf8");
      await f2.screenshot({ path: path.join(OUT, "28_pre_quiz_pending.png") }).catch(()=>{});
      console.log("AFTER:", txt.slice(0, 800));
      return f2;
    }
    return fg;
  }, null]], { meta: { title: "课前自测未提交态" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
