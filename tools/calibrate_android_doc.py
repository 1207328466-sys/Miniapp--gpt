# -*- coding: utf-8 -*-
"""校准 docs/android-js-逐行详解.md 里的行号引用（只改文档，不改代码）。

为什么需要它：那份「逐行详解」里到处都是「（384-418 行）」这种引用。android.js 一改，
这些数字就全错 —— 而人眼很难发现（文档照样读得通，只是把人带到错误的行）。
10/10 手改过一次，10/12 又发现烂了（文档说 700 行，实际 939 行）。所以做成可重跑的工具：

    python tools/calibrate_android_doc.py           # 按当前 android.js 重写文档里的行号
    python tools/calibrate_android_doc.py --check   # 只检查，有漂移就退出码 1

（注意：本文件源码里刻意用 \\u 转义写中文，纯 ASCII 源码 —— 免得经过管道/终端时被转成 ?）
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app_sub_function" / "suprecast_app" / "android.js"
DOC = ROOT / "docs" / "android-js-\u9010\u884c\u8be6\u89e3.md"

LP, RP, ROW_CHAR = "\uff08", "\uff09", "\u884c"  # （  ）  行
# 「（123-456 行）」 以及「（123-456 行：`funcName`）」——「行」后面允许再跟一段说明，
# 否则带函数名的小节标题会被正则漏掉 -> 检查器给出**假绿**（真实踩到过）。
# 第 3 个捕获组 = 「行」后面那段说明（例如「：`funcName`」）——**要原样保留**，
# 否则一次写回就会把小节标题里的函数名删掉（真实踩到过）。
RANGE = re.compile(LP + "(\\d+)-(\\d+) " + ROW_CHAR + "([^" + RP + "]*)" + RP)
# 表格首列行号：| 29 | `getDevice` | ...   或   | **57** | **`xxx`** | ...
TABLE_ROW = re.compile("^\\| \\*{0,2}(\\d+)\\*{0,2} \\| (.*?) \\|")


def function_ranges():
    """android.js 里每个顶层函数 / 导出块的起止行（1 基）"""
    lines = JS.read_text(encoding="utf-8").splitlines()
    starts = []
    for i, l in enumerate(lines, 1):
        m = re.match("^(?:async )?function (\\w+)", l)
        if m:
            starts.append((m.group(1), i))
        elif l.startswith("module.exports"):
            starts.append(("module.exports", i))
    out = {}
    for idx, (name, start) in enumerate(starts):
        end = starts[idx + 1][1] - 1 if idx + 1 < len(starts) else len(lines)
        out[name] = (start, end)
    return out, len(lines)


def names_in(text):
    """这一行里出现的反引号名字（去掉 ** 之类装饰）"""
    return [n.strip().strip("*").strip() for n in re.findall("`([^`]+)`", text)]


def main(argv=None):
    ap = argparse.ArgumentParser(description="calibrate line refs in the android.js walkthrough doc")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)

    funcs, total = function_ranges()
    lines = DOC.read_text(encoding="utf-8").splitlines()
    changes, unknown, out = [], [], []
    in_line_table = False  # 只在「| 行号 | 函数 | ...」这两张表里改首列行号

    for lineno, line in enumerate(lines, 1):
        new = line

        s = line.lstrip("> ").strip()
        if s.startswith("| \u884c\u53f7 | \u51fd\u6570 |"):
            in_line_table = True
        elif in_line_table and not s.startswith("|"):
            in_line_table = False
        handled = False  # 这一行是否已经被"没有函数名的小节"那条规则处理掉

        # 1) 「（a-b 行）」：按同一行里提到的函数名换成真实起止
        for m in RANGE.finditer(line):
            cand = [n for n in names_in(line) if n in funcs]
            if cand:
                # 一个小节可能覆盖多个函数（例如「真实 adb 点击」= findClickableAncestor + tapElement）
                start = min(funcs[n][0] for n in cand)
                end = max(funcs[n][1] for n in cand)
                if (m.group(1), m.group(2)) != (str(start), str(end)):
                    changes.append("doc %4d: %s-%s -> %s-%s (%s)" % (lineno, m.group(1), m.group(2), start, end, "+".join(cand)))
                    keep = m.group(3)
                    new = new.replace(m.group(0), LP + "%d-%d " % (start, end) + ROW_CHAR + keep + RP)
            else:
                if not handled:
                    unknown.append("doc %4d: %s (names=%s)" % (lineno, m.group(0), cand or "-"))

        # 2) 没有函数名的小节（例如文件头）：改成 1 到第一个函数之前
        if "\u6587\u4ef6\u5934" in line and RANGE.search(new) and not [n for n in names_in(line) if n in funcs]:
            first = min(v[0] for v in funcs.values())
            want = LP + "1-%d " % (first - 1) + ROW_CHAR + RP
            if RANGE.search(new).group(0) != want:
                new = RANGE.sub(want, new)
                changes.append("doc %4d: header section -> 1-%d" % (lineno, first - 1))
            handled = True

        # 3) 表格首列的行号 —— 只动「| 行号 | 函数 | ...」这两张表里的行，
        #    不然会把「问题清单」那种表的编号（7、9、14…）当成行号改掉。
        tm = TABLE_ROW.match(s)  # 注意用去掉引用符号后的 s —— 顶部那张表在 > 引用块里
        if tm and in_line_table:
            cand = [n for n in names_in(s) if n in funcs]
            if len(cand) == 1:
                start = funcs[cand[0]][0]
                if int(tm.group(1)) != start:
                    old = tm.group(1)
                    new = new.replace("| %s |" % old, "| %d |" % start, 1)
                    if new == line:
                        new = new.replace("| **%s** |" % old, "| **%d** |" % start, 1)
                    changes.append("doc %4d: table %s -> %d (%s)" % (lineno, old, start, cand[0]))

        out.append(new)

    print("android.js total lines: %d | functions/exports: %d" % (total, len(funcs)))
    if changes:
        print("\n%d place(s) to fix:" % len(changes))
        for c in changes:
            print("  " + c)
    else:
        print("\nall line references are consistent.")
    if unknown:
        print("\n%d place(s) cannot be judged automatically (likely describing old code):" % len(unknown))
        for u in unknown:
            print("  " + u)

    if args.check:
        return 1 if changes else 0
    if changes:
        # newline="\n"：仓库的 .gitattributes 把换行锁定成 LF。不加这句，
        # Windows 上会把 \n 变 \r\n，于是这个"被生成的文件"在 git 里永远显示为已修改
        #（export_cases.py 踩过同一个坑）。
        DOC.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
        print("\nwritten back: %s" % DOC.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
