# -*- coding: UTF-8 -*-
"""从「超云生态平台」导出的工作项 xlsx 生成知识库清单。

【为什么是脚本而不是手抄】
导出的是 CodeArts 工作项（Bug / Story），量上百条，而且会随迭代变化 ——
手抄一遍必然很快过期。脚本生成 + 可重复执行，才不会"看起来有、实际过时"。

用法（解包目录里每个子目录一个 xlsx）：
    python tools/build_requirements_kb.py <导出解包目录>
    例：python tools/build_requirements_kb.py %TEMP%\\req_export

产出（都写到 knowledge/ 下）：
    knowledge/工作项清单.md        全部工作项（**机器生成，勿手改**）
    knowledge/迭代与模块汇总.md    按迭代 / 模块 / 领域 / 类型 / 状态计数（**机器生成**）
控制台另打印一份紧凑汇总，供人工写 `knowledge/小程序功能地图.md`。
"""

import glob
import os
import re
import sys
from collections import Counter, defaultdict

import openpyxl

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB_DIR = os.path.join(REPO, "knowledge")

# 只关心这些列（不同导出的列数不一样，取并集）
FIELDS = [
    "编号", "标题", "类型", "状态", "模块", "领域", "迭代", "发布版本号",
    "优先级", "处理人", "创建人", "创建时间", "结束时间", "更新时间",
    "预计开始日期", "预计结束日期", "实际工时", "故事点", "标签", "发现环境",
    "父工作项标题", "描述",
]


def parse_hyperlink(cell):
    """编号列常常写成 =HYPERLINK("url","显示文本")，拆出 (文本, URL)"""
    s = str(cell or "").strip()
    if s.upper().startswith("=HYPERLINK"):
        quoted = re.findall(r'"([^"]*)"', s)
        url = quoted[0] if quoted else ""
        text = quoted[-1] if len(quoted) > 1 else ""
        # 显示文本本身也是个超链接时，取其中的编号
        m = re.search(r"([A-Z]{2,}-\d+|\d{6,})", text)
        return (m.group(1) if m else text), url
    return s, ""


def norm(s, limit=None):
    t = re.sub(r"\s+", " ", str(s or "")).strip()
    if limit and len(t) > limit:
        t = t[: limit - 1] + "…"
    return t


def load_all(src_dir):
    """读入全部 xlsx，按编号去重（同一编号保留字段更全的那条）"""
    items = {}
    files = sorted(glob.glob(os.path.join(src_dir, "*", "*.xlsx")))
    if not files:
        files = sorted(glob.glob(os.path.join(src_dir, "*.xlsx")))
    for f in files:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        for ws in wb.worksheets:
            rows = ws.iter_rows(values_only=True)
            try:
                header = [str(h).strip() if h else "" for h in next(rows)]
            except StopIteration:
                continue
            for row in rows:
                rec = {}
                for h, v in zip(header, row):
                    if h in FIELDS:
                        rec[h] = v
                raw_id, url = parse_hyperlink(rec.get("编号"))
                rec["编号"] = raw_id
                rec["_url"] = url
                if not rec.get("标题"):
                    continue
                key = raw_id or norm(rec.get("标题"), 40)
                prev = items.get(key)
                # 字段更全的赢（大导出带描述/模块，小导出只有基础列）
                if prev is None or sum(1 for v in rec.values() if v) > sum(1 for v in prev.values() if v):
                    items[key] = rec
        wb.close()
    return items, files


def write_items_md(items):
    os.makedirs(KB_DIR, exist_ok=True)
    out = os.path.join(KB_DIR, "工作项清单.md")
    stories = [r for r in items.values() if norm(r.get("类型")) in ("Story", "需求", "Epic", "Feature")]
    bugs = [r for r in items.values() if r not in stories]
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("# 工作项清单（机器生成，勿手改）\n\n")
        fh.write("> 来源：超云生态平台（CodeArts）导出的工作项 xlsx。\n")
        fh.write("> 重新生成：`python tools/build_requirements_kb.py <导出解包目录>`\n")
        fh.write(f"> 本次共 {len(items)} 条唯一工作项（需求/故事 {len(stories)} 条，其余 {len(bugs)} 条）。\n\n")
        for title, group in (("需求 / 故事", stories), ("缺陷 / 其它", bugs)):
            fh.write(f"## {title}（{len(group)} 条）\n\n")
            fh.write("| 编号 | 类型 | 状态 | 模块 | 标题 | 处理人 | 创建时间 |\n")
            fh.write("|---|---|---|---|---|---|---|\n")
            for r in sorted(group, key=lambda x: norm(x.get("创建时间"))):
                cells = [
                    norm(r.get("编号"), 22),
                    norm(r.get("类型"), 8),
                    norm(r.get("状态"), 8),
                    norm(r.get("模块"), 14),
                    norm(r.get("标题"), 60).replace("|", "/"),
                    norm(r.get("处理人"), 10),
                    norm(r.get("创建时间"), 12),
                ]
                fh.write("| " + " | ".join(cells) + " |\n")
            fh.write("\n")
    return out


def write_summary_md(items):
    out = os.path.join(KB_DIR, "迭代与模块汇总.md")

    def counter_md(title, key, limit=None):
        c = Counter(norm(r.get(key)) or "(空)" for r in items.values())
        lines = [f"### {title}\n", "| 值 | 条数 |", "|---|---|"]
        for k, v in c.most_common(limit):
            lines.append(f"| {k} | {v} |")
        lines.append("")
        return "\n".join(lines), c

    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("# 迭代与模块汇总（机器生成，勿手改）\n\n")
        fh.write("> 重新生成：`python tools/build_requirements_kb.py <导出解包目录>`\n\n")
        for title, key in (("按迭代", "迭代"), ("按模块", "模块"), ("按领域", "领域"),
                           ("按类型", "类型"), ("按状态", "状态"), ("按发布版本", "发布版本号")):
            md, _ = counter_md(title, key)
            fh.write(md + "\n")
    return out


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    src = argv[0]
    if not os.path.isdir(src):
        print(f"目录不存在：{src}")
        return 2

    items, files = load_all(src)
    print(f"读入 {len(files)} 个导出文件，去重后 {len(items)} 条工作项")
    if not items:
        return 1

    p1 = write_items_md(items)
    p2 = write_summary_md(items)
    print("已生成：", os.path.relpath(p1, REPO), "/", os.path.relpath(p2, REPO))

    print("\n=== 紧凑汇总（供人工写功能地图）===")
    for key in ("类型", "状态", "模块", "领域", "迭代", "发布版本号"):
        c = Counter(norm(r.get(key)) or "(空)" for r in items.values())
        if len(c) == 1 and "(空)" in c:
            continue
        print(f"  [{key}] " + "，".join(f"{k}:{v}" for k, v in c.most_common(12)))

    print("\n=== 需求/故事标题（理解功能用）===")
    stories = [r for r in items.values() if norm(r.get("类型")) in ("Story", "需求", "Epic", "Feature")]
    for r in sorted(stories, key=lambda x: norm(x.get("创建时间"))):
        print(f"  - {norm(r.get('标题'), 70)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
