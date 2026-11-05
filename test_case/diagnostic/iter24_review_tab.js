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
    // 先关掉可能的协议层
    const dev0 = await base.getDevice();
    await dev0.shell("input keyevent 4"); await base.sleep(1500);
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
    await base.tapBottomTab(fg, "学习中心"); await base.sleep(3000);
    fg = await base.foreground(page);
    // 第一张训练营（100% 完成的那门）
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
    const t = xs[0];
    const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
    await dev0.shell(`input tap ${Math.round(t.x*dpr)} ${Math.round(t.y*dpr)}`);
    await base.sleep(4500);
    fg = await base.foreground(page);
    const tab = fg.locator("wx-view, wx-text").filter({ hasText: /^评价$/ }).first();
    if (await tab.count()) { await base.tapLocator(fg, tab, "评价tab"); await base.sleep(3000); }
    page = await dump(page, "78_camp_review_tab");
    fg = await base.foreground(page);
    const reply = await fg.evaluate(() => {
      const out = [];
      document.querySelectorAll("wx-view, wx-text").forEach((el) => {
        const t = String(el.innerText || "").replace(/\s+/g, " ").trim();
        if (t === "回复") out.push(String(el.getAttribute("class") || "").slice(0, 40));
      });
      return out;
    });
    console.log("REPLY_BUTTONS:", JSON.stringify(reply));
    return fg;
  }, null]], { meta: { title: "课程评价tab" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
