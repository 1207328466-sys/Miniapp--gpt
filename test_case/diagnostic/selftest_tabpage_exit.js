/*
 * 自检（**离线、不连手机**）：「从二级页退到一级页」的退出判定。
 *
 * 盯的是 2026/10/13 真踩到的那个 bug：循环写成"最多返回 3 次"，
 * 而**第 3 次返回之后没有再检查一眼**就直接报失败 ——
 * 于是"正好要退 3 层"的用例（首页 → 我的 → 积分商城 → 积分明细）必红，
 * 而那时人已经站在有底部 tab 栏的页面上（截图能作证）。
 *
 * 判定逻辑现在在 base_page.js 的 exitDecision()（纯函数），这里正反两个方向钉住它：
 *   · 有 tab 栏 → 必须收工（哪怕一次都没退）
 *   · 没 tab 栏、还允许退 → 继续退
 *   · 退到"上限次数"这一刻如果已经有 tab 栏 → **必须收工**（就是那个 bug 的正面）
 *   · 退满次数仍然没有 → 才允许放弃
 *
 * 运行：node test_case/diagnostic/selftest_tabpage_exit.js
 * 退出码：0 = 全部符合预期；1 = 有不符合
 */

const base = require("../../app_sub_function/suprecast_app/pages/base_page");

let passed = 0;
const failed = [];

function check(name, got, want) {
  if (got === want) {
    passed++;
    console.log(`OK   ${name} -> ${got}`);
  } else {
    failed.push(`${name}：得到 ${got}，期望 ${want}`);
    console.log(`FAIL ${name} -> ${got}（期望 ${want}）`);
  }
}

const d = base.exitDecision;

check("已经在有 tab 栏的页面（一次没退）", d({ hasTabBar: true, backsDone: 0, maxBacks: 3 }), "done");
check("没有 tab 栏、还能退（第 1 次）", d({ hasTabBar: false, backsDone: 0, maxBacks: 3 }), "back");
check("没有 tab 栏、还能退（第 3 次之前）", d({ hasTabBar: false, backsDone: 2, maxBacks: 3 }), "back");
check(
  "★退满 3 次之后这一眼已经有 tab 栏 —— 必须收工（这就是修掉的那个 bug）",
  d({ hasTabBar: true, backsDone: 3, maxBacks: 3 }),
  "done"
);
check(
  "退满 3 次、仍然没有 tab 栏 —— 这时才允许放弃",
  d({ hasTabBar: false, backsDone: 3, maxBacks: 3 }),
  "give_up"
);
check("上限为 0（不许退）且没有 tab 栏", d({ hasTabBar: false, backsDone: 0, maxBacks: 0 }), "give_up");
check("上限为 0 但有 tab 栏", d({ hasTabBar: true, backsDone: 0, maxBacks: 0 }), "done");

console.log();
if (failed.length) {
  console.log(`有 ${failed.length} 项不符合预期：`);
  for (const f of failed) console.log("  · " + f);
  process.exit(1);
}
console.log(`全部通过（${passed} 项）`);
