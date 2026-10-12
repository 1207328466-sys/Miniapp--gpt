/*
 * 离线自检（**不需要手机**）：课程列表"0 课时对账"的匹配逻辑，正反两面都验。
 *
 * 需求 713367615 第 1 条：「管理后台的课程下的课时数为 0 时，小程序端不显示该课程」。
 * 怎么验？拿库里的"0 课时课程名"去小程序课程列表里找 —— 一个都不该找到。
 * 而"找"这一步最容易出事的是**前缀误报**：库里既有「付费课程1」也有「付费课程10」，
 * 只做子串匹配就会把「付费课程10」当成「付费课程1」显示了（假失败）。
 *
 * 所以把匹配抽成纯函数 `findZeroLessonShown`，用这份自检把边界钉住。
 *
 * 运行：node test_case/diagnostic/selftest_course_zero_lesson_match.js
 * 退出码：0 = 全部符合预期；1 = 有不符合的
 */

const learnCenter = require("../../app_sub_function/suprecast_app/pages/learn_center_page");

const { findZeroLessonShown, stripCourseCardPrefix, cardVariants } = learnCenter;

let passed = 0;
const failed = [];

/** 造一张课程卡（text = 卡片原文；name = 剥掉动态前缀后的版本） */
function card(text) {
  return { text, name: stripCourseCardPrefix(text) };
}

function ok(name, cards, dbNames) {
  const hits = findZeroLessonShown(cards, dbNames);
  if (hits.length) {
    failed.push(`${name}：本该一个都不命中，却命中了 ${JSON.stringify(hits)}`);
    return;
  }
  passed += 1;
  console.log(`OK   正例 ${name}`);
}

function bad(name, cards, dbNames, want) {
  const hits = findZeroLessonShown(cards, dbNames);
  if (!hits.length) {
    failed.push(`${name}：本该命中「${want}」，却一个都没命中`);
    return;
  }
  if (!hits.includes(want)) {
    failed.push(`${name}：命中的是 ${JSON.stringify(hits)}，没包含期望的「${want}」`);
    return;
  }
  passed += 1;
  console.log(`OK   反例 ${name} -> 命中 ${JSON.stringify(hits)}`);
}

// ---------- 正例 ----------
ok(
  "列表里没有 0 课时的课程",
  [card("免费课程 26 人已学习 15 课程评价 ¥0"), card("717 13 人已学习 1 课程评价 ¥1")],
  ["付费课程1", "课程2", "18"]
);
ok(
  "**前缀不能误报**：列表里有「付费课程10」，库里 0 课时的是「付费课程1」",
  [card("付费课程10 3 人已学习 1 课程评价 ¥1")],
  ["付费课程1"]
);
ok(
  "**前缀不能误报**：列表里有「课程22222」，库里 0 课时的是「课程2」",
  [card("课程22222 1 人已学习 0 课程评价 ¥0")],
  ["课程2"]
);

// ---------- 反例（该命中时必须命中） ----------
bad("0 课时的课程真的显示了", [card("付费课程1 3 人已学习 1 课程评价 ¥1")], ["付费课程1"], "付费课程1");
bad(
  "课程名本身是纯数字（库里有一门叫 18）",
  [card("18 2 人已学习 1 课程评价 ¥12")],
  ["18"],
  "18"
);
bad(
  "卡片前面挂着「已购买(学习进度 0%)」也要认得出来",
  [card("已购买(学习进度 0%) 717 13 人已学习 1 课程评价 ¥1")],
  ["717"],
  "717"
);
bad(
  "卡片前面挂着纯数字角标（形如「0 免费课程 …」）也要认得出来",
  [card("0 免费课程 26 人已学习 15 课程评价 ¥0")],
  ["免费课程"],
  "免费课程"
);

// ---------- 纯函数本身的边界 ----------
// 名字候选（cardVariants）要"**包含**期望的名字"，而且不能让剥法把名字吃掉
const variants = [
  ["已购买(学习进度 0%) 717 13 人已学习", "717"], // 纯数字课程名：不能被"剥数字角标"吃掉
  ["已购买(学习进度 37%) 7.8课程new 3 人已学习", "7.8课程new"],
  ["0 免费课程 26 人已学习", "免费课程"], // 纯数字角标：要能被剥掉
  ["4.16 创建课程 0 人已学习", "4.16 创建课程"], // 名字里有数字和点，别被剥坏
  ["18 2 人已学习", "18"], // 纯数字课程名 + 紧跟着统计数：不能被剥掉
];
variants.forEach(([raw, want]) => {
  const got = cardVariants(raw);
  const hit = got.some((v) => v === want || v.startsWith(want + " "));
  if (!hit) {
    failed.push(`cardVariants(${JSON.stringify(raw)}) = ${JSON.stringify(got)}，没有一个候选能匹配课程名 ${JSON.stringify(want)}`);
    return;
  }
  passed += 1;
  console.log(`OK   名字候选 ${JSON.stringify(raw.slice(0, 18))} 含 ${JSON.stringify(want)}`);
});

console.log();
if (failed.length) {
  console.log(`有 ${failed.length} 项不符合预期：`);
  failed.forEach((f) => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`全部通过（${passed} 项）`);
