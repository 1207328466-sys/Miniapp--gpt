/*
 * 页面对象：用户中心（底部 tab「我的」）
 *
 * 实测判据：可见文本里出现「积分商城」或「登录/注册」。
 * 这两个文本在「压铸百科」等其它页面的可见文本中出现 0 次（实测），可作可靠依据。
 *
 * 用 document.body.innerText 检索：它只返回**可见文本**，自动排除隐藏元素与
 * <style>/<script> 里的同名字符串（用 page.content() 会误判 —— 踩坑记录 坑 12）。
 *
 * 本模块是 android.js 里 switchToUserCenter 的**迁移目标**：
 * 页面知识（判据文案、幂等、重试）属于页面对象，不该留在关键字层。
 * android.js 保留同名导出做兼容，内部转调这里。
 */

const base = require("./base_page");

const BOTTOM_TAB_TEXT = "我的";
const MARKERS = ["积分商城", "登录/注册"];

/** 现在是不是用户中心 */
async function isOn(page) {
  // 注意：问的是"**屏幕上显示的是不是**用户中心"，必须看前台页 ——
  // 用"候选页里有没有用户中心"会把被盖住的旧页当成已到达（真机踩过：0.55 秒假成功）。
  const fg = await base.foreground(page);
  const t = await base.pageText(fg);
  return MARKERS.some((m) => t.includes(m));
}

/**
 * 找「用户中心」那一页：**前台优先，找不到就跨页找**。
 * 不依赖"猜哪个页在前台"（坑 19）——想知道的是"哪一页是用户中心"。
 */
async function findUserCenterPage(page) {
  const fg = await base.foreground(page);
  const t = await base.pageText(fg);
  if (MARKERS.some((m) => t.includes(m))) return fg;
  for (const m of MARKERS) {
    const hit = await base.findPageContaining(page, { text: m });
    if (hit) return hit;
  }
  return null;
}

/**
 * 切到用户中心；已经在则直接返回（幂等）。
 * @param {import('playwright').Page} page
 * @param {{timeout?: number, retries?: number, waitBeforeTap?: number}} [options]
 *        timeout: 单次等待超时（毫秒）；retries: 失败重试次数；waitBeforeTap: 点击前先等多久
 * @returns {Promise<import('playwright').Page>} 切换后的前台页
 */
async function switchTo(page, { timeout = 10000, retries = 1, waitBeforeTap = 1500 } = {}) {
  try {
    // 幂等：已经在用户中心就直接返回，不再点击
    if (await isOn(page)) {
      console.log("已在用户中心，无需切换");
      return await base.foreground(page);
    }

    // 【先退到一级页面】真机回归时踩到：上一条用例停在「专栏详情页」这类二级页上时，
    // 那个页面**没有底部 tab 栏**，直接找「我的」必然失败（报「找不到底部 tab「我的」」）。
    // 一次全量跑里 test_login_and_navigation / test_switch_to_user_center 两条都栽在这上面 ——
    // 它们单独跑是过的，只有"上一条用例留了个二级页"时才挂，属于典型的顺序依赖。
    page = await base.ensureOnTabPage(page);

    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      try {
        await base.sleep(waitBeforeTap);
        const fg = await base.foreground(page);

        // 【2026/10/16 加固】以前这里"按文字点「我的」"+ 取第 1 个顶着：首页上「我的」
        // （底部 tab）和「我的关注」（筛选栏）会同时命中 2 个（账本根因 3 那次 strict mode
        // 报错就是这个撞名），取第 1 个等于赌 DOM 顺序。现在用 tapBottomTab：
        // 先圈进 custom-tab-bar（实测栏里只命中 1 个），栏不在时才退回整页按文字找。
        // 另外必须用真实 adb tap：合成 .click() 在小程序上会因页面持续重绘
        // 导致 stable 检查永不满足，超时或误报失败（根因 6）。
        await base.tapBottomTab(fg, BOTTOM_TAB_TEXT);

        // 【关键】点击后必须重新解析前台页再验证：切 tab 会新建 page，
        // 旧 page 内容冻结，在它上面等「积分商城」永远等不到（账本 根因 4）。
        const ok = await base.waitUntil(async () => isOn(page), { timeout });
        if (!ok) throw new Error(`等待用户中心内容超时（${timeout}ms）`);

        console.log("已切换到用户中心");
        return (await findUserCenterPage(page)) || (await base.foreground(page));
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          console.warn(`切换到用户中心第 ${i + 1} 次失败，重试中: ${e.message.split("\n")[0]}`);
          await base.sleep(2000);
        }
      }
    }
    throw lastErr;
  } catch (e) {
    console.error(`切换到用户中心失败: ${e.message}`);
    throw e;
  }
}

module.exports = { BOTTOM_TAB_TEXT, MARKERS, isOn, findUserCenterPage, switchTo };
