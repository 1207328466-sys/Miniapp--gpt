/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713582841「有问必答搜索空状态优化」的
 * 文案到底是不是需求里写的那两句，以及**哪个关键词才是零结果**。
 *
 * 需求原话：「有问必答首页搜索执行搜索且零结果时，空态展示 AI 引导
 * 『没有找到相关内容？让小铸手帮你答』」，并且「有结果搜索不出现引导模块」。
 *
 * 为什么要先探测再写用例：关键词选错（其实有结果）会让"零结果"用例永远红，
 * 而项目铁律是**不凭猜测写断言**。这个探针把几个候选关键词逐个搜一遍，
 * 打印"引导出现没有 + 页面文字开头"，据此再决定用例里写哪个词。
 *
 * 只读：只搜索、只读文字，不点任何按钮、不改数据。
 * 运行：node test_case/diagnostic/probe_search_empty.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

// 候选关键词（只能字母数字下划线点连字符 —— typeKeyword 的限制）
const KEYWORDS = ["zzz9999", "qqqqq", "test", "xianhua", "a"];

const GUIDE_1 = "没有找到相关内容？让小铸手帮你答";
const GUIDE_2 = "问小铸手";

async function probe(page) {
  for (const kw of KEYWORDS) {
    page = await qa.ensureOnHomeFeed(page);
    page = await qa.openSearch(page);
    page = await qa.typeKeyword(page, { keyword: kw });
    // ⚠️ 只打字不提交的话，页面停在「搜索历史」面板 —— 必须提交才看得到结果页/空态。
    // 第一版探针就漏了这一步，5 个关键词读到的都是同一段历史列表。
    const { getDevice } = require("../../app_sub_function/suprecast_app/android");
    const device = await getDevice();
    await device.shell("input keyevent 66");
    await base.sleep(2500); // 等结果页与空态渲染

    const fg = await base.foreground(page);
    const text = await base.pageText(fg);
    const hasGuide1 = text.includes(GUIDE_1);
    const hasGuide2 = text.includes(GUIDE_2);
    const looksLikeResultPage = text.includes("全部回答");
    console.log(
      "[%s] 结果页=%s 引导1=%s 引导2=%s | 页面文字开头: %s",
      kw,
      looksLikeResultPage ? "是" : "否",
      hasGuide1 ? "有" : "无",
      hasGuide2 ? "有" : "无",
      JSON.stringify(text.slice(0, 90))
    );
  }

  // 收尾：回到首页，把搜索页交还
  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "搜索空态", title: "探测零结果关键词与 AI 引导文案" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
