/*
 * @project_name: UITest
 * @cur_file: test_case_comment_no_interaction.js
 * @create_date: 2026/10/15
 *
 * 用例：**案例评论不做交互**（缺陷 713317010）—— 自摆自收
 *   缺陷原文：「案例详情中评论仅支持 1 级，应**不显示回复和点赞按钮**（本期需求暂不涉及评论的交互）」
 *
 * 【判据从哪来（前端源码）】`src/components/comment-list/index.tsx`：
 *   onlyShowTime 为真 -> `.info-wrap` 里**只有时间**；
 *   否则 -> `.info-wrap` 里有「回复」(`.reply-btn`) + 点赞组件（`.like-wrap`）。
 *   而案例详情页是 `<CommentList ... onlyShowTime />`（`case-detail/index.tsx`）
 *   → 所以**案例评论行里应当只有时间**，没有回复、也没有点赞。
 *
 * 【为什么这条不是假绿】"没有回复按钮"最怕"元素没渲染/没找到评论区"也判过。所以同时断言：
 *   ① 我们那条评论的**条目容器**（`.comment-item`）找得到；
 *   ② 它的 `.info-wrap` 里**确实有时间文字**（证明"底部那一行"渲染了、我们看的是对的地方）。
 *   反向证据（2026/10/15 实测）：同一套组件在**帖子详情**里是"有时间+回复+点赞"那一支，
 *   那边的 `.reply-btn` 数得到 —— 说明这个选择器确实认得"回复按钮"这种东西。
 *
 * 【夹具】复用 `tools/case_comment_tool.py`（造一条评论 → 跑完删掉）。
 * 【开关】`UITEST_ALLOW_SUBMIT=1`：不设就记「跳过」。
 * 跑法：$env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 案例评论不做交互
 */

const path = require("path");
const { execFileSync } = require("child_process");
const { appTest } = require("../../common/app_common");
const { makeWriteSwitchStep } = require("../../common/db_tool");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
const TOOL = path.join(__dirname, "..", "..", "tools", "case_comment_tool.py");
const MARK = "UITEST带图评论"; // 跟 tools/case_comment_tool.py 里的标记一字不差

const requireWriteSwitch = makeWriteSwitchStep("案例评论（不做交互）");

let caseTitle = "";

function runCaseComment(args) {
  const py = process.env.UITEST_PYTHON || "python";
  try {
    const out = execFileSync(py, [TOOL, ...args], {
      encoding: "utf-8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    console.log(out.trim());
    return { code: 0, out };
  } catch (e) {
    const out = String((e.stdout || "") + (e.stderr || ""));
    if (out.trim()) console.log(out.trim());
    return { code: e.status === undefined ? -1 : e.status, out };
  }
}

/** 步骤 1：记住要点开哪张案例（列表第一张） */
async function pickCase(page) {
  page = await caseLibrary.ensureOn(page);
  const list = await caseLibrary.readList(page);
  const first = (list && list[0]) || null;
  if (!first || !first.title) {
    const fg = await base.foreground(page);
    throw new Error(
      "案例库列表里读不到第一张卡的标题。当前页面前 120 字：" +
        JSON.stringify((await base.pageText(fg)).slice(0, 120))
    );
  }
  caseTitle = first.title;
  console.log(`  要开的案例（列表第一张）：${JSON.stringify(caseTitle)}`);
  return page;
}

/** 步骤 2：造一条评论（夹具） */
async function addCommentFixture(page) {
  // 先删一遍（幂等）：上次跑挂了、或有人手工造过，都会留下"我们那条"，直接 --add 会被工具拒绝
  runCaseComment(["--case-title", caseTitle, "--remove", "--yes"]);
  const r = runCaseComment(["--case-title", caseTitle, "--add", "--yes"]);
  const m = r.out.match(/\[CASECMT\] mode=add case=(\d+) comment=(\d+) image=yes/);
  if (!m) {
    if (/拒绝/.test(r.out)) {
      const e = new Error(
        "夹具没能造出来（环境问题）：\n  " + r.out.trim().split("\n").slice(-3).join("\n  ")
      );
      e.preconditionNotMet = true;
      throw e;
    }
    throw new Error(`造评论失败：${r.out.trim().split("\n").slice(-3).join(" / ")}`);
  }
  console.log(`  夹具已就位：评论 id=${m[2]}（案例 id=${m[1]}）`);
  return page;
}

/** 步骤 3：打开案例详情，断言"评论行只有时间、没有回复/点赞" */
async function assertNoInteraction(page) {
  page = await caseLibrary.ensureOn(page);
  page = await caseLibrary
    .openByName(page, caseTitle)
    .catch(async () => caseLibrary.openFirstCase(page));
  await base.sleep(2500);

  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  if (!text.includes(MARK)) {
    throw new Error(
      `案例详情页上没有我们造的那条评论（内容应为 ${JSON.stringify(MARK)}）。\n` +
        `  当前页面前 200 字: ${JSON.stringify(text.slice(0, 200))}`
    );
  }

  const info = await fg.evaluate((mark) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    let leaf = null;
    document.querySelectorAll("*").forEach((el) => {
      const t = norm(el.innerText);
      if (!t.includes(mark)) return;
      if (Array.from(el.children).some((k) => norm(k.innerText).includes(mark))) return;
      leaf = el;
    });
    if (!leaf) return { found: false };
    let item = leaf;
    for (let i = 0; i < 6 && item; i++) {
      if (/comment-item/.test(String(item.getAttribute("class") || ""))) break;
      item = item.parentElement;
    }
    if (!item) return { found: true, itemFound: false };
    const texts = (sel) =>
      Array.from(item.querySelectorAll(sel)).map((el) => norm(el.innerText).slice(0, 24));
    return {
      found: true,
      itemFound: true,
      itemText: norm(item.innerText).slice(0, 120),
      infoWrap: texts(".info-wrap"),
      replyBtn: texts(".reply-btn"),
      likeWrap: texts(".like-wrap"),
      replyWord: /回复/.test(norm(item.innerText)),
    };
  }, MARK);

  if (!info.found) throw new Error(`页面上找不到标记为 ${JSON.stringify(MARK)} 的元素`);
  if (!info.itemFound) {
    throw new Error("找到评论文字，但往上找不到评论条目容器（class 里带 comment-item）");
  }
  console.log(`  评论条目文字：${JSON.stringify(info.itemText)}`);
  console.log(
    `  .info-wrap=${JSON.stringify(info.infoWrap)}  .reply-btn=${JSON.stringify(info.replyBtn)}  .like-wrap=${JSON.stringify(info.likeWrap)}`
  );

  const problems = [];
  const timeText = (info.infoWrap || []).join(" ");
  if (!/(秒|分钟|小时|天|刚刚|昨天)/.test(timeText)) {
    problems.push(
      `评论行里没读到"时间"（.info-wrap=${JSON.stringify(info.infoWrap)}）—— 那说明我们没看对地方，这条断言不能算过`
    );
  }
  if ((info.replyBtn || []).length) {
    problems.push(`出现了「回复」按钮（.reply-btn=${JSON.stringify(info.replyBtn)}）`);
  }
  if (info.replyWord) problems.push("条目文字里出现了「回复」");
  if ((info.likeWrap || []).length) {
    problems.push(`出现了点赞按钮（.like-wrap=${JSON.stringify(info.likeWrap)}）`);
  }

  if (problems.length) {
    throw new Error(
      "缺陷 713317010 回归失败：案例评论行**应当是只读的（只有时间）**，但：\n  - " +
        problems.join("\n  - ") +
        `\n  期望依据：案例详情用 <CommentList onlyShowTime />（前端源码 comment-list/index.tsx）`
    );
  }
  console.log(`  断言通过: 案例评论行只有时间（${JSON.stringify(timeText)}），没有「回复」也没有点赞`);
  return fg;
}

/** 步骤 4：还原（删掉我们造的那条评论） */
async function removeCommentFixture(page) {
  if (!caseTitle) return page;
  const r = runCaseComment(["--case-title", caseTitle, "--remove", "--yes"]);
  const m = r.out.match(/\[CASECMT\] mode=remove case=\d+ deleted=(\d+) images=(\d+)/);
  if (m) console.log(`  已还原：删掉评论 ${m[1]} 条、图片 ${m[2]} 行`);
  else console.error(`  [收尾] 还原失败：${r.out.trim().split("\n").slice(-2).join(" / ")}`);
  return page;
}

(async () => {
  const funcList = [
    [requireWriteSwitch, null],
    [pickCase, null],
    [addCommentFixture, null],
    [assertNoInteraction, null],
    [removeCommentFixture, null],
    [pages.qaPage.ensureOnHomeFeed, null],
  ];

  try {
    await appTest(funcList, {
      photosPath,
      meta: {
        feature: "案例库",
        story: "评论交互",
        title: "案例评论不做交互：评论行只有时间、没有回复/点赞（缺陷 713317010）",
      },
    });
    console.log("\n" + "=".repeat(60));
    console.log("test_case_comment_no_interaction.js 执行完成（夹具已还原）");
    console.log("=".repeat(60));
  } finally {
    if (caseTitle) {
      console.log("[收尾] 不管成功失败，都再删一次夹具（幂等）");
      try {
        runCaseComment(["--case-title", caseTitle, "--remove", "--yes"]);
      } catch (e) {
        console.error("[收尾] 还原失败（需要人工看一眼）：" + e.message);
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
