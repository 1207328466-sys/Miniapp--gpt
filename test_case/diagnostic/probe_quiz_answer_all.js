/*
 * 诊断（不以 test_ 开头，pytest 不收集）：把 15 题都答上，但**不提交**。
 *
 * 目的：单独验证"按题作答"这条新能力（滚动 + 逐题点击 + 逐题验证选中态）。
 * 为什么不提交：需求写明「如未提交已选的选项不会保存」—— 也就是说这份选择是临时的，
 * 所以这一步对数据零影响，可以放心反复跑。真正写库的提交在写链路用例里，
 * 而且要先设 UITEST_ALLOW_SUBMIT=1 才会执行。
 *
 * 运行：node test_case/diagnostic/probe_quiz_answer_all.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const quizPage = pages.quizPage;

async function probe(page) {
  page = await quizPage.ensureOn(page);
  page = await quizPage.answerAllQuestions(page, { allowInteract: true });

  const st = await quizPage.state(page);
  const qs = await quizPage.readQuestions(page);
  const checked = qs.map((q) => q.options.filter((o) => o.checked).length);
  console.log("\n=== 答完之后 ===");
  console.log("  进度: %s", JSON.stringify(st.progressText));
  console.log("  提交按钮: %s 禁用=%s", JSON.stringify(st.submitText), st.submitDisabled);
  console.log("  每题选中个数: %s", JSON.stringify(checked));
  console.log("  全部题都选中了吗: %s", checked.every((c) => c >= 1) ? "是" : "否");

  // 不提交，直接离开（选择本来就是临时的，不会保存）
  page = await base.ensureOnTabPage(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "答题页", title: "逐题作答演练（不提交）" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
