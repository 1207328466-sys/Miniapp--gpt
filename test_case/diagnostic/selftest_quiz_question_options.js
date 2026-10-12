/*
 * 离线自检（**不需要手机**）：答题页「选项 2~6 个且互不相同」这条规则，正反两面都验一遍。
 *
 * 为什么要有它：这条规则 2026/10/10 在多题活动上**没法验**（整页数选项数，数出 52 个，
 * 只能整体记跳过，见坑 16）。2026/10/12 拿到题目边界（一题 = 一个 `.quiz-card`）后改成逐题判，
 * 但线上此刻**没有多题活动可跑** —— 于是按项目惯例把规则抽成纯函数（`checkQuestionOptions`），
 * 用这份自检把"该红时会红"钉住，而不是靠"等下次线上出现多题活动"碰运气。
 *
 * 运行：node test_case/diagnostic/selftest_quiz_question_options.js
 * 退出码：0 = 全部符合预期；1 = 有不符合的
 */

const quizPage = require("../../app_sub_function/suprecast_app/pages/quiz_activity_page");

const check = quizPage.checkQuestionOptions;

let passed = 0;
const failed = [];

/** 正例：必须**一条问题都不报** */
function ok(name, questions) {
  const problems = check(questions);
  if (problems.length) {
    failed.push(`${name}：本该通过，却报出 ${JSON.stringify(problems)}`);
    return;
  }
  passed += 1;
  console.log(`OK   正例 ${name}`);
}

/** 反例：必须报错，且报错里包含 want 那句话 */
function bad(name, questions, want) {
  const problems = check(questions);
  const msg = problems.join(" / ");
  if (!problems.length) {
    failed.push(`${name}：本该报错（${want}）却通过了`);
    return;
  }
  if (!msg.includes(want)) {
    failed.push(`${name}：报错里没有「${want}」，实际是 ${msg}`);
    return;
  }
  passed += 1;
  console.log(`OK   反例 ${name} -> ${problems[0].slice(0, 60)}`);
}

const q = (head, texts) => ({ head, options: texts.map((t) => ({ text: t })) });

// ---------- 正例 ----------
ok("单题判断题（A 正确 / B 错误）", [q("1．判断题 未答", ["A 正确", "B 错误"])]);
ok("单题单选题 4 个选项", [q("5．单选题 未答", ["A 选项甲", "B 选项乙", "C 选项丙", "D 选项丁"])]);
ok("多选题库活动 15 题，每题选项都在 2~6 且不重复", [
  q("1．单选题 未答", ["A 甲", "B 乙"]),
  q("2．多选题 未答", ["A 甲", "B 乙", "C 丙", "D 丁", "E 戊", "F 己"]), // 正好 6 个
  q("3．判断题 未答", ["A 正确", "B 错误"]),
  q("4．单选题 未答", ["A 一", "B 二", "C 三"]),
]);
ok("正好 2 个选项（下界）", [q("1．判断题 未答", ["A 甲", "B 乙"])]);

// ---------- 反例 ----------
bad("某题只有 1 个选项", [q("1．单选题 未答", ["A 甲", "B 乙"]), q("2．单选题 未答", ["A 独苗"])], "第 2 题的选项应在 2~6");
bad(
  "某题有 7 个选项（超过上界）",
  [q("1．单选题 未答", ["A", "B", "C", "D", "E", "F", "G"])],
  "第 1 题的选项应在 2~6"
);
bad(
  "某题选项文字重复（序号不同、内容相同）",
  [q("1．单选题 未答", ["A 甲", "B 乙"]), q("2．多选题 未答", ["A 甲", "B 甲", "C 丙"])],
  "第 2 题的选项文字有重复"
);
ok("序号不同、内容也确实不同 -> 不算重复", [
  q("1．多选题 未答", ["A 甲", "B 乙", "C 丙"]),
  q("2．多选题 未答", ["A 甲乙", "B 乙甲"]),
]);
bad(
  "某题选项只有序号、没有内容（文字没渲染出来）",
  [q("1．单选题 未答", ["A 甲", "B", "C 丙"])],
  "第 1 题选项[1] 只有序号、没有内容"
);
bad("整页 52 个选项被当成一题（坑 16 的老场景）", [q("整页", new Array(52).fill("A 选项"))], "第 1 题的选项应在 2~6");

console.log();
if (failed.length) {
  console.log(`有 ${failed.length} 项不符合预期：`);
  failed.forEach((f) => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`全部通过（${passed} 项）`);
