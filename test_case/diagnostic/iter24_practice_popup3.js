const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    const state = await fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      document.querySelectorAll("wx-view, wx-text, button").forEach((el) => {
        const t = norm(el.innerText);
        if (t !== "提交" && t !== "取消") return;
        const c = String(el.getAttribute("class") || "");
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        out.push({ t, cls: c.slice(0, 60), color: s.color, bg: s.backgroundColor, opacity: s.opacity, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      });
      return out;
    });
    console.log("BTN_STATE:", JSON.stringify(state));
    fs.writeFileSync(path.join(OUT, "71_practice_popup_buttons.json"), JSON.stringify(state, null, 1), "utf8");
    const cancel = fg.locator("wx-view, wx-text").filter({ hasText: /^取消$/ }).first();
    if (await cancel.count()) { await base.tapLocator(fg, cancel, "取消"); await base.sleep(2500); }
    fg = await base.foreground(page);
    const txt = await fg.pageText ? await base.pageText(fg) : "";
    fs.writeFileSync(path.join(OUT, "72_practice_after_cancel.txt"), txt, "utf8");
    await fg.screenshot({ path: path.join(OUT, "72_practice_after_cancel.png") }).catch(()=>{});
    console.log("AFTER_CANCEL:", txt.slice(0, 300));
    return fg;
  }, null]], { meta: { title: "弹层按钮与取消" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
