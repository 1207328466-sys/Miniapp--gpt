/*
 * 自检（**不需要手机**）：验证"多候选时挑前台页"的三条规则。
 *
 * 为什么要有它：真机上"多个页面同时出帧"很难稳定复现（坑 19 就是碰运气撞上的），
 * 所以把挑页逻辑抽成纯函数 pickForegroundCandidate，在这里用构造数据把每条规则都验一遍 ——
 * 包括"反着来会怎样"，证明新规则真的在起作用、而不是碰巧。
 *
 * 运行：node test_case/diagnostic/selftest_pick_page.js
 * 退出码：0 = 全过；1 = 有不过的
 */

const { pickForegroundCandidate } = require("../../common/app_common");

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}（得到 ${got}，期望 ${want}）`);
  if (!ok) failed += 1;
}

// 三个真实页面（元素数取自 2026/10/10 真机采样）
const HOME = { name: "首页", count: 406 };
const COLUMN = { name: "学习中心·专栏列表", count: 217 }; // 卡在出帧的老页面
const SEARCH = { name: "搜索页", count: 77 }; // 刚跳过去的那一页

const now = 1_000_000;
const sinceOf = (p) => since[p.name];
const since = {};

// 场景①：从首页点进搜索页 —— 搜索页刚出帧，专栏列表卡着出帧且元素数更多
{
  since[HOME.name] = now - 60_000;
  since[COLUMN.name] = now - 30_000;
  since[SEARCH.name] = now - 500; // 0.5 秒前刚开始出帧
  const alive = [HOME, COLUMN, SEARCH].map((p) => ({ page: p, count: p.count }));
  const r = pickForegroundCandidate(alive, { callerPage: HOME, sinceOf, now });
  check("① 刚跳过去的那页优先（不被元素更多的老页面抢走）", r.page.name, "搜索页");
}

// 场景②：没有新页面开始出帧（都在一分钟前就开始出帧）-> 沿用调用方手里那一页
{
  since[HOME.name] = now - 60_000;
  since[COLUMN.name] = now - 61_000;
  since[SEARCH.name] = now - 62_000;
  const alive = [HOME, COLUMN, SEARCH].map((p) => ({ page: p, count: p.count }));
  const r = pickForegroundCandidate(alive, { callerPage: SEARCH, sinceOf, now });
  check("② 没在跳转时，沿用调用方手里那一页", r.page.name, "搜索页");
}

// 场景③：既没有新出帧、调用方那页也不在候选里 -> 退回元素数最多（老兜底）
{
  since[HOME.name] = now - 60_000;
  since[COLUMN.name] = now - 61_000;
  const alive = [HOME, COLUMN].map((p) => ({ page: p, count: p.count }));
  const r = pickForegroundCandidate(alive, { callerPage: SEARCH, sinceOf, now });
  check("③ 什么信号都没有时，退回「元素数最多」", r.page.name, "首页");
}

// 场景④：只有一个候选
{
  const r = pickForegroundCandidate([{ page: SEARCH, count: SEARCH.count }], {
    callerPage: HOME,
    sinceOf,
    now,
  });
  check("④ 只有一个候选时就是它", r.page.name, "搜索页");
}

// 反向验证：把"最近"的时间窗关掉（recentMs=0），第①条就应当失效、落回老行为
{
  since[HOME.name] = now - 60_000;
  since[SEARCH.name] = now - 500;
  const alive = [HOME, SEARCH].map((p) => ({ page: p, count: p.count }));
  const r = pickForegroundCandidate(alive, { callerPage: null, sinceOf, now, recentMs: 0 });
  check("⑤ 关掉新规则后确实落回老行为（证明第①条真在起作用）", r.page.name, "首页");
}

console.log(failed ? `\n有 ${failed} 项不通过` : "\n全部通过");
process.exit(failed ? 1 : 0);
