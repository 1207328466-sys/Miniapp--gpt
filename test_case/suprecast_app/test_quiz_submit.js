/*
 * @project_name: UITest
 * @cur_file: test_quiz_submit.js
 * @create_date: 2026/10/12
 *
 * 用例：答题的**写链路** —— 复位 -> 逐题作答 -> 提交 -> 界面断言 -> 数据库校验 -> 再复位
 *
 * 【为什么这条用例值得单独存在】
 * 到 2026/10/12 为止，框架能自动化的都是「只读」的需求。需求 713594985 里那段
 * 「登录用户须答完全部题目才能提交 / 提交后按钮变成已提交已参加」——恰恰要**真的提交一次**
 * 才测得到。owner 当天拍板：允许在测试库里删自己测试留下的记录（docs/待owner拍板.md Q2），
 * 于是「跑 -> 复位 -> 再跑」这条路才成立，这条用例也就有了存在的基础（Q3）。
 *
 * 【开关】
 *   `UITEST_ALLOW_SUBMIT=1` —— 不设就**记跳过**（不是失败，也不是偷偷跑）。
 *   为什么默认不跑：这台设备用的是 owner 的**真实账号**，提交会真的写库。
 *   点选项不需要开关：已用数据库实验证明只改前端选中态、不写库（账本第二十一节）。
 *
 * 【数据安全：跑前跑后都复位】
 * 用 `tools/quiz_data_cleanup.py`，而且**按活动名**定位（不按 id）——
 * 首页那张「答题」卡背后的活动会换人（实测见过 347、349 两个），写死 id 会指到别的活动上，
 * 那就是「清错数据」事故。名字对不上、或有重名时，工具会拒绝执行（宁可停，也不猜）。
 * 复位只删**我们这个测试活动**的记录；数据库名不像测试库时工具也会拒绝（--force-db 才放行）。
 *
 * 运行（PowerShell）：
 *   $env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 答题写链路
 * 只想用 node 单跑：
 *   $env:UITEST_ALLOW_SUBMIT="1"; node test_case/suprecast_app/test_quiz_submit.js
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const { runDbTool, makeWriteSwitchStep } = require("../../common/db_tool");
const { assertSelectorExists } = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const quizPage = pages.quizPage;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

const ALLOW_SUBMIT = process.env.UITEST_ALLOW_SUBMIT === "1";

/** 第一道闸：没打开写开关就记「跳过」（实现与文案在 common/db_tool.js，只有一份） */
const requireSubmitSwitch = makeWriteSwitchStep("答题写链路");

// 这次用例打开的是哪个活动（复位时要按它定位）。由第 2 步填上。
let activityTitle = "";


/** 记住这次打开的是哪个活动 —— 后面的复位/校验全靠它定位 */
async function rememberActivity(page, _kwargs, ctx) {
  const st = await quizPage.state(page);
  activityTitle = st.title;
  if (!activityTitle) {
    throw new Error(
      "读不到活动标题（.activity-quiz-card__title）。\n" +
        "  后面要按活动名复位数据，读不到名字就没法安全定位 -> 这里直接停，不猜。\n" +
        `  当前页面前 200 字: ${JSON.stringify((await base.pageText(await base.foreground(page))).slice(0, 200))}`
    );
  }
  console.log(`  本次活动：${JSON.stringify(activityTitle)}；进度 ${JSON.stringify(st.progressText)}`);
  console.log(`  这题是${st.total > 1 ? `多选题库活动（${st.total} 题）` : "单题活动"}`);
  if (ctx) ctx.set("quizActivityTitle", activityTitle);
  return page;
}

/**
 * 复位（跑前、跑后都用它）。
 *
 * 为什么非要检查 `mode=clean`：工具可能因为**拒绝执行**（库名不像测试库、名字不唯一、
 * 量太大）而以退出码 2 结束 —— 那时它一条都没删。如果这里只看"命令跑完了"，
 * 就会带着"数据已经清干净"的错误前提往下跑，最后失败在别的地方（典型的静默失败）。
 */
async function cleanupAnswers(page) {
  const out = runDbTool(["--activity-name", activityTitle, "--yes"]);
  const line = (out.match(/^\[CLEANUP\].*$/m) || [""])[0];
  if (!line.includes("mode=clean")) {
    throw new Error(`复位没有成功（没看到 mode=clean）：${line || "工具没输出 [CLEANUP] 行"}`);
  }
  return page;
}

/** 断言：题目答完了 -> 进度满、提交按钮可用（需求：答完全部题目才能提交） */
async function assertReadyToSubmit(page, _kwargs, ctx) {
  const st = await quizPage.state(page);
  const problems = [];
  if (st.answered === null || st.total === null) {
    problems.push(`读不到进度（现在读到的是 ${JSON.stringify(st.progressText)}）`);
  } else if (st.answered < st.total) {
    problems.push(`还没答完：${st.progressText}`);
  }
  if (st.submitDisabled) problems.push("提交按钮仍是禁用态（答完了却点不了，两者应当一致）");
  if (problems.length) {
    throw new Error("答完之后的状态不符合需求（713594985）：\n  - " + problems.join("\n  - "));
  }
  console.log(`  断言通过: 已答 ${st.answered}/${st.total}，提交按钮可用（文本 ${JSON.stringify(st.submitText)}）`);
  if (ctx) ctx.set("quizReadyToSubmit", true);
  return page;
}

/** 断言：提交后的样子（需求：「提交后按钮变成已提交已参加本次活动状态，不可再次点击」） */
async function assertSubmittedState(page, _kwargs, ctx) {
  const fg = await base.foreground(page);
  const st = await quizPage.state(fg);
  const text = await base.pageText(fg);
  const submitCount = await base.countOf(fg, quizPage.SEL.submit);
  const problems = [];

  if (!/已提交|已参加/.test(text)) {
    problems.push("页面上找不到「已提交 / 已参加」字样");
  }
  // 「不可再次点击」：按钮要么没了、要么禁用、要么文案已经不是「提交」
  const stillClickable = submitCount > 0 && !st.submitDisabled && st.submitText === "提交";
  if (stillClickable) {
    problems.push(
      `提交按钮看起来还能再点（命中 ${submitCount} 个，文本 ${JSON.stringify(st.submitText)}，禁用=${st.submitDisabled}）`
    );
  }
  if (problems.length) {
    throw new Error(
      "提交后的页面不符合需求（713594985）：\n  - " +
        problems.join("\n  - ") +
        `\n  实测: ${JSON.stringify({
          submitCount,
          submitText: st.submitText,
          submitDisabled: st.submitDisabled,
          pageText: text.slice(0, 200),
        })}`
    );
  }
  console.log(
    `  断言通过: 提交后不可再点（按钮命中 ${submitCount} 个，文本 ${JSON.stringify(st.submitText)}，禁用=${st.submitDisabled}）`
  );
  if (ctx) ctx.set("quizSubmitStateVerified", true);
  return fg;
}

/**
 * 数据库侧交叉验证：界面上说"提交成功"，库里到底有没有这一条？
 *
 * 为什么非要看库：界面的"已提交"是前端状态 —— 之前踩过「前端显示已答、库里一条没有」的坑
 * （账本第二十一节）。写链路的验证必须落到"库里真有这条记录"，光看界面是自说自话。
 */
async function assertDbHasSubmit(page) {
  const out = runDbTool(["--activity-name", activityTitle, "--expect-submits", "1"]);
  const m = out.match(/submits=(\d+)/);
  if (!m || Number(m[1]) !== 1) {
    throw new Error(`数据库校验失败：期望该活动有 1 条提交记录，实际读到 ${m ? m[1] : "(没解析出数字)"} 条`);
  }
  console.log("  断言通过: 数据库里确实多了 1 条提交记录（界面说的和库里存的对上了）");
  return page;
}

(async () => {
  const funcList = [
    // 0. 开关没开就跳过（先看开关，别先动手机）
    [requireSubmitSwitch, null],

    // 1. 打开答题活动页（自导航，幂等）
    [quizPage.ensureOn, null],
    [assertSelectorExists, { selector: quizPage.SEL.quizPage }],

    // 2. 记住活动名（复位要靠它定位）
    [rememberActivity, null],

    // 3. 跑前复位：把上次留下的记录清掉，这样这次"能答、能提交"
    [cleanupAnswers, null],

    // 4. 逐题作答（需求：答完全部题目才能提交）
    [quizPage.answerAllQuestions, { allowInteract: true }],
    [assertReadyToSubmit, null],

    // 5. 提交 —— 全程唯一会写数据的一步
    [quizPage.submitAnswers, { allowSubmit: true }],
    [assertSubmittedState, null],

    // 6. 数据库交叉验证 + 复位（把这次跑出来的记录清掉，手机与数据都交还）
    [assertDbHasSubmit, null],
    [cleanupAnswers, null],

    // 7. 回到首页（下一条用例的起点）
    [pages.qaPage.ensureOnHomeFeed, null],
  ];

  try {
    await appTest(funcList, {
      photosPath,
      meta: { feature: "答题", story: "写链路", title: "答题写链路：逐题作答→提交→校验→复位" },
    });
    console.log("\n" + "=".repeat(60));
    console.log("test_quiz_submit.js 执行完成（写链路全部步骤通过）");
    console.log("=".repeat(60));
  } finally {
    // 万一中间某一步失败了，也要把数据复位掉 ——
    // 失败时留下一条"半提交"的记录，下一个人会莫名其妙地不能答题。
    if (ALLOW_SUBMIT && activityTitle) {
      try {
        runDbTool(["--activity-name", activityTitle, "--yes"]);
      } catch (e) {
        console.error("[收尾] 复位失败（需要人工看一眼）：" + e.message);
      }
    }
  }
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
