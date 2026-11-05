/* 迭代24：把关键页面逐个打开、存文字+截图，供后续逐条对用例（只读，不改数据） */
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
  console.log(`== ${name} ==\n${txt.slice(0, 400)}\n`);
  return fg;
}

async function step(page, fn, label) {
  try { return await fn(page); } catch (e) { console.log(`[WARN] ${label}: ${e.message.split("\n")[0]}`); return page; }
}

(async () => {
  await appTest([[async (page) => {
    page = await step(page, (p) => pages.qaPage.ensureOnHomeFeed(p), "回首页");
    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapBottomTab(fg, "学习中心");
      await base.sleep(3000);
      return base.foreground(p);
    }, "进学习中心");
    page = await dump(page, "01_learn_center");

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapText(fg, "训练营课程测试", "训练营课程测试");
      await base.sleep(4000);
      return base.foreground(p);
    }, "进训练营课程");
    page = await dump(page, "02_camp_detail");

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapText(fg, "查看证书", "查看证书");
      await base.sleep(3500);
      return base.foreground(p);
    }, "进学习证书");
    page = await dump(page, "03_certificate");

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.goBack ? p : p;
      const { goBack } = require("../../app_sub_function/suprecast_app/android");
      return goBack(await base.foreground(p));
    }, "从证书返回");
    await base.sleep(2000);

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapText(fg, "评价", "评价tab");
      await base.sleep(2500);
      return base.foreground(p);
    }, "切评价tab");
    page = await dump(page, "04_camp_review_tab");

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapText(fg, "课程目录", "课程目录tab");
      await base.sleep(2500);
      return base.foreground(p);
    }, "切课程目录");
    page = await dump(page, "05_camp_catalog");

    page = await step(page, async (p) => {
      const { goBack } = require("../../app_sub_function/suprecast_app/android");
      return goBack(await base.foreground(p));
    }, "回学习中心");
    await base.sleep(3000);
    page = await dump(page, "06_learn_center_back");

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapText(fg, "产品分型面的设计原则123", "视频课程");
      await base.sleep(4000);
      return base.foreground(p);
    }, "进视频课程");
    page = await dump(page, "07_video_detail");

    page = await step(page, async (p) => {
      const { goBack } = require("../../app_sub_function/suprecast_app/android");
      return goBack(await base.foreground(p));
    }, "回学习中心2");
    await base.sleep(2500);

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapBottomTab(fg, "我的");
      await base.sleep(3000);
      return base.foreground(p);
    }, "进我的");
    page = await dump(page, "08_mine");

    page = await step(page, async (p) => {
      const fg = await base.foreground(p);
      await base.tapText(fg, "榜单", "榜单");
      await base.sleep(3500);
      return base.foreground(p);
    }, "进榜单");
    page = await dump(page, "09_ranking");

    page = await step(page, (p) => pages.qaPage.ensureOnHomeFeed(p), "回首页收尾");
    return page;
  }, null]], { meta: { feature: "迭代24", title: "迭代24 关键页面采样" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
