const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    // 回学习中心 -> 第一个训练营
    if (!(await base.pageText(fg)).includes("学习证书")) {
      await base.tapBottomTab(fg, "学习中心"); await base.sleep(2500);
      fg = await base.foreground(page);
      await base.tapText(fg, "训练营课程测试", "训练营课程测试"); await base.sleep(3500);
      fg = await base.foreground(page);
    }
    const loc = fg.locator("wx-view, wx-text").filter({ hasText: /^课前自测$/ }).first();
    const info = await loc.evaluate((el) => {
      function clickable(n){ let c=n; for(let i=0;i<6&&c;i++){ const cls=String(c.getAttribute&&c.getAttribute("class")||""); if(/stage|lesson|action|cell|row/i.test(cls)) return c; c=c.parentElement;} return n; }
      const t = clickable(el);
      const r = t.getBoundingClientRect();
      return { cls: String(t.getAttribute("class")||""), rect:[r.x,r.y,r.width,r.height] };
    });
    console.log("TARGET", JSON.stringify(info));
    await base.tapLocator(fg, loc, "课前自测");
    await base.sleep(4500);
    fg = await base.foreground(page);
    const txt = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "16_pre_quiz.txt"), txt, "utf8");
    await fg.screenshot({ path: path.join(OUT, "16_pre_quiz.png") }).catch(()=>{});
    console.log("TEXT:", txt.slice(0, 700));
    return fg;
  }, null]], { meta: { title: "课前自测页" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
