/*
 * 自检（**离线、不连手机**）：选择器没命中时那条"空格提示"的判断口径。
 *
 * 盯的是 2026/10/13 真踩到的那次：页面上元素的 class 是 `fs-28 text-blacks28 ml-2`
 * （三个 class 用空格分开），照抄进「点选择器」变成 `.fs-28 text-blacks28 ml-2` ——
 * 而 CSS 里空格是「里面的」，于是必然找不到。框架现在会给出正确写法，这条自检钉住这个判断：
 *   · 该认出来的（多个 class 抄成一串）必须认出来，并给出 `.a.b.c`；
 *   · **不该乱认的**（合法的"里面的"写法、纯标签、单个选择器）必须原样放过 ——
 *     乱给建议比不给更坏：用户会照着一个同样错的写法去改。
 *
 * 运行：node test_case/diagnostic/selftest_selector_hint.js
 * 退出码：0 = 全部符合预期；1 = 有不符合
 */

const base = require("../../app_sub_function/suprecast_app/pages/base_page");

let passed = 0;
const failed = [];

function check(name, got, want) {
  if (got === want) {
    passed++;
    console.log(`OK   ${name} -> ${got === null ? "（不猜）" : got}`);
  } else {
    failed.push(`${name}：得到 ${got}，期望 ${want}`);
    console.log(`FAIL ${name} -> ${got}（期望 ${want}）`);
  }
}

const s = base.suggestJoinedSelector;

// ---- 该认出来的：多个 class 抄成一串 ----
check("owner 那次真实填错的串", s(".fs-28 text-blacks28 ml-2"), ".fs-28.text-blacks28.ml-2");
check("只带点号的第一个、后面是裸名字", s(".a-1 b-2 c-3"), ".a-1.b-2.c-3");

// ---- 不该乱认的 ----
check("合法的「里面的」写法（后面带点号）", s(".hot-topics .inline-flex"), null);
check("合法的「里面的」写法（后面是真标签）", s(".course-detail div"), null);
check("单个选择器没有空格", s("wx-input.search-input"), null);
check("属性选择器不动它", s('[class*="custom-tab-bar"] span'), null);
check("第一段不是点号开头的 class", s("div span"), null);
check("空串 / 只有一个词", s(""), null);
check("纯 class 名（无点号，不是我们教的写法）", s("search-container"), null);

// ---- 按 id 定位：框架不给这条路（2026/10/14 起）----
// 三个按 id 定位的动作当天已从动作清单删除；这里验的是"另一条路"也堵着：
// 有人把 id 抄成 #xxx / [id=...] 填进选择器参数时，必须当场报错。
const r = base.rejectIdSelector;
function throws(fn) {
  try {
    fn();
    return false;
  } catch (e) {
    return true;
  }
}
check("#id 写法要拦住", throws(() => r("#_AQ")), true);
check('[id="..."] 写法要拦住', throws(() => r('[id="_AQ"]')), true);
check("选择器里夹着 id 也要拦住", throws(() => r('div [id="_AQ"] span')), true);
check("普通 id（不带 # 也不带 [id=]）不算 id 选择器，按普通选择器走", throws(() => r("_AQ")), false);
// ↓ 合法的选择器一个都不许误伤（误伤会让填表的人以为"连 .xxx 都不能用"）
check("class 选择器放过", throws(() => r(".search-container")), false);
check("标签+class 放过", throws(() => r("wx-input.search-input")), false);
check("后代选择器放过", throws(() => r(".hot-topics .inline-flex")), false);
check("属性选择器（不是 id）放过", throws(() => r('[class*="custom-tab-bar"] span')), false);

// ---- 「第几个」的解析（2026/10/14：给「点文字」「点选择器」加的参数2）----
const px = base.parseIndex;
check("不填 = 第 1 个（老行为不变）", px(""), 1);
check("不填（undefined）= 第 1 个", px(undefined), 1);
check("填 2 = 第 2 个", px("2"), 2);
check("填 10 = 第 10 个", px("10"), 10);
check("数字类型也认", px(3), 3);
check("前后空格先去掉", px("  4  "), 4);

for (const [name, raw] of [
  ["0 要从 1 数起", "0"],
  ["负数不行", "-1"],
  ["小数不行", "1.5"],
  ["文字不行", "第二个"],
]) {
  let bad = false;
  try {
    px(raw);
  } catch (e) {
    bad = true;
  }
  check(`反例：${name}`, bad, true);
}

// ---- 「滑动」的方向 + 每次滑多少（2026/10/14：owner 问"一次滑多少、能不能自己控制"）----
// 为什么值得盯：这是表格里唯一的"物理量"参数，两侧（导出校验 / 真机执行）各有一份同样的规则，
// 而且**默认行为必须一个字不变**（老的 `滑动 | 3 | 上` 要还是半屏）—— 这条自检就是钉这个的。
const sw = base.parseSwipeSpec;
function expectSwipe(name, raw, wantDir, wantRatio) {
  let got;
  try {
    const s = sw(raw);
    got = `${s.dir} ${Math.round(s.ratio * 100)}%`;
  } catch (e) {
    got = "（报错：" + e.message.split("\n")[0].slice(0, 40) + "）";
  }
  const want = `${wantDir} ${Math.round(wantRatio * 100)}%`;
  check(name, got, want);
}

expectSwipe("不填 = 向上、半屏（老行为不变）", undefined, "上", 0.5);
expectSwipe("只写方向 = 半屏", "上", "上", 0.5);
expectSwipe("向下也是半屏", "下", "下", 0.5);
expectSwipe("★自己定：上 30%", "上 30%", "上", 0.3);
expectSwipe("不带空格也认", "下30%", "下", 0.3);
expectSwipe("全角百分号也认", "上30％", "上", 0.3);
expectSwipe("边界：最小 5%", "上 5%", "上", 0.05);
expectSwipe("边界：最大 95%", "下 95%", "下", 0.95);

for (const [name, raw] of [
  ["越界（96%）要报错，不静默夹边界", "上 96%"],
  ["越界（0%）要报错", "上 0%"],
  ["方向写错要报错", "左"],
  ["只有数字没方向要报错", "30%"],
]) {
  let bad = false;
  try {
    sw(raw);
  } catch (e) {
    bad = true;
  }
  check(`反例：${name}`, bad, true);
}

// 起止比例：向上滑固定从 75% 处起手、向下滑从 25% 处起手 —— 只改"走多远"
check(
  "起止比例：上 30% -> 0.75 拖到 0.45",
  JSON.stringify([sw("上 30%").startRatio, sw("上 30%").endRatio]),
  JSON.stringify([0.75, 0.45])
);
check(
  "起止比例：下 30% -> 0.25 拖到 0.55",
  JSON.stringify([sw("下 30%").startRatio, sw("下 30%").endRatio]),
  JSON.stringify([0.25, 0.55])
);

console.log();
if (failed.length) {
  console.log(`有 ${failed.length} 项不符合预期：`);
  for (const f of failed) console.log("  · " + f);
  process.exit(1);
}
console.log(`全部通过（${passed} 项）`);
