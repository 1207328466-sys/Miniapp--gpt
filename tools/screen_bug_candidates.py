# -*- coding: utf-8 -*-
"""从拉下来的**缺陷**里筛「值得自动化回归、而且不复杂」的候选。

【它解决什么问题】
`knowledge/工作项清单.md` 里躺着 545 条缺陷（大多是以前修好的）。一条条人肉翻不现实，
但"全都要自动化"也不对：绝大多数缺陷是后台/接口/写数据/纯样式/依赖脏数据，
用真机 UI 断言去测它们只会得到一条永远红的（或永远绿却毫无意义的）用例。

所以这个脚本只做**粗筛**：按标题里的关键词，把明显不适合的剔掉，剩下的打成一张清单，
再**由人**从清单里挑（挑完的结论写在 `knowledge/缺陷回归清单.md`）。
它刻意不猜、不自动写用例 —— 断言必须来自需求/缺陷原文和真机实测（本项目铁律）。

【筛选规则】（改规则就改这里，别去改文档里的那份说明）
  1. 先剔：标题里带这些词的不要 —— 后台/中台/管理端/接口/同步/算法/模型/仿真/性能/
     导入/导出/埋点/推送/短信/权限/登录/部署/编译/打包/日志/并发/崩溃/闪退/内存/统计/
     报表/订单/发货/支付/退款/服务器/数据库 …（这些要么不是客户端、要么没法用 UI 断言）
  2. 再留：标题里得带"看得见的东西"—— 页面/按钮/显示/点击/弹窗/跳转/列表/文案/图标/
     输入/评论/搜索/积分/滚动/遮挡/错位/返回/标题/图片…（说明这条缺陷落在界面上）
  3. 状态只留**已关闭 / 已解决**（修好了，才谈"回归"；新建的还没上线，写了也只能永远跳过）

【用法】
    python tools/screen_bug_candidates.py                 # 打印候选（按模块词分组）
    python tools/screen_bug_candidates.py --out <文件>     # 同时写一份清单到文件
    python tools/screen_bug_candidates.py --selftest       # 只跑内置的正反例（离线，不读数据）
退出码：0 正常；1 数据文件不存在；2 --selftest 有不符合预期的
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "report" / "需求拉取" / "详情缓存.json"

# ---------- 规则 1：先剔（不是客户端 / 没法用 UI 断言）----------
EXCLUDE_WORDS = (
    "后台", "中台", "管理", "接口", "同步", "算法", "模型",
    "性能", "导入", "导出", "埋点", "推送", "短信", "权限", "部署", "编译",
    "打包", "日志", "并发", "崩溃", "闪退", "内存", "统计", "报表", "订单",
    "发货", "支付", "退款", "服务器", "数据库", "字段", "sql", "SQL",
)

# ---------- 规则 2：再留（缺陷落在界面上）----------
UI_WORDS = (
    "页面", "按钮", "显示", "不显示", "未显示", "点击", "无法", "弹窗", "跳转",
    "列表", "首页", "文案", "图标", "输入", "置灰", "草稿", "评论", "搜索",
    "积分", "换行", "滚动", "尺寸", "样式", "遮挡", "错位", "重复", "空白",
    "刷新", "返回", "标题", "图片", "头像", "间距", "布局", "字体", "颜色",
    "占位", "提示", "下拉", "切换", "展开", "折叠", "排序", "tab", "Tab",
    "位置", "页签", "导航", "banner", "弹层", "遮罩", "缺失", "错乱", "截断",
    "溢出", "对齐", "标签",
)

OPEN_STATUS = ("已关闭", "已解决")


def norm_name(item):
    """取可读的名字：字段可能是字符串，也可能是 {name: ...} 这种对象。"""
    v = item
    if isinstance(v, dict):
        v = v.get("name")
    return "" if v is None else str(v)


def is_candidate(name, status):
    """粗筛的核心规则（**纯函数**：--selftest 就是照它验的正反例）"""
    name = str(name or "")
    if not name:
        return False
    if status and status not in OPEN_STATUS:
        return False
    if any(w in name for w in EXCLUDE_WORDS):
        return False
    return any(w in name for w in UI_WORDS)


def load_bugs(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    bugs = []
    for v in data.values():
        if norm_name(v.get("tracker")) != "Bug":
            continue
        bugs.append(
            {
                "id": str(v.get("id")),
                "name": v.get("name") or "",
                "status": norm_name(v.get("status")),
                "priority": norm_name(v.get("priority")),
                "severity": norm_name(v.get("severity")),
            }
        )
    return bugs


def selftest():
    """正反例各来几条：规则改动时先跑它（不读数据、不联网）"""
    cases = [
        ("有问必答中，精选回答tab应该为精选问答", "已关闭", True),
        ("帖子详情页，评论按钮点击无响应", "已关闭", True),
        ("当用户为普通用户时，搜索结果、个人中心应该不显示普通用户的标签", "已关闭", True),
        # 客户端、但要不要自动化是**第二步**的判断（这条依赖"我的课程里得有下架课程")
        ("个人中心-我的课程，已删除和已屏蔽的课程应有相应提示", "已关闭", True),
        # 已知误差（故意留着）："未返回"里的「返回」被当成了界面词 ——
        # 粗筛宁滥勿缺，多出来的由人复筛时剔掉（这条其实是接口问题）
        ("用户表中获赞和收藏数未返回", "已解决", True),
        # 反例：管理后台（不是小程序客户端）
        ("banner管理-新增完banner后弹窗不会及时清空", "已关闭", False),
        ("课程管理的学习进度弹窗中未返回用户 Id", "已关闭", False),
        # 反例：还没修好（写了只能永远跳过）
        ("IOS端，小程序点击右上角按钮，页面收缩", "新建", False),
        ("搜索用户搜不到自己", "已拒绝", False),
        # 反例：一个界面词都没有（写不出 UI 断言）
        ("帖子被点赞，记录的应该为帖子id", "已关闭", False),
        ("", "已关闭", False),
    ]
    bad = 0
    for name, status, want in cases:
        got = is_candidate(name, status)
        mark = "OK  " if got == want else "FAIL"
        if got != want:
            bad += 1
        print("%s %s（期望 %s，实际 %s）" % (mark, name[:44] or "(空标题)", want, got))
    print()
    if bad:
        print("有 %d 条不符合预期" % bad)
        return 2
    print("全部通过（%d 条正反例）" % len(cases))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="从缺陷里粗筛「值得自动化回归」的候选")
    ap.add_argument("--cache", default=str(CACHE), help="详情缓存路径")
    ap.add_argument("--out", default="", help="把清单写一份到这个文件（默认只打印）")
    ap.add_argument("--selftest", action="store_true", help="只跑内置正反例")
    args = ap.parse_args(argv)

    if args.selftest:
        return selftest()

    if not Path(args.cache).exists():
        print("找不到缺陷数据：%s" % args.cache)
        print("  先拉一次：python tools/pull_requirements.py --tracker story,bug --details --kb")
        return 1

    bugs = load_bugs(args.cache)
    cands = [b for b in bugs if is_candidate(b["name"], b["status"])]
    lines = ["# 缺陷候选（粗筛结果，未人工挑选）", ""]
    lines.append("数据源：%s（缺陷共 %d 条，粗筛出 %d 条）" % (Path(args.cache).name, len(bugs), len(cands)))
    lines.append("")
    for b in cands:
        lines.append("| %s | %s | %s | %s |" % (b["id"], b["name"], b["status"], b["priority"]))
    text = "\n".join(lines) + "\n"
    print("缺陷 %d 条 -> 粗筛候选 %d 条（规则见本脚本头部注释）" % (len(bugs), len(cands)))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text, encoding="utf-8", newline="\n")
        print("清单已写入：%s" % args.out)
    else:
        print("（加 --out 可以把清单写成文件；下面只列前 10 条看看画风）")
        for b in cands[:10]:
            print("  %s | %s | %s" % (b["id"], b["name"][:56], b["status"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
