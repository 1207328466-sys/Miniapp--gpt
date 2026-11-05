/* 迭代24：打开第二个「训练营课程测试」（未购买）看未购买态 */
const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;

const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");

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
        console.log("unique cards:", JSON.stringify(xs));
        const target = xs[xs.length - 1];
        const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
        const dev = await base.getDevice();
        await dev.shell(`input tap ${Math.round(target.x * dpr)} ${Math.round(target.y * dpr)}`);
        await base.sleep(4500);

        fg = await base.foreground(page);
        const txt = await base.pageText(fg);
        fs.writeFileSync(path.join(OUT, "27_camp_unpurchased.txt"), txt, "utf8");
        await fg.screenshot({ path: path.join(OUT, "27_camp_unpurchased.png") }).catch(() => {});
        console.log("TEXT:", txt.slice(0, 600));
        return fg;
      },
      null,
    ],
  ], { meta: { feature: "迭代24", title: "未购买训练营详情" } });
})().catch((e) => {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
});
