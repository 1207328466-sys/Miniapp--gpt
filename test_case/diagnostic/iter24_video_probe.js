/* 迭代24：已购视频课程——打开学习页、点播放、读 currentTime、拖进度条（真机） */
const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const base = pages.base;

const OUT = path.join(__dirname, "..", "..", "report", "iter24", "evidence");
fs.mkdirSync(OUT, { recursive: true });

async function readVideo(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return {
      current: Number(v.currentTime || 0),
      duration: Number(v.duration || 0),
      paused: !!v.paused,
      readyState: v.readyState,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      dpr: window.devicePixelRatio,
    };
  });
}

async function dump(page, name) {
  const fg = await base.foreground(page);
  const txt = await base.pageText(fg);
  fs.writeFileSync(path.join(OUT, name + ".txt"), txt, "utf8");
  await fg.screenshot({ path: path.join(OUT, name + ".png") }).catch(() => {});
  console.log(`\n== ${name} ==\n${txt.slice(0, 500)}`);
  return fg;
}

(async () => {
  await appTest([
    [
      async (page) => {
        page = await pages.qaPage.ensureOnHomeFeed(page);
        let fg = await base.foreground(page);
        page = await pages.userCenter.switchTo(page);
        await base.sleep(1500);
        fg = await base.foreground(page);
        const tab = fg.locator("wx-view, wx-text").filter({ hasText: /^课程$/ }).first();
        await base.tapLocator(fg, tab, "课程tab");
        await base.sleep(2500);
        fg = await base.foreground(page);
        await base.tapText(fg, "压铸模具温控设计要点", "压铸模具温控设计要点");
        await base.sleep(3500);
        // 点第一课进入学习页
        fg = await base.foreground(page);
        const lesson = fg.locator("wx-view, wx-text").filter({ hasText: /压铸模具温控设计要点/ }).last();
        await base.tapLocator(fg, lesson, "第1课");
        await base.sleep(4500);
        page = await dump(page, "26_video_learn_page");

        let st = await readVideo(page);
        console.log("VIDEO_BEFORE:", JSON.stringify(st));
        if (st) {
          const dev = await base.getDevice();
          const dpr = st.dpr || 1;
          const cx = Math.round((st.rect[0] + st.rect[2] / 2) * dpr);
          const cy = Math.round((st.rect[1] + st.rect[3] / 2) * dpr);
          await dev.shell(`input tap ${cx} ${cy}`);
          await base.sleep(5000);
          const st2 = await readVideo(page);
          console.log("VIDEO_AFTER_PLAY:", JSON.stringify(st2));
          fs.writeFileSync(path.join(OUT, "26_video_play.json"), JSON.stringify({ before: st, after: st2 }, null, 1), "utf8");
        }
        page = await pages.qaPage.ensureOnHomeFeed(page);
        return page;
      },
      null,
    ],
  ], { meta: { feature: "迭代24", title: "视频课程播放探针" } });
})().catch((e) => {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
});
