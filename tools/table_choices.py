# -*- coding: utf-8 -*-
"""把"要填名字"的那几个参数，从测试库列出来（**只读**）—— 供 `--dropdown` 写进用例表的
「名称候选」工作表。

【为什么需要它】
  表格里有一类参数是**数据里的名字**，必须一字不差：

    · `打开课程详情` 的「课程名」（例如 717）
    · `打开案例` 的「案例名」（例如 填充任务1）
    · `复位答题记录` / `检查答题记录数` 的「活动名」（例如 Z-B4-答题角标）

  填错一个字，动作在真机上才会报"找不到"—— 对不写代码的人来说，这是纯靠猜。
  所以这里把候选名字取出来，跟表格一起给人看（不用记、可以复制粘贴）。

  另外两件只有库里才知道、但对写用例很关键的事，一并带上：
    · 课程**我们账号买没买**（「未购买点课时」那条断言必须挑一门没买的课）；
    · 课程**有几节课时**（0 课时的课在小程序端本来就不显示）。

【只读】全是 SELECT，一个写操作都没有。

用法:
    python tools/table_choices.py                 # 人看的清单
    python tools/table_choices.py --json          # 机器读的（--dropdown 用它）
    python tools/table_choices.py --case-limit 0  # 案例不限条数（默认只列前 60 条）
退出码: 0 成功；1 读配置/连库失败
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_cleanup import load_conn  # noqa: E402
from quiz_data_report import DEFAULT_CONFIG, read_config  # noqa: E402

DEFAULT_CASE_LIMIT = 60


def current_user_id():
    """表格里那些"我们账号"的判断，用的是环境档案里记的登录账号（config/env.yaml）。

    取不到就返回 None —— 那几列会写成"（不知道账号）"，而不是猜一个。
    """
    env_file = os.path.join(ROOT, "config", "env.yaml")
    try:
        import use_env

        data = use_env.load(env_file)
        prof, err = use_env.resolve(data, data.get("current", ""))
        if prof and prof.get("user_id"):
            return int(prof["user_id"])
    except Exception:
        pass
    return None


def fetch(config_path, case_limit=DEFAULT_CASE_LIMIT):
    """取三类名字。**任何一段失败只影响那一段**（写清原因），不连累其它段。"""
    out = {"课程": [], "答题活动": [], "案例": [], "notes": []}
    user_id = current_user_id()
    if user_id:
        out["notes"].append("课程那张表里的「我们账号买没买」按 user_id=%s（config/env.yaml）判断" % user_id)
    else:
        out["notes"].append("读不到当前账号（config/env.yaml 的 user_id），「买没买」这一列没填")

    conn = load_conn(str(config_path))
    try:
        cur = conn.cursor()

        # 课程：公开 + 未删；带上"买没买"和课时数（0 课时的课在小程序端不显示）
        cur.execute(
            "select c.course_name, "
            "(select count(*) from course_lesson l where l.course_tag = c.course_tag and l.is_deleted = 0), "
            "c.id from course_info c where c.del_tag = 0 and c.is_public = 1 order by c.id"
        )
        courses = cur.fetchall()
        bought = set()
        if user_id:
            cur.execute("select distinct course_tag from user_course_relation where user_id = %s", (user_id,))
            bought = {r[0] for r in cur.fetchall()}
            cur.execute("select id, course_tag from course_info")
            tag_of = {r[0]: r[1] for r in cur.fetchall()}
        else:
            tag_of = {}
        # 再取一次带 course_tag 的，才能判"买没买"
        cur.execute(
            "select c.course_name, c.course_tag, "
            "(select count(*) from course_lesson l where l.course_tag = c.course_tag and l.is_deleted = 0) "
            "from course_info c where c.del_tag = 0 and c.is_public = 1 order by c.id"
        )
        for name, tag, lessons in cur.fetchall():
            out["课程"].append(
                {
                    "name": str(name or ""),
                    "bought": ("是" if tag in bought else "否") if user_id else "",
                    "lessons": int(lessons or 0),
                }
            )
        # 同名课程在库里是真实存在的（实测 64 门里有多组同名）：按名字打开会命中第一门 ——
        # 这条必须写出来，否则"我明明填的是对的，怎么打开的不是那门课"会成为下一个坑。
        names = [c["name"] for c in out["课程"]]
        dups = sorted({n for n in names if names.count(n) > 1})
        if dups:
            out["notes"].append(
                "注意：这些课程名在库里有**多门同名**，按名字打开只会命中第一门 —— %s"
                % "、".join(dups[:8])
            )

        # 答题活动：只有 activity_type=1 的才是"答题"（复位/对账用的就是它）
        cur.execute(
            "select id, activity_name from home_activity "
            "where is_deleted = 0 and activity_type = 1 order by id desc"
        )
        for aid, name in cur.fetchall():
            out["答题活动"].append({"id": int(aid), "name": str(name or "")})

        # 案例：未删的，默认只列前 N 条（160 条全列出来也没人看）
        cur.execute("select count(*) from simulation_case where is_deleted = 0")
        total = int(cur.fetchone()[0])
        sql = "select title from simulation_case where is_deleted = 0 order by id desc"
        if case_limit:
            sql += " limit %d" % int(case_limit)
        cur.execute(sql)
        out["案例"] = [{"name": str(r[0] or "")} for r in cur.fetchall()]
        if case_limit and total > case_limit:
            out["notes"].append(
                "案例共 %d 条，这里只列了最近 %d 条（要看全部：python tools/table_choices.py --case-limit 0）"
                % (total, case_limit)
            )
        else:
            out["notes"].append("案例共 %d 条，已全部列出" % total)
        return out
    finally:
        conn.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="列出要填名字的那些参数的候选值（只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--json", action="store_true", help="输出机器可读的 JSON")
    parser.add_argument("--case-limit", type=int, default=DEFAULT_CASE_LIMIT,
                        help="案例最多列几条（0 = 不限，默认 %d）" % DEFAULT_CASE_LIMIT)
    args = parser.parse_args(argv)

    read_config(args.config)

    if args.json:
        # 机器可读模式：把连库时那句"连接：xxx（密码不回显）"挡在缓冲区里 ——
        # 否则它会混进 JSON，调用方（export_cases --dropdown）解析就炸。
        # ⚠️ 但**出错时要把缓冲区倒出来**：第一次写漏了这一步，结果"连不上库"的提示
        #    被自己吞掉、只留下一个退出码 1，调用方只能说一句"(没有输出)"（2026/10/13 踩到）。
        import contextlib
        import io as _io

        buf = _io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                data = fetch(args.config, args.case_limit)
        except SystemExit as e:
            sys.stderr.write(buf.getvalue())
            return int(e.code or 1)
        except Exception as e:
            sys.stderr.write(buf.getvalue())
            sys.stderr.write("读候选值失败：%s\n" % e)
            return 1
        print(json.dumps(data, ensure_ascii=False))
        return 0

    data = fetch(args.config, args.case_limit)

    print("\n=== 课程（%d 门）===" % len(data["课程"]))
    print("   %-34s %-6s %s" % ("课程名", "买没买", "课时数"))
    for c in data["课程"]:
        print("   %-34s %-6s %s" % (c["name"], c["bought"] or "-", c["lessons"]))
    print("\n=== 答题活动（%d 个）===" % len(data["答题活动"]))
    for a in data["答题活动"]:
        print("   id=%-5s %s" % (a["id"], a["name"]))
    print("\n=== 案例（列出 %d 条）===" % len(data["案例"]))
    for c in data["案例"]:
        print("   %s" % c["name"])
    print()
    for n in data["notes"]:
        print("（%s）" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
