const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
(async () => {
  await appTest([[async (page) => {
    const fg = await base.foreground(page);
    const info = await fg.evaluate(() => {
      const out = [];
      document.querySelectorAll("*").forEach((el) => {
        const c = String(el.getAttribute("class") || "");
        if (!/(mask|overlay|modal|dialog|popup)/i.test(c)) return;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        out.push({ cls: c.slice(0, 70), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], display: s.display, opacity: s.opacity, z: s.zIndex, pos: s.position });
      });
      return out;
    });
    console.log(JSON.stringify(info, null, 1).slice(0, 2000));
    return fg;
  }, null]], { meta: { title: "蒙层排查" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
