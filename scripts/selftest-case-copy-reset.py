# -*- coding: utf-8 -*-
"""案例复制复位工具的安全闸门自检（**不需要手机、也不需要连库**）。

为什么要它：`tools/case_copy_reset.py` 是本仓库**第二个会动数据**的工具
（删 `simulation_copy_record` 的行 + 把 `simulation_case.copy_count` 往下减）。
答题那个复位工具早就有 15 项自检了，这个一直空着 —— 护栏没人验，等于没护栏。

被验的是两个纯函数：
  · `decide_reset`：这一票能不能删（库名像不像测试库 / 有没有点名案例 / 量是不是太大）
  · `pick_case_id`：按标题能不能唯一定位到案例（重名要拒绝，不能挑一个"看起来对"的）

用法：python scripts/selftest-case-copy-reset.py
退出码：0 = 全部通过；1 = 有不符合预期的
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))

import case_copy_reset as m  # noqa: E402

ALPHA = "eco_microapp_alpha"
CAP = m.MAX_ROWS_WITHOUT_FORCE

failed = []
passed = 0


def expect(name, want_allowed, db, case_id, rows, want_msg=None, **kw):
    """跑一次护栏判断，核对"放不放行"和"拒绝理由里有没有那句话"。"""
    global passed
    allowed, reasons = m.decide_reset(db, case_id, rows, **kw)
    if allowed != want_allowed:
        failed.append(
            "%s：应当%s，实际%s（理由：%s）"
            % (name, "放行" if want_allowed else "拒绝", "放行" if allowed else "拒绝", reasons)
        )
        return
    if want_msg and not any(want_msg in r for r in reasons):
        failed.append("%s：拒绝理由里没有「%s」，实际是 %s" % (name, want_msg, reasons))
        return
    passed += 1
    print("OK   %s" % name)


# ---------- 正例 ----------
expect("测试库 + 点名案例 + 只删自己造的那条 -> 放行", True, ALPHA, 60, 1)
expect("本来就没得删（0 条）-> 放行", True, ALPHA, 60, 0)
expect("正好卡在上限 %d 条 -> 放行（上限是「超过才拦」）" % CAP, True, ALPHA, 60, CAP)
expect("库名含 test 也认（另一套测试库）-> 放行", True, "eco_microapp_test", 60, 1)

# ---------- 反例 ----------
expect("没点名案例 -> 拒绝", False, ALPHA, None, 1, want_msg="--case")
expect("生产库名 -> 拒绝", False, "eco_microapp_prod", 60, 1, want_msg="不像测试库")
expect("生产库名 + --force-db -> 放行（要人明确点头，不是永远拒绝）", True, "eco_microapp_prod", 60, 1, force_db=True)
expect("没见过的库名（不含 alpha/test）-> 拒绝", False, "eco_microapp_beta", 60, 1, want_msg="不像测试库")
expect("要删 %d 条（超 1 条）-> 拒绝" % (CAP + 1), False, ALPHA, 60, CAP + 1, want_msg="超过上限")
expect("要删 %d 条 + --force -> 放行" % (CAP + 1), True, ALPHA, 60, CAP + 1, force=True)
expect("要删 500 条 -> 拒绝", False, ALPHA, 60, 500, want_msg="超过上限")


# ---------- 按标题定位案例 ----------
def expect_pick(name, rows, want_id, want_msg=None):
    global passed
    got, why = m.pick_case_id(rows, "凝固应力")
    if got != want_id:
        failed.append("%s：定位到 %s，期望 %s（原因：%s）" % (name, got, want_id, why))
        return
    if want_msg and want_msg not in (why or ""):
        failed.append("%s：原因里没有「%s」，实际是 %s" % (name, want_msg, why))
        return
    passed += 1
    print("OK   %s" % name)


expect_pick("标题唯一命中 -> 用它的 id", [(60, "凝固应力")], 60)
expect_pick("标题一个都没命中 -> 拒绝", [], None, "找不到")
expect_pick("标题命中多个（重名）-> 拒绝，不挑第一个", [(60, "凝固应力"), (61, "凝固应力")], None, "不唯一")

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
