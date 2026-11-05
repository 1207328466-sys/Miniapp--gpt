const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
(async () => {
  await appTest([[async (page) => {
    const fg = await base.foreground(page);
    const info = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      document.querySelectorAll("wx-view, wx-text").forEach((el) => {
        const c = String(el.getAttribute("class") || "");
        const t = norm(el.innerText);
        if (!t || t.length > 40) return;
        if (!/选项|option|answer|choice|quiz|question|题/i.test(c + " " + t.slice(0, 4))) return;
        const r = el.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return;
        out.push({ cls: c.slice(0, 60), text: t.slice(0, 26), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      });
      const seen = new Set();
      return out.filter((o) => { const k = o.cls + o.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    });
    console.log(JSON.stringify(info, null, 0).slice(0, 3000));
    return fg;
  }, null]], { meta: { title: "答题选项结构" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
