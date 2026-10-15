/*
 * 页面对象：首页活动卡区 + 答题活动页
 *
 * 【知识来源】页面结构来自另一份工作副本（原仓库）的实测笔记，我们**逐项复核**后收录；
 * 用例与实现用我们自己的原语重写（页面对象 + 断言层 + 每步前台页解析）。
 *
 * 实测结构（2026/10/10）：
 *
 * 首页活动卡区（**轮播 swiper，一次只显示一张**）：
 *   [class*="qa-activity-flow-item--card"]      卡片本体（实测 163x217，css 约 (7,313)）
 *   [class*="qa-activity-flow-item__tag"]       角标 —— 判断是哪张卡靠它，
 *                                               文本形如「答题·官方」「链接·官方」
 *   [class*="qa-activity-flow-item__swiper"]    轮播容器（下面有 .wx-swiper-dot 圆点）
 *   ⚠️ 卡片数量会随活动上下线变化：实测同一位置先后见过「答题·官方」和「链接·官方」，
 *      也见过只渲染 1 张（scrollWidth == clientWidth，此时无需横滑）。
 *   ⚠️ **2026/10/15 纠正（坑 44 定稿）**：首页**只有一张活动卡**（= 一条活动）。
 *      卡里那个带 5 个圆点的 swiper 是**这条活动自己的 5 张图片**在自转
 *      （`autoplay` / `circular` / `interval=4000`），`current` 是"第几张图片"。
 *      角标（类型·来源）**会闪一下就没**（异步渲染，实测前 2 秒有、之后十几秒空）。
 *      位移是 transform（`scrollWidth == clientWidth` 恒成立）。
 *      详见 `readCardState` / `openQuizCard`。
 *
 * 答题活动页：
 *   .activity-quiz-page                         整页根容器（只出现在答题页，比文案可靠）
 *     .custom-navbar                            标题「Z-B4-答题角标」+ 返回
 *     .activity-quiz-card__title                活动标题
 *     .quiz-option                              选项（**两套样式共用基类**）：
 *                                               单选 .quiz-option--row / 多选 .quiz-option--grid
 *                                               （2026/10/15 补齐：只写 --row 会漏掉多选题）
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
  /*
   * ⚠️ 选项**有两套类名**，必须用公共基类 `.quiz-option`：
   *   · 单选题：`quiz-option quiz-option--row quiz-option--normal|--selected`（容器 .quiz-options--row）
   *   · 多选题：`quiz-option quiz-option--grid quiz-option--normal`（容器 .quiz-options--grid，选项里带图）
   * 2026/10/15 实测踩到：只写 `--row` 时，多选题的选项**一个都命中不到**
   * （活动「M1-六选项六图」第 2 题是多选，count 恒为 0，于是"点了没反应"）。
   * 用基类 `.quiz-option` 两边都覆盖；旁边那些 `quiz-option__badge / __text / __img`
   * 是**另外的类名**（双下划线），不会被 `.quiz-option` 选中。
   */
  option: ".quiz-option",
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
 *       .quiz-option               选项（**.quiz-option--row 单选 / .quiz-option--grid 多选**；
 *                                  只属于它所在的那个 .quiz-card）
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

/**
 * 活动卡区现在是**第几张卡**（读轮播圆点）+ 当前这张的角标文本。
 *
 * 【为什么要读圆点】2026/10/14 实测（答题卡"消失"那次）：
 *   卡区是一个 swiper（5 个圆点 = 5 张活动卡），但它
 *     ① **只把当前这张卡的角标渲染出来**（所以按角标只能认出一张）；
 *     ② `scrollWidth == clientWidth` —— 它是 **transform 位移**，不是滚动，
 *        所以「scrollWidth 比 clientWidth 大」这个判据**永远为假**（旧版就卡在这里，
 *        它以为"没有可滑的卡"，只能干等卡自己变，于是 30 秒后误报"活动没上线"）。
 *   唯一可靠的做法：**滑一下、看圆点动没动**，再看圆点停在哪、角标写了什么。
 *
 * @returns {Promise<{tag: string, index: number, total: number, box: {x:number,y:number,width:number,height:number}|null}|null>}
 *   index = 圆点是第几个（读不到 -1）；total = 圆点总数（0 表示读不到圆点）
 */
async function readCardState(page) {
  const fg = await base.foreground(page);
  return fg
    .evaluate(
      (sel) => {
        const wrap = document.querySelector(sel.card);
        if (!wrap) return null;
        const dots = Array.from(wrap.querySelectorAll(".wx-swiper-dot"));
        const tagEl = wrap.querySelector(sel.cardTag);
        const sw = wrap.querySelector(sel.swiper);
        const r = wrap.getBoundingClientRect();
        return {
          tag: String((tagEl && tagEl.innerText) || "").replace(/\s+/g, " ").trim(),
          index: dots.findIndex((d) => String(d.className).includes("active")),
          total: dots.length,
          autoplay: sw ? sw.hasAttribute("autoplay") : false,
          intervalMs: sw ? Number(sw.getAttribute("interval")) || 0 : 0,
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      },
      { card: SEL.card, cardTag: SEL.cardTag, swiper: SEL.cardSwiper }
    )
    .catch(() => null);
}

/**
 * 等「答题」角标出现（连着读，最多等 timeoutMs）。
 *
 * 为什么不能"读一次没有就判死"：角标**只渲染当前那一张**，而且**会闪一下就没**
 * （2026/10/15 实测：前 2 秒读到「答题·官方」，之后十几秒读到的都是空串）。
 * @returns {Promise<string|null>} 含「答题」的角标文本；等不到就返回 null
 */
async function waitForQuizTag(page, { timeoutMs = 4000, seenTags = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await readCardState(page);
    const tag = (st && st.tag) || "";
    if (tag && seenTags) seenTags.add(tag);
    if (tag.includes(CARD_TAG_QUIZ)) return tag;
    if (Date.now() >= deadline) return null;
    await base.sleep(700);
  }
}

/**
 * 点「答题」活动卡进入答题页。
 *
 * 【怎么找卡 —— 2026/10/15 真机实测定的口径】
 *   ① 首页**只有一张活动卡**（`qa-activity-flow-item--card`）：它代表**一条活动**，
 *      卡里那个带 5 个圆点的 swiper 是**这条活动自己的 5 张图片**在自转（`autoplay` 4 秒一次），
 *      **不是"5 张活动卡"**。（这一条我先后判错过两次，最后是打开卡片 HTML + 数 slide 的封面地址
 *      确认的：5 个 slide 的封面是同一个地址、角标只有一个。）
 *   ② 所以"首页有没有答题卡"= "前端挑中的那条活动是不是答题活动"。
 *      库里"在时间窗内 + 显示中"的活动可能有好几条，前端只挑一条放在这里。
 *   ③ 判据按可靠程度排：
 *      · **角标**（`qa-activity-flow-item__tag`，形如「答题·官方」）—— 最直接，但它是异步渲染的、
 *        会闪一下就没，实测最长见过 45 秒都不出现；
 *      · **落地页** —— 点一次卡，看有没有进 `.activity-quiz-page`。角标读不到时靠它定论。
 *   ④ 角标写着别的类型（例如「图文·官方」）就直接记跳过：点别的活动卡只会打开它自己的页面。
 *      实测还有**点了完全没反应**的活动卡（「新人首帖奖励」那张，三个位置都点不动，
 *      而同一屏的搜索栏一点就开 —— 是那张卡自己没配跳转，不是框架点不中）。
 *
 * 点击一律走 `tapLocator`（读 boundingBox 换算物理坐标），**不写死坐标** ——
 * 写死坐标在屏幕内容变化时会点到无关位置（另一份副本踩过这个坑，见其坑 13）。
 */
async function openQuizCard(page, { timeout = 15000 } = {}) {
  const seenTags = new Set();

  // ① 先等角标（异步渲染、会闪一下就没；实测最长见过 45 秒都不渲染）
  const tag = await waitForQuizTag(page, { timeoutMs: 6000, seenTags });
  const st = await readCardState(page);
  if (!st) {
    const fg = await base.foreground(page);
    throw preconditionError(
      `当前页面上没有活动卡（${SEL.card}）。可能在别的页面，或活动卡区未加载。` +
        `当前页面前 120 字: ${JSON.stringify((await base.pageText(fg)).slice(0, 120))}`
    );
  }
  console.log(
    `  首页活动卡：角标=${JSON.stringify(tag || st.tag)}（这一张卡内部的图片轮播 第 ${st.index + 1}/${st.total} 张）`
  );

  // ② 角标明确写着别的类型（例如「图文·官方」）-> 首页这张卡就不是答题活动，直接记跳过。
  //    为什么不硬点：点别的活动卡会打开它自己的页面（有些还会带来副作用），而结论不会变。
  if (st.tag && !st.tag.includes(CARD_TAG_QUIZ)) {
    throw preconditionError(
      `首页这张活动卡不是答题活动（角标=${JSON.stringify(st.tag)}）。\n` +
        `  这张卡背后是一条活动：库里"在时间窗内 + 显示中"的活动有好几条，前端只会挑一条放在这里。\n` +
        `  想跑这条用例：把答题活动**设为显示中**、并让它在时间窗内（测试环境可以直接在管理后台改），` +
        `  或者把当前这条活动的显示状态关掉。\n` +
        `  这是**前置条件不满足**，不是框架缺陷 —— 用例应记为跳过。`
    );
  }

  // ③ 角标是空的（异步渲染还没来得及显示）：点一次、看落地页 —— 用"落地页"当最终判据。
  const fg = await base.foreground(page);
  await base.tapLocator(fg, fg.locator(SEL.card).first(), tag ? `活动卡「${tag}」` : "首页活动卡");
  const ok = await base.waitUntil(async () => isOn(page), { timeout: Math.min(timeout, 8000) });
  if (ok) {
    console.log("  已进入答题活动页");
    return base.foreground(page);
  }

  const now = await base.foreground(page);
  const where = JSON.stringify((await base.pageText(now)).slice(0, 60));
  if (tag) {
    // 角标说是答题卡、点下去却没进答题页 —— 这是"操作没生效/产品侧问题"，该报红让人看一眼
    throw new Error(
      `角标写着「${st.tag}」（答题卡），但点下去没进答题页（当前页面前 60 字：${where}）。\n` +
        `  角标（类型·来源）是前端按活动类型渲染的，指着它却打不开，说明这张卡的行为跟角标对不上。\n` +
        `  下一步：截图 + 这条输出发给开发；若活动刚下线/到点，也会是这个样子。`
    );
  }
  throw preconditionError(
    `首页这张活动卡点下去没有进入答题页（角标空、落地页还是：${where}）。\n` +
      `  两种可能：① 这张卡背后不是答题活动（库里好几条在窗活动，前端挑了一条放在这里）；\n` +
      `  ② 它是答题活动，但这条活动没配跳转 —— 实测「新人首帖奖励」那张就是点了没反应。\n` +
      `  这是**前置条件不满足**，不是框架缺陷 —— 用例应记为跳过；` +
      `  想跑就先让答题活动成为首页这张卡（管理后台设显示中 / 关掉别的活动）。`
  );
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
/**
 * 点「第 i 题的第 1 个选项」—— **点哪里要按选项样式决定**。
 *
 * 【为什么不能一律点"元素中心"】2026/10/15 实测（活动「M1-六选项六图」第 2 题，多选）：
 *   选项长这样（CSS 尺寸 149x156）：
 *     .quiz-option--grid
 *       .quiz-option__grid-img      图片区 142x108（占了大半）
 *       .quiz-option__grid-row      下面一行：角标 A + 文字
 *   点**格子中心**（正好落在图片上）→ 毫无反应：class 还是 --normal、进度也不动；
 *   点**下面那一行**（角标/文字）→ 立刻变成 --selected、进度 1/2 → 2/2。
 *   （单选 `.quiz-option--row` 没有这个问题：它整行都是文字，点行中心就是点到了。）
 *
 * 所以：格子型选项按"角标那一行"的真实坐标点；其它情况仍走 `tapLocator`（它带
 * "目标在屏幕外就先滚进来"和"被盖住就报错"的保护）。
 *
 * @returns {Promise<Object>} page（框架的链条要求返回 page）
 */
async function tapQuestionFirstOption(page, i) {
  const fg = await base.foreground(page);
  const opt = fg.locator(SEL_Q.card).nth(i).locator(SEL.option).first();
  const gridRow = opt.locator(".quiz-option__grid-row").first();
  const isGrid = (await gridRow.count().catch(() => 0)) > 0;

  if (!isGrid) {
    await base.tapLocator(fg, opt, `第 ${i + 1} 题的选项`);
    return fg;
  }

  // 格子型：用"角标+文字"那一行的中心坐标点。
  // 不走 tapElement 的"往上找可点祖先"—— 那会爬到整个格子、又落回图片那一块（实测点不动）。
  const device = await base.getDevice();
  const dpr = await fg.evaluate(() => window.devicePixelRatio || 1);
  const readPoint = async () => {
    const box = await gridRow.boundingBox().catch(() => null);
    if (!box) return null;
    return {
      css: { x: box.x, y: box.y, w: box.width, h: box.height },
      x: Math.round((box.x + box.width / 2) * dpr),
      y: Math.round((box.y + box.height / 2) * dpr),
    };
  };

  let p = await readPoint();
  if (!p) throw new Error(`第 ${i + 1} 题的选项取不到坐标（角标那一行读不到）`);
  const screen = await fg.evaluate(() => ({
    h: Math.round((window.innerHeight || 0) * (window.devicePixelRatio || 1)),
  }));
  // 不在屏幕里就先滑上来（多题活动下面几道题常常在屏幕外）
  for (let k = 0; k < 4 && (p.y < 0 || p.y > screen.h); k++) {
    console.log(`  第 ${i + 1} 题的选项在屏幕外（y=${p.y}，屏高 ${screen.h}）—— 先滑上来`);
    const { swipeUpEx } = require("../android");
    const res = await swipeUpEx(page, {});
    if (!res.moved) break;
    await base.sleep(600);
    p = await readPoint();
    if (!p) break;
  }
  if (!p || p.y < 0 || p.y > screen.h) {
    throw new Error(`第 ${i + 1} 题的选项滑不进屏幕（最后量到 y=${p ? p.y : "读不到"}，屏高 ${screen.h}）`);
  }
  console.log(`  点第 ${i + 1} 题的选项：角标那一行 adb tap(${p.x}, ${p.y})`);
  await device.shell(`input tap ${p.x} ${p.y}`);
  return fg;
}

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
    await tapQuestionFirstOption(page, i);

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
  tapQuestionFirstOption,
  findCard,
  readCardState,
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
