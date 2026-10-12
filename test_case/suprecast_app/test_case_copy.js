/*
 * @project_name: UITest
 * @cur_file: test_case_copy.js
 * @create_date: 2026/10/12
 *
 * 用例：案例库的**复制写链路** —— 记水位 -> 点复制 -> 断言提示 -> 库里校验 -> 复位
 *
 * 【这条用例在测什么】
 * 需求 713381608：「案例复制完成后，弹出提示复制成功，提示『使用手机号登录智铸超云，即可查看案例详情』」。
 * 只有**真的复制一次**才测得到 —— 复制会写 `simulation_copy_record` 并让 `simulation_case.copy_count` +1。
 *
 * 【开关】
 *   `UITEST_ALLOW_SUBMIT=1` —— 不设就**记跳过**（不是失败，也不是偷偷跑）。
 *   免费案例复制不扣积分；付费案例会扣（本用例默认挑列表第一张，2026/10/12 那天是免费案例）。
 *
 * 【数据安全：跑前跑后都复位】
 *   `tools/case_copy_reset.py` 用**水位**复位：复制前记下最大记录 id，
 *   复位时只删「id 比水位大的、且属于这个案例的」记录，并把 copy_count 减回去 ——
 *   别人同时在复制也不会被误删。owner 2026/10/12 授权：可以改这个用户的数据。
 *
 * 【和表格动作「复制当前案例」的关系】
 *   逻辑都在 `app_sub_function/suprecast_app/case_copy.js`（一处实现，两处用）。
 *   表格动作走的是一条龙（含自动复位）；本文件把每一步拆成独立步骤，便于报告里逐步追溯。
 *
 * 运行（PowerShell）：
 *   $env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 案例复制写链路
 * 只用 node 单跑：
 *   $env:UITEST_ALLOW_SUBMIT="1"; node test_case/suprecast_app/test_case_copy.js
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const caseCopy = require("../../app_sub_function/suprecast_app/case_copy");
const pages = require("../../app_sub_function/suprecast_app/pages");

const caseLibrary = pages.caseLibrary;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
const ALLOW_SUBMIT = process.env.UITEST_ALLOW_SUBMIT === "1";

// 这次复制的是哪个案例（第 3 步从页面读出来）、复制前的水位（第 4 步记下）
let caseTitle = "";
let baseline = null;
let resetDone = false;

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
  return caseLibrary.openFirstCase(page);
}

/** 页面上读到的标题要和列表里记的一致（防"点开的是别的案例"这种串台） */
async function crossCheckTitle(page) {
  const onPage = await caseCopy.readTitleFromPage(page);
  if (onPage !== caseTitle) {
    throw new Error(
      `列表里记的标题是 ${JSON.stringify(caseTitle)}，详情页上却是 ${JSON.stringify(onPage)} ——` +
        ` 两边对不上，说明点开的不是同一张卡片。复位会按标题定位，这一步必须先对齐。`
    );
  }
  console.log(`  标题对齐：列表与详情页都是 ${JSON.stringify(caseTitle)}`);
  return page;
}

/** 记下复制前的水位（只读）——复位要用它 */
async function readBaseline(page) {
  baseline = caseCopy.readState(caseTitle);
  console.log(
    `  复制前：copy_count=${baseline.copyCount}、记录 ${baseline.records} 条、水位 id=${baseline.maxRecordId}`
  );
  return page;
}

/** 库里交叉验证：复制记录 +1、copy_count +1 */
async function assertDbChanged(page) {
  caseCopy.assertCopied(caseTitle, baseline);
  return page;
}

/** 复位：按水位只删这次造的那条记录 */
async function resetCopy(page) {
  if (!caseTitle || !baseline) return page;
  const line = caseCopy.reset(caseTitle, baseline.maxRecordId);
  console.log(`  复位完成：${line}`);
  resetDone = true;
  return page;
}

(async () => {
  const funcList = [
    [requireSubmitSwitch, null],
    [openFirstCaseAndRemember, null],
    [crossCheckTitle, null],
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
