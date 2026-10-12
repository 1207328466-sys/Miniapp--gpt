/*
 * 诊断（不以 test_ 开头，pytest 不收集）：学习中心的课程列表 + 课程详情（学习页）结构。
 *
 * 为什么探它：需求 713367615（已关闭）有四条，其中三条要落到"课程详情/学习页"上：
 *   ① 管理后台课时数为 0 的课程，小程序端**不显示**（可跟数据库对账：库里有 29 门这种课）
 *   ② 未购买用户点课时：封面图和标题不变，始终显示课程名称
 *   ③ 已购买未开始：点课程进学习页，默认「课程介绍」，展示课程标题 + 第一课时封面和视频
 *   ④ 已购买已开始：默认「课程目录」，展示上次观看的课时名称、课程标签、课时封面和视频
 *
 * 本探针：学习中心 → 课程 tab → 打印课程列表（名称/结构）→ 点第一张卡 → 打印落到的页面结构。
 * 只读：只导航 + 读 DOM，不播放视频、不购买。
 *
 * 运行：node test_case/diagnostic/probe_course_detail_page.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const learnCenter = pages.learnCenter;

async function probe(page) {
  page = await learnCenter.ensureOnColumnList(page);
  page = await learnCenter.switchToTopTab(page, { tab: "课程" });
  await base.sleep(2500);

  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n=== 课程 tab 的页面文字（前 400 字）===");
  console.log(text.slice(0, 400));

  const listInfo = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const classes = new Set();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (/course|lesson|card|list/i.test(c)) c.split(/\s+/).forEach((x) => classes.add(x));
    }
    // 候选课程卡片：含图片、且文字不太长
    const cards = [];
    for (const el of Array.from(document.querySelectorAll("wx-view, div"))) {
      const c = String(el.getAttribute("class") || "");
      if (!/course|card/i.test(c)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 60) continue;
      cards.push({
        cls: c.slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        text: norm(el.innerText).slice(0, 40),
      });
      if (cards.length >= 8) break;
    }
    return { classes: Array.from(classes).slice(0, 40), cards };
  });

  console.log("\n=== class 里带 course/lesson/card 的类名 ===");
  console.log("  " + listInfo.classes.join("  "));
  console.log("\n=== 候选课程卡片（前 8 个）===");
  listInfo.cards.forEach((c) => console.log("  <%s> 位置=%s 文字=%s", c.cls, JSON.stringify(c.rect), JSON.stringify(c.text)));

  /*
   * 点**我们已购买、且还没开始学**的那门课（列表上写着「已购买(学习进度 0%)」）——
   * 需求 713367615 第 3 条说的就是这种状态：「已购买用户-未开始学习：点击课程进入学习页，
   * 默认为课程介绍，展示课程标题和第一课时的封面和视频」。
   * 先按名字点（页面上那门课叫 717），点不到就退回"点第一张卡片"。
   */
  let tapped = "";
  try {
    await base.tapText(fg, "717", "已购买未开始的课程「717」");
    tapped = "按名字点中了「717」";
  } catch (e) {
    const card = fg.locator(listInfo.cards.length ? "." + listInfo.cards[0].cls.split(" ")[0] : "wx-view");
    await base.tapLocator(fg, card.first(), "第一张课程卡片（按名字没点中）");
    tapped = "按名字没点中，退回到点第一张卡片";
  }
  console.log("\n  点法：%s", tapped);
  await base.sleep(4000);

  const after = await base.foreground(page);
  const afterText = await base.pageText(after);
  console.log("\n=== 点开之后的页面（前 400 字）===");
  console.log(afterText.slice(0, 400));

  const detail = await after.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const classes = new Set();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (/course|intro|lesson|chapter|video|tab|目录|介绍/i.test(c)) c.split(/\s+/).forEach((x) => classes.add(x));
    }
    const tabs = [];
    for (const el of Array.from(document.querySelectorAll("wx-view, wx-text"))) {
      const t = norm(el.innerText);
      if (t === "课程介绍" || t === "课程目录" || t === "介绍" || t === "目录") {
        tabs.push({ text: t, cls: String(el.getAttribute("class") || "").slice(0, 60) });
      }
    }
    return { classes: Array.from(classes).slice(0, 40), tabs };
  });
  console.log("\n=== 详情页候选类名 ===");
  console.log("  " + detail.classes.join("  "));
  console.log("\n=== 页面上像「介绍/目录」tab 的元素 ===");
  detail.tabs.forEach((t) => console.log("  %s <%s>", JSON.stringify(t.text), t.cls));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "课程", title: "课程列表与课程详情页结构" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
