/*
 * 诊断（不以 test_ 开头，pytest 不收集）：缺陷 713587133「案例详情中缺少显示案例描述信息」
 * —— 案例详情页上那句「案例简介：xxx」到底渲不渲染、长什么样？
 *
 * 【缺陷原文（孙亭亭 / 已关闭）】案例详情中缺少显示案例描述信息。
 * 【源码锚点】`src/packageA/pages/case-detail/index.tsx`：
 *     {(detail.tags || detail.introduction) && (
 *        <View className="meta-block-tags-intro">
 *          {detail.tags ? <Text className="case-tags-intro">案例标签：{detail.tags}</Text> : null}
 *          {detail.introduction ? <Text className="case-tags-intro">案例简介：{detail.introduction}</Text> : null}
 *        </View>)}
 *   —— 两个要点：
 *     ① **条件渲染**：tags 和 introduction 都为空时整块不显示（所以夹具必须先有简介）；
 *     ② 外层还有 `!collapsed` —— 详情页有"展开/收起"，收起状态下这块可能不渲染。
 *
 * 【库里的事实（2026/10/16 只读查过）】`simulation_case.introduction` 就是"简介"，
 * 案例 id=90「亲亲」的 introduction = 「去」，status=1（上架）、is_deleted=0。
 *
 * 只读：打开案例库 → 点开一个案例 → 读页面文字与那两块元素。不改任何数据。
 * 运行：node test_case/diagnostic/probe_case_intro.js                # 默认用「亲亲」
 *       node test_case/diagnostic/probe_case_intro.js --name 案例名
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

const argv = process.argv.slice(2);
const ni = argv.indexOf("--name");
const NAME = ni >= 0 && argv[ni + 1] ? argv[ni + 1] : "亲亲";

async function probe(page) {
  page = await caseLibrary.ensureOn(page);
  page = await caseLibrary.openByName(page, NAME);
  const fg = await base.foreground(page);

  const info = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const introEls = Array.from(document.querySelectorAll(".case-tags-intro"));
    const meta = document.querySelector(".meta-block-tags-intro");
    const toggle = document.querySelector(".collapse-toggle");
    return {
      introCount: introEls.length,
      introTexts: introEls.map((e) => norm(e.innerText)),
      hasMetaBlock: !!meta,
      metaText: meta ? norm(meta.innerText).slice(0, 200) : "(没有 .meta-block-tags-intro)",
      toggle: toggle ? norm(toggle.innerText) : "(没有 .collapse-toggle)",
      title: norm((document.querySelector(".case-title") || {}).innerText),
      head: norm(document.body.innerText).slice(0, 200),
    };
  });

  console.log(`案例名（参数）：${NAME}`);
  console.log(`详情页标题 .case-title = ${JSON.stringify(info.title)}`);
  console.log(`.case-tags-intro 命中 ${info.introCount} 个：${JSON.stringify(info.introTexts)}`);
  console.log(`.meta-block-tags-intro 在吗：${info.hasMetaBlock}；它的文字：${JSON.stringify(info.metaText)}`);
  console.log(`.collapse-toggle = ${JSON.stringify(info.toggle)}`);
  console.log(`页面开头 200 字：${JSON.stringify(info.head)}`);
  return fg;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "案例详情", title: "案例简介那一块到底渲不渲染" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
