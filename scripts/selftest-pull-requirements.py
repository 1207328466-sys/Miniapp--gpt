# -*- coding: utf-8 -*-
"""需求拉取对账的自检（**离线**，不联网、不调 oacli）。

为什么要有它：`tools/pull_requirements.py` 里有三处"纯逻辑"——解析知识库清单、整理拉取结果、对账。
它们决定"新增/消失/状态变化"这三行结论对不对，而这三行是给人看的**结论**：
错了就是"报告说谎"（比如把状态变化算成新增，或者把消失漏掉）。
真机/联网那部分没法离线测，这三处可以，就钉住它们。

用法：python scripts/selftest-pull-requirements.py
退出码：0 = 全部符合预期；1 = 有不符合
"""

import os
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

import pull_requirements as p  # noqa: E402

failed = []
passed = 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("OK   %s" % name)
    else:
        failed.append("%s（%s）" % (name, detail))
        print("FAIL %s（%s）" % (name, detail))


# ---------- 解析知识库清单 ----------
md = """# 清单

| id | 类型 | 状态 |  | 标题 | 处理人 | 日期 |
|---|---|---|---|---|---|---|
| 712880447 | Story | 已关闭 |  | 小程序-压铸百科 | 俞振豪 | 2025/06/19 |
| 713594979 | Story | 新建 |  | 小程序-有问必答首页增加活动入口 | 詹鑫泽 | 2026/10/10 |
"""
tmp = tempfile.mkdtemp(prefix="uitest_pullreq_")
kb_path = os.path.join(tmp, "清单.md")
with open(kb_path, "w", encoding="utf-8") as fh:
    fh.write(md)
kb = p.parse_kb(kb_path)
check("解析知识库清单：读到 2 条", len(kb) == 2, "读到 %d 条" % len(kb))
check("解析知识库清单：状态与标题对得上",
      kb.get("713594979", {}).get("status") == "新建"
      and kb["712880447"]["title"] == "小程序-压铸百科",
      str(kb))
check("解析知识库清单：表头那行不会被当成数据", "id" not in kb, str(list(kb)))

# ---------- 整理拉取结果 ----------
pulled = p.summarize([
    {"id": 712880447, "subject": "小程序-压铸百科", "status": "已关闭",
     "assigned": "俞振豪", "updated_str": "2025-06-19 10:00"},
    {"id": 713594979, "subject": " 小程序-有问必答首页增加活动入口 ", "status": "已关闭",
     "assigned": "詹鑫泽", "updated_str": "2026-10-13 16:25"},
    {"id": "999999999", "subject": "新来的需求", "status": "新建", "assigned": "", "updated_str": "2026-10-14"},
])
check("整理拉取结果：id 统一成字符串、字段都取到",
      pulled["713594979"]["status"] == "已关闭" and pulled["713594979"]["title"].startswith("小程序")
      and "999999999" in pulled,
      str(pulled))

# ---------- 对账 ----------
added, gone, changed = p.diff(kb, pulled)
check("对账：新增只有 999999999", added == ["999999999"], str(added))
check("对账：消失为空（知识库两条都在拉取结果里）", gone == [], str(gone))
check("对账：状态变化算成变化、不算新增/消失",
      changed == [("713594979", "新建", "已关闭")], str(changed))

# ---------- 反例：把"消失"造出来 ----------
kb2 = dict(kb)
kb2["700000000"] = {"tracker": "Story", "status": "已关闭", "title": "知识库里有、拉取没有"}
added2, gone2, changed2 = p.diff(kb2, pulled)
check("对账（反例）：知识库有、拉取没有 -> 算「消失」", gone2 == ["700000000"], str(gone2))
check("对账（反例）：消失不会同时算成新增", "700000000" not in added2, str(added2))

# ---------- 反例：状态一边为空时不硬算变化 ----------
pulled3 = {"713594979": {"title": "x", "status": "", "assigned": "", "updated": ""}}
_a, _g, changed3 = p.diff({"713594979": kb["713594979"]}, pulled3)
check("对账（反例）：状态读到空值时不算「状态变化」", changed3 == [], str(changed3))

# ---------- 报告：零差异时必须写「零差异」，不能只给一张空表 ----------
rep = p.render_report(pulled, pulled, [], [], [], {"time": "t", "project_name": "P", "project_id": "id"})
check("报告：零差异时写明「零差异」", "零差异" in rep, rep[:80])
rep2 = p.render_report(pulled, kb, added, gone, changed, {"time": "t", "project_name": "P", "project_id": "id"})
check("报告：有变化时三段标题都在", "新增" in rep2 and "状态变化" in rep2 and "消失" in rep2, "")
check("报告：把新增那条的标题写进去（不是只写 id）", "新来的需求" in rep2, "")

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
