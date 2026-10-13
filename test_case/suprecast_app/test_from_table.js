/*
 * @project_name: UITest
 * @cur_file: test_from_table.js
 * @create_date: 2026/10/10
 *
 * 「填表就能写用例」的执行端：把 cases/用例表.xlsx 里填的东西跑起来。
 *
 * 【数据是怎么流过来的】
 *   cases/用例表.xlsx  --(python tools/export_cases.py)-->  cases/用例表.json  -->  本文件
 *        人填这张表                                            机器读这个文件
 *   `python run.py` 每次开跑前会自动导出一次，所以正常流程不用手动执行导出脚本。
 *
 * 【一条用例 = 一个 pytest 用例项】
 * 表格里同一个「用例编号」的若干行合起来算一条用例。conftest.py 会读这份 json，
 * 为每条用例生成一个**独立**的 pytest 用例项（用例编号经环境变量 UITEST_CASE_ID 传进来），
 * 这样报告里每条用例各占一行"通过/失败"，而不是一大堆步骤捆成一条看不清是哪条挂了。
 * 直接用 node 跑本文件时没有 UITEST_CASE_ID，那时就把表格里的用例挨个跑完。
 *
 * 【动作 -> 页面对象 的映射就在下面的 HANDLERS】
 * 表里写的「动作」必须在这里有实现。json 里那份动作清单（由 Python 侧生成）会用来
 * 反向校验一次：清单里有、这里没实现 -> 直接报错退出。宁可报错，也不要静默跳过某一行。
 *
 * 【只读优先】
 * 表格是给人随手填的，所以默认只放开"看得见、不改数据"的动作：
 *   · 「点文字」会挡掉 提交/兑换/支付… 这类文字（见 BLOCKED_TEXT）
 *   · 「打开答题活动」只打开页面，不选选项、不提交（选选项会消耗答题机会）
 * 真要测会改数据的操作，得单独写用例并显式打开开关 —— 不能在表格里随手写一行就触发。
 */

const fs = require("fs");
const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  runTool,
  runDbTool,
  writeSwitchOn,
  writeSwitchOffError,
  dbUnreachable,
  dbUnreachableError,
} = require("../../common/db_tool");
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");
const caseCopy = require("../../app_sub_function/suprecast_app/case_copy");

const base = pages.base;
const qaPage = pages.qaPage;
const learnCenter = pages.learnCenter;
const quizPage = pages.quizPage;
const userCenter = pages.userCenter;
const pointsMall = pages.pointsMall;
const postDetail = pages.postDetail;
const caseLibrary = pages.caseLibrary;
const courseDetail = pages.courseDetail;

const TABLE_JSON = path.join(__dirname, "..", "..", "cases", "用例表.json");
const TABLE_XLSX = path.join(__dirname, "..", "..", "cases", "用例表.xlsx");
const PHOTO_ROOT = path.join(__dirname, "..", "..", "report", "photo_app", "表格用例");

// 默认禁止点的文字：这些字点下去会改真实数据（提交答卷、消耗积分兑换…）。
// 用"包含"匹配 —— 表里写「立即提交」「确认兑换」也会被挡住。
const BLOCKED_TEXT = [
  "提交", "兑换", "签到", "下单", "支付", "付款", "购买", "领取",
  "抽奖", "报名", "删除", "退出登录", "退款", "取消订单",
];

/**
 * 动作实现表。
 * 每个实现都是 `run(page, 参数1, 参数2, ctx) -> page`。
 * ⚠️ 必须返回 page：runAppSteps 会把返回值当成下一步的 page，返回 undefined 会让下一步直接崩。
 */
const HANDLERS = {
  回到首页: {
    // 逻辑在页面对象里（qaPage.ensureOnHomeFeed）：它不是"点一下"那么简单，而是
    // 导航 + 验证 + 必要时退出搜索视图再来一轮 —— 那属于"这个页面怎么用"的知识。
    run: (page) => qaPage.ensureOnHomeFeed(page),
  },

  切到用户中心: { run: (page) => userCenter.switchTo(page) },

  打开积分商城: { run: (page) => pointsMall.ensureOn(page) },

  打开学习中心专栏: {
    run: async (page) => {
      page = await learnCenter.ensureOnColumnList(page);
      return learnCenter.switchToColumnTab(page);
    },
  },

  打开搜索并输入: {
    run: async (page, keyword) => {
      page = await qaPage.openSearch(page);
      return qaPage.typeKeyword(page, { keyword });
    },
  },

  打开搜索页: { run: (page) => qaPage.openSearch(page) },

  输入搜索关键词: {
    // 「打开搜索并输入」= 进搜索页 + 输入（一条龙）；这一条**只管输入**：
    // 适合「打开搜索页 -> 输入搜索关键词 -> 执行搜索」这种三步写法 ——
    // 想看清单步在干什么、想先把搜索页看清楚再输入时用（中文走 ADBKeyboard，见 typeKeyword）
    run: (page, keyword) => qaPage.typeKeyword(page, { keyword }),
  },

  点搜索历史里的词: {
    // 中文搜索的走法：框架自己敲不了中文（adb input text 只认 ASCII），
    // 但往 search_history 插一行中文、再点那个词条，就能触发一次真正的中文搜索。
    // 造数/复位：tools/search_history_tool.py（默认只预览，要 --yes 才真写）
    run: (page, word) => qaPage.tapHistoryChip(page, { word }),
  },

  打开第一个热门话题: { run: (page) => qaPage.openFirstHotTopic(page) },

  打开第一个帖子: { run: (page) => postDetail.openFirstFromFeed(page) },

  点主页按钮: { run: (page) => postDetail.tapHome(page) },

  执行搜索: {
    run: async (page) => {
      // 为什么要单独一个动作：`打开搜索并输入` 只是把字打进输入框 —— 不执行搜索的话
      // 页面停在「搜索历史」面板，结果页（以及"零结果空态"）根本不会出现。
      const { getDevice } = require("../../app_sub_function/suprecast_app/android");
      const search = await qaPage.findSearchPage(page);
      if (!search) {
        throw new Error(
          "「执行搜索」需要在搜索页上执行（候选页里都没有 wx-input.search-input）——" +
            "先把关键词打进去，或者检查上一步的「打开搜索并输入」是否成功"
        );
      }
      const device = await getDevice();
      // 【2026/10/13 加固】以前这里只是"发个回车 + 睡 1.5 秒 + 打印'已执行搜索'"，**没有任何验证** ——
      // owner 反馈「执行搜索没有成功」时，它其实是静默失败（回车没生效，页面还停在搜索历史面板），
      // 而那一步后面如果正好断言"关键词本身"，历史面板里也显示这个词，就会是**假绿**。
      // 现在：先确认框里有值，回车后**等页面离开「搜索历史」面板**才算成功；不成功重试一次，
      // 再不行就明确报错（带上输入框的值和当前页面开头）。
      const input = search.locator(qaPage.SEL.searchInput).first();
      const keyword = await base.inputValue(input);
      if (!keyword) {
        throw new Error(
          "搜索框是空的 —— 先「输入搜索关键词」，再执行搜索。\n" +
            "  （空着按回车不会触发任何搜索，页面会一直停在「搜索历史」面板。）"
        );
      }
      const leftHistoryPanel = async () =>
        !(await base.pageText(await base.foreground(page))).includes("搜索历史");

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) {
          console.log("  [自愈] 上次回车没搜起来 —— 重新点一下输入框拿到焦点，再回一次车");
        }
        // 先点输入框：回车要送给"有焦点的输入框"才有效。中文输入走 ADBKeyboard、切回原输入法后
        // 焦点可能已经丢了（见 qa_page.typeKeyword 里的说明），所以每次回车前都补一下焦点。
        await base.tapLocator(search, input, "搜索输入框（回车前先给它焦点）");
        await device.shell("input keyevent 66"); // 回车 = 把搜索跑起来（只读：只是查一次）
        if (await base.waitUntil(leftHistoryPanel, { timeout: 4000, interval: 400 })) {
          console.log(`已执行搜索（关键词 ${JSON.stringify(keyword)}，页面已离开「搜索历史」面板）`);
          return base.foreground(page);
        }
      }
      const now = await base.foreground(page);
      throw new Error(
        `按了回车但页面还停在「搜索历史」面板 —— **搜索没跑起来**（重试 2 次仍如此）。\n` +
          `  输入框里的值是 ${JSON.stringify(keyword)}\n` +
          `  当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}\n` +
          `  常见原因：输入框没拿到焦点（中文输入会临时切输入法，切回来要重新点一下）；或这一步前面根本没输入关键词。`
      );
    },
  },

  打开答题活动: { run: (page) => quizPage.ensureOn(page) },

  点文字: {
    run: async (page, text) => {
      const hit = BLOCKED_TEXT.find((w) => String(text).includes(w));
      if (hit) {
        throw new Error(
          `用例表里的「点文字」想点「${text}」，被安全阀挡住了（命中禁止词「${hit}」）。\n` +
            `  原因：这类操作会改真实数据（提交答卷、消耗积分、下单…）。\n` +
            `  真要测它，得单独写一条用例并显式打开开关，不能靠表格里写一行就触发。`
        );
      }
      const fg = await base.foreground(page);
      return base.tapText(fg, text, `文字「${text}」`);
    },
  },

  返回上一页: { run: (page) => android.goBack(page) },

  等待: {
    run: async (page, ms) => {
      await base.sleep(Number(ms));
      return page;
    },
  },

  检查文字显示: { run: (page, text) => android.assertTextVisible(page, { text }) },

  检查文字不显示: { run: (page, text) => android.assertTextNotVisible(page, { text }) },

  检查元素存在: { run: (page, selector) => android.assertSelectorExists(page, { selector }) },

  检查元素数量: {
    run: (page, selector, expected) =>
      android.assertSelectorCount(page, { selector, expected: Number(expected) }),
  },

  检查答题页: { run: (page, _p1, _p2, ctx) => quizPage.assertQuizPageRules(page, {}, ctx) },

  检查活动入口: { run: (page) => qaPage.assertActivityBlockInAllFeedTabs(page) },

  检查首页筛选栏顺序: { run: (page) => qaPage.assertFeedTabOrder(page) },

  检查回到顶部按钮: { run: (page) => pointsMall.assertBackTopRules(page) },

  /* ---------- 2026/10/10 追加的动作（「能做的都做上」）---------- */

  打印页面文字: {
    run: async (page) => {
      const fg = await base.foreground(page);
      const text = await base.pageText(fg);
      console.log(`当前屏幕上的文字（共 ${text.length} 字，下面只打前 600 字）：`);
      console.log(text.slice(0, 600));
      console.log("（挑「检查文字显示」要填什么，照着上面抄就行）");
      return fg;
    },
  },

  打印页面结构: {
    // 调"该用哪个选择器"时的利器：结构打进日志 + 完整内容落 report/dump_*.txt
    // （逻辑只有一份，在 android.js 的 dumpElements；命令行版见 test_case/diagnostic/dump_page.js）
    run: (page, scope) => android.dumpElements(page, { onlyText: String(scope || "").includes("只看有文字") }),
  },

  点选择器: {
    run: async (page, selector) => {
      const fg = await base.foreground(page);
      await base.tapSelector(fg, selector, `选择器 ${selector}`);
      return fg;
    },
  },

  滑动: {
    run: async (page, times, direction) => {
      const n = Number(times) || 1;
      const dir = direction || "上";
      if (!(n >= 1 && n <= 10)) throw new Error(`「滑动」的次数只能是 1~10，现在是 ${times}`);
      if (!["上", "下"].includes(dir)) throw new Error(`「滑动」的方向只能填 上 或 下，现在是 ${dir}`);
      for (let i = 1; i <= n; i++) {
        console.log(`  第 ${i}/${n} 次向${dir}滑动`);
        // swipeUp 的起止比例反过来就是向下滑（同一个原子操作，不重复造一个函数）
        page =
          dir === "下"
            ? await android.swipeUp(page, { startRatio: 0.25, endRatio: 0.75 })
            : await android.swipeUp(page);
        await base.sleep(800); // 滑完给它一点时间稳定，紧接着就断言容易读到中间态
      }
      return page;
    },
  },

  切换首页筛选栏: {
    run: (page, tab) => qaPage.switchToFeedTab(page, { tab, timeout: 10000 }),
  },

  切换学习中心顶部栏: {
    run: async (page, tab) => {
      // 先自己导航到学习中心（不在就切过去），再切目标 tab —— 这样表格里不用先写一步导航
      page = await learnCenter.ensureOnColumnList(page);
      return learnCenter.switchToTopTab(page, { tab });
    },
  },

  打开第一张专栏: {
    run: (page, _p1, _p2, ctx) => learnCenter.openFirstColumn(page, {}, ctx),
  },

  检查输入框的值: {
    run: async (page, selector, expected) => {
      const fg = await base.foreground(page);
      const count = await base.countOf(fg, selector);
      if (count === 0) throw await base.notFound(`输入框（选择器 ${selector}）`, fg);
      const actual = String(await base.inputValue(fg.locator(selector).first()));
      if (actual !== String(expected)) {
        throw new Error(
          `输入框里的值不等于期望值：期望 ${JSON.stringify(String(expected))}，实际 ${JSON.stringify(actual)}。\n` +
            (actual === ""
              ? "  读到的是空串 —— 注意这个坑：小程序把值放在元素的 value 属性上，读法不对就会「读不到 ≠ 没输进去」（见 documents/踩坑记录.md 坑 12）。\n"
              : "") +
            `  选择器：${selector}`
        );
      }
      console.log(`断言通过: 输入框里的值 = ${JSON.stringify(actual)}`);
      return fg;
    },
  },

  检查文字出现次数: {
    run: async (page, text, expected) => {
      const want = Number(expected);
      if (Number.isNaN(want)) throw new Error(`「检查文字出现次数」的次数要填数字，现在是 ${expected}`);
      const ok = await base.waitUntil(
        async () => (await base.countOfText(await base.foreground(page), text)) === want,
        { timeout: 8000 }
      );
      const fg = await base.foreground(page);
      if (!ok) {
        const actual = await base.countOfText(fg, text);
        throw new Error(
          `断言失败: 文字「${text}」在页面上命中 ${actual} 次，期望 ${want} 次（等待 8000ms 超时）。\n` +
            `  提示：外层包裹元素也会被算一次，所以数字常比肉眼看到的多。`
        );
      }
      console.log(`断言通过: 文字「${text}」命中 ${want} 次`);
      return fg;
    },
  },

  检查元素不存在: {
    run: async (page, selector) => {
      const ok = await base.waitUntil(
        async () => (await base.countOf(await base.foreground(page), selector)) === 0,
        { timeout: 8000 }
      );
      const fg = await base.foreground(page);
      if (!ok) {
        const actual = await base.countOf(fg, selector);
        throw new Error(
          `断言失败: 页面上仍然有 ${actual} 个 ${selector}（期望 0 个，等待 8000ms 超时）。\n` +
            `  当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
        );
      }
      console.log(`断言通过: 页面上没有 ${selector}（命中 0 个）`);
      return fg;
    },
  },

  /* ---------- 2026/10/12 追加：答题的写链路 ----------
   * owner 当天拍板「可以测会改数据的操作」（docs/待owner拍板.md Q2/Q3）。
   * 开关是**环境变量** UITEST_ALLOW_SUBMIT=1：跑的人决定"这次要不要写数据"，
   * 而不是代码里写死。没开开关时这两个动作**报错**，不跳过 —— 跳过会让"没测"看着像"没问题"。
   */

  逐题作答: {
    // 只改前端选中态、不写库（账本第二十一节有数据库实验证据），所以不需要开关
    run: (page) => quizPage.answerAllQuestions(page, { allowInteract: true }),
  },

  提交答卷: {
    run: async (page) => {
      if (!writeSwitchOn()) throw writeSwitchOffError("「提交答卷」");
      return quizPage.submitAnswers(page, { allowSubmit: true });
    },
  },

  复位答题记录: {
    run: async (page, activityName) => {
      if (!writeSwitchOn()) throw writeSwitchOffError("「复位答题记录」");
      const out = runDbTool(["--activity-name", activityName, "--yes"]);
      // 工具可能因为"名字不唯一 / 库名不像测试库 / 量太大"而**拒绝执行**（那时一条都没删），
      // 所以这里必须认 [CLEANUP] mode=clean 这一行，不能只看"命令跑完了"
      const line = (out.match(/^\[CLEANUP\].*$/m) || [""])[0];
      if (!line.includes("mode=clean")) {
        throw new Error(
          `「复位答题记录」没有真的删掉记录（活动名 ${JSON.stringify(activityName)}）：` +
            `${line || "工具没有输出 [CLEANUP] 行"}`
        );
      }
      return page;
    },
  },

  检查答题记录数: {
    run: async (page, activityName, expected) => {
      // 只读检查：不需要开关。expectOk=false -> 数量对不上时不抛错，由下面自己给一句人话报错
      const out = runDbTool(["--activity-name", activityName, "--expect-submits", String(expected)], {
        expectOk: false,
      });
      if (dbUnreachable(out)) throw dbUnreachableError("「检查答题记录数」");
      const m = out.match(/submits=(\d+)/);
      if (!m) {
        throw new Error(
          `「检查答题记录数」读不到结果（多半是活动名跟库里对不上）。\n  工具输出末尾：${out.trim().slice(-300)}`
        );
      }
      const actual = Number(m[1]);
      if (actual !== Number(expected)) {
        throw new Error(
          `断言失败: 活动「${activityName}」在库里的提交记录是 ${actual} 条，期望 ${expected} 条。\n` +
            `  常见原因：上一步「提交答卷」没成功，或者中间有人也在动这个活动。`
        );
      }
      console.log(`断言通过: 活动「${activityName}」的提交记录 = ${actual} 条`);
      return page;
    },
  },

  /* ---------- 2026/10/12 追加：案例库（需求 713381608）---------- */

  打开案例库: {
    // 入口就是底部 tab「设计专区」（2026/10/12 才找到；之前试过的两条路都是死路，见页面对象注释）
    run: (page) => caseLibrary.ensureOn(page),
  },

  检查案例库列表: {
    run: (page, _p1, _p2, ctx) => caseLibrary.assertListRules(page, {}, ctx),
  },

  打开第一个案例: {
    run: (page) => caseLibrary.openFirstCase(page),
  },

  打开案例: {
    run: (page, caseName) => caseLibrary.openByName(page, caseName),
  },

  检查案例详情页: {
    run: (page, _p1, _p2, ctx) => caseLibrary.assertDetailRules(page, {}, ctx),
  },

  打开案例库介绍长图: {
    run: (page) => caseLibrary.openIntro(page),
  },

  检查案例库介绍长图: {
    run: (page, _p1, _p2, ctx) => caseLibrary.assertIntroRules(page, {}, ctx),
  },

  /*
   * 复制案例 —— **一条龙**（记水位 → 点复制 → 断言提示 → 库里校验 → 自动复位）。
   * 为什么不像别的动作那样"一步只干一件事"：这是**写数据**的动作，
   * 拆开就意味着"有人可能忘了写最后那步复位"，而忘了复位的后果是别人看到数据被改过。
   */
  复制当前案例: {
    run: async (page, _p1, _p2, ctx) => {
      if (!writeSwitchOn()) throw writeSwitchOffError("「复制当前案例」");
      return caseCopy.runCopyChain(page, { ctx });
    },
  },

  /* ---------- 2026/10/12 追加：课程详情页（需求 713367615）---------- */

  打开课程详情: {
    run: (page, courseName) => courseDetail.openByName(page, courseName),
  },

  检查课程详情页: {
    run: (page, expectActiveTab, _p2, ctx) => courseDetail.assertRules(page, { expectActiveTab }, ctx),
  },

  检查未购买点课时: {
    run: (page, courseName, _p2, ctx) =>
      courseDetail.assertUnpurchasedLessonRules(page, { courseName }, ctx),
  },

  /**
   * 需求 713367615 第 1 条：「管理后台的课程下的课时数为 0 时，小程序端不显示该课程」。
   *
   * 这条**必须跟数据库对账**：界面上本来就看不到它们，光看界面证明不了什么 ——
   * 得先去库里把"0 课时的课程名单"拿出来，再确认这些名字一个都没出现在小程序课程列表里。
   * 只读（SELECT + 读界面文字），不需要写开关。
   */
  检查0课时课程不显示: {
    run: async (page, _p1, _p2, ctx) => {
      // 1) 库里的名单（工具会把名单放在 [COURSE] ... names=[...] 这一行）
      const out = runTool("courseList", []);
      if (dbUnreachable(out)) throw dbUnreachableError("「检查0课时课程不显示」");
      const m = out.match(/\[COURSE\][^\n]*names=(\[.*\])/);
      if (!m) throw new Error(`读不到"0 课时课程"名单（工具输出里没有 [COURSE] ... names=[]）。\n  输出末尾：${out.trim().slice(-200)}`);
      let dbNames = [];
      try {
        dbNames = JSON.parse(m[1]);
      } catch (e) {
        throw new Error(`名单 JSON 解析失败：${e.message}；原文：${m[1].slice(0, 200)}`);
      }
      console.log(`  库里 0 课时的公开课程：${dbNames.length} 门（去重后 ${new Set(dbNames).size} 个名字）`);
      if (!dbNames.length) {
        throw new Error("库里一门 0 课时的课程都没有 —— 这条断言就无从谈起（数据换形态了，别当通过）");
      }

      // 2) 小程序课程列表（边滚边读）
      page = await learnCenter.ensureOnColumnList(page);
      page = await learnCenter.switchToTopTab(page, { tab: "课程" });
      const cards = await learnCenter.readCourseList(page);
      console.log(`  小程序课程列表里读到 ${cards.length} 张课程卡`);
      if (!cards.length) throw new Error("小程序课程列表一张卡都没读到 —— 断言没法做（不是通过）");

      // 3) 对账：名单里的每个名字，都不该在小程序里出现
      //（匹配逻辑抽成纯函数 findZeroLessonShown，另有离线自检钉住它 —— 见 selftest_course_zero_lesson_match.js）
      const hits = learnCenter.findZeroLessonShown(cards, dbNames);
      if (hits.length) {
        throw new Error(
          `下面这些课程在库里是 0 课时，但小程序课程列表里**出现了**：${JSON.stringify(hits)}\n` +
            `  需求 713367615 原文：管理后台的课程下的课时数为 0 时，小程序端不显示该课程。`
        );
      }
      console.log(
        `断言通过: 库里 ${new Set(dbNames).size} 个"0 课时"课程名，一个都没出现在小程序课程列表（${cards.length} 张卡）里`
      );
      if (ctx) {
        ctx.set("courseZeroLessonNames", new Set(dbNames).size);
        ctx.set("courseCardsSeen", cards.length);
      }
      return page;
    },
  },
};

/* ---------------- 读表格 + 校验 ---------------- */

/** 前置条件不满足（例如表格还没填）——由 conftest 记成「跳过」，而不是「失败」 */
function precondition(message) {
  const err = new Error(message);
  err.preconditionNotMet = true;
  return err;
}

const ACTION_SPEC = {}; // 动作名 -> 清单里的定义（含「参数1/参数2 叫什么」），从 json 里读

function loadTable() {
  if (!fs.existsSync(TABLE_JSON)) {
    throw precondition(
      `还没导出用例表（找不到 ${TABLE_JSON}）。\n` +
        `  正常流程：填好 cases/用例表.xlsx，然后跑 python run.py（它会自动导出）。\n` +
        `  也可以手动导出：python tools/export_cases.py`
    );
  }

  let table;
  try {
    table = JSON.parse(fs.readFileSync(TABLE_JSON, "utf8"));
  } catch (e) {
    throw new Error(
      `读 ${TABLE_JSON} 失败（文件可能坏了或被手改过）：${e.message}\n` +
        `  修法：python tools/export_cases.py 重新导出一次`
    );
  }

  if (!Array.isArray(table.cases) || table.cases.length === 0) {
    throw precondition(
      `用例表里一条用例都没有（${TABLE_JSON}）。请在 cases/用例表.xlsx 里填几行，再用 python run.py 跑`
    );
  }
  (table.actions || []).forEach((a) => {
    ACTION_SPEC[a.name] = a;
  });
  return table;
}

/*
 * 反向校验：json 里的动作清单（Python 侧生成）必须都在本文件 HANDLERS 里有实现。
 *
 * 为什么要这一步：动作清单在 Python 侧（tools/export_cases.py），实现在 JS 侧（本文件）。
 * 两处一旦不同步，最坏的结果是「表格里那一行被静默忽略、用例显示通过」——
 * 那正是这个项目最忌讳的「假绿」。所以这里宁可当场报错。
 */
function checkActionList(table) {
  const declared = (table.actions || []).map((a) => a.name);
  if (!declared.length) {
    console.warn("  [提示] 用例表 json 里没带动作清单，跳过「清单 vs 实现」一致性校验（像被手改过的旧文件）");
    return;
  }

  const missing = declared.filter((n) => !HANDLERS[n]);
  if (missing.length) {
    throw new Error(
      `框架里没有实现这些动作：${missing.join("、")}\n` +
        `  情况：表格的「动作清单」里有它们（Python 侧生成），但 test_from_table.js 的 HANDLERS 里没有。\n` +
        `  这是框架自己的问题，不是表格填错了 —— 把这条报错发给 AI，让它在页面对象层补上实现。`
    );
  }

  const extra = Object.keys(HANDLERS).filter((n) => !declared.includes(n));
  if (extra.length) {
    console.warn(`  [提示] 代码里有、清单里没有的动作：${extra.join("、")}（表格里填不到，无害）`);
  }
}

/** 用例表比导出结果新时提醒一句（Excel 一保存文件时间就变，所以只说提示、不当错误） */
function warnIfTableEdited() {
  try {
    if (!fs.existsSync(TABLE_XLSX)) return;
    const xlsxTime = fs.statSync(TABLE_XLSX).mtimeMs;
    const jsonTime = fs.statSync(TABLE_JSON).mtimeMs;
    if (xlsxTime > jsonTime + 1000) {
      console.log(
        "  [提示] cases/用例表.xlsx 比 cases/用例表.json 新：本次跑的是 json 里的内容。\n" +
          "        用例表刚改过的话，请用 python run.py 跑（它会先重新导出）。"
      );
    }
  } catch (e) {
    /* 只是提示，读不到就算了 */
  }
}

/* ---------------- 把表格里的步骤变成可执行的函数 ---------------- */

/** 用于截图目录名：去掉文件名里不允许的字符 */
function safeName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .slice(0, 24);
}

/*
 * 一步 = 一个具名函数。
 *
 * 【为什么非得具名】runAppSteps 靠 `func.name` 打步骤日志、命名截图文件。
 * 用箭头函数或闭包包一层，名字会变成没意义的 "fn"；所以这里用 defineProperty
 * 补一个人话名字（例如 `检查文字显示_积分商城`），日志和截图才对得上表格里的哪一行。
 */
function buildStepFunc(step) {
  const handler = HANDLERS[step.action];
  if (!handler) {
    // 正常到不了这里：checkActionList 已经把「清单里有、实现没有」挡在前面了
    throw new Error(`动作「${step.action}」没有实现（HANDLERS 里找不到）`);
  }

  // 参数再查一遍：正常由 export_cases.py 保证，这里防的是「有人手改了 json」
  const spec = ACTION_SPEC[step.action];
  if (spec && spec.p1 && !step.param1) {
    throw new Error(`动作「${step.action}」缺「参数1」（${spec.p1}）—— 去用例表里检查这一行`);
  }
  if (spec && spec.p2 && !step.param2) {
    throw new Error(`动作「${step.action}」缺「参数2」（${spec.p2}）—— 去用例表里检查这一行`);
  }

  const fn = async (page, _kwargs, ctx) => {
    const out = await handler.run(page, step.param1, step.param2, ctx);
    return out || page; // 兜底：runAppSteps 会把返回值当成下一步的 page，返回 undefined 会让下一步崩
  };
  Object.defineProperty(fn, "name", {
    value: step.param1 ? `${step.action}_${safeName(step.param1)}` : step.action,
    configurable: true,
  });
  return [fn, null];
}

/* ---------------- 跑一条用例 ---------------- */

async function runOneCase(caseDef) {
  // 【表格填错了怎么办】导出时（tools/export_cases.py）已经把"能归到某条用例身上的错误"
  // 记在它的 errors 里：这里当场报错，**只让这一条红**，别的用例照常往下跑。
  // 为什么不是"整张表停下来"：owner 2026/10/12 定的口径 —— 一条填错不该废掉整轮测试。
  // 为什么不是"跳过它"：跳过等于把"填错了"藏起来，报告看着全绿，那是假绿。
  if (caseDef.errors && caseDef.errors.length) {
    throw new Error(
      "这条用例在表格里填错了（改 cases/用例表.xlsx 的这几行）：\n    " + caseDef.errors.join("\n    ")
    );
  }

  const funcList = caseDef.steps.map(buildStepFunc);
  console.log("\n" + "=".repeat(66));
  console.log(`用例 ${caseDef.id}：${caseDef.name}（${funcList.length} 步）`);
  console.log("=".repeat(66));

  await appTest(funcList, {
    // 每条用例一个截图目录，出了事一眼知道是哪条用例的
    photosPath: path.join(PHOTO_ROOT, safeName(caseDef.id)),
    meta: {
      feature: "填表用例",
      story: caseDef.id,
      title: `${caseDef.id} ${caseDef.name}`,
    },
  });
}

(async () => {
  const table = loadTable();
  checkActionList(table);
  warnIfTableEdited();

  // conftest 为「一条用例一个 pytest 用例项」准备了这个环境变量：只跑指定的那一条
  const only = process.env.UITEST_CASE_ID;
  const cases = only ? table.cases.filter((c) => c.id === only) : table.cases;
  if (!cases.length) {
    throw new Error(
      `环境变量 UITEST_CASE_ID=${only} 在用例表里找不到对应的用例编号。\n` +
        `  表格里现有：${table.cases.map((c) => c.id).join("、")}`
    );
  }
  if (!only) {
    console.log(`用例表里共 ${cases.length} 条用例，这次全跑：${cases.map((c) => c.id).join("、")}`);
  }

  let passed = 0;
  const failures = [];
  for (const caseDef of cases) {
    try {
      await runOneCase(caseDef);
      passed += 1;
      console.log(`>>> 用例 ${caseDef.id} 通过`);
    } catch (e) {
      failures.push({ id: caseDef.id, message: e.message, precondition: !!e.preconditionNotMet });
      console.error(
        `>>> 用例 ${caseDef.id} ${e.preconditionNotMet ? "不适用（前置条件不满足）" : "失败"}：${e.message}`
      );
    }
  }

  console.log("\n" + "=".repeat(66));
  console.log(`表格用例小结：共 ${cases.length} 条，通过 ${passed}，失败 ${failures.length}`);
  for (const f of failures) {
    console.log(`  [失败] ${f.id}：${f.message.split("\n")[0]}`);
  }
  console.log("=".repeat(66));

  if (!failures.length) {
    console.log("test_from_table.js 执行完成（全部通过）");
    return;
  }
  // 全是「前置条件不满足」时按 SKIPPED 报（退出码 3），别把「活动没上线」记成「用例失败」
  if (failures.every((f) => f.precondition)) {
    console.error("[PRECONDITION] " + failures.map((f) => `${f.id}: ${f.message.split("\n")[0]}`).join("；"));
    process.exit(3);
  }
  process.exit(1);
})().catch((e) => {
  if (e.preconditionNotMet) {
    console.error("[PRECONDITION] " + e.message);
    process.exit(3);
  }
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
