/*
 * @project_name: UITest
 * @cur_file: test_learn_center_column.js
 * @create_date: 2026/10/10
 *
 * 用例：学习中心 -> 专栏 -> 点击第一个专栏
 *
 * 流程：
 *   1. 确保处于学习中心-专栏列表页（自动处理多种起始状态）
 *   2. 点击顶部 tab「专栏」
 *   3. 点击第一张专栏卡片 .column-card
 *   4. 验证已进入专栏详情页
 *
 * 前置条件（框架不会代劳，必须手动准备）：
 *   - 微信已登录，目标小程序已打开并停留在前台
 *   - 起始页可以是：首页 / 学习中心 / 专栏列表页 / 专栏详情页 / 用户中心
 *     （步骤 1 会自动导航过去）
 *
 * 页面上定位到的真实结构（2026/10/10 实测，见 report/diagnostic/）：
 *
 * 专栏列表页（元素约 217 个）：
 *   <wx-view class="course-header-tabs">
 *     <wx-view class="h5-view header-tab">课程</wx-view>
 *     <wx-view class="h5-view header-tab active">专栏</wx-view>     <- 顶部 tab
 *     <wx-view class="header-tab">压铸百科</wx-view>
 *   </wx-view>
 *   <wx-view class="column-tab-list">
 *     <wx-view class="column-card" id="_AVe">                       <- 第一张卡片
 *       <wx-view class="column-card-banner">...图片...</wx-view>
 *       <wx-text class="column-card-name"><span>N1-预热期专栏</span></wx-text>
 *       <wx-view class="column-card-guest">...Zhanxinze / 铸问达人 / 关注...</wx-view>
 *     </wx-view>
 *     ...共 7 张卡片
 *   </wx-view>
 *
 * 专栏详情页（元素约 118 个，无底部 tab 栏）：
 *   <wx-view class="custom-navbar">
 *     <wx-text class="h5-i iconfont icon-base-nav-return">       <- 返回按钮 17x17
 *     <span>互动专栏</span>
 *     <wx-view class="col-subscribe-btn ...">已订阅</wx-view>
 *   </wx-view>
 *   <wx-text class="col-title"><span>N1-预热期专栏</span></wx-text>  <- 详情页独有标记
 *
 * 三条框架约定（写步骤函数必须遵守）：
 *   1. 步骤函数第一个参数是 page，结尾必须 return page，否则后续步骤拿到 undefined
 *   2. kwargs 非空时框架以 func(page, kwargs) 调用
 *   3. 所有交互走 tapElement（真实 adb tap）—— 实测合成 .click() 在小程序上
 *      会因页面持续重绘导致 "stable" 检查永不满足，要么超时抛错、
 *      要么在点击实际成功时误报失败
 *
 * [!] 已踩过的三个坑，勿重犯：
 *   1. 控制台输出不要用 emoji：pytest 往 Windows GBK 控制台打印时会抛
 *      UnicodeEncodeError，把真正的失败原因掩盖掉。
 *   2. 小程序某些导航会**销毁旧 page 对象**（如从详情页点返回），
 *      继续用旧引用会报 "Target page, context or browser has been closed"。
 *   3. 【第二轮踩的坑，本用例失败的真正原因】导航后旧 page 更常见的命运是
 *      **降级为后台页**：它仍然活着、仍然在 context.pages() 里，但内容冻结在
 *      切换前。此时若只检查"page 还活着吗"，就会一直拿着冻结页做判据，
 *      表现为「界面明明已经切到目标页了、判据却说没切过去」，然后反复点击到超时。
 *      修法：判据前一律用 resolveForegroundPage(page) 取当前前台页，并且
 *      **同一个判据里的所有检查必须作用在同一个 page 对象上**。
 *      （旧写法里 .column-card 数量查的是传入 page、页面文本查的是前台页，
 *        两个检查看两个页面，结论必然自相矛盾。）
 */

const path = require("path");
const { appTest, resolveForegroundPage } = require("../../common/app_common");
const {
  getDevice,
  tapElement,
  dumpElements,
  goBack,
  assertTextVisible,
  assertTextNotVisible,
  assertSelectorExists,
  assertSelectorCount,
} = require("../../app_sub_function/suprecast_app/android");

// ---------- 选择器与期望值（集中定义，小程序改版时改这里）----------
const SEL_LEARN_TAB_TEXT = "学习中心"; // 底部 tab（按文本定位）
// 顶部 tab 元素本身。
// 注意：这里绝不能用子串匹配 [class*="header-tab"] —— 容器是 course-header-tabs，
// 它的 class 里同样含有 "header-tab"，会被一起匹配进来且排在第一位，
// 于是 .first() 选中的是容器；容器中心恰好落在「专栏」tab 的右边界上（实测
// 容器 x=11 w=164 → 中心 x=93，而「专栏」tab 是 x=63 w=30 → 右边界 x=93），
// 点 1 像素边缘导致"时好时坏"。用精确类名选择器才能只命中三个 tab 元素。
const SEL_HEADER_TAB = ".header-tab"; // 顶部 tab 元素（精确类名，不含容器）
const SEL_COLUMN_TAB_TEXT = "专栏"; // 顶部 tab 文本
const SEL_COLUMN_CARD = ".column-card"; // 专栏卡片（可点击区域）
const SEL_COLUMN_NAME = ".column-card-name"; // 卡片里的专栏名
const SEL_DETAIL_TITLE = ".col-title"; // 详情页专栏标题，列表页没有此 class
// 返回按钮的选择器已内聚到 android.js 的 goBack() 里（它有一组候选 + 兜底），
// 用例侧不再自己维护，避免两处各写一份、改一处漏一处。

const EXPECTED_CARD_COUNT = 7; // 实测值；不一致只警告不失败（内容会更新）
const MARKER_LEARN_CENTER = "热门专栏"; // 学习中心-专栏页独有标题

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

// ---------- 工具函数 ----------

/** 纯等待。不依赖 page 对象：page 被销毁后 page.waitForTimeout 会抛错 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析当前真正的前台页。
 *
 * 框架的 resolveForegroundPage 会处理"page 已销毁"和"page 已降级为后台页"
 * 两种情况（后者是静默的，也是最坑的），解析失败时退回传入的 page，
 * 避免整条用例崩在一个基础设施问题上。
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Page>}
 */
async function foreground(page) {
  try {
    return await resolveForegroundPage(page);
  } catch (e) {
    console.log(`  [提示] 解析前台页失败，沿用当前 page: ${e.message.split("\n")[0]}`);
    return page;
  }
}

/** 取指定 page 的可见文本（失败返回空串，不抛错） */
async function pageText(p) {
  try {
    if (!p || p.isClosed()) return "";
    return await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
  } catch (e) {
    return "";
  }
}

// ---------- 页面判据（全部作用在"传入的那个 page 对象"上）----------
// 注意：这些函数刻意只接受一个明确的 page 参数，不自己去挑页面。
// 挑页面的动作统一放在调用方（每轮只挑一次），保证同一个判据里的
// 所有检查看的是同一个页面。

/** 指定 page 上是否处于详情页（详情页有 .col-title，列表页没有） */
async function pageIsDetail(p) {
  try {
    if (!p || p.isClosed()) return false;
    return (await p.locator(SEL_DETAIL_TITLE).count()) > 0;
  } catch (e) {
    return false;
  }
}

/** 指定 page 上是否处于专栏列表页（有卡片 且 有「热门专栏」标题） */
async function pageIsColumnList(p) {
  try {
    if (!p || p.isClosed()) return false;
    if ((await p.locator(SEL_COLUMN_CARD).count()) === 0) return false;
    return (await pageText(p)).includes(MARKER_LEARN_CENTER);
  } catch (e) {
    return false;
  }
}

/** 指定 page 上是否有底部 tab 栏 */
async function pageHasBottomTabBar(p) {
  try {
    if (!p || p.isClosed()) return false;
    return (await p.getByText(SEL_LEARN_TAB_TEXT).count()) > 0;
  } catch (e) {
    return false;
  }
}

/** 真实 tap 一个 Locator，失败信息写清楚 */
async function tapLocator(page, locator, what) {
  const count = await locator.count();
  if (count === 0) {
    throw new Error(`找不到${what}，选择器匹配到 0 个元素`);
  }
  await locator.first().waitFor({ state: "attached", timeout: 10000 });
  const device = await getDevice();
  await tapElement(device, page, locator.first());
  console.log(`  已点击${what}（匹配 ${count} 个，取第 1 个）`);
}

// ---------- 步骤 1：确保到达专栏列表页 ----------

/**
 * 框架不负责导航到起始页，而小程序可能停在多种状态：
 *   A. 已在专栏列表页        -> 什么都不做
 *   B. 在专栏详情页          -> 点顶部返回按钮（实测详情页没有底部 tab 栏）
 *   C. 在有底部 tab 的页面    -> 点底栏「学习中心」
 *
 * 【关键】每轮循环开头都重新解析前台页。点击底部 tab 后旧 page 会降级为
 * 后台页（内容冻结），只有重新取页面才能看到切换后的真实内容。
 */
async function stepEnsureColumnList(page) {
  console.log("\n[步骤 1] 确保处于学习中心-专栏列表页");

  for (let attempt = 1; attempt <= 4; attempt++) {
    page = await foreground(page);

    if (await pageIsColumnList(page)) {
      console.log(`  已在专栏列表页（第 ${attempt} 次检查通过）`);
      return page;
    }

    const onDetail = await pageIsDetail(page);
    const hasTab = await pageHasBottomTabBar(page);
    const t = await pageText(page);
    console.log(
      `  [尝试 ${attempt}] 在详情页=${onDetail} 有底部tab栏=${hasTab} 页面前 60 字=${JSON.stringify(t.slice(0, 60))}`
    );

    if (onDetail) {
      // 用框架的 goBack：它内部真实点击返回按钮（而不是浏览器历史后退），
      // 并且会校验"页面确实变了"才算成功。
      page = await goBack(page);
      await sleep(1500);
      continue;
    }

    if (hasTab) {
      await tapLocator(page, page.getByText(SEL_LEARN_TAB_TEXT).first(), `底部 tab「${SEL_LEARN_TAB_TEXT}」`);
      await sleep(4000);
      continue;
    }

    throw new Error(
      `无法到达专栏列表页：当前既不在详情页、也找不到底部 tab「${SEL_LEARN_TAB_TEXT}」。` +
        `请手动把小程序切到有底部 tab 栏的页面。当前页面前 200 字:\n  ${t.slice(0, 200)}`
    );
  }

  page = await foreground(page);
  if (!(await pageIsColumnList(page))) {
    throw new Error(
      `尝试 4 次后仍未到达专栏列表页。当前页面前 200 字:\n  ${(await pageText(page)).slice(0, 200)}`
    );
  }
  return page;
}

// ---------- 步骤 2：点击顶部 tab「专栏」 ----------

async function stepClickColumnTab(page) {
  console.log("\n[步骤 2] 点击顶部 tab「专栏」");
  page = await foreground(page);

  const tab = page.locator(SEL_HEADER_TAB, { hasText: SEL_COLUMN_TAB_TEXT });
  const total = await page.locator(SEL_HEADER_TAB).count();
  const count = await tab.count();
  console.log(`  页面上共 ${total} 个 header-tab，其中匹配「${SEL_COLUMN_TAB_TEXT}」的 ${count} 个`);

  if (count === 0) {
    throw new Error(
      `找不到顶部「${SEL_COLUMN_TAB_TEXT}」tab（选择器 ${SEL_HEADER_TAB}）。` +
        `当前页面前 200 字:\n  ${(await pageText(page)).slice(0, 200)}`
    );
  }

  const cls = await tab.first().evaluate((el) => String(el.className || ""));
  const isActive = cls.split(/\s+/).includes("active");
  console.log(`  该 tab 当前 class=${cls}`);
  console.log(`  状态: ${isActive ? "已选中（点击为幂等操作）" : "未选中，将切换"}`);

  await tapLocator(page, tab, `顶部 tab「${SEL_COLUMN_TAB_TEXT}」`);
  await sleep(3000);
  return page;
}

// ---------- 步骤 3：点击第一张专栏卡片 ----------

async function stepClickFirstColumn(page) {
  console.log("\n[步骤 3] 点击第一张专栏卡片");
  page = await foreground(page);

  const cardCount = await page.locator(SEL_COLUMN_CARD).count();
  const names = await page.locator(SEL_COLUMN_NAME).allInnerTexts();
  console.log(`  当前共 ${cardCount} 张卡片，名称: ${JSON.stringify(names.slice(0, 3))}${names.length > 3 ? " ..." : ""}`);

  if (cardCount === 0) {
    throw new Error(`没有找到任何专栏卡片（${SEL_COLUMN_CARD}），「${SEL_COLUMN_TAB_TEXT}」页可能未加载完成`);
  }
  if (cardCount !== EXPECTED_CARD_COUNT) {
    console.warn(`  警告: 卡片数 ${cardCount} 与实测值 ${EXPECTED_CARD_COUNT} 不同（内容可能已更新）`);
  }

  const firstName = names.length ? names[0] : "";
  console.log(`  第一张卡片名称: ${JSON.stringify(firstName)}`);
  // 挂到函数属性上，供步骤 4 使用（简单示例；正式项目建议用模块级变量）
  stepClickFirstColumn.firstName = firstName;

  await tapLocator(page, page.locator(SEL_COLUMN_CARD), "第一张专栏卡片");
  await sleep(5000);
  return page;
}

// ---------- 步骤 4：验证已进入专栏详情页 ----------

/** 打印各页面的身份，用于排查"拿到的 page 对不对" */
async function dumpPageIdentities(page, label) {
  let ctx = null;
  try {
    if (page && !page.isClosed()) ctx = page.context();
  } catch (e) {
    // 已销毁的 page 取不到 context
  }
  if (!ctx) {
    console.log(`  [${label}] 拿不到 context 引用`);
    return;
  }

  const pages = ctx.pages();
  console.log(`  [${label}] context 中共 ${pages.length} 个页面:`);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.isClosed()) {
      console.log(`    [${i}] (已关闭)`);
      continue;
    }
    try {
      const raf = await p.evaluate(
        () =>
          new Promise((res) => {
            let d = false;
            requestAnimationFrame(() => {
              d = true;
              res(true);
            });
            setTimeout(() => {
              if (!d) res(false);
            }, 500);
          })
      );
      const cnt = await p.locator("*").count().catch(() => -1);
      const cards = await p.locator(SEL_COLUMN_CARD).count().catch(() => -1);
      const titles = await p.locator(SEL_DETAIL_TITLE).count().catch(() => -1);
      const txt = (await pageText(p)).slice(0, 45);
      console.log(
        `    [${i}] RAF=${String(raf).padEnd(5)} 元素=${String(cnt).padStart(4)} 卡片=${cards} 详情标题=${titles} ${JSON.stringify(txt)}`
      );
    } catch (e) {
      console.log(`    [${i}] 读取失败: ${e.message.split("\n")[0].slice(0, 40)}`);
    }
  }
}

async function stepVerifyDetail(page) {
  console.log("\n[步骤 4] 验证已进入专栏详情页");
  await dumpPageIdentities(page, "步骤4 开始时");

  // 【关键】每轮都先解析出唯一的前台页，再在同一个对象上做全部判据。
  // 之前正是这里出错：.column-card 数量查传入 page、页面文本查前台页，
  // 两个检查看两个页面，结论自相矛盾，导致"实际已成功"被判定为失败。
  let fg = null;
  let onDetail = false;
  let stillOnList = true;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    fg = await foreground(page);
    onDetail = await pageIsDetail(fg);
    stillOnList = await pageIsColumnList(fg);
    if (onDetail) break;
    await sleep(600);
  }

  fg = await foreground(page);
  const text = await pageText(fg);
  let elCount = "读取失败";
  try {
    elCount = await fg.locator("*").count();
  } catch (e) {
    // 页面可能在验证过程中被销毁，忽略
  }
  console.log(`  前台页元素数: ${elCount}`);
  console.log(`  前台页面前 200 字: ${JSON.stringify(text.slice(0, 200))}`);
  console.log(`  详情页标记「${SEL_DETAIL_TITLE}」存在: ${onDetail}（应为 true）`);
  console.log(`  列表页标记「${MARKER_LEARN_CENTER}」仍存在: ${stillOnList}（应为 false）`);

  await dumpPageIdentities(fg, "步骤4 结束时");

  if (!onDetail || stillOnList) {
    throw new Error(
      `点击第一张专栏卡片后未进入详情页。\n` +
        `  期望: 前台页出现 ${SEL_DETAIL_TITLE} 且不再有「${MARKER_LEARN_CENTER}」\n` +
        `  实际: 详情页标记=${onDetail}, 列表页标记=${stillOnList}\n` +
        `  前台页面前 200 字: ${text.slice(0, 200)}`
    );
  }

  const firstName = stepClickFirstColumn.firstName;
  if (firstName) {
    console.log(`  第一张卡片名称「${firstName}」是否出现在详情页: ${text.includes(firstName)}`);
  }
  console.log("  [OK] 已进入专栏详情页");
  return fg;
}

// ---------- 用例主流程 ----------
(async () => {
  const funcList = [
    // 步骤 0：记录初始状态（便于失败时判断起点是什么）
    [
      async function stepRecordInitial(page) {
        let pageCount = "未知";
        try {
          pageCount = page.context().pages().length;
        } catch (e) {
          // 取不到就算了，不影响主流程
        }
        console.log(`已连接，context 中当前有 ${pageCount} 个页面`);
        const t = await pageText(page);
        console.log(`初始页面前 150 字: ${JSON.stringify(t.slice(0, 150))}`);
        console.log(`初始页面上专栏卡片数: ${await page.locator(SEL_COLUMN_CARD).count()}`);
        console.log(`初始页面上详情页标题数: ${await page.locator(SEL_DETAIL_TITLE).count()}`);
        return page;
      },
      null,
    ],

    // 步骤 1：确保到达专栏列表页
    [stepEnsureColumnList, null],

    // 步骤 2：点击「专栏」
    [stepClickColumnTab, null],

    // 验证「专栏」内容已显示 —— 改用断言层声明式表达期望。
    // 原先的写法是自己 count 一遍再手拼错误信息，这正是断言层要取代的东西。
    [assertTextVisible, { text: MARKER_LEARN_CENTER }],
    [assertSelectorExists, { selector: SEL_COLUMN_CARD }],

    // 步骤 3：点击第一张卡片
    [stepClickFirstColumn, null],

    // 步骤 4：验证已进入详情页（这一步自带更详细的诊断输出）
    [stepVerifyDetail, null],

    // 再用断言层独立表达一次"确实进了详情页"：
    // 详情页有且只有一个 .col-title，而列表页独有的「热门专栏」应当消失
    [assertSelectorCount, { selector: SEL_DETAIL_TITLE, expected: 1 }],
    [assertTextNotVisible, { text: MARKER_LEARN_CENTER }],

    // 附加：打印详情页结构，便于后续写更多断言
    [dumpElements, { tag: ["wx-view", "wx-text"] }],
  ];

  await appTest(funcList, { photosPath });

  console.log("\n" + "=".repeat(60));
  console.log("test_learn_center_column.js 执行完成（全部步骤通过）");
  console.log("=".repeat(60));
})().catch((e) => {
  // 注意：错误信息里不使用 emoji 等特殊字符，避免 Windows GBK 控制台编码失败
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
