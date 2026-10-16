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
    {"id": 712880447, "tracker": "Story", "subject": "小程序-压铸百科", "status": "已关闭",
     "assigned": "俞振豪", "updated_str": "2025-06-19 10:00"},
    {"id": 713594979, "tracker": "Story", "subject": " 小程序-有问必答首页增加活动入口 ", "status": "已关闭",
     "assigned": "詹鑫泽", "updated_str": "2026-10-13 16:25"},
    {"id": "999999999", "tracker": "Story", "subject": "新来的需求", "status": "新建", "assigned": "", "updated_str": "2026-10-14"},
])
check("整理拉取结果：id 统一成字符串、字段都取到",
      pulled["713594979"]["status"] == "已关闭" and pulled["713594979"]["title"].startswith("小程序")
      and "999999999" in pulled,
      str(pulled))

# ---------- 对账 ----------
added, gone, changed, first_time = p.diff(kb, pulled)
check("对账：这次没有「首次纳入的类型」（两边都是 Story）", first_time == {}, str(first_time))
# diff 现在返回 4 个（第 4 个是「首次纳入的类型」）
check("对账：新增只有 999999999", added == ["999999999"], str(added))
check("对账：消失为空（知识库两条都在拉取结果里）", gone == [], str(gone))
check("对账：状态变化算成变化、不算新增/消失",
      changed == [("713594979", "新建", "已关闭")], str(changed))

# ---------- 反例：把"消失"造出来 ----------
kb2 = dict(kb)
kb2["700000000"] = {"tracker": "Story", "status": "已关闭", "title": "知识库里有、拉取没有"}
added2, gone2, changed2, _ft2 = p.diff(kb2, pulled)
check("对账（反例）：知识库有、拉取没有 -> 算「消失」", gone2 == ["700000000"], str(gone2))
check("对账（反例）：消失不会同时算成新增", "700000000" not in added2, str(added2))

# ---------- 反例：状态一边为空时不硬算变化 ----------
pulled3 = {"713594979": {"tracker": "Story", "title": "x", "status": "", "assigned": "", "updated": ""}}
_a, _g, changed3, _ft3 = p.diff({"713594979": kb["713594979"]}, pulled3)
check("对账（反例）：状态读到空值时不算「状态变化」", changed3 == [], str(changed3))

# ---------- 报告：零差异时必须写「零差异」，不能只给一张空表 ----------
rep = p.render_report(pulled, pulled, [], [], [], {"time": "t", "project_name": "P", "project_id": "id"})
check("报告：零差异时写明「零差异」", "零差异" in rep, rep[:80])
rep2 = p.render_report(pulled, kb, added, gone, changed, {"time": "t", "project_name": "P", "project_id": "id"}, first_time)
check("报告：有变化时三段标题都在", "新增" in rep2 and "状态变化" in rep2 and "消失" in rep2, "")
check("报告：把新增那条的标题写进去（不是只写 id）", "新来的需求" in rep2, "")

# ---------- 首次纳入的类型（2026/10/14：把缺陷也拉进知识库时加的）----------
kb_story_only = {"713594979": {"tracker": "Story", "status": "已关闭", "title": "老需求"}}
pulled_mixed = {
    "713594979": {"tracker": "Story", "status": "已关闭", "title": "老需求", "assigned": "", "updated": ""},
    "712977285": {"tracker": "Bug", "status": "已关闭", "title": "老缺陷", "assigned": "", "updated": ""},
    "713999999": {"tracker": "Story", "status": "新建", "title": "真·新需求", "assigned": "", "updated": ""},
}
_a3, _g3, _c3, ft3 = p.diff(kb_story_only, pulled_mixed)
check("对账：首次拉缺陷不算「新增」（否则会像一夜冒出来 545 条）", _a3 == ["713999999"], str(_a3))
check("对账：首次纳入的类型单独报出来", ft3 == {"Bug": 1}, str(ft3))

# ---------- 描述正文：HTML -> 人能读的一段字（2026/10/14 加了"从 API 拉详情重建知识库"）----------
h = p.html_to_text(
    '<p>第一段 <b>加粗</b></p><p>第二段</p><img src="/v2/upload/x.png" height="10">'
    '<p>带实体 &amp; &lt;尖括号&gt; &nbsp;结尾</p>'
)
check("HTML 转文本：标签都去掉了", "<p>" not in h and "<b>" not in h, h)
check("HTML 转文本：图片变成 [图]（保留「这里有张图」的信息）",
      "[图]" in h, h)
check("HTML 转文本：实体还原（&amp; -> &）", "& <尖括号>" in h, h)
check("HTML 转文本：空白压成一个空格、不留多余空行", "  " not in h and "\n" not in h, repr(h))
check("HTML 转文本：空输入不炸", p.html_to_text(None) == "", repr(p.html_to_text(None)))

# ---------- 列表 + 详情 -> 知识库生成器要的字段 ----------
issues = [{"id": 713594985, "subject": "列表里的标题", "status": "新建", "assigned": "列表里的处理人",
           "updated_str": "2026-10-10 10:00"}]
details = {"713594985": {
    "id": 713594985, "name": "详情里的标题", "description": "<p>需求正文</p>",
    "tracker": {"name": "Story"}, "status": {"name": "已关闭"}, "priority": {"name": "高"},
    "module": {"name": "有问必答"}, "domain": {"name": "小程序"}, "iteration": {"name": "Sprint11"},
    "assigned_user": {"nick_name": "詹鑫泽"}, "creator": {"nick_name": "孙亭亭"},
    "created_time": "2026-09-08 10:00", "updated_time": "2026-10-13 16:25",
}}
items = p.to_kb_items(issues, details)
one = items["713594985"]
check("映射：编号/标题用详情里的（详情更准）", one["编号"] == "713594985" and one["标题"] == "详情里的标题", str(one))
check("映射：状态/类型/优先级/模块/迭代/领域都取到了",
      (one["状态"], one["类型"], one["优先级"], one["模块"], one["迭代"], one["领域"])
      == ("已关闭", "Story", "高", "有问必答", "Sprint11", "小程序"), str(one))
check("映射：处理人取别名字段、创建时间取详情", one["处理人"] == "詹鑫泽" and one["创建时间"] == "2026-09-08 10:00", str(one))
check("映射：描述已被压成一段纯文本", one["描述"] == "需求正文", str(one))

# 详情缺失时（网络失败/新拉到的还没缓存）不能崩，要退回列表里的字段
items2 = p.to_kb_items(issues, {})
t2 = items2["713594985"]
check("映射（反例）：没有详情时退回列表字段，不报错",
      t2["标题"] == "列表里的标题" and t2["状态"] == "新建" and t2["描述"] == "", str(t2))

# ---- 重建知识库的闸门（2026/10/16 补）----
# 为什么盯这条：`--kb` 是**用本次拉取的结果重建知识库**，而 `--days 3` 只回 21 条 ——
# 两个一配，247 条的知识库会被静默换成 21 条（输出还写着"知识库已重建"，看着挺成功）。
# 这种"越用越少"的错最难发现，所以正反两边都钉住。
ok_full, why_full = p.decide_kb_rebuild(False)
check("闸门：全量拉取 + --kb 放行", ok_full is True and why_full == "", str((ok_full, why_full)))
ok_partial, why_partial = p.decide_kb_rebuild(True)
check("闸门：局部拉取 + --kb 拒绝", ok_partial is False, str(ok_partial))
check("闸门：拒绝时给出人话原因（提到 --days/--force-partial-kb）",
      ("--days" in why_partial) and ("--force-partial-kb" in why_partial), why_partial[:80])
ok_force, _ = p.decide_kb_rebuild(True, force=True)
check("闸门：显式 --force-partial-kb 才放行", ok_force is True, str(ok_force))

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
