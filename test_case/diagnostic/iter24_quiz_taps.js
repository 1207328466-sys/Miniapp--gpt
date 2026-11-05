const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    for (let i = 1; i <= 3; i++) {
      fg = await base.foreground(page);
      const txt0 = await base.pageText(fg);
      if (txt0.includes("答题说明")) { console.log("already in quiz"); break; }
      const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
      if (!(await btn.count())) { console.log("no 去答题 on tap", i); break; }
      await base.tapLocator(fg, btn, `去答题#${i}`);
      await base.sleep(3500);
      fg = await base.foreground(page);
      const txt = await base.pageText(fg);
      console.log(`TAP ${i} -> inQuiz=${txt.includes("答题说明")} head=${txt.slice(0, 60)}`);
      if (txt.includes("答题说明")) {
        fs.writeFileSync(path.join(OUT, "32_quiz_enter_after_n.txt"), `进入答题页需要点 ${i} 次\n\n` + txt, "utf8");
        await fg.screenshot({ path: path.join(OUT, "32_quiz_enter_after_n.png") }).catch(()=>{});
        break;
      }
    }
    return fg;
  }, null]], { meta: { title: "去答题点击次数" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
