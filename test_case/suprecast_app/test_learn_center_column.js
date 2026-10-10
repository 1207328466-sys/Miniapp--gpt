/*
 * @project_name: UITest
 * @cur_file: test_learn_center_column.js
 * @create_date: 2026/10/10
 *
 * 用例：学习中心 -> 专栏 -> 点击第一个专栏
 *
 * 流程：
 *   1. 确保处于学习中心-专栏列表页（自动处理三种起始状态）
 *   2. 点击顶部 tab「专栏」
 *   3. 点击第一张专栏卡片 .column-card
 *   4. 验证已进入专栏详情页
 *
 * 前置条件（框架不会代劳，必须手动准备）：
 *   - 微信已登录，目标小程序已打开并停留在前台
 *   - 起始页可以是：首页 / 学习中心 / 专栏详情页（步骤 1 会自动导航）
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
 * [!] 两个已踩过的坑，勿重犯：
 *   1. 控制台输出不要用 emoji：pytest 往 Windows GBK 控制台打印时会抛
 *      UnicodeEncodeError，把真正的失败原因掩盖掉。
 *   2. 小程序某些导航会**销毁旧 page 对象**（如从详情页点返回），
 *      继续用旧引用会报 "Target page, context or browser has been closed"。
 *      因此每次导航后都要重新获取可用页面（见 reacquireForegroundPage）。
 */

const path = require("path");
const { appTest, pickForegroundPage } = require("../../common/app_common");
const {
  getDevice,
  tapElement,
  dumpElements,
} = require("../../app_sub_function/suprecast_app/android");

// ---------- 选择器与期望值（集中定义，小程序改版时改这里）----------
const SEL_LEARN_TAB_TEXT = "学习中心"; // 底部 tab（按文本定位）
const SEL_HEADER_TAB = '[class*="header-tab"]'; // 顶部 tab 容器
const SEL_COLUMN_TAB_TEXT = "专栏"; // 顶部 tab 文本
const SEL_COLUMN_CARD = ".column-card"; // 专栏卡片（可点击区域）
const SEL_COLUMN_NAME = ".column-card-name"; // 卡片里的专栏名
const SEL_DETAIL_TITLE = ".col-title"; // 详情页专栏标题，列表页没有此 class
const SEL_BACK_BUTTON = '[class*="nav-return"]'; // 详情页顶部返回按钮

const EXPECTED_CARD_COUNT = 7; // 实测值；不一致只警告不失败（内容会更新）
const MARKER_LEARN_CENTER = "热门专栏"; // 学习中心-专栏页独有标题

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

// ---------- 工具函数 ----------

/**
 * 浏览器上下文引用。
 *
 * 为什么要在导航前就存下来：实测 page 被关闭后，对已关闭的 page 调用
 * page.context() 会失败，导致拿不到兄弟页面、无法恢复。
 * 而 context 对象在页面切换后依然有效，context.pages() 会返回更新后的页面列表。
 * 因此必须在导航发生前保存 context 引用。
 */
let appContext = null;

/**
 * 重新获取一个可用的前台页对象。
 *
 * 为什么需要它：实测小程序某些导航（如从专栏详情页点返回）会销毁旧的 page 对象，
 * 此时继续用旧引用会报 "Target page, context or browser has been closed"。
 * 这比"page 变后台页"更严重 —— 后台页只是内容冻结，关闭的 page 完全不可用。
 *
 * @param {import('playwright').Page|null} page 可能已失效的 page 引用
 * @returns {Promise<import('playwright').Page>} 可用的前台页
 */
async function reacquireForegroundPage(page) {
  // 判断 page 引用是否仍然"在册"。
  // 注意不能只看 isClosed()：实测小程序导航后，旧 page 可能仍返回
  // isClosed() === false，但它已不在 context.pages() 里，是个"孤儿"引用，
  // 内容冻结在切换前，继续用会导致选错页面（本次踩坑的真实原因）。
  const isLive = () => {
    if (!page || page.isClosed()) return false;
    if (!appContext) return true; // context 还没记录，暂时信任
    return appContext.pages().includes(page);
  };

  if (isLive()) return page;

  console.log("  [提示] 原 page 已失效（已关闭或成为孤儿引用），正在从 context 重新获取...");

  let ctx = appContext;
  if (!ctx && page && !page.isClosed()) {
    ctx = page.context();
    appContext = ctx;
  }
  if (!ctx) {
    throw new Error("原 page 已失效，且没有可用的 context 引用（导航前未保存）。无法重新获取页面。");
  }

  const owners = ctx.pages();
  console.log(`  context 中共 ${owners.length} 个页面`);
  let best = null;
  let bestCount = -1;
  for (const p of owners) {
    if (p.isClosed()) continue;
    try {
      const alive = await p.evaluate(
        () =>
          new Promise((res) => {
            let done = false;
            requestAnimationFrame(() => {
              done = true;
              res(true);
            });
            setTimeout(() => {
              if (!done) res(false);
            }, 600);
          })
      );
      if (!alive) continue;
      const cnt = await p.locator("*").count().catch(() => 0);
      if (cnt > bestCount) {
        best = p;
        bestCount = cnt;
      }
    } catch (e) {
      // 该页面不可用，跳过
    }
  }

  if (!best) {
    throw new Error(`原 page 已失效，在 ${owners.length} 个页面中没找到可用的前台页`);
  }
  console.log(`  已重新获取前台页，元素数=${bestCount}`);
  return best;
}

/** 取当前前台页的可见文本（page 失效时返回空串，不抛错） */
async function visibleText(page) {
  try {
    if (page.isClosed()) return "";
    const fg = await pickForegroundPage(page);
    return fg.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
  } catch (e) {
    return "";
  }
}

/** 当前是否已处于学习中心的专栏列表页 */
async function isOnColumnList(page) {
  try {
    if (page.isClosed()) return false;
    if ((await page.locator(SEL_COLUMN_CARD).count()) === 0) return false;
    return (await visibleText(page)).includes(MARKER_LEARN_CENTER);
  } catch (e) {
    return false;
  }
}

/** 当前是否处于专栏详情页（详情页有 .col-title，列表页没有） */
async function isOnDetail(page) {
  try {
    if (page.isClosed()) return false;
    return (await page.locator(SEL_DETAIL_TITLE).count()) > 0;
  } catch (e) {
    return false;
  }
}

/** 当前是否有底部 tab 栏 */
async function hasBottomTabBar(page) {
  try {
    if (page.isClosed()) return false;
    return (await page.getByText(SEL_LEARN_TAB_TEXT).count()) > 0;
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

/** 导航后等待；旧 page 可能被销毁，此时不抛错，交给 reacquire 处理 */
async function waitAfterNavigation(page, ms) {
  try {
    await page.waitForTimeout(ms);
  } catch (e) {
    console.log(`    旧 page 已失效（${e.message.split("\n")[0]}），将重新获取`);
  }
}

// ---------- 步骤 1：确保到达专栏列表页 ----------

/**
 * 框架不负责导航到起始页，而小程序可能停在三种状态：
 *   A. 已在专栏列表页      -> 什么都不做
 *   B. 在专栏详情页        -> 点顶部返回按钮（实测详情页没有底部 tab 栏）
 *   C. 在有底部 tab 的页面  -> 点底栏「学习中心」
 */
async function stepEnsureColumnList(page) {
  console.log("\n[步骤 1] 确保处于学习中心-专栏列表页");

  for (let attempt = 1; attempt <= 4; attempt++) {
    page = await reacquireForegroundPage(page);

    if (await isOnColumnList(page)) {
      console.log(`  已在专栏列表页（第 ${attempt} 次检查通过）`);
      return page;
    }

    const onDetail = await isOnDetail(page);
    const hasTab = await hasBottomTabBar(page);
    const t = await visibleText(page);
    console.log(
      `  [尝试 ${attempt}] 在详情页=${onDetail} 有底部tab栏=${hasTab} 页面前 60 字=${JSON.stringify(t.slice(0, 60))}`
    );

    if (onDetail) {
      const backCount = await page.locator(SEL_BACK_BUTTON).count();
      console.log(`    找到 ${backCount} 个返回按钮（选择器 ${SEL_BACK_BUTTON}）`);
      if (backCount > 0) {
        await tapLocator(page, page.locator(SEL_BACK_BUTTON), "顶部返回按钮");
      } else {
        console.log("    未找到返回按钮，改用安卓系统返回键 input keyevent 4");
        const device = await getDevice();
        await device.shell("input keyevent 4");
      }
      await waitAfterNavigation(page, 3500);
      continue;
    }

    if (hasTab) {
      await tapLocator(page, page.getByText(SEL_LEARN_TAB_TEXT).first(), `底部 tab「${SEL_LEARN_TAB_TEXT}」`);
      await waitAfterNavigation(page, 4000);
      continue;
    }

    throw new Error(
      `无法到达专栏列表页：当前既不在详情页、也找不到底部 tab「${SEL_LEARN_TAB_TEXT}」。` +
        `请手动把小程序切到有底部 tab 栏的页面。当前页面前 200 字:\n  ${t.slice(0, 200)}`
    );
  }

  page = await reacquireForegroundPage(page);
  if (!(await isOnColumnList(page))) {
    throw new Error(
      `尝试 4 次后仍未到达专栏列表页。当前页面前 200 字:\n  ${(await visibleText(page)).slice(0, 200)}`
    );
  }
  return page;
}

// ---------- 步骤 2：点击顶部 tab「专栏」 ----------

async function stepClickColumnTab(page) {
  console.log("\n[步骤 2] 点击顶部 tab「专栏」");
  page = await reacquireForegroundPage(page);

  const tab = page.locator(SEL_HEADER_TAB, { hasText: SEL_COLUMN_TAB_TEXT });
  const total = await page.locator(SEL_HEADER_TAB).count();
  const count = await tab.count();
  console.log(`  页面上共 ${total} 个 header-tab，其中匹配「${SEL_COLUMN_TAB_TEXT}」的 ${count} 个`);

  if (count === 0) {
    throw new Error(
      `找不到顶部「${SEL_COLUMN_TAB_TEXT}」tab（选择器 ${SEL_HEADER_TAB}）。` +
        `当前页面前 200 字:\n  ${(await visibleText(page)).slice(0, 200)}`
    );
  }

  const cls = await tab.first().evaluate((el) => String(el.className || ""));
  const isActive = cls.split(/\s+/).includes("active");
  console.log(`  该 tab 当前 class=${cls}`);
  console.log(`  状态: ${isActive ? "已选中（点击为幂等操作）" : "未选中，将切换"}`);

  await tapLocator(page, tab, `顶部 tab「${SEL_COLUMN_TAB_TEXT}」`);
  await waitAfterNavigation(page, 3000);
  return page;
}

// ---------- 步骤 3：点击第一张专栏卡片 ----------

async function stepClickFirstColumn(page) {
  console.log("\n[步骤 3] 点击第一张专栏卡片");
  page = await reacquireForegroundPage(page);

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
  await waitAfterNavigation(page, 5000);
  return page;
}

// ---------- 步骤 4：验证已进入专栏详情页 ----------

/**
 * 取当前前台页，并顺带把 appContext 记下来。
 *
 * 关键：所有判据都必须作用在【同一个】页面上。
 * 之前的 bug 就是 visibleText 用了 pickForegroundPage（看到详情页），
 * 而 isOnDetail 用了传入的 page（可能是后台的列表页），
 * 导致同一个函数里两个判据各看一个页面、结论自相矛盾。
 */
async function getForeground(page) {
  if (!appContext) {
    try {
      if (page && !page.isClosed()) appContext = page.context();
    } catch (e) {}
  }
  return pickForegroundPage(page);
}

/** 判断某个 page 上是否处于详情页 */
async function pageIsDetail(p) {
  try {
    if (!p || p.isClosed()) return false;
    return (await p.locator(SEL_DETAIL_TITLE).count()) > 0;
  } catch (e) {
    return false;
  }
}

/** 判断某个 page 上是否处于专栏列表页 */
async function pageIsColumnList(p) {
  try {
    if (!p || p.isClosed()) return false;
    if ((await p.locator(SEL_COLUMN_CARD).count()) === 0) return false;
    const t = await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
    return t.includes(MARKER_LEARN_CENTER);
  } catch (e) {
    return false;
  }
}

/** 打印各页面的身份，用于排查"拿到的 page 对不对" */
async function dumpPageIdentities(label) {
  if (!appContext) {
    console.log(`  [${label}] 尚无 context 引用`);
    return;
  }
  const pages = appContext.pages();
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
      const txt = (await p.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 45);
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
  await dumpPageIdentities("步骤4 开始时");

  // 统一在"前台页"上做判断，并等详情页渲染完成
  let fg = null;
  let onDetail = false;
  let stillOnList = true;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    fg = await getForeground(page);
    onDetail = await pageIsDetail(fg);
    stillOnList = await pageIsColumnList(fg);
    if (onDetail) break;
    await fg.waitForTimeout(600).catch(() => {});
  }

  fg = await getForeground(page);
  const text = await fg.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim());
  console.log(`  前台页元素数: ${await fg.locator("*").count().catch(() => "err")}`);
  console.log(`  前台页面前 200 字: ${JSON.stringify(text.slice(0, 200))}`);
  console.log(`  详情页标记「${SEL_DETAIL_TITLE}」存在: ${onDetail}（应为 true）`);
  console.log(`  列表页标记「${MARKER_LEARN_CENTER}」仍存在: ${stillOnList}（应为 false）`);

  await dumpPageIdentities("步骤4 结束时");

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
    // 步骤 0：记录初始状态，并保存 context 引用
    [
      async function stepRecordInitial(page) {
        // 关键：在导航发生前保存 context。
        // 导航可能销毁 page 对象，届时对已关闭的 page 调 page.context() 会失败。
        appContext = page.context();
        console.log(`已保存 context 引用，当前 context 中有 ${appContext.pages().length} 个页面`);

        const t = await visibleText(page);
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
    [
      async function verifyColumnTab(page) {
        console.log("\n[验证] 确认「专栏」内容已显示");
        page = await reacquireForegroundPage(page);
        const n = await page.locator(SEL_COLUMN_CARD).count();
        if (n === 0) {
          throw new Error(`点击「${SEL_COLUMN_TAB_TEXT}」后没有找到任何 ${SEL_COLUMN_CARD} 卡片`);
        }
        console.log(`  [OK] 找到 ${n} 张专栏卡片`);
        return page;
      },
      null,
    ],

    // 步骤 3：点击第一张卡片
    [stepClickFirstColumn, null],

    // 步骤 4：验证已进入详情页
    [stepVerifyDetail, null],

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
