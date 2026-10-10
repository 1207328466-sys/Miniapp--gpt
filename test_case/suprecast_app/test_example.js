/*
 * @project_name: UITest
 * @cur_file: test_example.js
 * @create_date: 2026/10/8
 *
 * 用例：有问必答 → 打开搜索页 → 输入关键词（并读回校验）
 *
 * 【与旧版最大的区别：不再需要人工准备现场】
 * 旧版要求在用例执行前"手动把手机切到有问必答页"，否则报
 * `没有 page 含搜索栏 .search-container`。现在 openSearch 会自己
 * 点底部 tab「有问必答」导航过去（幂等，已在则跳过）。
 *
 * 页面知识在 `pages/qa_page.js`（有问必答页 + 搜索页），本文件不出现选择器。
 *
 * ---------- 覆盖范围（诚实标注，别误读）----------
 *   ✅ 自导航到有问必答页 → 点搜索栏进搜索页 → 输入关键词 → 读回校验
 *   ❌ **提交搜索与结果页校验尚未实现**：结果页结构还没实测，
 *      不凭猜测写断言，所以本用例到"关键词确实在输入框里"为止。
 *   ⚠️ 关键词仅限 ASCII：[A-Za-z0-9_.-]，因为 `adb shell input text`
 *      不支持中文（传中文不报错但不生效），中文输入方案见 README「已知限制」。
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const {
  assertSelectorCount,
  dumpElements,
} = require("../../app_sub_function/suprecast_app/android");
const pages = require("../../app_sub_function/suprecast_app/pages");

const qaPage = pages.qaPage;
const base = pages.base;

const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
const KEYWORD = "test"; // 仅 ASCII，原因见文件头

(async () => {
  const funcList = [
    // 步骤 1：打开搜索页。幂等 + 自导航：不在有问必答页就点底部 tab 过去。
    [qaPage.openSearch, null],

    // 断言：确实进了搜索页 —— 真实输入框出现（此时搜索栏已消失）
    [assertSelectorCount, { selector: qaPage.SEL.searchInput, expected: 1 }],

    // 步骤 2：输入关键词。内部会读回校验：输不进去就报错，绝不静默通过。
    [qaPage.typeKeyword, { keyword: KEYWORD }],

    // 断言：输入框里的值确实等于关键词。
    // 与 typeKeyword 内部的读回是双保险 —— 一个查"输入那刻对不对"，
    // 一个查"经过页面重渲染之后值还在不在"。
    [
      async function assertKeywordInInput(page) {
        const fg = await base.foreground(page);
        const value = await base.inputValue(fg.locator(qaPage.SEL.searchInput).first());
        if (value !== KEYWORD) {
          throw new Error(
            `输入框里的值不等于关键词（期望 ${JSON.stringify(KEYWORD)}，实际 ${JSON.stringify(value)}）`
          );
        }
        console.log(`断言通过: 输入框值 = ${JSON.stringify(value)}`);
        return fg;
      },
      null,
    ],

    // 附加：打印搜索页结构，为后续写"提交搜索 + 结果页断言"留素材
    [dumpElements, { tag: ["wx-view", "wx-input", "wx-text"] }],

    // 收尾：把手机交还给下一条用例。
    // 本用例停在搜索页（它是个二级页，而且搜索结果页也带搜索栏，很容易被后续用例误判成首页），
    // 真机回归时下一条用例就是从搜索视图起步、报出「一个筛选 tab 都没找到」的。
    [qaPage.ensureOnHomeFeed, null],
  ];

  await appTest(funcList, {
    photosPath,
    // 用例元数据（决定报告里的中文分组与中文用例名）：
    // 不传的话，报告和控制台只能拿英文文件名当名字 —— 给人看的地方一律说中文。
    meta: { feature: "有问必答首页", story: "搜索", title: "打开搜索页并输入关键词（读回校验）" },
  });

  console.log("\n" + "=".repeat(60));
  console.log("test_example.js 执行完成（全部步骤通过）");
  console.log("=".repeat(60));
})().catch((e) => {
  // 必须保留：让 node 以非 0 退出码结束，pytest 才能感知失败
  console.error("\n用例失败: " + e.message);
  process.exit(1);
});
