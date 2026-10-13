# -*- coding: utf-8 -*-
"""用例表规则自检（不需要手机）：验证 tools/export_cases.py 的校验与体检规则。

为什么要它：这些规则是"表格填错时唯一的护栏" —— 但护栏本身没人验过。
真机上的行为有真机跑兜底，纯逻辑的规则就用这份自检兜底：每条规则都要
**正反两个方向**都验一遍（合规的表不报错；违规的表必须报出预期的那句话）。

用法：python scripts/selftest-export-cases.py
退出码：0 = 全部通过；1 = 有不符合预期的
"""

import os
import re
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


def bad_case(name, rows, want, **kw):
    """反例（**归得到某条用例身上**）：导出照常成功，但那条用例自己带着错误。

    这是 2026/10/12 owner 定的口径：表格里有一条填错，不该废掉整轮测试 ——
    错误归到那条用例，真机跑的时候只有它红。所以这里断言的是"错误挂在用例上"，
    而不是"整张表报错"。
    """
    global passed
    try:
        cases = m.validate(m.read_rows(make(rows, **kw)))
    except m.TableError as e:
        failed.append("%s：本该把错误归到用例身上，却整张表报错 %s" % (name, e.errors))
        return
    msgs = [msg for c in cases for msg in (c.get("errors") or [])]
    if any(want in msg for msg in msgs):
        passed += 1
        print("OK   反例 %s -> %s" % (name, msgs[0][:60]))
        return
    failed.append("%s：用例上没带着「%s」这个错误，实际是 %s" % (name, want, msgs or "（一条错误都没有）"))


def bad_table(name, rows, want, **kw):
    """反例（**归不到用例身上**）：整张表就有问题，必须报错、不导出"""
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

# ---------- 校验反例（填错就归到那条用例身上，导出照常成功）----------
# 注意：这些"填错"都**不会**让整张表报废 —— 真机跑的时候只有那一条红。
bad_case("不认识的动作", [["B_001", "名字", 1, "打开首贝", "", "", ""]], "不认识动作")
bad_case("动作缺参数1", [["B_002", "名字", 1, "打开搜索并输入", "", "", ""]], "参数1")
bad_case("多余参数2", [["B_003", "名字", 1, "回到首页", "", "多填的", ""]], "用不到「参数2」")
bad_case("固定候选项写错", [["B_004", "名字", 1, "切换首页筛选栏", "最新问题", "", ""]], "只能填这 4 个之一")
bad_case("滑动方向写错", [["B_005", "名字", 1, "滑动", "1", "左", ""]], "只能填这 2 个之一")
bad_case("步骤序号重复", [["B_006", "名字", 1, "回到首页", "", "", ""], ["B_006", "", 1, "返回上一页", "", "", ""]], "重复")
bad_case("动作那一格是空的", [["B_007", "名字", 1, "", "", "", ""]], "「动作」是空的")
def mixed(name, rows, good_id, bad_id):
    """**这次改动的核心**：一条填错时，别的用例必须一点不受影响。

    正反两面一起验：
      正面 = 好的那条照样导出、步骤齐全、身上没有任何 errors
      反面 = 坏的那条确实被标出来了（不能悄悄放过）
    """
    global passed
    try:
        cases = m.validate(m.read_rows(make(rows)))
    except m.TableError as e:
        failed.append("%s：一条填错不该让整张表报错，实际报了 %s" % (name, e.errors))
        return
    by_id = {c["id"]: c for c in cases}
    if good_id not in by_id or bad_id not in by_id:
        failed.append("%s：导出的用例不全（%s）" % (name, list(by_id)))
        return
    good, bad = by_id[good_id], by_id[bad_id]
    problems = []
    if good.get("errors"):
        problems.append("好的那条也被标了错：%s" % good["errors"])
    if len(good["steps"]) != 2:
        problems.append("好的那条步骤数变成 %d（期望 2）" % len(good["steps"]))
    if not bad.get("errors"):
        problems.append("坏的那条一个错都没标（会被静默放过）")
    if problems:
        failed.append("%s：%s" % (name, "；".join(problems)))
        return
    passed += 1
    print("OK   正反同验 %s（好的照跑，坏的只红它自己）" % name)


mixed(
    "两条用例，只有一条填错",
    [
        ["B_008", "好的那条", 1, "回到首页", "", "", ""],
        ["B_008", "", 2, "检查文字显示", "积分商城", "", ""],
        ["B_009", "坏的那条", 1, "回到首页", "", "", ""],
        ["B_009", "", 2, "打开首贝", "", "", ""],
    ],
    "B_008",
    "B_009",
)

# ---------- 表格级反例（归不到哪条用例身上，就该整表停下来）----------
bad_table("空表", [], "一行数据都没有")
bad_table(
    "表头被改",
    [["B_010", "名字", 1, "回到首页", "", "", ""]],
    "表头",
    header=["用例编号", "用例名字", "步骤序号", "动作", "参数1", "参数2", "备注"],
)
bad_table("第一行就没编号（上面没得承接）", [["", "名字", 1, "回到首页", "", "", ""]], "「用例编号」是空的")


# ---------- 合并单元格（webzdh 式一案一块）----------
def carry(name, rows, want_cases, want_steps):
    """编号空着的行必须**并进上一条用例**，不能凭空多出一条用例、也不能丢步骤。

    为什么要有这条：表里同一条用例的编号/名称被并成了一格，读出来只有第一行有值。
    这里正反两个方向都验：空编号要能承接；表头下面第一行就不能空（没得承接时得报错）。
    """
    global passed
    try:
        cases = m.validate(m.read_rows(make(rows)))
    except m.TableError as e:
        failed.append("%s：本该通过，却整表报错 %s" % (name, e.errors))
        return
    got = [[c["id"], len(c["steps"])] for c in cases]
    want = [[i, n] for i, n in zip(want_cases, want_steps)]
    if got != want:
        failed.append("%s：解析成 %s，期望 %s" % (name, got, want))
        return
    passed += 1
    print("OK   合并排版 %s -> %s" % (name, got))


carry(
    "编号只写首行，下面两行空着",
    [
        ["D_001", "一案多步", 1, "回到首页", "", "", ""],
        ["", "", 2, "检查文字显示", "积分商城", "", ""],
        ["", "", 3, "回到首页", "", "", ""],
    ],
    ["D_001"],
    [3],
)
carry(
    "两块并排，不串味",
    [
        ["D_002", "前一条", 1, "回到首页", "", "", ""],
        ["", "", 2, "检查文字显示", "积分商城", "", ""],
        ["D_003", "后一条", 1, "回到首页", "", "", ""],
    ],
    ["D_002", "D_003"],
    [2, 1],
)


def actions_sheet_at_top(times):
    """「动作清单」刷 N 次也必须**一直待在第 1 行**，而且下拉框指的那几行不是空的。

    这是 2026/10/13 真踩到的 bug 的反向验证：以前 append 是往 max_row 后面接，
    每刷一次清单就往下挪一截（刷 9 次挪到第 436 行），而下拉框还指着 A2:A48 —— 空行，
    于是下拉框里一个动作都选不出来。
    """
    global passed
    wb = Workbook()
    ws = wb.active
    ws.title = m.SHEET_ACTIONS
    for _ in range(times):
        m.fill_actions_sheet(ws)
    name = "动作清单刷 %d 次仍在表头下方" % times
    if ws.cell(1, 1).value != "动作":
        failed.append("%s：第 1 行是 %r，不是表头（清单被 append 挤下去了）" % (name, ws.cell(1, 1).value))
        return
    got = [ws.cell(r, 1).value for r in range(2, len(m.ACTIONS) + 2)]
    # 顺序必须等于**按用途分组**之后的顺序（表格下拉框读起来像目录，就是靠这一条）
    want = [a["name"] for a in m.ordered_actions()]
    if got != want:
        failed.append("%s：清单内容对不上（%s…）" % (name, got[:3]))
        return
    if ws.cell(len(m.ACTIONS) + 2, 1).value is not None:
        failed.append("%s：清单下面还留着旧内容（第 %d 行）" % (name, len(m.ACTIONS) + 2))
        return
    passed += 1
    print("OK   动作清单刷 %d 次：%d 个动作都在第 2~%d 行" % (times, len(want), len(want) + 1))


actions_sheet_at_top(1)
actions_sheet_at_top(3)
actions_sheet_at_top(9)  # 就是踩坑那次刷的次数


def example_params(action):
    """把「怎么填（示例）」拆成参数1 / 参数2（有两个参数的动作写成 `参数1 / 参数2`）"""
    ex = str(m.ACTION_EXAMPLES.get(action["name"], "")).strip()
    if not action["p1"]:
        return "", ""
    # 用「 / 」（带空格）当分隔符：示例本身可能带括号说明，括号里也可能有斜杠
    parts = [p.strip() for p in ex.split(" / ")] if action["p2"] and " / " in ex else [ex]
    parts = [re.sub(r"（[^）]*）\s*$", "", p).strip() for p in parts]
    return parts[0], (parts[1] if len(parts) > 1 else "")


def examples_are_copyable():
    """**每条示例都必须"照抄就能过校验"** —— 把 49 条示例当成参数填一张表，跑一遍导出校验。

    为什么值得单独验：示例是给人照抄的。示例自己写错（比如填了个不存在的候选值、或该填的参数空着），
    照抄的人会被导出报错挡住 —— 那时他只会觉得"文档骗人"。所以让闸门替他们先抄一遍。
    """
    global passed
    rows = []
    for a in m.ACTIONS:
        p1, p2 = example_params(a)
        rows.append(["EX_%s" % a["name"], "示例校验", 1, a["name"], p1, p2, ""])
    try:
        cases = m.validate(m.read_rows(make(rows)))
    except m.TableError as e:
        failed.append("示例校验：本该通过，整表却报错 %s" % e.errors)
        return
    bad = [(c["id"], c["errors"]) for c in cases if c.get("errors")]
    if bad:
        failed.append("示例校验：这些示例照抄会被报错 %s" % bad[:3])
        return
    if len(cases) != len(m.ACTIONS):
        failed.append("示例校验：用例数 %d 与动作数 %d 对不上" % (len(cases), len(m.ACTIONS)))
        return
    passed += 1
    print("OK   示例校验：%d 个动作的示例照抄都能过导出校验" % len(cases))


examples_are_copyable()


def merge_keeps_content():
    """并格**不能改内容**：并格前后导出来的「用例编号 + 用例名称 + 步骤数」必须一模一样。

    这是 2026/10/13 那条真 bug 的反向验证：一开始把「编号/名称」并成了一整块 A:B，
    而 openpyxl 合并时会把除左上角以外的单元格清空 —— 名字正好在 B 列，被吃掉，
    导出时用例名静默退化成编号（看着"跑通了"，其实用例名没了）。
    """
    global passed
    from openpyxl import load_workbook

    wb = Workbook()
    ws = wb.active
    ws.title = m.SHEET_DATA
    ws.append(m.HEADERS)
    for row in m.SAMPLE_ROWS:
        ws.append(row)
    wb.save(PATH)
    before = [[c["id"], c["name"], len(c["steps"])] for c in m.validate(m.read_rows(PATH))]

    wb = load_workbook(PATH)
    m.merge_case_cells(wb[m.SHEET_DATA])
    wb.save(PATH)
    after = [[c["id"], c["name"], len(c["steps"])] for c in m.validate(m.read_rows(PATH))]

    if before != after:
        failed.append("并格改了内容：并之前 %s，并之后 %s" % (before, after))
        return
    if any(name == cid for cid, name, _n in after):
        failed.append("并格之后有用例名退化成了编号：%s" % after)
        return
    passed += 1
    print("OK   并格不改内容（%d 条用例，名字都还在）" % len(after))


merge_keeps_content()

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
