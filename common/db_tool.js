/*
 * 调 Python 侧的数据库工具（目前只有 tools/quiz_data_cleanup.py）。
 *
 * 【为什么单独一个文件】
 * 两个地方都要用它：表格用例的驱动（test_case/suprecast_app/test_from_table.js）
 * 和写链路用例（test_case/suprecast_app/test_quiz_submit.js）。
 * 复制的代价不是"多几行"，而是**两个地方的说法会慢慢不一样** ——
 * 一处报错说"开关没开"，另一处说"权限不足"，看的人就得多绕一圈。
 *
 * 【为什么用 execFileSync 而不是拼 shell 字符串】
 * 工具路径里有中文，拼 shell 在 Windows 上容易被引号/编码坑；而且拼出来的命令
 * 没法一眼看出到底跑了什么。execFileSync 传数组参数，不经过 shell 解析。
 */

const path = require("path");
const { execFileSync } = require("child_process");

/** 框架用到的 Python 数据工具（路径集中在这里，别在调用处各写各的） */
const TOOLS = {
  cleanup: path.join(__dirname, "..", "tools", "quiz_data_cleanup.py"),
  caseCopy: path.join(__dirname, "..", "tools", "case_copy_reset.py"),
  // 案例「复制数」对账（只读）——缺陷 713453275 的回归用例要用
  caseCopyCounts: path.join(__dirname, "..", "tools", "case_copy_counts.py"),
  courseList: path.join(__dirname, "..", "tools", "course_list_report.py"),
  quizScore: path.join(__dirname, "..", "tools", "quiz_score_report.py"),
  quizAnswerKey: path.join(__dirname, "..", "tools", "quiz_answer_key_report.py"),
  // 礼品分类的夹具（屏蔽/还原）——缺陷 713396918 的回归用例要用
  giftCategory: path.join(__dirname, "..", "tools", "gift_category_tool.py"),
};

const CLEANUP_TOOL = TOOLS.cleanup;

/**
 * 数据库工具在"连不上测试库"时会打这句（见 tools/quiz_data_report.py 的 load_conn）。
 *
 * 为什么要认这句话：**连不上库是环境问题，不是产品/框架 bug** ——
 * 它应该记「跳过并说明原因」，而不是记一条红。
 * 记红的话，报告里就长期躺着一条假失败，久而久之没人再看红（本仓最忌讳的"报告说谎"）。
 */
const DB_UNREACHABLE_MARK = "连不上测试库";

/** 输出里是不是"连不上库"（调用方自己判读时用） */
function dbUnreachable(out) {
  return String(out || "").includes(DB_UNREACHABLE_MARK);
}

/** 造一个"前置条件不满足"的错误：连不上库 -> 这条检查本次跳过 */
function dbUnreachableError(what) {
  const e = new Error(
    `${what}依赖测试数据库，但**现在连不上库**（网络/VPN/白名单问题，不是代码问题）。\n` +
      `  本次记「跳过」：跳过≠通过 —— 等能连上库时再跑一次这条。\n` +
      `  自检：ping 得通、3306 端口连不上，基本就是白名单/防火墙。`
  );
  e.preconditionNotMet = true;
  return e;
}

/**
 * 跑 `tools/quiz_data_cleanup.py`。
 *
 * @param {string[]} args 传给脚本的参数，例如 ["--activity-name", "Z-B4-答题角标", "--yes"]
 * @param {{expectOk?: boolean}} [opts] expectOk=false 时：退出码非 0 **不抛错**，
 *        把输出原样返回（调用方要自己判读数对不对，例如「检查答题记录数」）。
 * @returns {string} 工具的完整输出
 */
function runTool(which, args, { expectOk = true } = {}) {
  const script = TOOLS[which];
  if (!script) throw new Error(`未知的数据库工具：${which}（可选：${Object.keys(TOOLS).join(" / ")}）`);
  // 允许用环境变量换一份数据库配置：验证"库不可用时会不会好好跳过"就靠它 ——
  // 指向一个连不上的库即可，**不用动真实的 config/db.local.yaml**。
  const extra = process.env.UITEST_DB_CONFIG ? ["--config", process.env.UITEST_DB_CONFIG] : [];
  // 用 UITEST_PYTHON（conftest 会把它设成"当前这个 Python 解释器"），
  // 免得在多 Python/虚拟环境的机器上调到另一个没装 pymysql 的解释器上
  const py = process.env.UITEST_PYTHON || "python";
  try {
    const out = execFileSync(py, [script, ...args, ...extra], {
      encoding: "utf-8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    console.log(out.trim());
    return out;
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || ""));
    if (out.trim()) console.log(out.trim());
    // 「连不上库」是环境问题 -> 记跳过并说明原因（见上面 DB_UNREACHABLE_MARK 的说明）
    if (dbUnreachable(out)) throw dbUnreachableError(`数据库工具「${path.basename(script)}」`);
    if (!expectOk) return out;
    throw new Error(
      `数据库工具执行失败（${path.basename(script)} 参数：${args.join(" ")}，退出码 ${e.status}）：\n  ` +
        out.trim().split("\n").slice(-4).join("\n  ")
    );
  }
}

/** 答题数据复位工具（tools/quiz_data_cleanup.py） */
function runDbTool(args, opts) {
  return runTool("cleanup", args, opts);
}

/** 案例复制体检/复位工具（tools/case_copy_reset.py） */
function runCaseCopyTool(args, opts) {
  return runTool("caseCopy", args, opts);
}

/**
 * 写操作的开关：**来自环境变量**，不是代码里的常量。
 *
 * 为什么必须是环境变量：同一份用例，跑的人和跑的场景不同 ——
 * "只是回归一下"不该写数据，"专门验写链路"才该写。写死在代码里就没法区分了。
 */
function writeSwitchOn() {
  return process.env.UITEST_ALLOW_SUBMIT === "1";
}

/** 没有开关时的统一说法（几处报错文案保持一致，看的人不用重新理解一遍） */
function writeSwitchOffMessage(what) {
  return (
    `${what}会写真实数据，但这次没有打开开关，已拒绝执行。\n` +
    "  打开方式：PowerShell 里先设 $env:UITEST_ALLOW_SUBMIT=\"1\" 再跑；\n" +
    "  为什么报错而不是跳过：跳过会让「没测」看起来像「没问题」。"
  );
}

/**
 * 开关没开时的错误对象。
 *
 * ⚠️ 刻意带上 `preconditionNotMet`：这样它在 pytest 里会记成 **SKIPPED**（"这次不适用"），
 * 而不是 FAILED（"这条坏了"）。区别很重要 —— 默认全量跑里带着一条红的"写用例"，
 * 久而久之就没人看红了（本项目最忌讳的"报告说谎"）。
 * 同时跳过是**可见的**：报告里会写"写开关没开"，摘要里也专门列一行"跳过的 = 这次没测"。
 */
function writeSwitchOffError(what) {
  const e = new Error(writeSwitchOffMessage(what));
  e.preconditionNotMet = true;
  return e;
}

/**
 * 造一个"检查写开关"的步骤函数 —— 写链路用例的第一道闸。
 *
 * 为什么要工厂：两个写链路用例（答题提交 / 案例复制）本来各写了一份 15 行的开关检查，
 * 消息也各写一份 —— 那种重复的代价是"两个地方的说法会慢慢不一样"，而写数据的用例**最怕说法不一致**。
 * 现在只有一份实现、一份文案；用例侧一行就够。
 *
 * @param {string} label 人话名字（会出现在步骤日志与报错里，例如「案例复制写链路」）
 * @returns {Function} 步骤函数：开关没开就抛"前置条件不满足"（pytest 记 SKIPPED，不是 FAILED）
 */
function makeWriteSwitchStep(label) {
  const fn = async function requireWriteSwitch(page) {
    if (!writeSwitchOn()) throw writeSwitchOffError(`「${label}」`);
    console.log(`  写链路开关已打开（UITEST_ALLOW_SUBMIT=1），继续：${label}`);
    return page;
  };
  Object.defineProperty(fn, "name", { value: `requireWriteSwitch_${label}`, configurable: true });
  return fn;
}

module.exports = {
  runTool,
  runDbTool,
  runCaseCopyTool,
  writeSwitchOn,
  writeSwitchOffMessage,
  writeSwitchOffError,
  makeWriteSwitchStep,
  DB_UNREACHABLE_MARK,
  dbUnreachable,
  dbUnreachableError,
  CLEANUP_TOOL,
  TOOLS,
};
