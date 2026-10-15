# -*- coding: utf-8 -*-
"""答题数据复位（**会删数据**；默认只预览，不删）。

【为什么需要它】
  「会改数据的用例」（提交答卷 / 积分兑换 / 签到）要靠"跑 → 复位 → 再跑"才能反复执行，
  否则跑一次就把测试环境的数据弄脏了。这个工具就是那个"复位"动作。

  owner 已于 2026/10/12 明确授权：**可以在测试库里删掉这些记录**（见 docs/待owner拍板.md Q2）。
  授权范围是"测试环境、我们自己的活动数据"，所以本工具带三道闸：

    1. **默认只预览**：不加 --yes 就一个字节都不删，先把"会删几行、是谁的记录"打给你看
    2. **必须点名活动**：--activity 347 这种；不给就拒绝（防止"删错一片"）
    3. **只认测试库**：库名里必须含 alpha / test，否则拒绝（要删别的库得显式 --force-db）
  另外行数超过 50 行会停下来要 --force —— 授权的是"我们自己的少量记录"，
  出现一大片说明要么选错了活动，要么该找 owner 再确认一次。

用法:
    python tools/quiz_data_cleanup.py --activity 347                    # 预览（只读）
    python tools/quiz_data_cleanup.py --activity 347 --user 1966909     # 只看某个账号
    python tools/quiz_data_cleanup.py --activity 347 --yes              # 真删
    python tools/quiz_data_cleanup.py --activity 347 --expect-submits 0 # 跑完校验：现在剩几条

⚠️ **默认只动"我们这个账号"的数据**（账号来自 `config/env.yaml` 的 `user_id`，run.py 会设成
   `UITEST_USER_ID`）。理由见下面 `--all-users` 那段：写链路只需要"让我们这个账号重新可答"，
   而**清空整条活动会删到别人的记录**（2026/10/15 实际遇到过：一条活动下积了 26 条别人的提交）。
   要清整条活动，显式加 `--all-users`；那时"超过 50 行"的闸门照旧生效。

输出里带 [CLEANUP] 前缀的那一行是给机器读的（用例侧靠它判断"确实清干净了"）。

退出码: 0 = 正常（含"本来就没得删"）；1 = 读配置/连库失败；2 = 被安全闸门挡下（没删任何东西）
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

ANSWER_TABLE = "home_activity_quiz_answer"
DETAIL_TABLE = "home_activity_quiz_answer_detail"

# 库名里出现这些词才算"测试库"。这里刻意写死一小串，而不是"不含 prod 就行" ——
# 判据要是反着写（黑名单），将来冒出个没见过的生产库名就悄悄放行了。
TEST_DB_MARKERS = ("alpha", "test")

# 没有 --force 时，最多删这么多行
MAX_ROWS_WITHOUT_FORCE = 50


def decide(db_name, activity_id, submit_rows, detail_rows, force=False, force_db=False):
    """决定这一票能不能删 —— **纯函数，不碰库**，所以能离线自测（见 scripts/selftest-quiz-cleanup.py）。

    返回 (allowed, reasons, notices)：
      allowed  False = 拒绝执行（一个字节都不删）
      reasons  拒绝的原因（人话，逐条）
      notices  提醒（不拦，但要说出来）
    """
    reasons = []
    notices = []

    if not activity_id:
        reasons.append("没给 --activity。复位动作必须点名「哪个活动」，否则可能删掉一大片。")

    name = str(db_name or "").lower()
    if not any(m in name for m in TEST_DB_MARKERS) and not force_db:
        reasons.append(
            "数据库名 %r 不像测试库（不含 %s）。删数据不可逆：确认这是测试库再加 --force-db。"
            % (db_name, " / ".join(TEST_DB_MARKERS))
        )

    total = int(submit_rows or 0) + int(detail_rows or 0)
    if total > MAX_ROWS_WITHOUT_FORCE and not force:
        reasons.append(
            "这次会删 %d 行，超过上限 %d 行（owner 授权的是「我们自己的少量记录」）。"
            "确认无误再加 --force。" % (total, MAX_ROWS_WITHOUT_FORCE)
        )

    if total == 0:
        notices.append("本来就没有可删的记录（已经是干净状态）。")

    return (not reasons), reasons, notices


def count_rows(cur, table, activity_id, user_id):
    sql = "select count(*) from %s where activity_id = %%s" % table
    args = [activity_id]
    if user_id:
        sql += " and user_id = %s"
        args.append(user_id)
    cur.execute(sql, args)
    return int(cur.fetchone()[0])


def who_submitted(cur, activity_id, user_id):
    """每条提交是谁的、什么时候的 —— 删之前先让人看一眼，删之后这段话就是凭证"""
    sql = "select user_id, question_count, correct_count, actual_point, submit_time from %s where activity_id = %%s" % ANSWER_TABLE
    args = [activity_id]
    if user_id:
        sql += " and user_id = %s"
        args.append(user_id)
    sql += " order by submit_time desc limit 20"
    cur.execute(sql, args)
    return cur.fetchall()


def activity_name(cur, activity_id):
    cur.execute("select activity_name from home_activity where id = %s", (activity_id,))
    row = cur.fetchone()
    return row[0] if row else "(主表里没有这个活动 id)"


def pick_activity_id(rows, name):
    """从「按名字查出来的活动行」里挑出唯一那一个 —— **纯函数**，便于离线自测。

    为什么要按名字找 id：首页那张「答题」卡的**背后活动会换人**（实测见过 347、15 题的
    「Z-题干图验证」…），用例写死 id 就会"昨天能跑、今天指到别的活动上"。
    按名字定位更贴近用例的真实意图（"我要清的是我现在打开的这个活动"）。

    返回 (activity_id, 原因)：恰好一个 -> (id, None)；0 个 / 多个 -> (None, 人话原因)。
    多个时**故意不挑第一个** —— 挑一个"看起来对"的然后删它的数据，正是这个工具最该避免的事。
    """
    rows = list(rows or [])
    if not rows:
        return None, "在 home_activity 里找不到名字为 %r 的活动（名字要跟页面标题一字不差）" % name
    if len(rows) > 1:
        return None, "有 %d 个活动都叫 %r（id: %s）—— 名字不唯一，改用 --activity 指定 id" % (
            len(rows),
            name,
            "、".join(str(r[0]) for r in rows),
        )
    return int(rows[0][0]), None


def main(argv=None):
    parser = argparse.ArgumentParser(description="答题数据复位（默认只预览）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--activity", type=int, help="要复位的活动 id，例如 347")
    parser.add_argument(
        "--activity-name",
        help="要复位的活动名（跟页面标题一字不差，例如「Z-题干图验证」）。"
        "用途：答题卡背后的活动会换人，写死 id 会指到别的活动上；名字不唯一时会拒绝执行",
    )
    parser.add_argument("--user", type=int, help="只清某个 user_id（不填 = 该活动下所有账号）")
    parser.add_argument("--yes", action="store_true", help="真的执行删除（不加就是预览）")
    parser.add_argument("--force", action="store_true", help="放行「超过上限」的大批量删除")
    parser.add_argument("--force-db", action="store_true", help="放行「库名不像测试库」的情况")
    parser.add_argument("--expect-submits", type=int, help="只做校验：读到的提交数不等于这个值就以退出码 2 结束")
    parser.add_argument("--all-users", action="store_true",
                        help="连别的账号的记录一起清（默认只清本环境的登录账号）")
    args = parser.parse_args(argv)

    # 谁的数据？—— 默认收窄到「本环境的登录账号」（config/env.yaml 的 user_id，
    # run.py 会把它设成 UITEST_USER_ID）。
    #
    # 【为什么把默认改成这样】2026/10/15 实际踩到：拿一条"别人也在用"的活动跑写链路时，
    # 该活动下积了 26 条提交 / 440 条明细（别的账号、别的日期）：
    #   ① 安全闸门按"超过 50 行"拦下（拦得对）；
    #   ② 就算放行，那也是**删别人的数据** —— owner 授权的是"删我们自己的记录"，不是"清空一条活动"。
    # 而写链路真正需要的只有一件事：**让我们这个账号重新可答**（"已参加"是记在账号上的）。
    # 所以要清整条活动，请显式写 --all-users。
    if args.user is None and not args.all_users:
        env_user = os.environ.get("UITEST_USER_ID")
        if env_user:
            args.user = int(env_user)
            print("限定账号：%s（来自环境档案 config/env.yaml 的 user_id；要清整条活动请显式加 --all-users）"
                  % args.user)

    if args.activity and args.activity_name:
        print("--activity 和 --activity-name 只能给一个（同时给不知道该听谁的）")
        return 2

    db_name = read_config(args.config)["database"]
    conn = load_conn(args.config)
    try:
        cur = conn.cursor()

        if args.activity_name:
            cur.execute(
                "select id, activity_name from home_activity where activity_name = %s",
                (args.activity_name,),
            )
            found = cur.fetchall()
            resolved, why = pick_activity_id(found, args.activity_name)
            if resolved is None:
                print("\n[拒绝执行] 没能唯一定位活动：%s" % why)
                print("[CLEANUP] mode=refused activity-name=%s" % args.activity_name)
                return 2
            print("\n按名字定位到活动 id：%s（%s）" % (resolved, args.activity_name))
            args.activity = resolved

        # 只校验模式：不删任何东西，只回答"现在还剩几条"
        if args.expect_submits is not None:
            submits = count_rows(cur, ANSWER_TABLE, args.activity, args.user)
            print("\n[校验] 活动 %s 当前的提交记录：%s 条（期望 %s 条）" % (args.activity, submits, args.expect_submits))
            print("[CLEANUP] mode=verify activity=%s submits=%s expect=%s" % (args.activity, submits, args.expect_submits))
            return 0 if submits == args.expect_submits else 2

        submits = count_rows(cur, ANSWER_TABLE, args.activity, args.user)
        details = count_rows(cur, DETAIL_TABLE, args.activity, args.user)

        print("\n=== 活动 %s：%s ===" % (args.activity, activity_name(cur, args.activity)))
        if args.user:
            print("  限定账号：%s" % args.user)
        print("  将影响：提交 %s 条 / 作答明细 %s 条" % (submits, details))
        rows = who_submitted(cur, args.activity, args.user)
        if rows:
            print("\n  这些提交记录（最多列 20 条）：")
            print("    %-12s %5s %5s %6s  %s" % ("user_id", "题数", "答对", "得分", "提交时间"))
            for r in rows:
                print("    %-12s %5s %5s %6s  %s" % (r[0], r[1], r[2], r[3], r[4]))

        allowed, reasons, notices = decide(
            db_name, args.activity, submits, details, force=args.force, force_db=args.force_db
        )
        for n in notices:
            print("\n  [提示] %s" % n)

        if not allowed:
            print("\n[拒绝执行] 安全闸门拦下了这次复位：")
            for r in reasons:
                print("  · %s" % r)
            print("\n[CLEANUP] mode=refused activity=%s submits=%s details=%s" % (args.activity, submits, details))
            return 2

        if not args.yes:
            print("\n[预览] 没有加 --yes，所以**什么都没删**。")
            print("      确认上面这些正是要清的记录后，再执行：")
            print("        python tools/quiz_data_cleanup.py --activity %s --yes" % args.activity)
            print("[CLEANUP] mode=dry-run activity=%s submits=%s details=%s" % (args.activity, submits, details))
            return 0

        # ---- 真删：先明细、后主表，同一个事务 ----
        where = "activity_id = %s" + (" and user_id = %s" if args.user else "")
        dargs = (args.activity, args.user) if args.user else (args.activity,)
        cur.execute("delete from %s where %s" % (DETAIL_TABLE, where), dargs)
        deleted_details = cur.rowcount
        cur.execute("delete from %s where %s" % (ANSWER_TABLE, where), dargs)
        deleted_submits = cur.rowcount
        conn.commit()

        left_submits = count_rows(cur, ANSWER_TABLE, args.activity, args.user)
        left_details = count_rows(cur, DETAIL_TABLE, args.activity, args.user)
        print("\n[已删除] 提交 %s 条 / 明细 %s 条" % (deleted_submits, deleted_details))
        print("         复查：现在还剩 提交 %s 条 / 明细 %s 条" % (left_submits, left_details))
        print(
            "[CLEANUP] mode=clean activity=%s deleted_submits=%s deleted_details=%s left_submits=%s left_details=%s"
            % (args.activity, deleted_submits, deleted_details, left_submits, left_details)
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
