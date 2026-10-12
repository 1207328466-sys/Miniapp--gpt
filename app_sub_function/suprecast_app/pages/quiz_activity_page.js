/*
 * 页面对象：首页活动卡区 + 答题活动页
 *
 * 【知识来源】页面结构来自另一份工作副本（原仓库）的实测笔记，我们**逐项复核**后收录；
 * 用例与实现用我们自己的原语重写（页面对象 + 断言层 + 每步前台页解析）。
 *
 * 实测结构（2026/10/10）：
 *
 * 首页活动卡区（**横向列表，不自动轮播**）：
 *   [class*="qa-activity-flow-item--card"]      卡片本体（实测 163x217，css 约 (7,313)）
 *   [class*="qa-activity-flow-item__tag"]       角标 —— 判断是哪张卡靠它，
 *                                               文本形如「答题·官方」「链接·官方」
 *   [class*="qa-activity-flow-item__swiper"]    横向容器（卡多时 scrollWidth > clientWidth）
 *   ⚠️ 卡片数量会随活动上下线变化：实测同一位置先后见过「答题·官方」和「链接·官方」，
 *      也见过只渲染 1 张（scrollWidth == clientWidth，此时无需横滑）。
 *
 * 答题活动页：
 *   .activity-quiz-page                         整页根容器（只出现在答题页，比文案可靠）
 *     .custom-navbar                            标题「Z-B4-答题角标」+ 返回
 *     .activity-quiz-card__title                活动标题
 *     [class*="quiz-option--row"]               选项行（「A 正确」「B 错误」）
 *     [class*="activity-quiz-submit"]           提交（未选答案时灰色禁用）
 *   提交前后的状态变化（可作断言依据）：
 *     进度 已答：0/1 -> 1/1 ；题号标签 未答 -> 已答 ；提交按钮 灰色禁用 -> 红色可用
 *
 * ---------------------------------------------------------------------------
 * ⚠️ 数据安全：本页面对象对"提交"格外克制
 * ---------------------------------------------------------------------------
 * 这个活动的题目是**一次性**的，而这台设备用的是**真实账号**（测试环境没有独立测试账号）。
 * 因此：
 *   - 选择选项：纯前端选中态，不改服务端数据 -> 正常执行
 *   - **提交答案：会真的写数据** -> 只有调用方显式传 `allowSubmit: true` 才执行
 *   - 题目已答完时：选项通常已锁定，此时**跳过选择**（它不会有任何效果），
 *     而不是"点了没反应然后报一个假失败"
 *
 * ⚠️ **2026/10/10 追加的重要存疑（未定论，因此按最坏情况处理）**
 * 实测观察到：一次"只选选项、没提交"的运行之后，题目进度从 `已答 0/1` 变成了 `1/1`。
 * 有两种可能，我**没能区分**：
 *   a) 有人在手机上手动点了提交；
 *   b) **选中选项会直接自动提交**（单题活动可能就是这么设计的）。
 * 如果是 (b)，那么"选择选项"就不是安全操作，我那次"选择"已经动了数据。
 * 在查清之前，**选择与提交都按"会写数据"对待**，都要显式开关：
 *   - `allowInteract`（默认 false）：是否允许点选项
 *   - `allowSubmit`（默认 false）：是否允许点提交
 * 查清 (a)/(b) 的办法：等该活动出新一期后，只点选项、不点提交，看进度是否变化。
 *
 * ✅ **2026/10/10 已用数据库查清（账本第二十一节）**：结论是 **(a)/(b) 都不成立** ——
 * 只点选项后 UI 进度确实从 `已答 0/1` 变成 `1/1`，但**数据库一条记录都没写**
 * （活动 347 的 `home_activity_quiz_answer` / `_detail` 前后都是 0 条）。
 * 也就是说：**那个「已答」是前端本地状态**（把这个活动的"已选"记成了"已答"），
 * **不会写服务端**。所以点选项是安全的，`allowInteract` 可以放开；
 * **真正写库的是「提交」**，它必须继续默认禁止。
 */

const base = require("./base_page");

const SEL = {
  card: '[class*="qa-activity-flow-item--card"]',
  cardTag: '[class*="qa-activity-flow-item__tag"]',
  cardSwiper: '[class*="qa-activity-flow-item__swiper"]',
  quizPage: ".activity-quiz-page",
  title: ".activity-quiz-card__title",
  // ⚠️ 这三个一律用**精确类名**，不要用子串匹配 [class*="..."]：
  // 实测 [class*="activity-quiz-submit"] 会命中三个元素，DOM 里排第一的是外层包裹
  // `activity-quiz-submit-wrap`（347x91），而真正的按钮是 `h5-view activity-quiz-submit`（256x40）。
  // 按子串匹配就会读到包裹元素的 class —— 这正是"禁用态判定失效"的原因，
  // 也**和账本根因 11（[class*=header-tab] 命中容器）是同一个坑，我又踩了一次**。
  // 教训：命中数量是信号；用例里对结构用 assertSelectorCount(期望 1) 能把这类坑当场抓住。
  option: ".quiz-option--row",
  submit: ".activity-quiz-submit",
};

/*
 * ⚠️ 多选题库活动（一整页渲染好几道题）的**题目边界**（2026/10/12 真机实测拿到）
 *
 * 在此之前只知道"整页 52 个选项行"，不知道一道题到哪儿为止，于是多题活动只能记跳过（坑 16）。
 * 实测结构（活动「Z-题干图验证」15 题，一页渲染全部）：
 *   .quiz-card                     一道题（实测 333x465）—— **这就是题目边界**
 *     .quiz-card__head             题号 / 分值 / 状态（形如「1．单选题 1 积分 未答」）
 *     .quiz-options                这道题的选项容器
 *       .quiz-option--row          选项行（**只属于它所在的那个 .quiz-card**）
 * 另一套是"活动信息卡"，名字像但别混：`.activity-quiz-card__title` 是**活动标题**，
 * `.quiz-card` 才是**题目**。
 */
const SEL_Q = {
  card: ".quiz-card",
  head: ".quiz-card__head",
};

/**
 * **纯函数**：按题判「选项 2~6 个且互不相同」（需求 713594985 原文口径）。
 *
 * 为什么要单独抽出来：这条规则**原本在多题活动上没法验**（整页数选项数，数出 52 个，只能整体跳过）。
 * 抽成纯函数之后，即使线上此刻没有多题活动，也能用离线自检把它正反两面都钉住 ——
 * 「该红时会红」不能靠"等下次线上出现多题活动"来碰运气。
 *
 * @param {Array<{head?:string, options:Array<{text:string}>}>} questions 一道题一项
 * @returns {string[]} 问题清单（空数组 = 全部符合）
 */
function checkQuestionOptions(questions) {
  /*
   * 选项显示出来的文本带序号前缀（「A 正确」「B 错误」…），所以判"文字重复"时必须
   * **先剥掉序号再比内容** —— 否则 "A 甲" 和 "B 甲" 会被当成两个不同的选项，
   * 这条规则等于永远不生效（离线自检的反例当场抓到了这一点）。
   */
  const contentOf = (s) =>
    String(s || "")
      .trim()
      .replace(/^[A-Fa-f][\s．.、:：)）]*/, "")
      .trim();
  const problems = [];
  (questions || []).forEach((q, i) => {
    const options = (q && q.options) || [];
    const n = options.length;
    if (n < 2 || n > 6) {
      problems.push(
        `第 ${i + 1} 题的选项应在 2~6 个，实际 ${n} 个（题目：${JSON.stringify((q && q.head) || "")}）`
      );
    }
    const contents = options.map((o) => contentOf(o && o.text));
    contents.forEach((c, j) => {
      if (!c) {
        // 只看得到序号、看不到内容（「A」这种）—— 多半是选项文字没渲染出来，不是"内容为空"这么简单
        problems.push(`第 ${i + 1} 题选项[${j}] 只有序号、没有内容（原文：${JSON.stringify((options[j] || {}).text)}）`);
      }
    });
    // 内容都为空时不比重复 —— 那种情况上面已经报过"没有内容"，再报一条只会把人绕晕
    const nonEmpty = contents.filter((c) => c);
    if (nonEmpty.length === contents.length && new Set(contents).size !== contents.length) {
      problems.push(`第 ${i + 1} 题的选项文字有重复：${JSON.stringify(contents)}（需求要求互不相同）`);
    }
  });
  return problems;
}

const HOME_TAB_TEXT = "有问必答";
const CARD_TAG_QUIZ = "答题";

/**
 * 构造一个"前置条件不满足"的错误。
 *
 * 为什么要区分：**活动没上线 ≠ 框架坏了**。前者该记为 SKIPPED（用例不适用），
 * 后者才是 FAILED。混在一起会让日常跑的报告里长期躺着一条"假失败"，
 * 久而久之没人再看它 —— 这正是"报告说谎"的另一种形式。
 * 用例侧捕获后用 `process.exit(3)` 上报，conftest 会把它转成 pytest 的 SKIPPED。
 */
function preconditionError(message) {
  const e = new Error(message);
  e.preconditionNotMet = true;
  return e;
}

/** 现在是不是答题活动页 */
async function isOn(page) {
  // 注意：这里是"**屏幕上显示的是不是**答题页"，必须看前台页 ——
  // 不能用"候选页里有没有答题页"（那会把被盖住的旧页当成已到达，真机踩过）。
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.quizPage)) > 0;
}

/**
 * 找「答题活动页」那一页：**前台优先，找不到就跨页找**。
 * 这样就不依赖"猜哪个页在前台"（坑 19）——我们真正想知道的是"哪一页是答题页"。
 */
async function findQuizPage(page) {
  const fg = await base.foreground(page);
  if ((await base.countOf(fg, SEL.quizPage)) > 0) return fg;
  return base.findPageContaining(page, { selector: SEL.quizPage });
}

/**
 * 读出答题页的关键状态（只读，不改任何东西）。
 * @returns {Promise<{title: string, progressText: string, answered: number|null,
 *                    total: number|null, options: Array, submitText: string,
 *                    submitClass: string, submitDisabled: boolean|null}>}
 */
async function state(page) {
  const fg = await base.foreground(page);
  return fg.evaluate(
    (sel) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const text = norm(document.body.innerText);
      const m = text.match(/已答\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/);
      const options = [];
      document.querySelectorAll(sel.option).forEach((el) => {
        options.push({
          text: norm(el.innerText),
          cls: String(el.getAttribute("class") || ""),
        });
      });
      // ⚠️ 提交按钮类名实测有 3 个元素命中 [class*="activity-quiz-submit"]，
      // 这里取第一个；下面同时返回原始 class 字符串，便于核对"禁用态"到底怎么表达。
      // （另一份副本的文档写"未选答案时灰色禁用"，我们实测判定为 false —— 存疑，
      //   可能是判定方式不对，所以把原始 class 打出来，下次运行一看便知。）
      const sub = document.querySelector(sel.submit);
      const subCls = sub ? String(sub.getAttribute("class") || "") : "";
      const subDisabled = sub
        ? /disabled/i.test(subCls) ||
          sub.getAttribute("disabled") !== null ||
          sub.getAttribute("aria-disabled") === "true"
        : null;
      const titleEl = document.querySelector(sel.title);
      return {
        title: norm(titleEl ? titleEl.innerText : ""),
        progressText: m ? m[0] : "",
        answered: m ? Number(m[1]) : null,
        total: m ? Number(m[2]) : null,
        options,
        submitText: sub ? norm(sub.innerText) : "",
        submitClass: subCls,
        submitDisabled: subDisabled,
      };
    },
    { option: SEL.option, submit: SEL.submit, title: SEL.title }
  );
}

/**
 * 页面上有哪些活动卡（只读）。返回命中「答题」卡的那一项。
 * @returns {Promise<{cards: Array<{index: number, tag: string, box: Object|null}>, hit: Object|null}>}
 */
async function findCard(page, { tagContains = CARD_TAG_QUIZ } = {}) {
  const fg = await base.foreground(page);
  const cards = fg.locator(SEL.card);
  const n = await cards.count().catch(() => 0);

  const list = [];
  for (let i = 0; i < n; i++) {
    const el = cards.nth(i);
    const tag = await el
      .locator(SEL.cardTag)
      .first()
      .innerText()
      .catch(() => "");
    const box = await el.boundingBox().catch(() => null);
    list.push({ index: i, tag: String(tag || "").replace(/\s+/g, " ").trim(), box });
  }
  return { cards: list, hit: list.find((c) => c.tag.includes(tagContains)) || null };
}

/** 活动卡区能不能横向滑动（scrollWidth 明显大于 clientWidth） */
async function cardListScrollable(page) {
  const fg = await base.foreground(page);
  return fg
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return el.scrollWidth > el.clientWidth + 20;
    }, SEL.cardSwiper)
    .catch(() => false);
}

/**
 * 点「答题」活动卡进入答题页；卡不在当前屏内时，尝试横向滑动活动卡区再找。
 * 点击一律走 `tapElement`（读 boundingBox 换算物理坐标），**不写死坐标** ——
 * 写死坐标在屏幕内容变化时会点到无关位置（另一份副本踩过这个坑，见其坑 13）。
 */
async function openQuizCard(page, { timeout = 15000, maxSwipes = 4, waitForCard = 30000 } = {}) {
  const waitDeadline = Date.now() + waitForCard;
  let lastTags = [];

  for (let attempt = 1; attempt <= maxSwipes; attempt++) {
    const fg = await base.foreground(page);
    const { cards, hit } = await findCard(fg);
    lastTags = cards.map((c) => c.tag);

    console.log(
      `  [第 ${attempt} 次] 本页活动卡 ${cards.length} 张：${JSON.stringify(cards.map((c) => c.tag))}`
    );

    if (hit) {
      console.log(`  命中「${CARD_TAG_QUIZ}」卡：角标=${JSON.stringify(hit.tag)}`);
      await base.tapLocator(fg, fg.locator(SEL.card).nth(hit.index), `活动卡「${hit.tag}」`);
      const ok = await base.waitUntil(async () => isOn(page), { timeout });
      if (!ok) {
        const now = await base.foreground(page);
        throw new Error(
          `点击「${CARD_TAG_QUIZ}」卡后没有进入答题页（未出现 ${SEL.quizPage}）。` +
            `当前页面前 120 字: ${JSON.stringify((await base.pageText(now)).slice(0, 120))}`
        );
      }
      console.log("  已进入答题活动页");
      return base.foreground(page);
    }

    if (cards.length === 0) {
      throw preconditionError(
        `当前页面上没有活动卡（${SEL.card}）。可能在别的页面，或活动卡区未加载。` +
          `当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
      );
    }

    if (!(await cardListScrollable(fg))) {
      // 实测：卡区的角标会随时间变化（同一位置先后见过「答题·官方」「链接·官方」「图文·官方」），
      // 且只渲染 1 张（该状态下 scrollWidth == clientWidth，无卡可滑）。
      // 所以这里**等一等再看**，而不是立刻判死。
      if (Date.now() < waitDeadline) {
        console.log(`    当前不是「${CARD_TAG_QUIZ}」卡且无可滑动空间，等待卡变化后重试...`);
        await base.sleep(4000);
        page = await base.foreground(page);
        attempt -= 1; // 等待不算一次滑动尝试
        continue;
      }
      throw preconditionError(
        `等了 ${Math.round(waitForCard / 1000)} 秒仍未出现「${CARD_TAG_QUIZ}」活动卡。\n` +
          `  实测到的卡：${JSON.stringify(lastTags)}\n` +
          `  这是**前置条件不满足**（活动未上线/已换卡），不是框架缺陷 —— 用例应记为跳过。`
      );
    }

    // 横向滑动：按卡片实际位置算起止点，滑完**核对卡是否真的变了**
    const card = cards[0];
    if (!card.box) throw new Error("读不到卡片坐标，无法滑动");
    const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
    const y = Math.round((card.box.y + card.box.height / 2) * dpr);
    const x1 = Math.round((card.box.x + card.box.width - 10) * dpr);
    const x2 = Math.round((card.box.x + 10) * dpr);
    const device = await base.getDevice();
    const tagsBefore = cards.map((c) => c.tag).join("|");
    console.log(`  滑动活动卡区 (${x1},${y}) -> (${x2},${y})`);
    await device.shell(`input swipe ${x1} ${y} ${x2} ${y} 500`);
    await base.sleep(2500);

    const after = await findCard(page);
    const tagsAfter = after.cards.map((c) => c.tag).join("|");
    if (tagsAfter === tagsBefore) {
      throw new Error(
        `横向滑动后卡片没有变化（${tagsBefore}）。滑动很可能没作用在活动卡区上。\n` +
          `  这是"操作没生效"，不是"没找到卡" —— 两者原因不同，别混为一谈。`
      );
    }
  }

  throw new Error(`滑动 ${maxSwipes} 次后仍未找到「${CARD_TAG_QUIZ}」活动卡`);
}

/**
 * 确保停在答题活动页（自导航 + 幂等）。
 * 路径：已在答题页 -> 直接返回；否则退出一级页 -> 点底部 tab「有问必答」-> 找并点「答题」卡。
 */
async function ensureOn(page, { timeout = 15000 } = {}) {
  if (await isOn(page)) {
    console.log("已在答题活动页，跳过导航（幂等）");
    return base.foreground(page);
  }

  page = await base.ensureOnTabPage(page);
  await base.tapText(page, HOME_TAB_TEXT, `底部 tab「${HOME_TAB_TEXT}」`);
  await base.sleep(2500);
  return openQuizCard(page, { timeout });
}

/**
 * 校验答题页是否符合需求（需求 713594985「小程序-答题赢积分活动」）。
 *
 * **只读**：不选选项、不提交。断言项全部取自需求原文：
 *   1. 吸顶常驻「已选N/总数 · 答对最多可赢积分」（实现里文案是「已答： N /1」，语义是已选）
 *   2. 选项 2~6 个、且每个选项文本非空（需求：选项 2~6 个且互不相同）
 *   3. **提交按钮状态与"是否选完"一致**（需求：登录用户须答完全部题目才能提交）
 *      —— 断言"一致性"而不是"初始必须禁用"：小程序会记住上一次的选择（客户端状态），
 *      按固定期望断言会得到一个由环境决定的假失败。
 *   4. 题目状态词存在（未答 / 已选 / 答对 / 答错）
 */
async function assertQuizPageRules(page, kwargs, ctx) {
  // 【锚定】这是"页面上应该长什么样"的结构/需求检查，锚在**识别出来的答题页**上比锚在
  // "猜出来的前台页"上更对：即使前台页判错，只要答题页存在，这一组检查就该在它上面做。
  const fg = (await findQuizPage(page)) || (await base.foreground(page));
  const st = await state(fg);
  const text = await base.pageText(fg);
  const problems = [];
  // 多选题库活动（一页渲染好几道题）还是单题活动？—— 决定下面按题判还是按整页判
  const multi = st.total !== null && st.total > 1;
  if (!text.includes("答对最多可赢积分")) {
    problems.push("吸顶栏缺少文案「答对最多可赢积分」");
  }
  if (!/已[选答]\s*[:：]?\s*\d+\s*\/\s*\d+/.test(text)) {
    problems.push("吸顶栏缺少进度「已选/已答 N/总数」");
  }
  /*
   * 【选项数要按"每道题"判】需求原文是「选项 2~6 个且互不相同」—— **按题**说的。
   *
   * 2026/10/10 踩过：线上多题活动把 15 道题的选项全渲染在一页里，整页数出 52 个，
   * 这条断言不成立，只能整体记跳过（坑 16）。
   * 2026/10/12 拿到题目边界（一题 = 一个 `.quiz-card`）之后改成**逐题判**：
   *   · 多选题库活动 -> 按 .quiz-card 分组，每题单独数选项、查空文本、查文字重复
   *   · 单题活动 -> 沿用"整页就是这一题"的老判据（同样的规则，写法更直接）
   */
  if (multi) {
    const questions = await readQuestions(fg);
    if (questions.length !== st.total) {
      problems.push(
        `吸顶进度说共 ${st.total} 题，但 DOM 里读到 ${questions.length} 个题目容器（${SEL_Q.card}）—— 两边的"题数"对不上`
      );
    }
    problems.push(...checkQuestionOptions(questions));
  } else {
    // 单题活动：整页就是这一题（用同一套规则，只是题数固定为 1）
    problems.push(...checkQuestionOptions([{ head: st.title, options: st.options }]));
  }
  if (!/(未答|已选|已答|答对|答错)/.test(text)) {
    problems.push("找不到题目状态词（未答/已选/答对/答错）");
  }

  const allSelected = st.answered !== null && st.total !== null && st.answered >= st.total;
  const expectedDisabled = !allSelected;
  if (st.submitDisabled !== expectedDisabled) {
    problems.push(
      `提交按钮状态与选择数不一致：已选 ${st.answered}/${st.total}，` +
        `按钮禁用=${st.submitDisabled}（需求要求"答完全部题目才能提交"，即应为 ${expectedDisabled}）`
    );
  }

  if (problems.length) {
    throw new Error(
      "答题页不符合需求（713594985）：\n  - " +
        problems.join("\n  - ") +
        "\n  实测: " +
        JSON.stringify({
          progressText: st.progressText,
          optionCount: st.options.length,
          questionCount: multi ? st.total : 1,
          submitText: st.submitText,
          submitDisabled: st.submitDisabled,
          pageText: text.slice(0, 160),
        })
    );
  }
  console.log(
    `断言通过: 答题页符合需求口径（吸顶文案齐全 / ${multi ? `共 ${st.total} 题，逐题选项都在 2~6 且不重复` : `选项数=${st.options.length}`} / ` +
      `按钮禁用=${st.submitDisabled} 与已选 ${st.answered}/${st.total} 一致 / 状态词齐全）`
  );
  if (ctx) ctx.set("quizRulesChecked", true);
  return fg;
}

/**
 * 逐题打印题目信息（**只读**）：多选题库活动时，报告里能看清"一共几题、每题几个选项"。
 * 单题活动也会打一行（就一题）。
 */
async function logQuestions(page, kwargs, ctx) {
  const questions = await readQuestions(page);
  if (!questions.length) {
    console.log("  这个答题页上没有题目容器（.quiz-card）—— 页面可能还没渲染完，或活动用的是另一种写法");
    return page;
  }
  console.log(`  共读到 ${questions.length} 道题：`);
  questions.forEach((q, i) => {
    console.log(`    第 ${i + 1} 题：${JSON.stringify(q.head)}，选项 ${q.options.length} 个`);
  });
  if (ctx) ctx.set("quizQuestionCountDetail", questions.length);
  return page;
}

/** 打印答题页状态（只读），并把进度存进用例上下文 */
async function logState(page, kwargs, ctx) {
  const st = await state(page);
  console.log(`  活动标题: ${JSON.stringify(st.title)}`);
  console.log(`  进度: ${JSON.stringify(st.progressText)}（已答 ${st.answered}/${st.total}）`);
  st.options.forEach((o, i) => console.log(`  选项[${i}] ${JSON.stringify(o.text)}`));
  console.log(`  提交按钮: ${JSON.stringify(st.submitText)} 禁用=${st.submitDisabled}`);
  console.log(`    原始 class: ${JSON.stringify(st.submitClass.slice(0, 120))}`);
  if (ctx) {
    ctx.set("quizTitle", st.title);
    ctx.set("quizProgress", st.progressText);
    ctx.set("quizAnswered", st.answered);
  }
  return page;
}

/**
 * 选第一个选项，并**断言它真的被选中了**（动作结果断言，不是"点了就算数"）。
 * 题目已答完时选项通常已锁定 -> 跳过选择并说明原因（这不是"跳过验证"）。
 *
 * ⚠️ 默认不执行（`allowInteract` 默认 false）：因为存在"选中即自动提交"的存疑，
 * 在查清之前把点选项也当成写数据操作。见文件头的说明。
 *
 * @param {{allowInteract?: boolean}} params
 */
async function selectFirstOption(page, { allowInteract = false } = {}, ctx = null) {
  const st = await state(page);

  if (!allowInteract) {
    console.log(
      "  allowInteract=false -> 不点选项。原因：存在「选中即自动提交」的存疑（见文件头），" +
        "在查清之前把点选项也当作写数据操作。"
    );
    return page;
  }
  if (st.answered !== null && st.total !== null && st.answered >= st.total) {
    console.log(
      `  该题已答完（${st.progressText}），选项应已锁定 -> 跳过选择` +
        `（此时点选项不会有任何效果，硬点只会得到一个假失败）`
    );
    return page;
  }

  const fg = await base.foreground(page);
  const options = fg.locator(SEL.option);
  const n = await options.count().catch(() => 0);
  if (n === 0) throw new Error(`答题页上没有选项（${SEL.option}）`);

  const first = options.first();
  const text = String(await first.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  await base.tapLocator(fg, options, `第一个选项「${text}」`);
  await base.sleep(1200);

  // 断言选中态：被点选项的 class 应出现 checked/selected/active 之类标记
  const readCls = async () =>
    await fg
      .locator(SEL.option)
      .first()
      .evaluate((el) => String(el.getAttribute("class") || ""))
      .catch(() => "");

  const ok = await base.waitUntil(async () => /checked|selected|active|--on/i.test(await readCls()), {
    timeout: 5000,
    interval: 300,
  });
  if (!ok) {
    throw new Error(
      `点击选项后没有观察到选中态（第一个选项 class=${JSON.stringify(await readCls())}）。\n` +
        `  点击走的是真实 adb tap，所以先怀疑选中态的 class 命名与预期不同。`
    );
  }
  console.log("  已选中第一个选项（选中态断言通过）");
  if (ctx) ctx.set("quizSelectedOption", text);
  return fg;
}

/**
 * 提交答案 —— **会写真实账号的数据**，因此只有显式 `allowSubmit: true` 才执行。
 * @param {{allowSubmit?: boolean}} params
 */
async function submitIfAllowed(page, { allowSubmit = false } = {}) {
  const st = await state(page);

  if (!allowSubmit) {
    console.log(
      "  allowSubmit=false -> 不提交。原因：题目一次性、这台设备用真实账号，" +
        "提交会真的改数据。确需跑完整链路时把用例里的 ALLOW_SUBMIT 改成 true。"
    );
    return page;
  }
  if (st.answered !== null && st.total !== null && st.answered >= st.total) {
    console.log(`  该题已答完（${st.progressText}），跳过提交`);
    return page;
  }
  if (st.submitDisabled) {
    throw new Error("提交按钮仍是禁用态，说明选项没有被真正选中（不要在这里硬点）");
  }

  const fg = await base.foreground(page);
  await base.tapSelector(fg, SEL.submit, "提交按钮");

  const ok = await base.waitUntil(
    async () => {
      const cur = await state(page);
      const now = await base.foreground(page);
      const text = await base.pageText(now);
      const hasFeedback = /回答正确|回答错误|答对|答错|正确|错误/.test(text);
      const progressed = cur.answered !== null && cur.total !== null && cur.answered >= cur.total;
      return hasFeedback || progressed;
    },
    { timeout: 8000 }
  );
  if (!ok) {
    const now = await base.foreground(page);
    throw new Error(
      "点击提交后没有观察到任何反馈（既无正确/错误提示，进度也没推进）。\n" +
        `  当前页面前 200 字: ${JSON.stringify((await base.pageText(now)).slice(0, 200))}`
    );
  }
  console.log("  提交后观察到反馈，答题流程完成");
  return base.foreground(page);
}

/* ==========================================================================
 * 多选题库活动：按"一道题"来读和答
 * ==========================================================================
 * 能力边界（写在最前面，避免误用）：
 *   · 下面用的 `.quiz-card` 边界是 **2026/10/12 真机实测**的结果（活动「Z-题干图验证」）。
 *     换一种活动实现，类名可能不同 —— 那时要重新实测（跑 probe_quiz_page.js），别猜。
 *     一道题都读不到时会明确报错，不会静默当成"只有一道题"。
 *   · 点选项**只改前端选中态、不写库**（账本第二十一节有数据库实验证据）；
 *     真正写库的是「提交」。
 */

/**
 * 逐题读状态（**只读**）：一题 = 一个 `.quiz-card`。
 * @returns {Promise<Array<{index:number, head:string, text:string, options:Array<{text:string, checked:boolean}>}>>}
 */
async function readQuestions(page) {
  const fg = (await findQuizPage(page)) || (await base.foreground(page));
  return fg.evaluate(
    (sel) => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      document.querySelectorAll(sel.card).forEach((card, i) => {
        const head = card.querySelector(sel.head);
        const options = [];
        card.querySelectorAll(sel.option).forEach((el) => {
          options.push({
            text: norm(el.innerText),
            checked: /checked|selected|active|--on/i.test(String(el.getAttribute("class") || "")),
          });
        });
        out.push({
          index: i,
          head: norm(head ? head.innerText : ""),
          text: norm(card.innerText).slice(0, 80),
          options,
        });
      });
      return out;
    },
    { card: SEL_Q.card, head: SEL_Q.head, option: SEL.option }
  );
}

/**
 * 逐题作答：把还没选的题都选上**第一个选项**，每题选完立刻验证"真的选中了"。
 *
 * 【为什么要有它】需求要求"登录用户须答完全部题目才能提交" —— 想跑「提交」这条链路，
 * 必须先有能力把 15 道题都答上。以前没有这个能力，多题活动只能整体记跳过（坑 16）。
 * 现在知道了题目边界（`.quiz-card`），就能按题来读、按题来点。
 *
 * 屏幕外的题不用手滑：`tapElement` 发现目标在屏幕外时会先把它滚进可视区再点
 * （android.js 2026/10/10 起就有的保护）。
 *
 * @param {{allowInteract?: boolean, ctx?: object}} params
 *   allowInteract 默认 false：虽然是"只改前端"的操作，仍然要显式声明 ——
 *   免得它被顺手塞进一条只读用例里。
 */
async function answerAllQuestions(page, { allowInteract = false, ctx = null } = {}) {
  if (!allowInteract) {
    throw new Error(
      "「逐题作答」需要显式打开开关（allowInteract: true）。\n" +
        "  为什么：它会在页面上逐个点选项。已用数据库实验证明**只点选项不写库**（账本第二十一节），\n" +
        "  但这种「点一下就变」的操作仍然要显式声明，免得它被顺手塞进一条只读用例里。"
    );
  }

  page = (await findQuizPage(page)) || page;
  const fg = await base.foreground(page);
  const cards = fg.locator(SEL_Q.card);
  const n = await cards.count();
  if (n === 0) {
    throw new Error(
      `答题页上找不到题目容器（${SEL_Q.card}）—— 无法按题作答。\n` +
        `  这是**框架识别能力**不足（不是产品 bug）：说明这个活动的 DOM 结构和 2026/10/12 实测的多题活动不同。\n` +
        `  别猜 —— 先跑 node test_case/diagnostic/probe_quiz_page.js 看清结构再改页面对象。`
    );
  }

  const before = await state(page);
  console.log(`  本次活动共 ${n} 道题（进度 ${JSON.stringify(before.progressText)}）`);

  let already = 0;
  let picked = 0;
  for (let i = 0; i < n; i++) {
    const qs = await readQuestions(page);
    const q = qs[i];
    if (!q) throw new Error(`读不到第 ${i + 1} 题（一共读到 ${qs.length} 题）`);
    if (q.options.some((o) => o.checked)) {
      already += 1;
      console.log(`  第 ${i + 1}/${n} 题已经选过了（${JSON.stringify(q.head)}），跳过`);
      continue;
    }

    const opts = cards.nth(i).locator(SEL.option);
    const firstText = String(await opts.first().innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    await base.tapLocator(fg, opts.first(), `第 ${i + 1} 题的选项「${firstText}」`);

    // 动作结果断言：点完必须真的变成"选中态"，否则后面那句"答完了"就是空话
    const ok = await base.waitUntil(
      async () => {
        const now = await readQuestions(page);
        return !!(now[i] && now[i].options.some((o) => o.checked));
      },
      { timeout: 5000, interval: 300 }
    );
    if (!ok) {
      const now = await readQuestions(page);
      throw new Error(
        `第 ${i + 1} 题的选项点了但没变成选中态（题目状态：${JSON.stringify((now[i] || {}).head)}）。\n` +
          `  当前选项：${JSON.stringify((now[i] || {}).options)}`
      );
    }
    picked += 1;
    const cur = await state(page);
    console.log(`  第 ${i + 1}/${n} 题已选「${firstText}」-> 进度 ${JSON.stringify(cur.progressText)}`);
  }

  const after = await state(page);
  console.log(
    `  逐题作答完成：新选 ${picked} 题、原本已选 ${already} 题；进度 ${JSON.stringify(after.progressText)}`
  );
  if (ctx) {
    ctx.set("quizQuestionCount", n);
    ctx.set("quizPickedCount", picked);
    ctx.set("quizProgressAfterAnswer", after.progressText);
  }
  return base.foreground(page);
}

/**
 * 提交答卷 —— **会写真实账号的数据**；没有开关就**报错**（不是静默跳过）。
 *
 * 与 `submitIfAllowed` 的区别（两个都留着，别用错）：
 *   · `submitIfAllowed`：老用例（test_quiz_activity.js）用的。开关关着只打一句日志就继续，
 *     语义是"这条用例本来就不打算提交"；它还会在"进度已满"时跳过提交 —— 那是按**单题**活动的
 *     旧经验写的（单题时"1/1"曾被当成"已答过"）。
 *   · `submitAnswers`：给**写链路**用的。开关关着直接抛错；并且要求"题目答完、按钮可用"才点 ——
 *     在多题活动里"进度满了"恰恰是"可以提交"的意思，两者语义正好相反。
 *
 * @param {{allowSubmit?: boolean, ctx?: object}} params
 */
async function submitAnswers(page, { allowSubmit = false, ctx = null } = {}) {
  if (!allowSubmit) {
    throw new Error(
      "「提交答卷」没有打开开关，已拒绝执行（这个操作会**真的写数据**）。\n" +
        "  打开方式：跑用例时设环境变量 UITEST_ALLOW_SUBMIT=1。\n" +
        "  为什么报错而不是跳过：跳过会让「没测」看起来像「没问题」。\n" +
        "  提交前请确认：这是我们自己的测试活动，跑完用 tools/quiz_data_cleanup.py 复位。"
    );
  }

  const st = await state(page);
  console.log(
    `  提交前：进度 ${JSON.stringify(st.progressText)}，按钮 ${JSON.stringify(st.submitText)} 禁用=${st.submitDisabled}`
  );
  if (st.submitDisabled) {
    throw new Error(
      `提交按钮是禁用态（进度 ${st.progressText}）—— 说明题目还没答完，不能硬点。\n` +
        `  需求口径：登录用户须答完全部题目才能提交。先跑「逐题作答」把题答完。`
    );
  }
  if (st.answered !== null && st.total !== null && st.answered < st.total) {
    throw new Error(`进度显示还没答完（${st.progressText}），不能提交`);
  }

  const fg = await base.foreground(page);
  await base.tapSelector(fg, SEL.submit, "提交按钮");

  // 判据取自需求原文：「提交后按钮变成"已提交已参加本次活动"状态，不可再次点击」
  const ok = await base.waitUntil(
    async () => {
      const text = await base.pageText(await base.foreground(page));
      return /已提交|已参加|提交成功/.test(text);
    },
    { timeout: 10000, interval: 400 }
  );
  const after = await base.foreground(page);
  const text = await base.pageText(after);
  if (!ok) {
    throw new Error(
      "点了提交，但页面上没出现「已提交 / 已参加」这类提交成功的样子。\n" +
        `  当前页面前 300 字: ${JSON.stringify(text.slice(0, 300))}`
    );
  }
  const st2 = await state(after);
  console.log(`  提交成功：按钮变成 ${JSON.stringify(st2.submitText)}，进度 ${JSON.stringify(st2.progressText)}`);
  if (ctx) ctx.set("quizSubmitTextAfter", st2.submitText);
  return after;
}

module.exports = {
  SEL,
  SEL_Q,
  checkQuestionOptions,
  HOME_TAB_TEXT,
  CARD_TAG_QUIZ,
  isOn,
  findQuizPage,
  state,
  readQuestions,
  findCard,
  cardListScrollable,
  openQuizCard,
  ensureOn,
  assertQuizPageRules,
  logQuestions,
  logState,
  selectFirstOption,
  submitIfAllowed,
  answerAllQuestions,
  submitAnswers,
};
