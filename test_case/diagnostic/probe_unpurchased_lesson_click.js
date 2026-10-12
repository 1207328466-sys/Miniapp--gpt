/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**未购买用户**点课时，封面和标题会不会变？
 *
 * 需求 713367615 第 2 条原文：
 *   「未购买用户：点击课时不改变封面图和标题，**始终显示课程名称**」
 *
 * 样本：课程「测试-11」（course_info id=77，2 个课时）——
 *   我们账号在 user_course_relation 里**只有** 717 一门课的购买关系，所以它属于"未购买"。
 *
 * 做法：打开它的详情页 → 记下标题与视频/封面 → 切到「课程目录」→ 点第一个课时 →
 *       再记一次 → 比较（标题应当**还是课程名**，封面/视频不变）。
 *
 * 只读：只导航 + 读 DOM + 点课时（未购买用户点课时按需求本就"什么都不该发生"）。
 * 运行：node test_case/diagnostic/probe_unpurchased_lesson_click.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const courseDetail = pages.courseDetail;

const COURSE = "7.8课程new";

/** 读详情页上的"标题 / 封面 / 视频 / tab"这几样 */
async function snapshot(page, label) {
  const fg = (await courseDetail.findCourseDetailPage(page)) || (await base.foreground(page));
  const info = await fg.evaluate((sel) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const img = document.querySelector(sel.videoPoster) || document.querySelector(sel.videoContainer);
    const r = img ? img.getBoundingClientRect() : null;
    const tabs = [];
    document.querySelectorAll(sel.tabItem).forEach((el) => {
      const cls = String(el.getAttribute("class") || "");
      tabs.push({ text: norm(el.innerText), active: /titles-item-active/.test(cls) });
    });
    return {
      title: norm((document.querySelector(sel.name) || {}).innerText || ""),
      coverRect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
      tabs,
      head: norm(document.body.innerText).slice(0, 80),
    };
  }, { name: courseDetail.SEL.name, videoPoster: courseDetail.SEL.videoPoster, videoContainer: courseDetail.SEL.videoContainer, tabItem: courseDetail.SEL.tabItem });
  // 课程名到底渲染在哪个元素上？（未购买页的 .course-name 是空的，所以要另找）
  const nameEls = await fg.evaluate((course) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (norm(el.innerText) !== course) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 10) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.getAttribute("class") || "").slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      });
      if (out.length >= 4) break;
    }
    return out;
  }, COURSE);
  console.log("\n[%s] 标题=%s 封面/视频区=%s", label, JSON.stringify(info.title), JSON.stringify(info.coverRect));
  console.log("        tab=%s", JSON.stringify(info.tabs));
  console.log("        课程名元素：%s", JSON.stringify(nameEls));
  console.log("        页面前 80 字: %s", JSON.stringify(info.head));
  return info;
}

async function probe(page) {
  page = await courseDetail.openByName(page, COURSE);
  const before = await snapshot(page, "打开课程详情");

  // 切到「课程目录」（未购买课程应当也能看到目录；看不到就直接说清）
  try {
    await base.tapText(await base.foreground(page), "课程目录", "tab「课程目录」");
    await base.sleep(1500);
  } catch (e) {
    console.log("\n  [提示] 未购买课程上点不到「课程目录」tab：%s", e.message.split("\n")[0]);
  }
  const afterSwitch = await snapshot(page, "切到课程目录后");

  // 找到"课时"条目并点第一个
  const fg = await base.foreground(page);
  const lessonInfo = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("wx-view"))) {
      const t = norm(el.innerText);
      if (!/^第\d+课|^第[一二三四五六七八九十]课/.test(t) || t.length > 60) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 20) continue;
      out.push({ text: t.slice(0, 40), cls: String(el.getAttribute("class") || "").slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
      if (out.length >= 3) break;
    }
    return out;
  });
  console.log("\n=== 页面上的「第N课」条目（前 3 个）===");
  lessonInfo.forEach((l) => console.log("  %s <%s> 位置=%s", JSON.stringify(l.text), l.cls, JSON.stringify(l.rect)));

  if (!lessonInfo.length) {
    const e = new Error("这个详情页上看不到「第N课」条目 —— 没法点课时；需求第 2 条先用不了这条路");
    e.preconditionNotMet = true;
    throw e;
  }

  // 点第一个课时（按文字点）
  await base.tapText(await base.foreground(page), "第1课", "第一个课时");
  await base.sleep(2000);
  const after = await snapshot(page, "点了第一个课时之后");

  // 结论：标题应当**还是课程名**，封面也不该变
  const problems = [];
  if (after.title !== before.title) problems.push(`标题变了：${JSON.stringify(before.title)} -> ${JSON.stringify(after.title)}`);
  if (after.title !== COURSE) problems.push(`标题不是课程名：${JSON.stringify(after.title)}（期望 ${JSON.stringify(COURSE)}）`);
  if (JSON.stringify(after.coverRect) !== JSON.stringify(before.coverRect)) {
    problems.push(`封面/视频区变了：${JSON.stringify(before.coverRect)} -> ${JSON.stringify(after.coverRect)}`);
  }
  if (problems.length) {
    throw new Error("需求 713367615 第 2 条不成立：\n  - " + problems.join("\n  - "));
  }
  console.log("\n✅ 通过：未购买用户点课时后，标题仍是课程名、封面/视频区没变（需求第 2 条）");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "课程", title: "未购买用户点课时会不会改变封面和标题" },
  });
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
