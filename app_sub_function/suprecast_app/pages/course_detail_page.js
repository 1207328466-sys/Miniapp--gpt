/*
 * 页面对象：课程详情页（学习页）
 *
 * 需求 713367615（已关闭）里有三条跟它有关：
 *   ② 未购买用户：点击课时不改变封面图和标题，始终显示课程名称
 *   ③ **已购买用户-未开始学习**：点击课程进入学习页，默认为「课程介绍」，展示课程标题和第一课时的封面和视频
 *   ④ 已购买用户-已开始学习：默认为「课程目录」，展示上次观看的课时名称、课程标签、课时封面和视频
 *
 * 实测结构（2026/10/12，课程「717」，我们账号是"已购买 + 学习进度 0%"）：
 *   .course-detail                   整页根容器（只在课程详情/学习页出现）
 *     .eco-video-container           视频区（h-420px）
 *       .wx-video-poster             第一课时的**封面图**
 *       .wx-video-cover-duration     「00:07」这样的时长角标
 *     .course-name                   课程名（实测就是「717」）
 *     .nut-tabs / .nut-tabs-titles
 *       .nut-tabs-titles-item        两个 tab：课程介绍 / 课程目录
 *       .nut-tabs-titles-item-active **当前选中的那个**（实测"未开始学习"落在「课程介绍」）
 *
 * 与之对账的数据库事实（2026/10/12 只读查询）：
 *   · `course_info` 里「717」= id 83、course_tag `2077939147885576192`
 *   · `user_course_relation` 里我们账号（1966909 / 1966910）**都买了这门课**
 *   · `course_record` 里我们账号**一条学习记录都没有** -> 学习进度 0% -> 属于"未开始学习"
 */

const base = require("./base_page");

const SEL = {
  page: ".course-detail",
  name: ".course-name",
  tabItem: ".nut-tabs-titles-item",
  tabActive: ".nut-tabs-titles-item-active",
  videoContainer: ".eco-video-container",
  videoPoster: ".wx-video-poster",
};

/** 需求里的两个 tab 名（原文：课程介绍 / 课程目录） */
const TABS = ["课程介绍", "课程目录"];

async function isOn(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.page)) > 0;
}

/** 定位课程详情页（前台优先，找不到就跨页找） */
async function findCourseDetailPage(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.page)) > 0) return fg;
  return base.findPageContaining(page, { selector: SEL.page });
}

/**
 * 读课程详情页的关键状态（只读）：课程名 / 有哪些 tab / 当前选中哪个 / 有没有视频与封面。
 * @returns {Promise<{name:string, tabs:Array<{text:string,active:boolean}>, activeTab:string, hasVideo:boolean, hasPoster:boolean, text:string}>}
 */
async function readState(page) {
  const fg = (await findCourseDetailPage(page)) || (await base.foreground(page));
  return fg.evaluate(
    (sel) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const tabs = [];
      document.querySelectorAll(sel.tabItem).forEach((el) => {
        const cls = String(el.getAttribute("class") || "");
        tabs.push({ text: norm(el.innerText), active: /titles-item-active/.test(cls) });
      });
      const active = tabs.find((t) => t.active);
      // 「封面/视频区」的位置：未购买页上一样要有（需求第 2 条要看它变没变）
      const coverEl = document.querySelector(sel.videoContainer) || document.querySelector(sel.videoPoster);
      const cr = coverEl ? coverEl.getBoundingClientRect() : null;
      return {
        name: norm((document.querySelector(sel.name) || {}).innerText || ""),
        tabs,
        activeTab: active ? active.text : "",
        hasVideo: !!document.querySelector(sel.videoContainer),
        hasPoster: !!document.querySelector(sel.videoPoster),
        coverPreview: cr ? [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)] : null,
        text: norm(document.body.innerText).slice(0, 120),
      };
    },
    { name: SEL.name, tabItem: SEL.tabItem, videoContainer: SEL.videoContainer, videoPoster: SEL.videoPoster }
  );
}

/** 打印并记录状态（只读） */
async function logState(page, kwargs, ctx) {
  const st = await readState(page);
  console.log(`  课程名: ${JSON.stringify(st.name)}`);
  console.log(`  页面上的 tab: ${JSON.stringify(st.tabs.map((t) => t.text))}`);
  console.log(`  当前选中: ${JSON.stringify(st.activeTab)}`);
  console.log(`  视频区: ${st.hasVideo ? "有" : "无"} ｜ 第一课时封面: ${st.hasPoster ? "有" : "无"}`);
  if (ctx) {
    ctx.set("courseDetailName", st.name);
    ctx.set("courseDetailActiveTab", st.activeTab);
  }
  return page;
}

/**
 * 校验课程详情页是否符合需求（**只读**）。
 *
 * @param {{期望默认选中的tab?: string}} _kwargs 表格里用「参数1」传期望的默认 tab（课程介绍 / 课程目录）
 *
 * 断言取自需求 713367615 原文：
 *   · 页面是**学习页**（.course-detail）
 *   · 有「课程介绍 / 课程目录」两个 tab，且**默认选中**期望的那个
 *     （未开始学习 -> 课程介绍；已开始学习 -> 课程目录）
 *   · **展示课程标题**（.course-name 非空）
 *   · 展示**第一课时的封面和视频**（视频容器 + 封面图都在）
 */
async function assertRules(page, { expectActiveTab } = {}, ctx = null) {
  const fg = (await findCourseDetailPage(page)) || (await base.foreground(page));
  const st = await readState(fg);
  const problems = [];

  for (const t of TABS) {
    if (!st.tabs.some((x) => x.text === t)) problems.push(`页面上找不到 tab「${t}」（需求要求有「课程介绍 / 课程目录」）`);
  }
  if (!st.activeTab) {
    problems.push("两个 tab 里没有任何一个处于选中态（读不到 nut-tabs-titles-item-active）");
  }
  const want = String(expectActiveTab || "").trim();
  if (want && st.activeTab !== want) {
    problems.push(`默认选中的是「${st.activeTab}」，期望「${want}」（未开始学习应为课程介绍，已开始学习应为课程目录）`);
  }
  if (!st.name) problems.push("页面上读不到课程标题（.course-name 是空的）—— 需求要求展示课程标题");
  if (!st.hasVideo) problems.push("没有视频区（.eco-video-container）—— 需求要求展示第一课时的视频");
  if (!st.hasPoster) problems.push("没有第一课时封面（.wx-video-poster）—— 需求要求展示第一课时的封面");

  if (problems.length) {
    throw new Error(
      "课程详情页不符合需求（713367615）：\n  - " +
        problems.join("\n  - ") +
        `\n  实测: ${JSON.stringify({ 课程名: st.name, tab: st.tabs, 选中: st.activeTab, 视频: st.hasVideo, 封面: st.hasPoster })}`
    );
  }
  console.log(
    `断言通过: 课程详情页有「课程介绍 / 课程目录」两个 tab，默认选中「${st.activeTab}」，` +
      `展示课程标题「${st.name}」+ 第一课时封面和视频`
  );
  if (ctx) {
    ctx.set("courseDetailChecked", true);
    ctx.set("courseDetailActiveTab", st.activeTab);
  }
  return fg;
}

/**
 * 打开某门课的详情页（自导航）：学习中心 → 课程 tab → 按名字点课程 → 等 `.course-detail`。
 * @param {string} courseName 课程名（跟列表上一字不差，例如 717）
 */
async function openByName(page, courseName, { timeout = 15000 } = {}) {
  if (!courseName) throw new Error("「打开课程详情」需要填课程名（参数1），例如 717");
  if (await isOn(page)) {
    // 已经在课程详情页：如果就是要看这门课，直接返回；否则先回学习中心列表
    const st = await readState(page);
    if (st.name === String(courseName)) {
      console.log(`已在课程详情页「${st.name}」，跳过导航（幂等）`);
      return base.foreground(page);
    }
  }
  const learnCenter = require("./learn_center_page");
  page = await learnCenter.ensureOnColumnList(page);
  page = await learnCenter.switchToTopTab(page, { tab: "课程" });
  await base.tapText(await base.foreground(page), String(courseName), `课程「${courseName}」`);
  const ok = await base.waitUntil(async () => (await base.countOf(await base.foreground(page), SEL.page)) > 0, { timeout });
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      `点了课程「${courseName}」但没有进入课程详情页（未出现 ${SEL.page}）。\n` +
        `  当前页面前 160 字: ${JSON.stringify((await base.pageText(now)).slice(0, 160))}`
    );
  }
  console.log(`已进入课程详情页（点了「${courseName}」）`);
  return base.foreground(page);
}

/* ============================================================================
 * 需求 713367615 第 2 条：未购买用户点课时，**封面图和标题不该变**（始终显示课程名称）
 * ============================================================================
 * 实测（2026/10/12，未购买课程「7.8课程new」，我们账号只买过 717）：
 *   · 页面上先出现「购买课程后才可以观看哦～ 购买」——未购买态
 *   · 课程名渲染在 `wx-view.fs-34.text-blacks88.font-medium.break-all`（**不是** `.course-name`，
 *     后者在未购买页上是空的 —— 所以判"标题"不能只认 `.course-name`）
 *   · 点第一个课时（第1课）之后：课程名元素与视频/封面区**都没有变化** ✓
 */

/** 找"文本正好等于课程名"的那个元素（标题判据用它，兼容两种页面写法） */
async function findTitleElement(page, courseName) {
  const fg = (await findCourseDetailPage(page)) || (await base.foreground(page));
  return fg.evaluate((name) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (norm(el.innerText) !== name) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 10) continue;
      return {
        cls: String(el.getAttribute("class") || "").slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        text: norm(el.innerText),
      };
    }
    return null;
  }, String(courseName || "").trim());
}

/** 点「课程目录」tab，再点第一个课时（未购买用户点课时按需求"什么都不该发生"） */
async function clickFirstLesson(page) {
  const fg = await base.foreground(page);
  if ((await base.countOfText(fg, "课程目录")) === 0) {
    throw new Error("这个课程详情页上没有「课程目录」tab —— 没法点课时");
  }
  await base.tapText(fg, "课程目录", "tab「课程目录」");
  await base.sleep(1200);

  const lesson = await base.foreground(page).then((p) =>
    p.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const t = norm(el.innerText);
        if (!/^第\s*1\s*课/.test(t) || t.length > 40) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 20) continue;
        return { text: t, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
      }
      return null;
    })
  );
  if (!lesson) throw new Error("「课程目录」里找不到「第1课」条目");
  await base.tapText(await base.foreground(page), "第1课", `第一个课时（${lesson.text}）`);
  await base.sleep(1800);
  return lesson;
}

/**
 * 校验需求 713367615 第 2 条（**只读**）：未购买用户点课时 -> 封面图和标题都不变、仍显示课程名。
 * @param {{课程名?: string}} 表格里用「参数1」传课程名（要跟列表上一字不差）
 */
async function assertUnpurchasedLessonRules(page, { courseName } = {}, ctx = null) {
  const name = String(courseName || "").trim();
  if (!name) throw new Error("「检查未购买点课时不改变封面标题」需要填课程名（参数1），例如 7.8课程new");

  const fg = (await findCourseDetailPage(page)) || (await base.foreground(page));
  const problems = [];

  // 前置：必须是"未购买"的样子，否则这条断言测的不是这个场景
  const text = await base.pageText(fg);
  if (!/购买课程后才可以观看|购买后|去购买/.test(text)) {
    problems.push(
      `这个页面看起来**不是未购买态**（没看到「购买课程后才可以观看」这类文案）。` +
        `请换一门我们账号没买过的课，或用「检查课程详情页符合需求」测已购买的情况`
    );
  }

  const beforeTitle = await findTitleElement(fg, name);
  const beforeState = await readState(fg);
  if (!beforeTitle) problems.push(`点课时之前，页面上找不到课程名「${name}」（需求要求始终显示课程名称）`);
  if (problems.length) throw new Error("前置条件不满足：\n  - " + problems.join("\n  - "));

  const lesson = await clickFirstLesson(fg);
  const afterTitle = await findTitleElement(await base.foreground(page), name);
  const afterState = await readState(await base.foreground(page));

  if (!afterTitle) {
    problems.push(`点课时之后，页面上**看不到课程名**「${name}」了 —— 需求要求始终显示课程名称`);
  } else if (JSON.stringify(afterTitle.rect) !== JSON.stringify(beforeTitle.rect) || afterTitle.text !== beforeTitle.text) {
    problems.push(
      `点课时之后标题变了：${JSON.stringify(beforeTitle)} -> ${JSON.stringify(afterTitle)}` +
        `（需求：未购买用户点课时**不改变标题**，始终显示课程名称）`
    );
  }
  if (JSON.stringify(afterState.coverPreview) !== JSON.stringify(beforeState.coverPreview)) {
    problems.push(
      `点课时之后封面/视频区变了：${JSON.stringify(beforeState.coverPreview)} -> ${JSON.stringify(afterState.coverPreview)}`
    );
  }

  if (problems.length) {
    throw new Error("课程详情页不符合需求（713367615 第 2 条）：\n  - " + problems.join("\n  - "));
  }
  console.log(
    `断言通过: 未购买用户点课时「${lesson.text}」之后，标题仍是课程名（元素与位置都没变），封面/视频区也没变`
  );
  if (ctx) {
    ctx.set("unpurchasedCourse", name);
    ctx.set("unpurchasedLessonClicked", lesson.text);
  }
  return base.foreground(page);
}

module.exports = {
  SEL,
  TABS,
  isOn,
  findCourseDetailPage,
  readState,
  logState,
  assertRules,
  openByName,
  findTitleElement,
  clickFirstLesson,
  assertUnpurchasedLessonRules,
};
