const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    const fg = await base.foreground(page);
    const txt = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "77_purchase_protocol.txt"), txt, "utf8");
    await fg.screenshot({ path: path.join(OUT, "77_purchase_protocol.png") }).catch(()=>{});
    console.log("TEXT:", txt.slice(0, 900));
    const info = await fg.evaluate(() => {
      const out = [];
      document.querySelectorAll("wx-view, wx-text, checkbox").forEach((el) => {
        const t = String(el.innerText || "").replace(/\s+/g, " ").trim();
        const c = String(el.getAttribute("class") || "");
        if (!/协议|同意|购买|取消|确认|checkbox|agree/i.test(c + " " + t)) return;
        if (!t && !c) return;
        const r = el.getBoundingClientRect();
        if (r.width < 5) return;
        out.push({ cls: c.slice(0,50), text: t.slice(0,30), rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] });
      });
      return out.slice(0, 12);
    });
    console.log("ELEMS:", JSON.stringify(info).slice(0, 1200));
    return fg;
  }, null]], { meta: { title: "购买协议弹层" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
