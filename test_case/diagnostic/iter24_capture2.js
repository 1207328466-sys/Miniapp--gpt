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
  console.log(`\n== ${name} ==\n${txt.slice(0, 500)}`);
  return fg;
}
async function safe(page, fn, label) {
  try { return await fn(page); } catch (e) { console.log(`[WARN] ${label}: ${e.message.split("\n")[0]}`); return page; }
}
const back = async (page) => require("../../app_sub_function/suprecast_app/android").goBack(await base.foreground(page));

(async () => {
  await appTest([[async (page) => {
    page = await dump(page, "10_certificate_page");

    page = await safe(page, back, "回课程详情");
    await base.sleep(2000);
    page = await safe(page, async (p) => { const fg = await base.foreground(p); await base.tapText(fg, "课前自测", "课前自测"); await base.sleep(3500); return base.foreground(p); }, "进课前自测");
    page = await dump(page, "11_pre_quiz");
    page = await safe(page, back, "回课程详情2");
    await base.sleep(2000);

    page = await safe(page, async (p) => { const fg = await base.foreground(p); await base.tapText(fg, "课后练习", "课后练习"); await base.sleep(3500); return base.foreground(p); }, "进课后练习");
    page = await dump(page, "12_post_quiz");
    page = await safe(page, back, "回课程详情3");
    await base.sleep(2000);

    page = await safe(page, async (p) => { const fg = await base.foreground(p); await base.tapText(fg, "课后实操", "课后实操"); await base.sleep(3500); return base.foreground(p); }, "进课后实操");
    page = await dump(page, "13_practice");
    page = await safe(page, back, "回课程详情4");
    await base.sleep(2000);

    page = await safe(page, back, "回学习中心");
    await base.sleep(2500);
    page = await safe(page, async (p) => {
      const fg = await base.foreground(p);
      // 第二个「训练营课程测试」（未购买）
      await base.tapText(fg, "训练营课程测试", "训练营课程测试", { nth: 2 }).catch(async () => { await base.tapText(fg, "训练营课程测试", "训练营课程测试"); });
      await base.sleep(3500);
      return base.foreground(p);
    }, "进第二个训练营");
    page = await dump(page, "14_camp_second");

    page = await safe(page, async (p) => { const fg = await base.foreground(p); await base.tapBottomTab(fg, "我的"); await base.sleep(2500); return base.foreground(p); }, "进我的");
    page = await safe(page, async (p) => { const fg = await base.foreground(p); await base.tapText(fg, "课程", "我的-课程", { nth: 1 }); await base.sleep(2500); return base.foreground(p); }, "我的课程tab");
    page = await dump(page, "15_my_courses");

    page = await safe(page, (p) => pages.qaPage.ensureOnHomeFeed(p), "回首页");
    return page;
  }, null]], { meta: { feature: "迭代24", title: "迭代24 页面采样2" } });
})().catch((e) => { console.error("ERR", e.message.split("\n")[0]); process.exit(1); });
