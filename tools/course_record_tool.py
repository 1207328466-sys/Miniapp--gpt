# -*- coding: utf-8 -*-
"""课程学习记录 造数 / 复位（**会写库**；默认只预览，不加 --yes 不动数据）。

【为什么需要它】
  需求 713367615 第 ④ 条：「已购买用户-已开始学习 → 默认为『课程目录』，
  展示上次观看的课时名称、课程标签、课时封面和视频」。

  这条的**前置数据**是"这个账号在这门课上已经学过" —— 对应 `course_record` 里有行记录。
  我们账号（1966909）在课程 717 上本来是"已购买 + 一条学习记录都没有"（= 未开始学习），
  所以要么真播一次视频、要么造一行记录。

【2026/10/13 真机实测：什么才算"开始学习"】（三条，都是点完再查库对出来的）
  1. 在小程序里点「课程目录」-> 点第 1 课，**不会**写 course_record（点完再查库，一行都没多）；
  2. **把视频真播完**，小程序自己会写：`duration=7.0`、`watch_progress='7'`、`is_watch_end=1`
     （课程 717 的课时只有 7.5 秒，点一下封面就播起来，页面先出现「正在学习」、播完变「已学完」）；
  3. 所以"已开始学习"**可以靠真播一次得到**（最真实），也可以靠本工具造一行（可控、可复位）。

  ⚠️ **先确认当前登录的是哪个账号**：2026/10/13 实测小程序写入的是 **user_id 1966910**
  （早先文档里记的是 1966909 —— 账号换过）。别照抄 user id，先用
  `select user_id, max(create_time) from course_view_record group by user_id order by 2 desc limit 5`
  这种"最近活跃"的查询确认，再传给 --user。

【三道闸】（和 quiz_data_cleanup.py 一个路子）
  1. **默认只预览**：不加 --yes 一个字节都不写，先把"会写什么/会删几行"打给你看；
  2. **必须点名**：--user 和 --course-id 都给，否则拒绝（防止写错课程/写错账号）；
  3. **只认测试库**：库名里必须含 alpha / test，否则拒绝（要动别的库得显式 --force-db）。

用法：
    python tools/course_record_tool.py --user 1966909 --course-id 83                 # 预览：现在有没有记录
    python tools/course_record_tool.py --user 1966909 --course-id 83 --add --yes     # 造一行"已开始学习"
    python tools/course_record_tool.py --user 1966909 --course-id 83 --delete --yes  # 复位（删掉这行）
    python tools/course_record_tool.py --user 1966909 --course-id 83 --expect 1      # 只校验现在有几行

退出码：0 正常；1 读配置/连库失败；2 被安全闸门挡下（没动任何数据）
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

RECORD_TABLE = "course_record"
TEST_DB_MARKERS = ("alpha", "test")

# 造数时写的值：照着库里真实行的形状来（watch_progress 是**字符串**；真播一次会写 '7' 这种秒数）
# 注意 `duration` 这一列存的是**秒**（真播一次写 7.0），不是毫秒
ADDED_WATCH_PROGRESS = "1"


def decide(db_name, user_id, course_id, existing, add, delete, force_db=False):
    """这一票能不能动数据 —— **纯函数，不碰库**，所以能离线自检。@returns (allowed, reasons)"""
    reasons = []
    if not user_id:
        reasons.append("没给 --user。改数据必须点名「哪个账号」，否则可能写到别人身上。")
    if not course_id:
        reasons.append("没给 --course-id（或 --course-name）。必须点名是哪门课。")
    name = str(db_name or "").lower()
    if not any(m in name for m in TEST_DB_MARKERS) and not force_db:
        reasons.append(
            "数据库名 %r 不像测试库（不含 %s）。确认这是测试库再加 --force-db。" % (db_name, " / ".join(TEST_DB_MARKERS))
        )
    if delete and existing == 0:
        reasons.append("要删，但这个账号在这门课上一行记录都没有 —— 没什么可删的（先看清楚再下手）。")
    return (not reasons), reasons


def find_course(cur, course_id=None, course_name=None):
    """按 id 或名字定位课程。名字不唯一时返回多行，让调用方拒绝执行。"""
    if course_id:
        cur.execute("select id, course_name, course_tag from course_info where id = %s", (course_id,))
    else:
        cur.execute("select id, course_name, course_tag from course_info where course_name = %s", (course_name,))
    return cur.fetchall()


def first_lesson(cur, course_tag):
    cur.execute(
        "select id, lesson_name, video_duration from course_lesson "
        "where course_tag = %s and is_deleted = 0 order by id limit 1",
        (course_tag,),
    )
    return cur.fetchone()


def count_records(cur, user_id, course_tag):
    cur.execute(
        "select count(*) from %s where user_id = %%s and course_tag = %%s" % RECORD_TABLE,
        (user_id, course_tag),
    )
    return int(cur.fetchone()[0])


def list_records(cur, user_id, course_tag):
    cur.execute(
        "select id, course_lesson_id, watch_progress, is_watch_end, create_time from %s "
        "where user_id = %%s and course_tag = %%s order by id" % RECORD_TABLE,
        (user_id, course_tag),
    )
    return cur.fetchall()


def main(argv=None):
    parser = argparse.ArgumentParser(description="课程学习记录 造数/复位（默认只预览）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--user", type=int, help="账号 user_id（必填），例如 1966909")
    parser.add_argument("--course-id", type=int, help="课程 id（course_info.id），例如 83（课程「717」）")
    parser.add_argument("--course-name", help="课程名（跟列表上一字不差，例如 717）。与 --course-id 二选一")
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--add", action="store_true", help="造一行学习记录（需要 --yes 才真写）")
    g.add_argument("--delete", action="store_true", help="删掉该账号在这门课上的学习记录（需要 --yes）")
    parser.add_argument("--yes", action="store_true", help="真的执行（不加就是预览）")
    parser.add_argument("--force-db", action="store_true", help="放行「库名不像测试库」的情况")
    parser.add_argument("--expect", type=int, help="只校验：读到的记录数不等于这个值就以退出码 2 结束")
    args = parser.parse_args(argv)

    if args.course_id and args.course_name:
        print("--course-id 和 --course-name 只能给一个（同时给不知道该听谁的）")
        return 2

    db_name = read_config(args.config)["database"]
    conn = load_conn(args.config)
    try:
        cur = conn.cursor()

        found = find_course(cur, args.course_id, args.course_name)
        if len(found) != 1:
            print("\n[拒绝执行] 没能唯一定位课程：按 %s 查到 %d 门" % (
                ("id=%s" % args.course_id) if args.course_id else ("名字=%s" % args.course_name), len(found)))
            for r in found[:10]:
                print("    id=%s %s" % (r[0], r[1]))
            return 2
        cid, cname, ctag = found[0]
        lesson = first_lesson(cur, ctag)
        existing = count_records(cur, args.user, ctag)

        print("\n=== 课程「%s」(id=%s, course_tag=%s)，账号 %s ===" % (cname, cid, ctag, args.user))
        print("  第一课时：%s" % (
            "id=%s 名称=%s 时长=%ss" % (lesson[0], lesson[1], lesson[2]) if lesson else "（这门课没有课时！）"))
        print("  现在这个账号在这门课上的学习记录：%s 行" % existing)
        for r in list_records(cur, args.user, ctag):
            print("    id=%s lesson=%s 进度=%s 看完=%s 创建=%s" % r)

        if args.expect is not None:
            print("\n[校验] 当前 %s 行（期望 %s 行）" % (existing, args.expect))
            print("[COURSE_RECORD] mode=verify user=%s course=%s records=%s expect=%s"
                  % (args.user, cid, existing, args.expect))
            return 0 if existing == args.expect else 2

        allowed, reasons = decide(db_name, args.user, cid, existing, args.add, args.delete, args.force_db)
        if not allowed:
            print("\n[拒绝执行] 一个字节都没动：")
            for r in reasons:
                print("  · %s" % r)
            print("[COURSE_RECORD] mode=refused user=%s course=%s" % (args.user, cid))
            return 2

        if not (args.add or args.delete):
            print("\n（只是预览。要造数加 --add --yes；要复位加 --delete --yes）")
            print("[COURSE_RECORD] mode=preview user=%s course=%s records=%s" % (args.user, cid, existing))
            return 0

        if not args.yes:
            if args.add:
                print("\n[预览] 将会写入 1 行：course_tag=%s lesson=%s watch_progress=%s"
                      % (ctag, lesson[0] if lesson else "?", ADDED_WATCH_PROGRESS))
            else:
                print("\n[预览] 将会删除 %s 行（该账号在这门课上的全部学习记录）" % existing)
            print("  确认无误就加 --yes 真跑一次。")
            print("[COURSE_RECORD] mode=dry-run user=%s course=%s records=%s" % (args.user, cid, existing))
            return 0

        if args.add:
            if not lesson:
                print("[拒绝执行] 这门课没有课时，造出来的记录没有意义")
                return 2
            cur.execute(
                "insert into %s (course_tag, course_lesson_id, duration, user_id, watch_progress, "
                "is_watch_end, create_time, update_time) values (%%s, %%s, %%s, %%s, %%s, 0, now(), now())"
                % RECORD_TABLE,
                (ctag, lesson[0], 0, args.user, ADDED_WATCH_PROGRESS),
            )
            conn.commit()
            print("\n[已写入] 1 行学习记录（lesson=%s，进度=%s）" % (lesson[0], ADDED_WATCH_PROGRESS))
        else:
            cur.execute(
                "delete from %s where user_id = %%s and course_tag = %%s" % RECORD_TABLE,
                (args.user, ctag),
            )
            conn.commit()
            print("\n[已删除] %s 行学习记录" % cur.rowcount)

        after = count_records(cur, args.user, ctag)
        print("[COURSE_RECORD] mode=%s user=%s course=%s records=%s"
              % ("add" if args.add else "delete", args.user, cid, after))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
