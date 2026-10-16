/*
 * 结构化步骤日志（JSONL）
 *
 * 【为什么需要它】
 * 原来 runAppSteps 每步只 console.log 一行，pytest 侧看到的是"1 个文件 = 1 个用例"，
 * 失败时只有一张截图 + 一段文本。想知道"跑到第几步、哪一步慢、当时页面是什么"，
 * 只能人肉翻控制台 —— 而控制台还遇到过编码乱码。
 *
 * 这里把每一步写成**一行 JSON**（JSONL），由 Python 侧（conftest.py）读取后：
 *   1. 在控制台打印人可读的步骤明细
 *   2. 还原成 Allure 的 feature -> story -> step 层次，并把失败步骤的截图附上去
 * 文件格式刻意选 JSONL 而不是一个大 JSON：逐行追加，进程中途被杀也不会丢已写的内容。
 *
 * 【为什么用环境变量传路径，而不是约定固定位置】
 * 约定固定位置就要靠"扫描目录 / 猜文件名"去找本次的日志，并发跑（xdist）时必然串台。
 * 由 Python 侧指定一个临时路径传进来，本次运行与文件一一对应，不可能混。
 *
 * 【写失败不让用例失败】
 * 报告是"附加价值"，不该因为它写不出去就把测试判失败；但也不能静默 ——
 * 所以这里只打 WARN 到 stderr，并且 Python 侧在读不到日志时也会明确告警。
 */

const fs = require("fs");
const path = require("path");

/**
 * 创建一个步骤日志写入器。
 * @param {{filePath?: string|null, caseFile?: string|null, meta?: Object|null}} [options]
 *        filePath: 日志文件路径；为空则整体禁用（不会报错）
 *        caseFile: 用例文件名，用于报告标题
 *        meta: 用例元数据 {feature, story, title, precondition, note}，
 *              可省略（省略时按文件名推导）；后两个是表格用例的「前置条件 / 备注」，
 *              Python 侧（conftest.py）会把它们贴进 Allure 报告的描述里。
 * @returns {{enabled: boolean, case: Function, step: Function, finish: Function}}
 */
function createStepLogger({ filePath = null, caseFile = null, meta = null } = {}) {
  const enabled = Boolean(filePath);

  const warn = (msg) => console.error(`[WARN] ${msg}`);

  if (enabled) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // 每次运行覆盖：避免上一次的步骤混进本次报告
      fs.writeFileSync(filePath, "", "utf8");
    } catch (e) {
      warn(`无法创建步骤日志 ${filePath}（${e.message}）：报告会缺少步骤明细，但用例继续跑`);
      return { enabled: false, case: () => {}, step: () => {}, finish: () => {} };
    }
  }

  const write = (obj) => {
    if (!enabled) return;
    try {
      fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
    } catch (e) {
      warn(`写步骤日志失败：${e.message}`);
    }
  };

  const state = { steps: 0, failed: 0, startedAt: Date.now() };

  return {
    enabled,

    /** 用例头：报告里用它做 feature / story / title */
    case(extra = {}) {
      state.startedAt = Date.now();
      write({
        type: "case",
        caseFile: caseFile || null,
        // feature 缺省沿用用例所在目录名，story/title 缺省用文件名
        feature: (meta && meta.feature) || extra.feature || null,
        story: (meta && meta.story) || extra.story || null,
        title: (meta && meta.title) || extra.title || caseFile || null,
        // 表格用例才有：报告描述里的「前置条件 / 备注 / 类型分类」
        precondition: (meta && meta.precondition) || extra.precondition || null,
        note: (meta && meta.note) || extra.note || null,
        type: (meta && meta.type) || extra.type || null,
        startedAt: new Date().toISOString(),
      });
    },

    /**
     * 记录一步。
     * @param {{num: number, name: string, status: "passed"|"failed", duration: number,
     *          screenshot?: string|null, error?: string|null}} info
     */
    step(info) {
      state.steps += 1;
      if (info.status === "failed") state.failed += 1;
      write({
        type: "step",
        num: info.num,
        name: info.name,
        status: info.status,
        duration: Number((info.duration || 0).toFixed(2)),
        screenshot: info.screenshot || null,
        // 错误信息只留首行：完整堆栈已经打印到控制台了，日志里留摘要即可
        error: info.error ? String(info.error).split("\n")[0] : null,
      });
    },

    /** 收尾：写总结行（含用例上下文快照，便于复现失败时的数据状态） */
    finish({ context = null, error = null } = {}) {
      write({
        type: "summary",
        steps: state.steps,
        passed: state.steps - state.failed,
        failed: state.failed,
        total: Number(((Date.now() - state.startedAt) / 1000).toFixed(2)),
        context: context || null,
        error: error ? String(error).split("\n")[0] : null,
      });
    },
  };
}

module.exports = { createStepLogger };
