/*
 * @project_name: UITest
 * @cur_file: test_learn_center_column.js
 * @create_date: 2026/10/10
 *
 * 用例：学习中心 -> 专栏 -> 点击第一个专栏 -> 验证已进入详情页
 *
 * 【本用例是"页面对象（Page Object）"的示范】
 * 页面知识（选择器、页面标记、幂等导航）全部收在
 * `app_sub_function/suprecast_app/pages/` 下：
 *   pages/learn_center_page.js    学习中心（含「专栏」列表）
 *   pages/column_detail_page.js   专栏详情页
 * 所以这个文件里**没有任何选择器字面量** —— 小程序改版时只改页面对象，
 * 不用满仓库找"这个 class 谁还在用"。
 *
 * 层次关系：用例层（本文件）-> 页面对象 -> 关键字层（android.js）-> 驱动层（app_common.js）
 *
 * 前置条件（框架不会代劳，必须手动准备）：
 *   - 微信已登录，目标小程序已打开并处于前台
 *   - 起始页可以是：首页 / 学习中心 / 专栏列表页 / 专栏详情页 / 用户中心
 *     （步骤 1 会自动导航过去）
 *
 * [!] 已踩过的四个坑，勿重犯：
 *   1. 控制台输出不要用 emoji：pytest 往 Windows GBK 控制台打印时会抛
 *      UnicodeEncodeError，把真正的失败原因掩盖掉。
 *   2. 小程序导航可能**销毁**旧 page 对象，继续用旧引用会报
 *      "Target page, context or browser has been closed"。
 *   3. 更常见的是导航后旧 page **降级为后台页**：活着、仍在 context.pages() 里，
 *      但内容冻结。只检查"还活着吗"就会一直拿着冻结页做判据，表现为
 *      「界面明明已经切到目标页、判据却说没切过去」，然后反复点击到超时。
 *      第 2、3 条现在都由框架统一处理（resolveForegroundPage + 每步重新解析）。
 *   4. 同一个判据里的所有检查必须作用在**同一个 page 对象**上，
 *      否则"两个判据看两个页面、结论自相矛盾"。
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  dumpElements,
  assertTextVisible,
  assertTextNotVisible,
  assertSelectorExists,
  assertSelectorCount,
} = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const learnCenter = pages.learnCenter;
const columnDetail = pages.columnDetail;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");

// ---------- 用例主流程 ----------
(async () => {
  const funcList = [
    // 步骤 1：确保到达「学习中心 - 专栏列表页」
    // 幂等：已在则直接返回；在详情页则点返回；在其它 tab 则切 tab。
    [learnCenter.ensureOnColumnList, null],

    // 步骤 2：切到顶部「专栏」tab（已是选中态时为空操作）
    [learnCenter.switchToColumnTab, null],

    // 断言：「专栏」内容确实显示出来了
    [assertTextVisible, { text: learnCenter.MARKER_COLUMN_LIST }],
    // 卡片数会随运营内容变化，所以只断言"至少一张"，不断言精确数量
    // —— 写死数量会在别人新增一张专栏时变成假失败。
    [assertSelectorExists, { selector: learnCenter.SEL.columnCard }],

    // 步骤 3：点第一张专栏卡片进详情页（内部会确认真的进去了）
    [learnCenter.openFirstColumn, null],

    // 断言：确实在详情页 —— 详情页有且只有一个 .col-title，
    // 而列表页独有的「热门专栏」应当消失
    [assertSelectorCount, { selector: columnDetail.SEL.title, expected: 1 }],
    [assertTextNotVisible, { text: learnCenter.MARKER_COLUMN_LIST }],

    // 附加：打印详情页结构，便于后续写更多断言
    [dumpElements, { tag: ["wx-view", "wx-text"] }],
  ];

  await appTest(funcList, { photosPath });

  console.log("\n" + "=".repeat(60));
  console.log("test_learn_center_column.js 执行完成（全部步骤通过）");
  console.log("=".repeat(60));
})().catch((e) => {
  // 必须保留：让 node 以非 0 退出码结束，pytest 才能感知失败
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
