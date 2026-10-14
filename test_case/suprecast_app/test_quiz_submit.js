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
const { runDbTool, runTool, makeWriteSwitchStep } = require("../../common/db_tool");
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

/** 提交前快照：记下账号余额（对账时要比"这一笔到底到账多少"） */
let pointsBefore = null;
async function snapshotBeforeSubmit(page) {
  const out = runTool("quizScore", ["--activity-name", activityTitle, "--mode", "points"]);
  const line = (out.match(/^\[QUIZSCORE\].*$/m) || [""])[0];
  const m = line.match(/points=(\d+)/);
  if (!m) {
    throw new Error(
      `读不到提交前的账号余额（工具输出里没有 points=…）。\n` +
        `  这一句很关键：没有它就没法验证"发多少到账多少"和"答错扣没扣分"。\n  拿到的是：${line}`
    );
  }
  pointsBefore = Number(m[1]);
  console.log(`  提交前快照：账号余额 ${pointsBefore}`);
  return page;
}

/**
 * 跑之前先看一眼：**本机前端是不是还留着上一次提交的状态**。
 *
 * 为什么要有这一步（2026/10/13 真踩到）：数据库那边的答卷我们已经复位删掉了，但**小程序前端
 * 把它记在本地**（跑完会弹「答题完成 +积分」弹窗、底部按钮显示「已参加本次活动」）。
 * 此时再跑同一条用例，它会进来就停在"已参加"，答不了也提交不了 ——
 * 那是**环境状态没归零**，不是产品/框架坏了。所以这里明确记「跳过」并说清怎么归零，
 * 而不是红一条（红一条会让人以为产品又坏了）。
 */
async function assertRetakeable(page) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  const st = await quizPage.state(fg);
  const alreadyDone = /已参加|已提交/.test(text) || /已参加|已提交/.test(st.submitText || "");
  if (!alreadyDone) return page;

  const e = new Error(
    "本次打不开「能答题」的状态：小程序前端还留着上一次提交的痕迹" +
      "（页面上有「已参加本次活动」或「答题完成」弹窗）。\n" +
      "  说明：数据库里我们**已经复位**了（答卷记录删掉了），残留的是**小程序本机的状态**。\n" +
      "  怎么办：把小程序划掉重开（或换一条活动）再跑；刚跑完就立刻重跑同一活动必定撞到这个。\n" +
      `  当前按钮文本：${JSON.stringify(st.submitText)}；进度：${JSON.stringify(st.progressText)}`
  );
  e.preconditionNotMet = true;
  throw e;
}

/**
 * 对账：需求 713594985 里跟"分"有关的规则（2026/10/13 补，owner 当天给了权限）。
 *
 * 断言只挑**不依赖"还原产品侧当日计数器"**的不变式 —— 这一点是被现实教会的：
 *   产品按"今日剩余额度"截断（实测：今天已得 1031，所以一笔应得 1021 的只发了 969），
 *   但**那个计数器不在我们能读的表里**（`point_change_record` 里没有今天的发放，
 *   `point_rank_record` 是周/月的排行、隔一段时间才同步）。而且我们的复位会把答卷删掉，
 *   删掉之后连"照答卷求和"都还原不出产品记的数了。
 *   → 所以不写"实得 == min(应得, 我算的剩余)"这种断言：那会在正确的产品行为上**假红**。
 *
 * 真正能钉死的四条：
 *   1. **不会多发**：实得 <= 应得；
 *   2. **到账一致**：提交后余额 − 提交前余额 == 实得（发多少、到账多少）；
 *   3. **答错不扣分**：答对 0 题时，实得 == 0 且余额**不得减少**；
 *   4. **截断是看得见的**：实得 < 应得时，明确打出"发生了截断"（这是 C 那条需求的观察点）。
 */
async function assertScoreAccounting(page) {
  const out = runTool("quizScore", ["--activity-name", activityTitle]);
  const line = (out.match(/^\[QUIZSCORE\].*$/m) || [""])[0];
  if (!line || line.includes("submits=0")) {
    throw new Error(`对账失败：库里读不到刚才那次提交（工具输出：${line || "没有 [QUIZSCORE] 行"}）`);
  }
  const kv = {};
  for (const part of line.replace("[QUIZSCORE] ", "").split(/\s+/)) {
    const i = part.indexOf("=");
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  }
  const n = (k) => Number(kv[k]);
  const problems = [];
  const pointsAfter = n("points");
  const gained = pointsAfter - pointsBefore;

  // ① 不会多发
  if (n("actual") > n("should")) {
    problems.push(`发放超过了应得：应得 ${kv.should}、实得 ${kv.actual}（应得是上限）`);
  }

  // ①b 判分口径：拿答案键独立复算一遍，跟库里的答对数/应得对上
  //     （这条能钉住"多选：所选集合必须与答案集合完全一致" —— 少选、多选都算错）
  //     复算的前提是"每题点了前 1 个选项"（就是 quizPage.answerAllQuestions 的选法）；
  //     哪天改了选法，这条会红 —— 那正是要人来看一眼的地方。
  const keyOut = runTool("quizAnswerKey", ["--activity-name", activityTitle]);
  const keyLine = (keyOut.match(/^\[ANSWERKEY\].*$/m) || [""])[0];
  const key = {};
  for (const part of keyLine.replace("[ANSWERKEY] ", "").split(/\s+/)) {
    const i = part.indexOf("=");
    if (i > 0) key[part.slice(0, i)] = part.slice(i + 1);
  }
  if (!keyLine) {
    console.log("  [说明] 读不到答案键（工具没输出 [ANSWERKEY] 行），跳过判分复算这条子检查");
  } else {
    if (Number(key.expected_correct) !== n("correct")) {
      problems.push(
        `判分对不上（答案键复算）：按「每题选前 1 个选项 + 多选须集合完全一致」应当是 ` +
          `${key.expected_correct} 题对，但库里 correct_count=${kv.correct}`
      );
    }
    if (Number(key.expected_should) !== n("should")) {
      problems.push(
        `应得对不上（答案键复算）：按答案键应当是 ${key.expected_should} 分，但库里 should_point=${kv.should}`
      );
    }
    console.log(
      `  答案键复算：${key.questions} 题（其中多选 ${key.multi} 题）→ 应当答对 ${key.expected_correct} 题、` +
        `应得 ${key.expected_should} 分；库里 ${kv.correct} 题 / ${kv.should} 分，一致`
    );
  }

  // ② 到账一致：余额增量必须等于这一笔的实得
  if (!Number.isFinite(gained) || gained !== n("actual")) {
    problems.push(
      `到账对不上：提交前余额 ${pointsBefore}、提交后余额 ${pointsAfter}，增量 ${gained}，` +
        `但库里这一笔的实得是 ${kv.actual}\n` +
        `    （若增量比实得多，可能是这期间有别的收益；比实得少或为负，就是这一笔没按实得发放）\n` +
        `    排查口径（2026/10/14 真遇到过一次"发放记录有、余额一分没动"）：\n` +
        `      python tools/points_credit_check.py --user <账号>   # 只读，看余额最后变动时间 + 今天发了多少\n` +
        `      若"余额最后变动"不在今天、而"今天连任务分也没进余额"，那是**环境/产品侧的发放链路**没生效，\n` +
        `      不是框架的对账写错了 —— 把这条输出发给开发确认（积分服务有没有在跑、库有没有指对）。\n` +
        `      详见 docs/踩坑记录.md 坑 42`
    );
  }

  // ③ 答错不扣分
  if (n("correct") === 0) {
    if (n("actual") !== 0) {
      problems.push(`一题没答对却发了 ${kv.actual} 分（需求：答对才得分）`);
    }
    if (gained < 0) {
      problems.push(`答错后余额减少了 ${-gained} 分 —— 需求原文是「答错不扣分」`);
    }
  }

  if (problems.length) {
    throw new Error(
      "判分/发放对账不通过（需求 713594985）：\n  - " +
        problems.join("\n  - ") +
        `\n  原始数据: ${line}`
    );
  }

  if (n("actual") < n("should")) {
    console.log(
      `  【截断】应得 ${kv.should}、实得 ${kv.actual} —— 产品按「今日剩余额度」少发了 ` +
        `${n("should") - n("actual")} 分（owner 口径：到上限不再发放）。` +
        `今日已得参考值 ${kv.today_before}（按报表折算，仅供定位）／上限 ${kv.cap_on === "1" ? kv.cap : "未启用"}`
    );
  }
  console.log(
    `  断言通过: 答对 ${kv.correct}/${kv.questions} 题，应得 ${kv.should}、实得 ${kv.actual}，` +
      `余额 ${pointsBefore} → ${pointsAfter}（增量与实得一致）` +
      `${n("correct") === 0 ? "，且没有扣分" : ""}`
  );
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
    // 3b. 前端状态残留就记跳过（数据库复位了、小程序本机没归零）
    [assertRetakeable, null],

    // 4. 逐题作答（需求：答完全部题目才能提交）
    [quizPage.answerAllQuestions, { allowInteract: true }],
    [assertReadyToSubmit, null],

    // 5. 提交 —— 全程唯一会写数据的一步
    [snapshotBeforeSubmit, null],
    [quizPage.submitAnswers, { allowSubmit: true }],
    [assertSubmittedState, null],

    // 6. 数据库交叉验证 + 复位（把这次跑出来的记录清掉，手机与数据都交还）
    [assertDbHasSubmit, null],
    [assertScoreAccounting, null],
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
