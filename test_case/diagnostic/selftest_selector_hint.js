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

// ---- 按 id 定位（2026/10/14）：id 转选择器的口径 ----
const i = base.idSelector;
check("普通 id", i("_AQ"), '[id="_AQ"]');
check("带 # 的 id（也认）", i("#_AQ"), '[id="_AQ"]');
check(
  "★以数字开头的 id（CSS 的 #xxx 用不了，必须走属性写法）",
  i("9d834775--_XFi"),
  '[id="9d834775--_XFi"]'
);
check("前后有空格先去掉", i("  _AQ  "), '[id="_AQ"]');

let threw = false;
try {
  i("");
} catch (e) {
  threw = true;
}
check("空 id 要报错（而不是生成一个匹配一切的选择器）", threw, true);

let threw2 = false;
try {
  i('a"b');
} catch (e) {
  threw2 = true;
}
check("id 里带引号要报错（不然会拼出一个坏选择器）", threw2, true);

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

console.log();
if (failed.length) {
  console.log(`有 ${failed.length} 项不符合预期：`);
  for (const f of failed) console.log("  · " + f);
  process.exit(1);
}
console.log(`全部通过（${passed} 项）`);
