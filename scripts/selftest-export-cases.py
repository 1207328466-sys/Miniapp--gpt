# -*- coding: utf-8 -*-
"""用例表规则自检（不需要手机）：验证 tools/export_cases.py 的校验与体检规则。

为什么要它：这些规则是"表格填错时唯一的护栏" —— 但护栏本身没人验过。
真机上的行为有真机跑兜底，纯逻辑的规则就用这份自检兜底：每条规则都要
**正反两个方向**都验一遍（合规的表不报错；违规的表必须报出预期的那句话）。

用法：python scripts/selftest-export-cases.py
退出码：0 = 全部通过；1 = 有不符合预期的
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))

from openpyxl import Workbook  # noqa: E402

import export_cases as m  # noqa: E402

TMP = tempfile.mkdtemp(prefix="uitest_selftest_")
PATH = os.path.join(TMP, "用例表.xlsx")

failed = []
passed = 0


def make(rows, header=None, sheet="用例"):
    wb = Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(header or m.HEADERS)
    for r in rows:
        ws.append(r)
    wb.save(PATH)
    return PATH


def ok(name, rows, want_warn_count=0, **kw):
    """正例：应当没有任何错误；并检查提示条数"""
    global passed
    try:
        cases = m.validate(m.read_rows(make(rows, **kw)))
        warns = m.lint_cases(cases)
    except m.TableError as e:
        failed.append("%s：本该通过，却报错 %s" % (name, e.errors))
        return
    if len(warns) != want_warn_count:
        failed.append("%s：提示条数 %d，期望 %d（%s）" % (name, len(warns), want_warn_count, warns))
        return
    passed += 1
    print("OK   正例 %s" % name)


def bad(name, rows, want, **kw):
    """反例：必须报错，且报错里包含 want 那句话"""
    global passed
    try:
        m.validate(m.read_rows(make(rows, **kw)))
    except m.TableError as e:
        msg = " / ".join(e.errors)
        if want in msg:
            passed += 1
            print("OK   反例 %s -> %s" % (name, e.errors[0][:60]))
            return
        failed.append("%s：报错里没有「%s」，实际是 %s" % (name, want, msg))
        return
    failed.append("%s：本该报错（%s）却通过了" % (name, want))


GOOD = ["回到首页", "", "检查文字显示", "积分商城", "", "", ""]

# ---------- 正例 ----------
ok(
    "合规用例（起点 + 检查 + 交还）",
    [
        ["A_001", "合规", 1, "回到首页", "", "", ""],
        ["A_001", "", 2, "检查文字显示", "积分商城", "", ""],
        ["A_001", "", 3, "回到首页", "", "", ""],
    ],
)
ok("只有一步的最小用例", [["A_002", "最小", 1, "回到首页", "", "", ""]], want_warn_count=1)  # 没有检查 -> 1 条提示

# ---------- 校验反例（填错就该挡下来）----------
bad("不认识的动作", [["B_001", "名字", 1, "打开首贝", "", "", ""]], "不认识动作")
bad("动作缺参数1", [["B_002", "名字", 1, "打开搜索并输入", "", "", ""]], "参数1")
bad("多余参数2", [["B_003", "名字", 1, "回到首页", "", "多填的", ""]], "用不到「参数2」")
bad("固定候选项写错", [["B_004", "名字", 1, "切换筛选tab", "最新问题", "", ""]], "只能填这 4 个之一")
bad("滑动方向写错", [["B_005", "名字", 1, "滑动", "1", "左", ""]], "只能填这 2 个之一")
bad("步骤序号重复", [["B_006", "名字", 1, "回到首页", "", "", ""], ["B_006", "", 1, "返回上一页", "", "", ""]], "重复")
bad("空表", [], "一行数据都没有")
bad("表头被改", [["B_007", "名字", 1, "回到首页", "", "", ""]], "表头", header=["用例编号", "用例名字", "步骤序号", "动作", "参数1", "参数2", "备注"])

# ---------- 体检（lint）反例：只提示，不拦截 ----------
ok("一条用例没有任何检查", [["C_001", "无检查", 1, "回到首页", "", "", ""], ["C_001", "", 2, "切到用户中心", "", "", ""], ["C_001", "", 3, "回到首页", "", "", ""]], want_warn_count=1)
ok("第一步不回到首页", [["C_002", "起点不对", 1, "检查文字显示", "积分商城", "", ""], ["C_002", "", 2, "回到首页", "", "", ""]], want_warn_count=1)
ok("最后一步停在二级页", [["C_003", "结尾不对", 1, "回到首页", "", "", ""], ["C_003", "", 2, "检查文字显示", "热门专栏", "", ""], ["C_003", "", 3, "打开搜索并输入", "test", "", ""]], want_warn_count=1)
ok("三条规矩全犯", [["C_004", "全犯", 1, "打开答题活动", "", "", ""]], want_warn_count=3)

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
