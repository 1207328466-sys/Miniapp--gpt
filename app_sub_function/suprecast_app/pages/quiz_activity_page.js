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
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.quizPage)) > 0;
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

module.exports = {
  SEL,
  HOME_TAB_TEXT,
  CARD_TAG_QUIZ,
  isOn,
  state,
  findCard,
  cardListScrollable,
  openQuizCard,
  ensureOn,
  logState,
  selectFirstOption,
  submitIfAllowed,
};
