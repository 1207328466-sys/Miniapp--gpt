# -*- coding: utf-8 -*-
"""覆盖对账（**只读、离线**）：已关闭的小程序需求里，**哪些还没有被任何用例引用**？

【为什么要有它】"下一步写哪条用例"以前靠翻 `knowledge/可自动化需求清单.md`（手写的，
2026/10/12 之后就没再更）—— 手写清单会过期，而"哪条被引用过"其实是**可以算出来的事实**。

【口径】
  · 候选 = `knowledge/工作项清单.md` 里 **Story + 状态「已关闭」 + 标题以「小程序」开头**；
    （后台/中台类的先不算 —— 那不是真机 UI 用例能覆盖的东西）
  · **被引用** = 这个编号出现在**用例本身**（`cases/用例表.json`、`test_case/**`）
    或两份"对账类"文档（`knowledge/缺陷回归清单.md`、`knowledge/可自动化需求清单.md`）里。
  ⚠️ **不能**扫 `knowledge/需求描述汇编.md` / `工作项清单.md`：那两份里**每个编号都出现**（台账本身），
    扫了就等于"全都覆盖了"（第一版就是这么得出"0 条未覆盖"的假结论）。

【注意】"没被引用"≠"该写用例"：里面很多属于"要写数据 / 系统 UI / 纯样式"（见
`knowledge/可自动化需求清单.md` 第四节）。这个脚本只负责**把没碰过的列出来**，挑哪条仍然由人决定。

用法:
    python tools/coverage_report.py            # 列出没被引用的（前面是摘要）
    python tools/coverage_report.py --md       # 输出 markdown 表格（方便贴进文档）
    python tools/coverage_report.py --all      # 连"被引用过的"也列出来
退出码：0 正常；1 读不到清单
"""

import argparse
import io
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIST = ROOT / "knowledge" / "工作项清单.md"

# 扫哪些地方算"这条被用过"（见文件头 ⚠️ 那段：台账本身不算）
SCAN_DIRS = ["test_case"]
SCAN_FILES = [
    ROOT / "cases" / "用例表.json",
    ROOT / "knowledge" / "缺陷回归清单.md",
    ROOT / "knowledge" / "可自动化需求清单.md",
    ROOT / "knowledge" / "小程序功能地图.md",
]
ID_RE = re.compile(r"\b(71\d{7})\b")


def parse_list(path=LIST):
    """从工作项清单里读出 Story 行 —— **纯函数**（离线自检可用）。"""
    rows = []
    for line in io.open(path, encoding="utf-8"):
        m = re.match(
            r"^\|\s*(\d{6,})\s*\|\s*Story\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]+?)\s*\|", line
        )
        if m:
            rows.append(
                {
                    "id": m.group(1),
                    "status": m.group(2).strip(),
                    "module": m.group(3).strip(),
                    "title": m.group(4).strip(),
                }
            )
    return rows


def referenced_ids():
    """用例与两份对账文档里出现过的编号集合。"""
    seen = set()
    paths = list(SCAN_FILES)
    for sub in SCAN_DIRS:
        for root, dirs, files in os.walk(ROOT / sub):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            paths += [Path(root) / f for f in files if f.endswith((".js", ".py"))]
    for p in paths:
        try:
            text = io.open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        seen.update(ID_RE.findall(text))
    return seen


def split_covered(rows, seen, only_closed_mini=True):
    """-> (covered, uncovered)；口径见文件头。**纯函数**（不碰文件系统）。"""
    cand = [
        r
        for r in rows
        if (not only_closed_mini or (r["status"] == "已关闭" and r["title"].startswith("小程序")))
    ]
    covered = [r for r in cand if r["id"] in seen]
    uncovered = [r for r in cand if r["id"] not in seen]
    return covered, uncovered


def render(items, md=False):
    """把一批需求渲染成给人看的文本（markdown 表格或缩进列表）。**纯函数**。"""
    lines = []
    if md:
        lines += ["| 需求编号 | 标题 |", "|---|---|"]
    for r in items:
        lines.append("| %s | %s |" % (r["id"], r["title"]) if md else "   %s  %s" % (r["id"], r["title"][:64]))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="覆盖对账（只读）")
    ap.add_argument("--md", action="store_true", help="输出 markdown 表格")
    ap.add_argument("--all", action="store_true", help="连被引用过的也列出来")
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    if not LIST.exists():
        print("读不到 %s" % LIST)
        return 1
    rows = parse_list()
    seen = referenced_ids()
    covered, uncovered = split_covered(rows, seen)

    print("工作项清单里 Story：%d 条" % len(rows))
    print("已关闭 + 标题以「小程序」开头：%d 条" % (len(covered) + len(uncovered)))
    print("其中**被用例/清单引用过**的：%d 条" % len(covered))
    print("其中**还没被引用**的：%d 条\n" % len(uncovered))
    print("== 还没被引用（%d 条）==" % len(uncovered))
    print(render(uncovered, md=a.md))
    print()
    if a.all:
        print("== 已经引用过（%d 条）==" % len(covered))
        print(render(covered, md=a.md))
    return 0


if __name__ == "__main__":
    sys.exit(main())
