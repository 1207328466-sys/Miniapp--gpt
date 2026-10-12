/*
 * 案例复制的「写链路」—— 表格动作（test_from_table.js）和 .js 用例（test_case_copy.js）共用。
 *
 * 【为什么抽出来】
 * 这条链路有五个环节：读标题 -> 记水位 -> 点复制 -> 断言提示 -> 库里校验 -> 复位。
 * 两处各写一遍的结果一定是"说法慢慢不一样"，而这类**写数据**的代码，说法不一样就是事故。
 *
 * 【复位为什么用"水位"】
 * 复制前先记下 `simulation_copy_record` 里最大的 id（水位），复位时只删
 * 「id 比水位大、且属于这个案例」的记录，并把 `copy_count` 减掉同样条数 ——
 * 这样**别人同时在复制也不会被误删**。工具：tools/case_copy_reset.py。
 */

const { runCaseCopyTool } = require("../../common/db_tool");
const pages = require("./pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

/**
 * 解析工具输出里的 `[COPY] ...` 行。
 *
 * ⚠️ 取**最后一行**：这个工具一次运行会打两行 —— 先 `mode=report`（体检），
 * 再 `mode=reset`（复位）/ `mode=verify`（校验）。第一版取第一行，
 * 结果复位明明成功了却被判成"没看到 mode=reset"（真机踩到）。
 */
function parseCopyLine(out) {
  const all = out.match(/^\[COPY\].*$/gm) || [""];
  const line = all[all.length - 1];
  const kv = {};
  line.split(/\s+/).forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  });
  return { line, kv };
}

/** 读案例现在的状态（只读）：复制数 / 记录数 / 水位 */
function readState(title) {
  const out = runCaseCopyTool(["--case-title", title]);
  const { line, kv } = parseCopyLine(out);
  if (!line.includes("mode=report")) {
    throw new Error(`读案例状态失败（没看到 mode=report）：${line || "工具没有输出 [COPY] 行"}`);
  }
  return {
    copyCount: Number(kv.copy_count),
    records: Number(kv.records),
    maxRecordId: Number(kv.max_record_id),
  };
}

/** 复位（按水位只删自己造的那条） */
function reset(title, sinceId) {
  const out = runCaseCopyTool(["--case-title", title, "--reset", "--since-id", String(sinceId), "--yes"]);
  const { line } = parseCopyLine(out);
  if (!line.includes("mode=reset")) {
    throw new Error(`复位没成功（没看到 mode=reset）：${line || "工具没有输出 [COPY] 行"}`);
  }
  return line;
}

/** 库里交叉验证：复制记录 +1、copy_count +1 */
function assertCopied(title, baseline) {
  const now = readState(title);
  const problems = [];
  if (now.records !== baseline.records + 1) {
    problems.push(`复制记录应当是 ${baseline.records + 1} 条，实际 ${now.records} 条`);
  }
  if (now.copyCount !== baseline.copyCount + 1) {
    problems.push(`copy_count 应当是 ${baseline.copyCount + 1}，实际 ${now.copyCount}`);
  }
  if (problems.length) throw new Error("复制后数据库对不上：\n  - " + problems.join("\n  - "));
  console.log(
    `  断言通过: 库里确实多了一条复制记录（${now.records} 条），copy_count ${baseline.copyCount} -> ${now.copyCount}`
  );
  return now;
}

/** 从案例详情页读出当前案例的标题（复位要靠它定位） */
async function readTitleFromPage(page) {
  const fg = await base.foreground(page);
  const title = (await base.textOf(fg, caseLibrary.SEL.detailTitle)).trim();
  if (!title) {
    throw new Error(
      `读不到案例标题（${caseLibrary.SEL.detailTitle}）—— 后面要按标题复位数据，读不到就不往下走。\n` +
        `  当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
    );
  }
  return title;
}

/**
 * 表格动作用的**一条龙**：读标题 → 记水位 → 点复制 → 断言提示 → 库里校验 → 复位。
 *
 * 为什么把"复位"也包进来：写数据的动作**不能让人有机会忘记复位**。
 * 中间任何一步失败，`finally` 里也会用同一个水位把这次造的记录清掉。
 *
 * ⚠️ 前置条件：当前必须在案例详情页上（表格里先用「打开案例库」+「打开第一个案例」把页面走到这儿）。
 */
async function runCopyChain(page, { ctx = null } = {}) {
  const title = await readTitleFromPage(page);
  console.log(`  这次要复制的案例：${JSON.stringify(title)}`);
  const baseline = readState(title);
  console.log(
    `  复制前：copy_count=${baseline.copyCount}、记录 ${baseline.records} 条、水位 id=${baseline.maxRecordId}`
  );
  if (ctx) ctx.set("copyCaseTitle", title);

  let ok = false;
  try {
    page = await caseLibrary.copyCurrentCase(page, { ctx });
    assertCopied(title, baseline);
    ok = true;
  } finally {
    // 成功要复位、失败也要复位 —— 失败了不复位，下一个人看到的就是"复制数莫名其妙多了一条"
    try {
      const line = reset(title, baseline.maxRecordId);
      console.log(`  已复位：${line}`);
    } catch (e) {
      console.error(`  [收尾] 复位失败（需要人工看一眼）：${e.message}`);
      if (ok) throw e; // 主流程成功、只有复位失败：如实报错，别假装没事
    }
  }
  return base.foreground(page);
}

module.exports = { parseCopyLine, readState, reset, assertCopied, readTitleFromPage, runCopyChain };
