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
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    const xs = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const hits = [];
      document.querySelectorAll("span, wx-text").forEach((el) => {
        if (norm(el.innerText) !== "训练营课程测试") return;
        const r = el.getBoundingClientRect();
        if (r.width > 0) hits.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      });
      const uniq = [];
      hits.forEach((h) => { if (!uniq.some((u) => Math.abs(u.x - h.x) < 10)) uniq.push(h); });
      return uniq;
    });
    const t = xs[xs.length - 1];
    const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
    const dev = await base.getDevice();
    await dev.shell(`input tap ${Math.round(t.x * dpr)} ${Math.round(t.y * dpr)}`);
    await base.sleep(4500);
    page = await dump(page, "68_course_75_again");
    fg = await base.foreground(page);
    for (let i = 1; i <= 2; i++) {
      const txt = await base.pageText(fg);
      if (txt.includes("提交记录")) break;
      const btn = fg.locator(".action-card__btn").first();
      if (!(await btn.count())) break;
      await base.tapLocator(fg, btn, `行动卡#${i}`);
      await base.sleep(4000);
      fg = await base.foreground(page);
    }
    page = await dump(page, "69_practice_page_now");
    fg = await base.foreground(page);
    const go = fg.locator("wx-view, wx-text").filter({ hasText: /^去提交实操$/ }).first();
    if (await go.count()) { await base.tapLocator(fg, go, "去提交实操"); await base.sleep(4000); }
    page = await dump(page, "70_practice_popup_now");
    return page;
  }, null]], { meta: { title: "实操提交弹层（干净进入）" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
