/* 迭代24：训练营「课前自测」未提交态（从行动卡「去答题」进入） */
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
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(() => {});
  console.log(`\n== ${name} ==\n${txt.slice(0, 800)}`);
  return fg;
}

(async () => {
  await appTest([
    [
      async (page) => {
        page = await pages.qaPage.ensureOnHomeFeed(page);
        let fg = await base.foreground(page);
        await base.tapBottomTab(fg, "学习中心");
        await base.sleep(3000);
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
          hits.forEach((h) => {
            if (!uniq.some((u) => Math.abs(u.x - h.x) < 10)) uniq.push(h);
          });
          return uniq;
        });
        const target = xs[xs.length - 1];
        const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
        const dev = await base.getDevice();
        await dev.shell(`input tap ${Math.round(target.x * dpr)} ${Math.round(target.y * dpr)}`);
        await base.sleep(4500);
        fg = await base.foreground(page);
        const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
        if ((await btn.count()) === 0) throw new Error("没找到「去答题」（先跑 iter24_camp_unpurchased.js 进入第二个训练营）");
        await base.tapLocator(fg, btn, "去答题");
        await base.sleep(4500);
        page = await dump(page, "28_pre_quiz_pending");
        return page;
      },
      null,
    ],
  ], { meta: { feature: "迭代24", title: "课前自测未提交态" } });
})().catch((e) => {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
});
