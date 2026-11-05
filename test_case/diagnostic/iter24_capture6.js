/* 迭代24：积分榜单 + 已购视频课程（压铸模具温控设计要点）详情/学习页，只读采样 */
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
  fs.writeFileSync(path.join(OUT, name + ".txt"), "URL: " + fg.url() + "\n\n" + txt, "utf8");
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(() => {});
  console.log(`\n== ${name} ==\n${txt.slice(0, 700)}`);
  return fg;
}

async function tapExact(page, word, nth = 0) {
  const fg = await base.foreground(page);
  const loc = fg
    .locator("wx-view, wx-text")
    .filter({ hasText: new RegExp(`^${word}$`) })
    .nth(nth);
  if ((await loc.count()) === 0) throw new Error(`找不到「${word}」`);
  await base.tapLocator(fg, loc, word);
  await base.sleep(2800);
  return base.foreground(page);
}

(async () => {
  await appTest([
    [
      async (page) => {
        page = await pages.qaPage.ensureOnHomeFeed(page);
        let fg = await base.foreground(page);
        await base.tapBottomTab(fg, "我的");
        await base.sleep(2500);
        page = await tapExact(page, "积分商城");
        await base.sleep(3000);
        page = await tapExact(page, "积分榜单");
        await base.sleep(3500);
        page = await dump(page, "24_ranking");

        // 回首页 -> 我的 -> 课程 -> 已购视频课程
        page = await pages.qaPage.ensureOnHomeFeed(page);
        fg = await base.foreground(page);
        await base.tapBottomTab(fg, "我的");
        await base.sleep(2500);
        page = await tapExact(page, "课程");
        page = await tapExact(page, "压铸模具温控设计要点");
        await base.sleep(4000);
        page = await dump(page, "25_video_purchased");

        page = await pages.qaPage.ensureOnHomeFeed(page);
        return page;
      },
      null,
    ],
  ], { meta: { feature: "迭代24", title: "积分榜单 + 已购视频课程" } });
})().catch((e) => {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
});
