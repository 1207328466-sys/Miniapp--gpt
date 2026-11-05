/* 迭代24：我的-课程 / 收藏 / 积分商城（找榜单入口），只读采样 */
const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;

const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
fs.mkdirSync(OUT, { recursive: true });

async function dump(page, name) {
  const fg = await base.foreground(page);
  const txt = await base.pageText(fg);
  fs.writeFileSync(path.join(OUT, name + ".txt"), txt, "utf8");
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(() => {});
  console.log(`\n== ${name} ==\n${txt.slice(0, 600)}`);
  return fg;
}

async function tapExact(page, word) {
  const fg = await base.foreground(page);
  const loc = fg.locator("wx-view, wx-text").filter({ hasText: new RegExp(`^${word}$`) }).first();
  if ((await loc.count()) === 0) throw new Error(`找不到「${word}」`);
  await base.tapLocator(fg, loc, word);
  await base.sleep(2500);
  return base.foreground(page);
}

(async () => {
  await appTest([
    [
      async (page) => {
        page = await pages.qaPage.ensureOnHomeFeed(page);
        let fg = await base.foreground(page);
        await base.tapBottomTab(fg, "我的");
        await base.sleep(3000);
        page = await tapExact(page, "课程");
        page = await dump(page, "21_my_courses");

        page = await tapExact(page, "收藏");
        page = await dump(page, "22_my_favorites");

        page = await tapExact(page, "积分商城");
        await base.sleep(3000);
        page = await dump(page, "23_points_mall");

        page = await pages.qaPage.ensureOnHomeFeed(page);
        return page;
      },
      null,
    ],
  ], { meta: { feature: "迭代24", title: "我的课程/收藏/积分商城采样" } });
})().catch((e) => {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
});
