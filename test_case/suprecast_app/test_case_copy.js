/*
 * @project_name: UITest
 * @cur_file: test_case_copy.js
 * @create_date: 2026/10/12
 *
 * 用例：案例库的**复制写链路** —— 复位 -> 点复制 -> 断言提示 -> 库里校验 -> 再复位
 *
 * 【这条用例在测什么】
 * 需求 713381608：「案例复制完成后，弹出提示复制成功，提示『使用手机号登录智铸超云，即可查看案例详情』」
 * 「免费和付费案例都提示」—— 只有**真的复制一次**才测得到。
 *
 * 【开关】
 *   `UITEST_ALLOW_SUBMIT=1` —— 不设就**记跳过**（不是失败，也不是偷偷跑）。
 *   复制会写 `simulation_copy_record` 并让 `simulation_case.copy_count` +1；
 *   免费案例不扣积分、付费案例会扣（本用例默认挑列表第一张，2026/10/12 那天是免费案例）。
 *
 * 【数据安全：跑前跑后都复位】
 *   `tools/case_copy_reset.py` 用**水位**复位：复制前记下最大记录 id，
 *   复位时只删"id 比水位大的、且属于这个案例的"记录，并把 copy_count 减回去 ——
 *   这样别人同时在复制也不会被误删。owner 2026/10/12 授权：可以改这个用户的数据。
 *
 * 运行（PowerShell）：
 *   $env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 案例复制写链路
 * 只用 node 单跑：
 *   $env:UITEST_ALLOW_SUBMIT="1"; node test_case/suprecast_app/test_case_copy.js
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const { runCaseCopyTool } = require("../../common/db_tool");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
const ALLOW_SUBMIT = process.env.UITEST_ALLOW_SUBMIT === "1";

// 这次复制的是哪个案例（由第 3 步从页面上读出来），以及复制前的水位
let caseTitle = "";
let baseline = null; // {copyCount, records, maxRecordId}

let resetDone = false;

/**
 * 从工具输出里抠出 `[COPY] ...` 那一行的键值对。
 *
 * ⚠️ 必须取**最后一行**，不能取第一行：这个工具一次运行会打两行 ——
 * 先 `mode=report`（体检），再 `mode=reset`（复位）或 `mode=verify`（校验）。
 * 第一版取第一行，于是复位明明成功了、却被判成"没看到 mode=reset"（真机踩到）。
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

async function requireSubmitSwitch(page) {
  if (!ALLOW_SUBMIT) {
    const e = new Error(
      "这条用例会**真的复制一次案例**（写测试库数据），默认不执行。\n" +
        "  要跑它：先设环境变量 UITEST_ALLOW_SUBMIT=1，PowerShell 里这样写：\n" +
        '    $env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 案例复制写链路\n' +
        "  它跑前会记水位、跑完自动复位（删掉自己造的那条记录并把复制数改回去）。"
    );
    e.preconditionNotMet = true;
    throw e;
  }
  console.log("  写链路开关已打开（UITEST_ALLOW_SUBMIT=1），继续");
  return page;
}

/** 打开案例库第一张案例（并记下它的标题 —— 复位要靠标题定位） */
async function openFirstCaseAndRemember(page, _kwargs, ctx) {
  page = await caseLibrary.ensureOn(page);
  const list = await caseLibrary.readList(page);
  if (!list.length) throw new Error("案例库列表是空的，没法测复制");
  caseTitle = list[0].title;
  console.log(`  这次要复制的案例：${JSON.stringify(caseTitle)}（列表第一张）`);
  if (ctx) ctx.set("copyCaseTitle", caseTitle);
  page = await caseLibrary.openFirstCase(page);
  return page;
}

/** 记下复制前的水位（只读）——复位要用它 */
async function readBaseline(page) {
  const out = runCaseCopyTool(["--case-title", caseTitle]);
  const { line, kv } = parseCopyLine(out);
  if (!line.includes("mode=report")) {
    throw new Error(`读案例状态失败（没看到 mode=report）：${line || "工具没有输出 [COPY] 行"}`);
  }
  baseline = {
    copyCount: Number(kv.copy_count),
    records: Number(kv.records),
    maxRecordId: Number(kv.max_record_id),
  };
  console.log(
    `  复制前：copy_count=${baseline.copyCount}、记录 ${baseline.records} 条、水位 id=${baseline.maxRecordId}`
  );
  return page;
}

/** 跑完（或失败）都把这次造的记录清掉 */
async function resetCopy(page) {
  if (!caseTitle || !baseline) return page; // 还没开始写，不用复位
  const out = runCaseCopyTool([
    "--case-title",
    caseTitle,
    "--reset",
    "--since-id",
    String(baseline.maxRecordId),
    "--yes",
  ]);
  const { line } = parseCopyLine(out);
  if (!line.includes("mode=reset")) {
    throw new Error(`复位没成功（没看到 mode=reset）：${line || "工具没有输出 [COPY] 行"}`);
  }
  resetDone = true;
  return page;
}

/** 库里交叉验证：复制记录 +1、copy_count +1（界面上说成功，库里也得真有） */
async function assertDbChanged(page) {
  const out = runCaseCopyTool(["--case-title", caseTitle]);
  const { kv } = parseCopyLine(out);
  const records = Number(kv.records);
  const copyCount = Number(kv.copy_count);
  const problems = [];
  if (records !== baseline.records + 1) problems.push(`复制记录应当是 ${baseline.records + 1} 条，实际 ${records} 条`);
  if (copyCount !== baseline.copyCount + 1) {
    problems.push(`copy_count 应当是 ${baseline.copyCount + 1}，实际 ${copyCount}`);
  }
  if (problems.length) throw new Error("复制后数据库对不上：\n  - " + problems.join("\n  - "));
  console.log(`  断言通过: 库里确实多了一条复制记录（${records} 条），copy_count ${baseline.copyCount} -> ${copyCount}`);
  return page;
}

(async () => {
  const funcList = [
    [requireSubmitSwitch, null],
    [openFirstCaseAndRemember, null],
    [readBaseline, null],
    [caseLibrary.copyCurrentCase, { ctx: null }],
    [assertDbChanged, null],
    [resetCopy, null],
    [pages.qaPage.ensureOnHomeFeed, null],
  ];

  try {
    await appTest(funcList, {
      photosPath,
      meta: { feature: "案例库", story: "写链路", title: "案例复制写链路：复位→复制→断言→校验→复位" },
    });
    console.log("\n" + "=".repeat(60));
    console.log("test_case_copy.js 执行完成（写链路全部步骤通过）");
    console.log("=".repeat(60));
  } finally {
    // 失败也要复位：留着一条记录，下一个人看到的就是"复制数莫名其妙多了一条"
    if (ALLOW_SUBMIT && caseTitle && baseline && !resetDone) {
      try {
        await resetCopy(null);
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
