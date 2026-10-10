/*
 * @project_name: UITest
 * @cur_file: test_quiz_activity.js
 * @create_date: 2026/10/10
 *
 * 用例：首页活动卡 -> 进入答题活动页 -> 校验界面要素与状态
 *
 * 流程：
 *   1. 自导航到答题活动页（退出一级页 -> 点底部 tab「有问必答」-> 找并点「答题」活动卡）
 *   2. 断言答题页要素齐全（根容器 / 标题 / 选项 / 提交按钮）
 *   3. 打印并记录当前状态（进度、选项、提交按钮是否禁用）
 *   4. 选择第一个选项（按状态：已答完则跳过，因为选项已锁定）
 *   5. 提交（**默认不执行**，见下）
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 为什么默认不提交：这台设备用的是**真实账号**
 * ---------------------------------------------------------------------------
 * 本用例的知识与骨架来自另一份工作副本（原仓库）的 `test_quiz_activity.js`，
 * 但那版在"题目已答完"的状态下仍会点选项并提交。我们的差异：
 *   - 选择选项：纯前端选中态，不改服务端数据 -> 执行 + 断言选中态
 *   - **提交答案：会真的写数据** -> 由下面的 ALLOW_SUBMIT 控制，默认 false
 * 测试环境没有独立测试账号（owner 已确认），所以这个开关是数据安全阀，不是保守。
 * 要跑完整提交链路时把 ALLOW_SUBMIT 改成 true。
 *
 * 前置条件（框架不代劳，但本用例会自导航）：
 *   - 微信已登录，目标小程序已打开（起始页任意）
 *   - 首页活动卡区里存在「答题」卡（活动下线时会明确报"卡不在"，而不是判成框架 bug）
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  assertSelectorExists,
  assertSelectorCount,
  assertTextVisible,
  dumpElements,
} = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const quizPage = pages.quizPage;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

// 数据安全阀（两个，都默认 false）。改动前请先读 pages/quiz_activity_page.js 的文件头说明。
//   ALLOW_INTERACT：是否允许点选项 —— 存在"选中即自动提交"的存疑，故默认关闭
//   ALLOW_SUBMIT  ：是否允许点提交 —— 确定会写数据
const ALLOW_INTERACT = false;
const ALLOW_SUBMIT = false;

(async () => {
  const funcList = [
    // 步骤 1：自导航到答题活动页（幂等）
    [quizPage.ensureOn, null],

    // 断言：确实在答题页 —— 判据用结构选择器，比"页面含某段文案"可靠
    // （文案判据会被后台标签页骗：后台页也读得到内容）
    [assertSelectorCount, { selector: quizPage.SEL.quizPage, expected: 1 }],

    // 断言：界面要素齐全。
    // 这里刻意用 assertSelectorCount 钉住数量而不是"≥1"：
    // 实测 [class*="activity-quiz-submit"] 会多命中一个外层包裹元素，
    // 用"恰好 1 个"能把这种"选择器吃多了"的坑当场抓住（账本根因 11 的同类问题）。
    [assertSelectorExists, { selector: quizPage.SEL.title }],
    [assertSelectorCount, { selector: quizPage.SEL.submit, expected: 1 }],
    [assertSelectorCount, { selector: quizPage.SEL.option, expected: 2 }],

    // 断言：进度提示存在（形如「已答：0/1」，实测在其它页不出现）
    [assertTextVisible, { text: "已答" }],

    // 步骤 3：打印并记录状态（进度/选项/提交按钮），只读
    [quizPage.logState, null],

    // 步骤 4：选第一个选项（默认关闭；已答完时也会跳过 —— 那时选项已锁定，硬点只会得到假失败）
    [quizPage.selectFirstOption, { allowInteract: ALLOW_INTERACT }],

    // 步骤 5：提交（默认关闭，见文件头说明）
    [quizPage.submitIfAllowed, { allowSubmit: ALLOW_SUBMIT }],

    // 附加：打印答题页结构，便于后续写更多断言
    [dumpElements, { tag: ["wx-view", "wx-text"] }],
  ];

  await appTest(funcList, {
    photosPath,
    meta: { feature: "首页活动", story: "答题活动", title: "进入答题页并校验状态" },
  });

  console.log("\n" + "=".repeat(60));
  console.log("test_quiz_activity.js 执行完成（全部步骤通过）");
  console.log("=".repeat(60));
})().catch((e) => {
  // 前置条件不满足（如活动未上线）-> 退出码 3 -> conftest 转成 pytest 的 SKIPPED。
  // 区分"用例不适用"与"用例失败"很重要：混在一起会让报告里长期躺着一条假失败。
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  // 必须保留：让 node 以非 0 退出码结束，pytest 才能感知失败
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
