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
    // 先回到一级页，再重进课程（排除蒙层/旧状态）
    page = await pages.qaPage.ensureOnHomeFeed(page);
    let fg = await base.foreground(page);
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
    const dev = await base.getDevice();
    await dev.shell(`input tap ${Math.round(t.x * dpr)} ${Math.round(t.y * dpr)}`);
    await base.sleep(4500);
    page = await dump(page, "63_course_reenter_75");
    fg = await base.foreground(page);
    for (let i = 1; i <= 2; i++) {
      const btn = fg.locator(".action-card__btn").first();
      if (!(await btn.count())) break;
      await base.tapLocator(fg, btn, `行动卡#${i}`);
      await base.sleep(4000);
      fg = await base.foreground(page);
      const txt = await base.pageText(fg);
      console.log(`TAP${i}: practicePage=${txt.includes("实操说明") || txt.includes("还没有提交记录")} inProgress=${txt.includes("课后实操 进行中")}`);
      if (txt.includes("实操说明") || txt.includes("还没有提交记录")) break;
    }
    page = await dump(page, "64_practice_page_retry");
    return page;
  }, null]], { meta: { title: "实操页重试" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
