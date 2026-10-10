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
  const fg = await base.foreground(page);
  const t = await base.pageText(fg);
  return MARKERS.some((m) => t.includes(m));
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

    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      try {
        await base.sleep(waitBeforeTap);
        const fg = await base.foreground(page);

        // 必须 .first()：首页上同时存在「我的」和「我的关注」，
        // 不加会在 strict mode 下抛 "resolved to 2 elements"（账本 根因 3）。
        // 另外要用真实 adb tap：合成 .click() 在小程序上会因页面持续重绘
        // 导致 stable 检查永不满足，超时或误报失败（根因 6）。
        await base.tapText(fg, BOTTOM_TAB_TEXT, "底部 tab「我的」");

        // 【关键】点击后必须重新解析前台页再验证：切 tab 会新建 page，
        // 旧 page 内容冻结，在它上面等「积分商城」永远等不到（账本 根因 4）。
        const ok = await base.waitUntil(async () => isOn(page), { timeout });
        if (!ok) throw new Error(`等待用户中心内容超时（${timeout}ms）`);

        console.log("已切换到用户中心");
        return await base.foreground(page);
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

module.exports = { BOTTOM_TAB_TEXT, MARKERS, isOn, switchTo };
