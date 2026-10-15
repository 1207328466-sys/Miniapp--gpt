/*
 * @project_name: UITest
 * @cur_file: test_top_post.js
 * @create_date: 2026/10/15
 *
 * 用例：**置顶帖**（缺陷 713367194）—— 自摆自收
 *   复位（确保没别的置顶帖）→ 从信息流里挑一条帖子 → 用管理后台接口置顶 →
 *   等小程序端「最新提问」把它显示成**第一条 + 带「置顶」** → 断言 → 取消置顶（还原）
 *
 * 【为什么用"管理后台接口"而不是改库】
 * 置顶状态**不在这套库里**：`post` 表 32 个列全查过、全库列名带 top/pin 的地方也逐个查过，
 * 帖子侧一个置顶字段都没有 —— 它是管理后台的服务在管（详见 knowledge/管理后台接口与夹具.md）。
 * 所以夹具走 `tools/post_top_tool.py`（默认只预览，`--yes` 才真写，跑完必须还原）。
 *
 * 【这条用例为什么慢 —— 不是卡住，是在等缓存】
 * 实测（2026/10/15）：置顶后小程序端**约 5~7 分钟**才变（服务端有缓存）。
 * 所以断言那一步是**轮询**（默认最多等 12 分钟，每 30 秒强制重进一次首页再读），
 * 而不是"改完立刻看"—— 后者会得出"置顶没用"的错误结论（这条记在 docs/踩坑记录.md 坑 49）。
 *
 * 【开关】`UITEST_ALLOW_SUBMIT=1`：不设就**记跳过**（不设 = 这次不测写数据的用例）
 * 跑法：$env:UITEST_ALLOW_SUBMIT="1"; python run.py -k 置顶帖
 * 单跑：$env:UITEST_ALLOW_SUBMIT="1"; node test_case/suprecast_app/test_top_post.js
 */

const path = require("path");
const { execFileSync } = require("child_process");
const { appTest } = require("../../common/app_common");
const { makeWriteSwitchStep } = require("../../common/db_tool");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qaPage = pages.qaPage;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
const TOOL = path.join(__dirname, "..", "..", "tools", "post_top_tool.py");

/** 第一道闸：没打开写开关就记「跳过」（实现与文案只有一份，见 common/db_tool.js） */
const requireWriteSwitch = makeWriteSwitchStep("置顶帖");

/**
 * 轮询预算：默认 **5 分钟**（每 20 秒一轮）。
 *
 * 【别被"缓存"骗了 —— 2026/10/15 实测纠正】
 * 一开始我用"进用户中心再回首页"当刷新，结果置顶后**十几分钟**都看不到，以为是"服务端缓存十来分钟"，
 * 还照着那个写了 20 分钟的预算。后来 owner 提醒"可以切 tab 刷新"，一验才发现：
 *   · **真切 tab**（先切到「推荐」再切回「最新提问」）会重新拉这一栏的列表 —— 置顶/取消**立刻**反映出来
 *     （实测：16:18:52 置顶 → 16:20 已经排在第一位；取消置顶也立刻消失）；
 *   · 而"本来就在最新提问"时调切换动作是**幂等的**（"无需切换"）→ 等于**没刷新** ——
 *     我之前那些探针就是这么骗自己的。
 * 所以这里用真切 tab + 短轮询；预算留着是为了容忍"服务端偶尔慢一拍"。
 * 可调：`UITEST_TOP_WAIT_MS`（毫秒）、`UITEST_TOP_POLL_MS`（轮询间隔）。
 */
const WAIT_MS = Number(process.env.UITEST_TOP_WAIT_MS || 5 * 60 * 1000);
const POLL_MS = Number(process.env.UITEST_TOP_POLL_MS || 20 * 1000);

let target = null; // {id, title}
let pinned = false;

/** 调 tools/post_top_tool.py；返回 {code, out}（不抛错，让调用方自己判） */
function runPostTop(args) {
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

/** 把"工具被闸门/凭据拦下"这种情况变成「跳过」而不是红（它跟产品行为无关） */
function toolPreconditionError(what, out) {
  const e = new Error(
    `${what}：管理后台工具没能执行（这属于环境/凭据问题，不是产品缺陷）。\n` +
      `  工具输出（末几行）：${out.trim().split("\n").slice(-3).join(" / ")}\n` +
      `  取 token：python tools/post_top_tool.py --login（用系统自带 Edge 登中台 SSO）`
  );
  e.preconditionNotMet = true;
  return e;
}

/** 读信息流当前最上面几张卡的文字（"标题 作者 评论数"，置顶的会带「置顶」前缀） */
async function readTopCards(page, limit = 6) {
  const fg = await base.foreground(page);
  return fg.evaluate((n) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    document.querySelectorAll("wx-view").forEach((el) => {
      if (!/^flow-item$/.test(String(el.getAttribute("class") || ""))) return;
      const r = el.getBoundingClientRect();
      const t = norm(el.innerText);
      if (t && r.height > 0) out.push({ text: t, y: Math.round(r.y) });
    });
    out.sort((a, b) => a.y - b.y);
    return out.slice(0, n);
  }, limit);
}

/**
 * 拿到「最新提问」的**新数据**：切到别的筛选 tab 再切回来（owner 2026/10/15 提醒的做法）。
 *
 * 为什么不用"进用户中心再回首页"那套：那要 4 次导航（约 35 秒），而切 tab 只是两次点击
 * （约 6 秒）—— 而且**切 tab 本身就会重新请求这一栏的列表**，够用。
 * 兜底：万一 tab 切换失败（页面不在一级页等），就退回"离开首页再回来"的重办法。
 */
async function backToFreshFeed(page) {
  try {
    page = await qaPage.ensureOnHomeFeed(page);
    await qaPage.switchToFeedTab(page, { tab: "推荐" });
    await base.sleep(900);
    page = await qaPage.switchToFeedTab(page, { tab: "最新提问" });
    // 切回来之后列表要重新渲染：**等它真的出现卡片**再读，别读到一个空列表
    // （2026/10/15 实测：切回来 2.5 秒时读到 0 张卡，再等一会儿才有）
    const fg = await base.foreground(page);
    await base.waitUntil(async () => (await readTopCards(fg, 1)).length > 0, { timeout: 8000, interval: 500 });
    return base.foreground(page);
  } catch (e) {
    console.log(`  [提示] 切 tab 刷新没成功（${e.message.split("\n")[0]}）—— 改用"离开首页再回来"的重办法`);
    page = await pages.userCenter.switchTo(page);
    await base.sleep(1200);
    page = await qaPage.ensureOnHomeFeed(page);
    page = await qaPage.switchToFeedTab(page, { tab: "最新提问" });
    await base.sleep(2000);
    return base.foreground(page);
  }
}

/** 步骤 1：从信息流里挑一条"能当夹具用"的帖子（信息流里看得见 + 后台能唯一定位 + 当前没置顶） */
async function pickTargetPost(page) {
  const fg = await backToFreshFeed(page);
  const cards = await readTopCards(fg, 8);
  console.log(`  信息流最上面 ${cards.length} 张卡：${JSON.stringify(cards.map((c) => c.text.slice(0, 18)))}`);

  for (const c of cards) {
    // 卡片文字形如「置顶 兄弟 xiba 1」/「w aaaaaa 0」—— 取第一个空格前的部分当标题
    // ⚠️ 带「置顶」前缀的卡**直接跳过**：它要么是环境里已有的置顶帖，要么是**缓存的旧置顶**
    //    （服务端缓存十来分钟，刚跑完上一次用例时会残留）。挑它当目标，后面的轮询会被这份旧缓存
    //    立刻"满足"，等于假绿。
    if (/^置顶/.test(c.text)) {
      console.log(`  跳过「${c.text.slice(0, 18)}」：它现在带着「置顶」标记（可能是别人置顶的，也可能是上一轮的缓存）`);
      continue;
    }
    const first = c.text.replace(/^置顶\s*/, "").split(" ")[0];
    if (!first) continue;
    const r = runPostTop(["--title", first]);
    const m = r.out.match(/\[TOPPOST\] mode=state post=(\d+) isTop=(\d+) title=(.*)$/m);
    if (!m) continue; // 重名/找不到 -> 换下一张卡
    const [, id, isTop, title] = m;
    if (Number(isTop) !== 0) {
      console.log(`  跳过「${title}」：它已经被置顶了（isTop=${isTop}）`);
      continue;
    }
    target = { id: Number(id), title };
    console.log(`  挑中：id=${target.id} 标题=${JSON.stringify(target.title)}（信息流里看得见、后台可唯一定位、当前未置顶）`);
    return base.foreground(page);
  }

  const e = new Error(
    "没挑到能当夹具用的帖子（要有：信息流里看得见 + 后台按标题能唯一定位 + 当前没置顶）。\n" +
      `  信息流最上面几张卡：${JSON.stringify(cards.map((c) => c.text.slice(0, 20)))}\n` +
      "  常见原因：最上面几条标题在后台有重名（工具会拒绝猜），或它们已经是置顶帖。"
  );
  e.preconditionNotMet = true;
  throw e;
}

/** 步骤 2：置顶（夹具"摆"上去） */
async function pinTargetPost(page) {
  const r = runPostTop(["--id", String(target.id), "--pin", "--yes"]);
  if (r.code !== 0 || !/\[TOPPOST\] mode=set .*isTop=1/.test(r.out)) {
    if (/拒绝/.test(r.out) && !/接口报错/.test(r.out)) throw toolPreconditionError("置顶", r.out);
    throw new Error(`置顶没成功（id=${target.id}）：${r.out.trim().split("\n").slice(-3).join(" / ")}`);
  }
  pinned = true;
  return page;
}

/** 步骤 3：等小程序端把它显示成第一条 + 带「置顶」（真切 tab 刷新，通常几秒到一两分钟） */
async function waitAppShowsTop(page) {
  const started = Date.now();
  const deadline = started + WAIT_MS;
  let round = 0;
  let lastCards = [];

  while (Date.now() < deadline) {
    round += 1;
    const fg = await backToFreshFeed(page);
    const cards = await readTopCards(fg, 3);
    lastCards = cards;
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`  [第 ${round} 次看，已等 ${elapsed}s] 最上面：${JSON.stringify(cards.map((c) => c.text.slice(0, 22)))}`);

    const hit = /置顶/.test(cards[0] ? cards[0].text : "");
    if (hit) {
      // 断言：**第一条**就是它，而且带「置顶」；标题要对得上（防"显示的是别人的置顶帖"）
      if (!cards[0].text.includes(target.title)) {
        throw new Error(
          `第一条虽然带「置顶」，但标题对不上：期望含 ${JSON.stringify(target.title)}，实际 ${JSON.stringify(cards[0].text)}`
        );
      }
      console.log(
        `  断言通过: 「最新提问」第一条 = ${JSON.stringify(cards[0].text)}（带「置顶」且标题是 ${JSON.stringify(target.title)}）`
      );
      return base.foreground(page);
    }
    await base.sleep(POLL_MS);
  }

  throw new Error(
    `等了 ${Math.round(WAIT_MS / 60000)} 分钟（每轮都真切了一次 tab 刷新），` +
      `小程序「最新提问」第一条仍然没有「置顶」标记。\n` +
      `  期望：id=${target.id} 标题=${JSON.stringify(target.title)} 出现在第一条且带「置顶」\n` +
      `  实测最上面几张卡：${JSON.stringify(lastCards.map((c) => c.text))}\n` +
      `  排查：① 刷新方式对不对（必须**真切 tab**：先切到别的筛选 tab 再切回来；\n` +
      `        "本来就在这一栏"时调切换是幂等的、等于没刷新）\n` +
      `        ② 手机上装的小程序版本是否含 713367194 的修复？\n` +
      `        ③ 抓信息流接口的返回，看有没有 isTop 字段（有字段没渲染=前端；没字段=服务端）`
  );
}

/** 步骤 4：还原之后，再确认小程序端也把「置顶」摘掉了（真切 tab 刷新，正反两个方向都验） */
async function waitAppClearsTop(page) {
  const deadline = Date.now() + WAIT_MS;
  let round = 0;
  let lastCards = [];
  while (Date.now() < deadline) {
    round += 1;
    const fg = await backToFreshFeed(page);
    const cards = await readTopCards(fg, 3);
    lastCards = cards;
    const stillMarked = cards.some((c) => /^置顶/.test(c.text) && c.text.includes(target.title));
    console.log(`  [还原后第 ${round} 次看] 最上面：${JSON.stringify(cards.map((c) => c.text.slice(0, 22)))}`);
    if (!stillMarked) {
      console.log(
        `  断言通过: 取消置顶后，小程序端也不再把它显示成置顶（最上面：${JSON.stringify(cards.map((c) => c.text.slice(0, 16)))}）`
      );
      return base.foreground(page);
    }
    await base.sleep(POLL_MS);
  }
  throw new Error(
    `取消置顶后等了 ${Math.round(WAIT_MS / 60000)} 分钟，小程序端**仍然**把 ` +
      `${JSON.stringify(target.title)} 显示成置顶（实测真切 tab 之后应当立刻变）。\n` +
      `  实测最上面几张卡：${JSON.stringify(lastCards.map((c) => c.text))}\n` +
      `  注意：如果环境里**别人**也置顶了同标题的帖子，这条断言会误报 —— 先确认这一点。`
  );
}

/** 步骤 4：还原（取消置顶）—— 失败时 finally 也会再调一次 */
async function unpinTargetPost(page) {
  if (!target) return page;
  const r = runPostTop(["--id", String(target.id), "--unpin", "--yes"]);
  if (/\[TOPPOST\] mode=set .*isTop=0/.test(r.out)) {
    pinned = false;
    console.log(`  已还原：id=${target.id} 取消置顶（下一步会真切一次 tab，确认小程序端也摘掉了「置顶」）`);
  } else {
    console.error(`  [收尾] 取消置顶失败，需要人工看一眼：${r.out.trim().split("\n").slice(-2).join(" / ")}`);
  }
  return page;
}

(async () => {
  const funcList = [
    [requireWriteSwitch, null],
    [pickTargetPost, null],
    [pinTargetPost, null],
    [waitAppShowsTop, null],
    [unpinTargetPost, null],
    [waitAppClearsTop, null],
    [qaPage.ensureOnHomeFeed, null],
  ];

  try {
    await appTest(funcList, {
      photosPath,
      meta: { feature: "有问必答", story: "置顶帖", title: "置顶帖：后台置顶后，最新提问第一条显示「置顶」" },
    });
    console.log("\n" + "=".repeat(60));
    console.log("test_top_post.js 执行完成（夹具已还原）");
    console.log("=".repeat(60));
  } finally {
    // 失败也要还原：留着一条别人的置顶帖，下一个人看到的信息流就是错的
    if (pinned && target) {
      console.log("[收尾] 用例中途失败 —— 好，先把置顶还原");
      try {
        runPostTop(["--id", String(target.id), "--unpin", "--yes"]);
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
