const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;
const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
(async () => {
  await appTest([[async (page) => {
    let fg = await base.foreground(page);
    const dev = await base.getDevice();
    const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
    // 点蒙层右下角空白处（onBlur 关掉它）
    await dev.shell(`input tap ${Math.round(340 * dpr)} ${Math.round(730 * dpr)}`);
    await base.sleep(1500);
    fg = await base.foreground(page);
    const has = await fg.evaluate(() => {
      const m = document.querySelector(".overlay-mask");
      if (!m) return "none";
      const r = m.getBoundingClientRect();
      return `display=${getComputedStyle(m).display} rect=${Math.round(r.width)}x${Math.round(r.height)}`;
    });
    console.log("OVERLAY_AFTER_TAP:", has);
    // 再点行动卡
    const btn = fg.locator(".action-card__btn").first();
    if (await btn.count()) { await base.tapLocator(fg, btn, "去提交"); await base.sleep(4500); }
    fg = await base.foreground(page);
    const txt = await base.pageText(fg);
    fs.writeFileSync(path.join(OUT, "65_practice_after_mask_dismiss.txt"), txt, "utf8");
    await fg.screenshot({ path: path.join(OUT, "65_practice_after_mask_dismiss.png") }).catch(()=>{});
    console.log("TEXT:", txt.slice(0, 500));
    return fg;
  }, null]], { meta: { title: "蒙层关闭后进实操" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
