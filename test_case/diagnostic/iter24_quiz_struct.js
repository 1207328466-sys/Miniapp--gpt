const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    console.log("STATE:", (await base.pageText(fg)).slice(0, 60));
    if (!(await base.pageText(fg)).includes("答题说明")) {
      // 尝试进入：若在课程详情，点去答题；否则回首页->学习中心->第二张卡
      const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
      if (await btn.count()) { await base.tapLocator(fg, btn, "去答题"); await base.sleep(3500); }
    }
    fg = await base.foreground(page);
    const info = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      document.querySelectorAll("wx-view, wx-text").forEach((el) => {
        const c = String(el.getAttribute("class") || "");
        if (!/option|quiz|question|submit/i.test(c)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 5) return;
        out.push({ cls: c.slice(0, 60), text: norm(el.innerText).slice(0, 30), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      });
      const seen = new Set();
      return out.filter((o) => { const k = o.cls + o.text + o.rect.join(","); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    });
    console.log(JSON.stringify(info, null, 1).slice(0, 2500));
    return fg;
  }, null]], { meta: { title: "答题页结构" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
