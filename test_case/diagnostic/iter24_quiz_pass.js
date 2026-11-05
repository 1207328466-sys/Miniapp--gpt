/* 迭代24：进入第二个训练营的课前自测，按正确答案作答并提交（期望通过） */
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
  console.log(`\n== ${name} ==\n${txt.slice(0, 700)}`);
  return fg;
}

async function openSecondCamp(page) {
  const fg = await base.foreground(page);
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
  const t = xs[xs.length - 1];
  const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
  const dev = await base.getDevice();
  await dev.shell(`input tap ${Math.round(t.x * dpr)} ${Math.round(t.y * dpr)}`);
  await base.sleep(4500);
  return base.foreground(page);
}

async function enterQuiz(page) {
  for (let i = 1; i <= 2; i++) {
    const fg = await base.foreground(page);
    if ((await base.pageText(fg)).includes("答题说明")) return fg;
    const btn = fg.locator("wx-view, wx-text").filter({ hasText: /^去答题$/ }).first();
    if (!(await btn.count())) return fg;
    await base.tapLocator(fg, btn, `去答题#${i}`);
    await base.sleep(3500);
  }
  return base.foreground(page);
}

/** 按「第几题 → 选项字母数组」作答（训练营答题页的真实结构是 .cq-options 分组 + .cq-option 行） */
async function answerPlan(page, plan) {
  for (let qi = 0; qi < plan.length; qi++) {
    for (const letter of plan[qi]) {
      const fg = await base.foreground(page);
      const group = fg.locator(".cq-options").nth(qi);
      if ((await group.count()) === 0) throw new Error(`第 ${qi + 1} 题的分组不存在`);
      const opt = group
        .locator(".cq-option")
        .filter({ has: fg.locator(".cq-option__badge", { hasText: new RegExp(`^${letter}$`) }) })
        .first();
      if ((await opt.count()) === 0) throw new Error(`第 ${qi + 1} 题找不到选项 ${letter}`);
      await base.tapLocator(fg, opt, `第${qi + 1}题${letter}`);
      await base.sleep(700);
    }
  }
  return base.foreground(page);
}

(async () => {
  await appTest([
    [
      async (page) => {
        let fg = await base.foreground(page);
        if (!(await base.pageText(fg)).includes("答题说明")) {
          page = await pages.qaPage.ensureOnHomeFeed(page);
          fg = await base.foreground(page);
          await base.tapBottomTab(fg, "学习中心");
          await base.sleep(3000);
          page = await openSecondCamp(page);
          page = await enterQuiz(page);
        }
        page = await dump(page, "39_quiz_before_answer");

        // 正确答案：Q1=A；Q2=A/B/C（多选需点三个）；Q3=A
        page = await answerPlan(page, [["A"], ["A", "B", "C"], ["A"]]);
        page = await dump(page, "40_quiz_answer_all");

        fg = await base.foreground(page);
        const submit = fg.locator("wx-view, wx-text").filter({ hasText: /^提交$/ }).first();
        if (await submit.count()) {
          await base.tapLocator(fg, submit, "提交");
          await base.sleep(4500);
        }
        page = await dump(page, "41_quiz_pass_result");
        return page;
      },
      null,
    ],
  ], { meta: { feature: "迭代24", title: "课前自测通过态" } });
})().catch((e) => {
  console.error("ERR", e.message.split("\n")[0]);
  process.exit(1);
});
