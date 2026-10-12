/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**反向验证** —— 把「未购买点课时」这条断言
 * 指向一门**已购买**的课（717），它必须**明确报错**，而不是假装通过。
 *
 * 为什么要验：这条断言里有一句前置检查（"页面必须是未购买态"）。如果那句写松了，
 * 把"已购买"的课当成"未购买"来测，报告会显示通过 —— 那是**假绿**，比红更糟。
 *
 * 只读：只导航 + 读 DOM（已购买页上不会点课时，因为前置检查会先拦下）。
 * 运行：node test_case/diagnostic/probe_unpurchased_assert_reverse.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const courseDetail = pages.courseDetail;

async function probe(page) {
  // 717 是我们账号**已购买**的课（user_course_relation 里有关系）
  page = await courseDetail.openByName(page, "717");
  console.log("\n[第 1 步] 已打开已购买的课程「717」，现在故意用「未购买」的断言去测它");

  let err = "";
  try {
    await courseDetail.assertUnpurchasedLessonRules(page, { courseName: "717" });
  } catch (e) {
    err = e.message;
  }

  if (!err) {
    throw new Error(
      "反向验证失败：把已购买的课交给「未购买」断言，它竟然通过了 —— 说明前置检查（必须是未购买态）没起作用，\n" +
        "  这条断言会在错误的场景下给出「绿」，属于假绿。"
    );
  }
  const wanted = "不是未购买态";
  if (!err.includes(wanted)) {
    throw new Error(`反向验证失败：虽然报错了，但报的不是「${wanted}」，而是：${err.split("\n")[0]}`);
  }
  console.log("\n✅ 反向验证通过：已购买页面被前置检查拦下，报错原文：");
  console.log("   %s", err.split("\n").slice(0, 3).join("\n   "));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "课程", title: "反向验证：已购买页面必须被未购买断言拦下" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
