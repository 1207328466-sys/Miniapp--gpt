/*
 * @project_name: UITest
 * @cur_file: test_case_comment.js
 * @create_date: 2026/10/15
 *
 * 用例：**案例评论里的图片要显示**（缺陷 713369819）—— 自摆自收
 *   造一条带图评论（夹具）→ 打开这张案例的详情页 → 断言：这条评论在、**它下面那张图真的画出来了** →
 *   删掉我们造的那条评论（还原）
 *
 * 【为什么夹具要自己造】
 * 小程序端发评论要过微信的**原生图片选择器**，框架现在驱动不了；管理后台又只有"查/删评论"、
 * 没有"造评论"的接口。所以夹具落到数据库：`locution_comment`（评论本体）+
 * `upload_file`（`biz_type=2` 评论、`file_type=7`、`biz_id`=评论 id 那张图）——
 * 口径是拿"接口确实返回了 img 的评论"反查出来的（详见 tools/case_comment_tool.py 文件头）。
 *
 * 【断言为什么这么写】
 * 需求原话是"查看时**图片未显示**"，所以重点不是"这条评论在不在"，而是**图有没有渲染**：
 * 找到含标记的那条评论条目（class 里带 comment-item），在它的正文区（comment-content）里找 wx-image，
 * 要求**渲染尺寸 > 20×20**（头像那个 33×33 不算）且 `src` 是 http(s) 的 OSS 地址。
 *
 * 【开关】`UITEST_ALLOW_SUBMIT=1`：不设就**记跳过**
 * 跑法：$env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 案例评论
 * 单跑：$env:UITEST_ALLOW_SUBMIT="1"; node test_case/suprecast_app/test_case_comment.js
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

/** 第一道闸：没打开写开关就记「跳过」 */
const requireWriteSwitch = makeWriteSwitchStep("案例评论（带图）");

let caseTitle = "";

/** 调 tools/case_comment_tool.py；返回 {code, out}（不抛错，让调用方判） */
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

/** 步骤 1：记住"要点开哪张案例"（列表第一张卡的标题 —— 夹具和断言必须在同一张上） */
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

/** 步骤 2：造一条带图评论（夹具"摆"上去） */
async function addCommentFixture(page) {
  // 先删一遍（幂等）：上次跑挂了、或有人手工造过，都会留下"我们那条"，直接 --add 会被工具拒绝
  runCaseComment(["--case-title", caseTitle, "--remove", "--yes"]);
  const r = runCaseComment(["--case-title", caseTitle, "--add", "--yes"]);
  const m = r.out.match(/\[CASECMT\] mode=add case=(\d+) comment=(\d+) image=yes/);
  if (!m) {
    if (/拒绝/.test(r.out)) {
      const e = new Error(
        "夹具没能造出来（环境问题，不是产品缺陷）：\n  " + r.out.trim().split("\n").slice(-3).join("\n  ")
      );
      e.preconditionNotMet = true;
      throw e;
    }
    throw new Error(`造带图评论失败：${r.out.trim().split("\n").slice(-3).join(" / ")}`);
  }
  console.log(`  夹具已就位：评论 id=${m[2]}（案例 id=${m[1]}）`);
  return page;
}

/** 步骤 3：打开这张案例的详情页，断言"评论在 + 图真的渲染出来了" */
async function assertCommentImageShown(page) {
  page = await caseLibrary.ensureOn(page);
  page = await caseLibrary.openByName(page, caseTitle).catch(async (e) => {
    console.log(`  [提示] 按名字开案例没走通（${e.message.split("\n")[0]}）—— 退回"开第一张"`);
    return caseLibrary.openFirstCase(page);
  });
  await base.sleep(2500);

  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  if (!text.includes(MARK)) {
    throw new Error(
      `案例详情页上没有我们造的那条评论（内容应为 ${JSON.stringify(MARK)}）。\n` +
        `  说明：库里那条评论被删了？或者开的不是同一张案例（现在开的是 ${JSON.stringify(caseTitle)}）。\n` +
        `  当前页面前 200 字: ${JSON.stringify(text.slice(0, 200))}`
    );
  }

  const info = await fg.evaluate((mark) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const boxOf = (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
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
    const pick = (sel) =>
      Array.from(item.querySelectorAll(sel)).map((im) => {
        const b = boxOf(im);
        return { cls: String(im.getAttribute("class") || ""), w: b.w, h: b.h, src: String(im.getAttribute("src") || "") };
      });
    return {
      found: true,
      itemFound: true,
      itemCls: String(item.getAttribute("class") || ""),
      all: pick("wx-image, img"),
      body: pick('[class*="comment-content"] wx-image, [class*="comment-content"] img'),
    };
  }, MARK);

  if (!info.found) throw new Error(`页面上找不到标记为 ${JSON.stringify(MARK)} 的元素（文字里有，但没定位到元素）`);
  if (!info.itemFound) {
    throw new Error("找到了评论文字，但往上找不到「评论条目」容器（class 里带 comment-item）—— 页面结构可能变了");
  }

  console.log(`  评论条目：${JSON.stringify(info.itemCls.slice(0, 40))}；里面图片 ${info.all.length} 个：`);
  for (const im of info.all) {
    console.log(`     ${im.w}x${im.h}  ${JSON.stringify(im.cls.slice(0, 30))}  src=${JSON.stringify(im.src.slice(0, 56))}`);
  }

  const body = info.body.filter((im) => im.w > 20 && im.h > 20 && /^https?:/.test(im.src));
  if (!body.length) {
    throw new Error(
      `断言失败（缺陷 713369819）：这条评论**没有把图片显示出来**。\n` +
        `  在评论正文区（comment-content）里找到的图片：${JSON.stringify(info.body)}\n` +
        `  判据：正文区要有 wx-image、渲染尺寸 > 20×20、src 是 http(s)。\n` +
        `  （提示：头像那个 33×33 的 avatar-image 不算；只看到头像 = 正文图没渲染）`
    );
  }
  console.log(
    `  断言通过: 评论里那张图渲染出来了（${body[0].w}x${body[0].h}，src=${JSON.stringify(body[0].src.slice(0, 56))}…）`
  );
  return fg;
}

/** 步骤 4：还原（删掉我们造的那条评论和它的图片行）—— 失败时 finally 也会再调一次 */
async function removeCommentFixture(page) {
  if (!caseTitle) return page;
  const r = runCaseComment(["--case-title", caseTitle, "--remove", "--yes"]);
  const m = r.out.match(/\[CASECMT\] mode=remove case=\d+ deleted=(\d+) images=(\d+)/);
  if (m) {
    console.log(`  已还原：删掉评论 ${m[1]} 条、图片 ${m[2]} 行`);
  } else {
    console.error(`  [收尾] 还原失败，需要人工看一眼：${r.out.trim().split("\n").slice(-2).join(" / ")}`);
  }
  return page;
}

(async () => {
  const funcList = [
    [requireWriteSwitch, null],
    [pickCase, null],
    [addCommentFixture, null],
    [assertCommentImageShown, null],
    [removeCommentFixture, null],
    [pages.qaPage.ensureOnHomeFeed, null],
  ];

  try {
    await appTest(funcList, {
      photosPath,
      meta: { feature: "案例库", story: "带图评论", title: "案例评论：带图评论里的图片要显示（缺陷 713369819）" },
    });
    console.log("\n" + "=".repeat(60));
    console.log("test_case_comment.js 执行完成（夹具已还原）");
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
