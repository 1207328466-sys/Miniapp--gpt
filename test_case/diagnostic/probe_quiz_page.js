/*
 * 诊断（不以 test_ 开头，pytest 不收集）：现在的「答题」卡打开的是哪种活动？
 *
 * 为什么要看：需求 713594985 的断言里有「选项 2~6 个（按每道题算）」，
 * 而线上先后出现过**单题判断题**（1 题）和**开发造的 15 题题库活动**（整页渲染全部选项）。
 * 两种形态下，"一道题的边界在哪"完全不同 —— 写提交链路（要答完全部题才能提交）之前，
 * 必须先看清现在是哪种，以及多题活动下每道题的容器是什么（坑 16 一直卡在这）。
 *
 * 只读：只导航 + 读 DOM，不点选项、不提交。
 * 运行：node test_case/diagnostic/probe_quiz_page.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const quizPage = pages.quizPage;

async function probe(page) {
  page = await quizPage.ensureOn(page);
  await quizPage.logState(page);

  const fg = await base.foreground(page);
  const info = await fg.evaluate((sel) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

    // 1) 选项行的外层容器长什么样（多题活动里"一道题"的边界靠它认）
    const ancestors = [];
    const first = document.querySelector(sel.option);
    let n = first;
    for (let i = 0; i < 6 && n; i++) {
      ancestors.push({
        tag: n.tagName.toLowerCase(),
        cls: String(n.getAttribute("class") || "").slice(0, 90),
        options: n.querySelectorAll(sel.option).length,
      });
      n = n.parentElement;
    }

    // 2) 候选"题目容器"：谁的 class 里带 question / card / item，且各自含几个选项
    const containers = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      if (!/question|quiz-card|quiz-item/i.test(c)) continue;
      const box = el.getBoundingClientRect();
      containers.push({
        cls: c.slice(0, 80),
        options: el.querySelectorAll(sel.option).length,
        rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
        text: norm(el.innerText).slice(0, 40),
      });
      if (containers.length >= 12) break;
    }

    return {
      optionCount: document.querySelectorAll(sel.option).length,
      submitCount: document.querySelectorAll(sel.submit).length,
      ancestors,
      containers,
      pageText: norm(document.body.innerText).slice(0, 300),
    };
  }, { option: quizPage.SEL.option, submit: quizPage.SEL.submit });

  console.log("\n选项行总数: %d，提交按钮命中: %d", info.optionCount, info.submitCount);
  console.log("\n=== 第一个选项的外层（逐层往外）===");
  info.ancestors.forEach((a, i) =>
    console.log("  %d 层: <%s class=%s> 内含选项 %d 个", i, a.tag, a.cls, a.options)
  );
  console.log("\n=== class 里带 question / quiz-card / quiz-item 的容器 ===");
  if (!info.containers.length) console.log("  （没有）");
  info.containers.forEach((c) =>
    console.log("  <%s> 选项 %d 个 位置=%s 文字=%s", c.cls, c.options, JSON.stringify(c.rect), JSON.stringify(c.text))
  );
  console.log("\n页面文字前 300 字:\n  %s", info.pageText);

  page = await quizPage.ensureOn(page, {});
  page = await base.ensureOnTabPage(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "答题页", title: "看答题页是单题还是多题" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
