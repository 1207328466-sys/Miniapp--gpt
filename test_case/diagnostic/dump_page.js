/*
 * 看页面结构（**长期保留的工具**，不是一次性探针）
 *
 * 【什么时候用它】写用例时想知道"屏幕上这些东西是什么元素、用什么选择器能定位"：
 * 例如「检查元素存在」的参数要填 `.search-container` 这种选择器，选择器从哪来？就从这里来。
 * 只想看**文字**的话不用它 —— 表格动作「打印页面文字」更省事（它只打屏幕上看得见的文字）。
 *
 * 【怎么跑】不需要表格、不需要 pytest，直接跑：
 *     node test_case/diagnostic/dump_page.js                 # 整个页面（控制台打前 300 行）
 *     node test_case/diagnostic/dump_page.js --only-text     # 只看"内部有文字"的分支（推荐，几十行）
 *     node test_case/diagnostic/dump_page.js --tag wx-text   # 只看某一类元素
 *     node test_case/diagnostic/dump_page.js --max 1000      # 控制台多打一些
 *
 * 【产出】完整内容写到 report/dump_<月日_时分秒>.txt（控制台只打前 N 行，免得刷屏把要看的东西冲掉），
 * 结尾还会打一行统计：本页元素几个、遍历了几个、输出几行。
 *
 * 【为什么不再自己写一套遍历】老版本（2026/10/10 那次排查「我的」文本）内置了一份自己的 DOM 遍历，
 * 和 `android.js` 的 dumpElements 是同一套逻辑的两份实现 —— 那种重复的代价是"改一处、漏一处"。
 * 现在只有一份：这里直接调 `dumpElements`。
 *
 * 前置：手机连着、微信里小程序开着（停在你想看的那一页）。
 */

const { appTest } = require("../../common/app_common");
const { dumpElements } = require("../../app_sub_function/suprecast_app/android");

const argv = process.argv.slice(2);
function arg(name, def = "") {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
}
const has = (name) => argv.includes(`--${name}`);

const params = {
  onlyText: has("only-text"),
  maxLines: Number(arg("max", "300")) || 300,
  tag: arg("tag", "") || undefined,
  save: true,
};

(async () => {
  console.log(
    `看页面结构：${params.tag ? `只看 <${params.tag}>` : "整个 body"}` +
      `${params.onlyText ? "（只看有文字的分支）" : ""}，控制台最多 ${params.maxLines} 行`
  );
  await appTest([[dumpElements, params]], {
    meta: { feature: "调试工具", story: "看页面结构", title: "看页面结构（dumpElements）" },
  });
  console.log("\n完整内容在上面那行「完整内容已写入 …」指的文件里（report/dump_*.txt），可以在编辑器里搜。");
})().catch((e) => {
  console.error("看页面结构失败: " + e.message);
  process.exit(1);
});
