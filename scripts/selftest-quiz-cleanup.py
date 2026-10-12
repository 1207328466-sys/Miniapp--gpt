# -*- coding: utf-8 -*-
"""答题复位工具的安全闸门自检（**不需要手机、也不需要连库**）。

为什么要它：`tools/quiz_data_cleanup.py` 是**本仓库唯一一个会删数据**的工具。
它的护栏（没点名活动就拒绝、不是测试库就拒绝、量太大就拒绝）一旦松开，
不会报错 —— 只会在某次真跑的时候安静地删掉不该删的东西。所以护栏本身要有自检，
而且每条都要**正反两面**验一遍（该放行的必须放行，该拦的必须拦）。

被验的是纯函数 `decide()`：它不碰数据库，只回答"这一票能不能删"。

用法：python scripts/selftest-quiz-cleanup.py
退出码：0 = 全部通过；1 = 有不符合预期的
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))

import quiz_data_cleanup as m  # noqa: E402

failed = []
passed = 0


def expect(name, want_allowed, db, activity, submits, details, want_msg=None, **kw):
    """跑一次护栏判断，核对"放不放行"和"拒绝理由里有没有那句话"。"""
    global passed
    allowed, reasons, notices = m.decide(db, activity, submits, details, **kw)
    if allowed != want_allowed:
        failed.append(
            "%s：应当%s，实际%s（理由：%s）" % (name, "放行" if want_allowed else "拒绝", "放行" if allowed else "拒绝", reasons)
        )
        return
    if want_msg and not any(want_msg in r for r in reasons):
        failed.append("%s：拒绝理由里没有「%s」，实际是 %s" % (name, want_msg, reasons))
        return
    passed += 1
    print("OK   %s" % name)


ALPHA = "eco_microapp_alpha"

# ---------- 正面：正常该放行的 ----------
expect("测试库 + 点名活动 + 少量记录 -> 放行", True, ALPHA, 347, 1, 2)
expect("一行都没有（本来就干净）-> 放行", True, ALPHA, 347, 0, 0)
expect("正好卡在上限 50 行 -> 放行（上限是「超过才拦」）", True, ALPHA, 347, 10, 40)
expect("库名含 test 也认（另一套测试库）-> 放行", True, "eco_microapp_test", 347, 1, 2)

# ---------- 反面：必须拦下来的 ----------
expect("没给活动编号 -> 拒绝", False, ALPHA, None, 1, 2, want_msg="--activity")
expect("生产库名 -> 拒绝", False, "eco_microapp_prod", 347, 1, 2, want_msg="不像测试库")
# 反向再验一次：显式 --force-db 才放行（说明它不是"永远拒绝"，而是"要人明确点头"）
expect("生产库名 + --force-db -> 放行", True, "eco_microapp_prod", 347, 1, 2, force_db=True)
expect("没见过的库名（既不含 alpha 也不含 test）-> 拒绝", False, "eco_microapp_beta", 347, 1, 2, want_msg="不像测试库")
expect("一次要删 51 行 -> 拒绝", False, ALPHA, 347, 1, 50, want_msg="超过上限")
expect("一次要删 51 行 + --force -> 放行", True, ALPHA, 347, 1, 50, force=True)
expect("一次要删 2000 行 -> 拒绝", False, ALPHA, 347, 500, 1500, want_msg="超过上限")

# ---------- 提示（不拦，但要说出来）----------
allowed, reasons, notices = m.decide(ALPHA, 347, 0, 0)
if not notices or not any("干净" in n for n in notices):
    failed.append("一条都没有时，应当给一句「本来就干净」的提示，实际提示是 %s" % notices)
else:
    passed += 1
    print("OK   没有可删的记录时会给提示（不是默默什么都不做）")


# ---------- 按活动名定位 id（首页答题卡背后的活动会换人，写死 id 会指到别的活动上）----------
def expect_pick(name, rows, want_id, want_msg=None):
    global passed
    got_id, why = m.pick_activity_id(rows, "Z-题干图验证")
    if got_id != want_id:
        failed.append("%s：定位到 %s，期望 %s（原因：%s）" % (name, got_id, want_id, why))
        return
    if want_msg and want_msg not in (why or ""):
        failed.append("%s：原因里没有「%s」，实际是 %s" % (name, want_msg, why))
        return
    passed += 1
    print("OK   %s" % name)


expect_pick("名字唯一命中 -> 用它的 id", [(360, "Z-题干图验证")], 360)
expect_pick("名字一个都没命中 -> 拒绝", [], None, "找不到")
expect_pick(
    "名字命中多个（重名）-> 拒绝，不挑第一个",
    [(360, "Z-题干图验证"), (361, "Z-题干图验证")],
    None,
    "不唯一",
)

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
