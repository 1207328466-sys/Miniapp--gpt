/*
 * @project_name: UITest
 * @cur_file: test_switch_to_user_center.js
 * @create_date: 2026/10/10
 *
 * 用例：切换到用户中心，并验证切换真的成功
 *
 * 前置条件（框架不会代劳，必须手动准备）：
 *   1. 手机已连接，adb devices 显示 device 状态
 *   2. 微信已登录，目标小程序已打开并停留在前台
 *   3. 小程序处于首页（底部有 tab 栏的页面）
 *
 * 本用例与 test_login_and_navigation.js 的区别：
 *   那条用例只有"操作"，没有"验证"，所以功能坏了它也会报成功（假通过）。
 *   这条用例每一步操作后都有明确的验证，功能坏了会真正失败。
 *
 * 验证机制说明：
 *   switchToUserCenter 内部会等「积分商城」或「登录/注册」这两个可见文本出现。
 *   这两个文本在「压铸百科」等其它页面的 DOM 中出现 0 次（实测数据），
 *   因此可以可靠区分"切换成功"和"没切换过去"。
 *   等不到就抛错 -> pytest 报 FAILED，而不是假通过。
 *
 * 输出：
 *   - report/photo_app/ 下每个步骤一张截图
 *   - 控制台打印用户中心的页面结构（调试用）
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  switchToUserCenter,
  dumpElements,
} = require("../../app_sub_function/suprecast_app/android");

(async () => {
  const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

  const funcList = [
    // 步骤1：切换到用户中心
    // 内部包含验证：等「积分商城」或「登录/注册」出现，等不到会抛错
    [switchToUserCenter, null],

    // 步骤2：打印用户中心的页面结构
    // 用途：确认这个页面到底加载了什么内容，也为后续用例提供选择器参考
    [dumpElements, null],
  ];

  await appTest(funcList, {
    photosPath,
    meta: { feature: "用户中心", story: "导航", title: "切到用户中心并能看到积分商城" },
  });
  console.log("test_switch_to_user_center.js 执行完成");
})().catch((e) => {
  // 必须保留：让 node 以非 0 退出码结束，pytest 才能感知失败
  console.error(e);
  process.exit(1);
});
