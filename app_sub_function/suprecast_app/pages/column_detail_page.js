/*
 * 页面对象：专栏详情页
 *
 * 实测结构（2026/10/10，report/diagnostic/）：
 *   <wx-view class="custom-navbar">
 *     <wx-text class="h5-i iconfont icon-base-nav-return ...">      <- 返回按钮 17x17
 *     <span>互动专栏</span>
 *     <wx-view class="col-subscribe-btn col-subscribe-btn--subscribed">已订阅</wx-view>
 *   </wx-view>
 *   <wx-text class="col-title"><span>N1-预热期专栏</span></wx-text>  <- 列表页没有此 class
 *
 * 元素数约 118，且**没有底部 tab 栏** —— 这两点都可以用来判断"是否已经离开列表页"。
 */

const base = require("./base_page");
const { goBack } = require("../android");

const SEL = {
  title: ".col-title",
  navbar: ".custom-navbar",
  backButton: '[class*="nav-return"]',
  subscribeBtn: ".col-subscribe-btn",
  subscribeMainBtn: ".col-subscribe-main-btn",
  interactionTime: ".col-interaction-time",
};

/** 现在是不是专栏详情页（判据：出现列表页没有的 .col-title） */
async function isOn(page) {
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.title)) > 0;
}

/** 详情页标题文本（不在详情页时返回空串） */
async function title(page) {
  const fg = await base.foreground(page);
  return base.textOf(fg, SEL.title);
}

/**
 * 点顶部返回按钮回到上一页。
 * 内部用框架的 goBack：真实点击返回按钮（不是浏览器后退），并校验页面确实发生变化。
 */
async function back(page, options = {}) {
  return goBack(page, options);
}

/**
 * 订阅状态。
 * 实测 DOM 用 class 后缀表达状态：`col-subscribe-btn--subscribed` 表示已订阅。
 * 拿不到按钮时返回 "unknown"，由调用方决定怎么处理（不要把未知当已知）。
 * @returns {Promise<"subscribed"|"not-subscribed"|"unknown">}
 */
async function subscribeState(page) {
  const fg = await base.foreground(page);
  const cls = await base.classOf(fg, SEL.subscribeBtn);
  if (!cls) return "unknown";
  return /(^|\s|-)subscribed(\s|$)/.test(cls) ? "subscribed" : "not-subscribed";
}

module.exports = { SEL, isOn, title, back, subscribeState };
