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
    const t0 = await base.pageText(fg);
    console.log("START:", t0.slice(0, 90));
    if (!t0.includes("提交记录")) {
      // 回首页 -> 学习中心 -> 第二个训练营 -> 行动卡
      page = await pages.qaPage.ensureOnHomeFeed(page);
      fg = await base.foreground(page);
      const dev0 = await base.getDevice();
      const dpr0 = await fg.evaluate(() => window.devicePixelRatio || 1);
      await dev0.shell(`input tap 340 ${Math.round(730 * dpr0)}`); // 顺手点掉可能的残留蒙层
      await base.sleep(1200);
      fg = await base.foreground(page);
      const dev = await base.getDevice();
      await base.tapBottomTab(fg, "学习中心"); await base.sleep(3000);
      fg = await base.foreground(page);
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
      await dev.shell(`input tap ${Math.round(t.x * dpr)} ${Math.round(t.y * dpr)}`);
      await base.sleep(4500);
      fg = await base.foreground(page);
      const btn = fg.locator(".action-card__btn").first();
      if (await btn.count()) { await base.tapLocator(fg, btn, "去提交"); await base.sleep(4000); }
      fg = await base.foreground(page);
    }
    page = await dump(page, "73_practice_before_submit");
    fg = await base.foreground(page);
    const go = fg.locator("wx-view, wx-text").filter({ hasText: /^去提交实操$/ }).first();
    if (await go.count()) { await base.tapLocator(fg, go, "去提交实操"); await base.sleep(3500); }
    page = await dump(page, "74_practice_popup_again");
    fg = await base.foreground(page);
    const sub = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).last();
    if (await sub.count()) { await base.tapLocator(fg, sub, "提交(无截图)"); await base.sleep(2500); }
    page = await dump(page, "75_practice_submit_without_image");
    return page;
  }, null]], { meta: { title: "无截图提交" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
