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
const android = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;
const learnCenter = pages.learnCenter;
const quizPage = pages.quizPage;
const userCenter = pages.userCenter;

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

  检查答题页符合需求: { run: (page, _p1, _p2, ctx) => quizPage.assertQuizPageRules(page, {}, ctx) },

  检查活动入口: { run: (page) => qaPage.assertActivityBlockInAllFeedTabs(page) },

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

  切换筛选tab: {
    run: (page, tab) => qaPage.switchToFeedTab(page, { tab, timeout: 10000 }),
  },

  切换学习中心顶部tab: {
    run: async (page, tab) => {
      // 先自己导航到学习中心（不在就切过去），再切目标 tab —— 这样表格里不用先写一步导航
      page = await learnCenter.ensureOnColumnList(page);
      return learnCenter.switchToTopTab(page, { tab });
    },
  },

  点第一张专栏: {
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
