/*
 * @project_name: UITest
 * @cur_file: test_login_and_navigation.js
 * @create_date: 2026/10/9
 *
 * 用例：进入用户中心并查看页面结构
 *
 * 前置条件（框架不会代劳，必须手动准备）：
 *   1. 手机已通过 USB 连接，adb devices 显示 device 状态
 *   2. 微信已登录，目标小程序已打开并停留在前台
 *   3. 小程序当前处于首页（底部有「我的」tab 的那个页面）
 *
 * 本用例验证的能力：
 *   - 框架能否连上设备并抓到小程序 WebView
 *   - 能否成功点击「我的」切换到用户中心
 *   - 打印用户中心页面的 HTML 结构，供后续用例确定选择器
 *
 * [!] 重要说明（当前框架的能力缺口）：
 *   本用例没有真正的断言。它只能证明"流程没报错"，
 *   不能证明"用户中心真的显示正确"。
 *   验证方式是人工查看 report/photo_app/ 下的截图和控制台输出。
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  switchToUserCenter,
  dumpElements,
} = require("../../app_sub_function/suprecast_app/android");

(async () => {
  // 截图保存目录：项目根目录/report/photo_app
  const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

  // 步骤清单：每一项是 [函数引用, 参数字典 或 null]
  // - 传函数引用而不是函数名字符串，因为框架靠 func.name 打日志、命名截图
  // - 参数字典为 null 时，框架会以 func(page) 调用；有值时以 func(page, kwargs) 调用
  const funcList = [
    // 步骤1：点击「我的」切换到用户中心
    [switchToUserCenter, null],

    // 步骤2：打印用户中心页面的 HTML 结构（调试用，不改变页面）
    // 目的：看清这个页面有哪些元素和 class，为后续写带断言的用例确定选择器
    [dumpElements, null],
  ];

  await appTest(funcList, { photosPath });
  console.log("test_login_and_navigation.js 执行完成");
})().catch((e) => {
  // 必须保留这个错误出口：让 node 以非 0 退出码结束，
  // 否则 pytest 无法感知失败，会把失败的用例当成通过
  console.error(e);
  process.exit(1);
});
