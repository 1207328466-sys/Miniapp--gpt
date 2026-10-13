# -*- coding: utf-8 -*-
"""文档索引不许漂移（**离线**，不需要手机）。

为什么要有它：这一轮给几份长文档加了「目录」、给踩坑记录加了「按症状查」的索引表，
还建了 `docs/README.md` 文档地图。**索引这种东西，一旦和正文对不上，比没有更坏** ——
读者按索引去找，找到的是别人说的东西，不是文档说的东西（本仓最忌讳的"报告说谎"同源）。

它查三类：
  1. 长文档的「## 目录」条目，必须与正文的 `## ` 小节**一模一样**（顺序也一致）；
  2. `docs/踩坑记录.md` 的索引表里的坑号，必须与正文 `## 坑 N` 标题的坑号集合一致
     （漏一条、编号写错都会报红）；
  3. `docs/` 下的每份文档都得登记在 `docs/README.md`（新加了文档不登记 -> 报红）。

用法：python scripts/check-doc-index.py
退出码：0 = 全部一致；1 = 有漂移（逐条列出）
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(REPO, "docs")

# 有目录的长文档（短文档不加目录，见"三条读文档的约定"）
WITH_TOC = [
    "README.md",
    "docs/使用手册-零基础.md",
    "docs/交接文档.md",
    "docs/框架导读.md",
    "docs/框架能力与问题账本.md",
    "docs/android-js-逐行详解.md",
    "docs/零基础-框架全景与维护手册.md",
]

failures = []
passed = 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("OK   %s" % name)
    else:
        failures.append("%s（%s）" % (name, detail))
        print("FAIL %s（%s）" % (name, detail))


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as f:
        return f.read()


# ---------- 1) 长文档：目录条目 == 正文小节 ----------
for rel in WITH_TOC:
    text = read(rel)
    lines = text.splitlines()
    toc_start = next((i for i, l in enumerate(lines) if l.strip() == "## 目录"), None)
    if toc_start is None:
        check("%s 有目录" % rel, False, "找不到「## 目录」小节")
        continue

    # 目录条目 = 从「## 目录」往下、直到下一个 "## " 之间的 "- xxx" 行
    toc_items = []
    i = toc_start + 1
    while i < len(lines) and not lines[i].startswith("## "):
        m = re.match(r"^- (.+?)\s*$", lines[i])
        if m:
            toc_items.append(m.group(1))
        i += 1

    # 正文小节 = 除「## 目录」以外的所有 "## "
    body = [l.strip()[3:].strip() for l in lines if l.startswith("## ") and l.strip() != "## 目录"]

    missing = [h for h in body if h not in toc_items]
    extra = [h for h in toc_items if h not in body]
    order_ok = [h for h in toc_items if h in body] == [h for h in body if h in toc_items]
    check(
        "%s 目录与正文一致（%d 条）" % (rel, len(body)),
        not missing and not extra and order_ok,
        "目录里缺：%s；目录里多：%s；顺序：%s"
        % ("、".join(missing[:3]) or "无", "、".join(extra[:3]) or "无", "一致" if order_ok else "不一致"),
    )

# ---------- 2) 踩坑记录：索引表坑号 == 正文坑号 ----------
pit = read("docs/踩坑记录.md")
body_pits = sorted(int(n) for n in re.findall(r"(?m)^## 坑 (\d+)：", pit))
index_section = pit.split("## 索引", 1)[1].split("\n## 坑 1：", 1)[0] if "## 索引" in pit else ""
index_pits = sorted(int(n) for n in re.findall(r"(?m)^\| (\d+) \|", index_section))
check(
    "踩坑记录：索引表与正文坑号一致（正文 %d 条，索引 %d 条）" % (len(body_pits), len(index_pits)),
    body_pits == index_pits,
    "正文有索引没有：%s；索引有正文没有：%s"
    % (sorted(set(body_pits) - set(index_pits)) or "无", sorted(set(index_pits) - set(body_pits)) or "无"),
)

# ---------- 3) docs/ 下的文档都得登记在文档地图里 ----------
map_text = read("docs/README.md")
unregistered = []
for name in sorted(os.listdir(DOCS)):
    if not name.endswith(".md") or name == "README.md":
        continue
    if name not in map_text:
        unregistered.append(name)
check(
    "docs/ 下的文档都登记在文档地图里",
    not unregistered,
    "没登记：%s（在 docs/README.md 的表里加一行）" % "、".join(unregistered),
)

print()
if failures:
    print("有 %d 项不一致：" % len(failures))
    for f in failures:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
