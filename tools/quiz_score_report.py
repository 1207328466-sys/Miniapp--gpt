# -*- coding: utf-8 -*-
"""答题提交的**对账**（只读）：判分对不对、积分发放对不对（含每日上限截断）。

【为什么要它】
  需求 713594985 里有三段跟"分"有关的原文（见 knowledge/需求描述汇编.md）：
    · 判分口径：单选/判断**对则得分**；多选须**所选集合与答案集合完全一致**；**答错不扣分**；
    · 每日总积分上限：仅「计入每日总上限」开关开启时生效；按自然日重置；
    · 截断时**按剩余值发放**（owner 2026/10/13 补充：到了上限就**不再发放**）。

  这几条光看界面证明不了 —— 界面上只有「提交成功」。真正的判据在库里：
  `home_activity_quiz_answer` 一行里有 `should_point`（应得）和 `actual_point`（实得），
  再跟「今天已经得了多少、上限多少」对一遍，就能判"发对没有"。

  本工具把这几件事一次读出来（**纯 SELECT**），输出末尾一行 `[QUIZSCORE] ...` 给用例侧读。

用法:
    python tools/quiz_score_report.py --activity-name Z-B4-答题角标
    python tools/quiz_score_report.py --activity-name Z-B4-答题角标 --user 1966910
退出码: 0 正常；1 读配置/连库失败；2 定位不到活动（名字不唯一/不存在）
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_cleanup import pick_activity_id  # noqa: E402
from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

ANSWER_TABLE = "home_activity_quiz_answer"


def latest_submit(cur, activity_id, user_id=None):
    sql = (
        "select id, user_id, question_count, correct_count, should_point, actual_point, "
        "point_status, submit_time from %s where activity_id = %%s" % ANSWER_TABLE
    )
    args = [activity_id]
    if user_id:
        sql += " and user_id = %s"
        args.append(user_id)
    sql += " order by id desc limit 1"
    cur.execute(sql, args)
    return cur.fetchone()


def question_scores(cur, activity_id):
    cur.execute(
        "select id, score from home_activity_question where activity_id = %s and is_deleted = 0 order by id",
        (activity_id,),
    )
    return cur.fetchall()


def today_earned(cur, user_id):
    """今天这个账号"计入每日总上限"的已得积分 —— 按产品**实际记的那两本账**折算。

    ⚠️ 别用 `point_change_record` 算（第一版就是那么写的，结果算出来是 0）：
    实测它里面**没有**今天的答题发放（那本账看起来是后台/手工变动用的）。
    用错账本的后果是：产品明明按剩余额度正确截断了，却被判成"实得对不上"——**假红**。
    2026/10/13 就是这个假红把口径查清楚：今天 = 浏览帖子 10 分 + 上次答题 1021 分 = 1031，
    所以本次按 remaining=2000-1031=969 发放，产品行为是对的。

    两本账：
      1. `point_task_record`（每日任务完成次数）× `point_rule.points`，只算 include_daily_total=1 的规则；
      2. `home_activity_quiz_answer.actual_point`（今天已发的答题积分）。

    @param exclude_submit_id 要排除的提交 id（算"这一笔之前"的已得时用）
    @returns (合计, 明细行列表)
    """
    detail = []
    total = 0

    cur.execute(
        "select r.rule_name, r.points, t.complete_count from point_task_record t "
        "join point_rule r on r.id = t.rule_id "
        "where t.user_id = %s and t.task_date = curdate() and r.include_daily_total = 1",
        (user_id,),
    )
    for name, points, count in cur.fetchall():
        if int(points or 0) <= 0 or int(count or 0) <= 0:
            continue
        sub = int(points) * int(count)
        total += sub
        detail.append("%s %s 次 × %s 分 = %s" % (name, count, points, sub))

    cur.execute(
        "select id, activity_id, actual_point from home_activity_quiz_answer "
        "where user_id = %s and submit_time >= curdate() and submit_time < curdate() + interval 1 day "
        "order by id",
        (user_id,),
    )
    quiz_rows = cur.fetchall()
    quiz_total = sum(int(r[2] or 0) for r in quiz_rows)
    if quiz_rows:
        detail.append("答题发放 %s 笔，合计 %s 分（活动 %s）"
                      % (len(quiz_rows), quiz_total, "、".join(str(r[1]) for r in quiz_rows)))
    total += quiz_total
    return total, detail, quiz_rows


def global_rule(cur):
    cur.execute("select daily_total_limit, is_daily_limit_enabled from point_global_rule limit 1")
    row = cur.fetchone()
    return (int(row[0] or 0), int(row[1] or 0)) if row else (0, 0)


def recent_flows(cur, user_id, since):
    """这笔提交前后的积分流水（看"答错扣没扣分"就靠它：有没有负数）"""
    cur.execute(
        "select change_type, change_point, before_point, after_point, operate_time, remark "
        "from point_change_record where user_id = %s and operate_time >= %s - interval 5 minute "
        "order by id desc limit 5",
        (user_id, since),
    )
    return cur.fetchall()


def main(argv=None):
    parser = argparse.ArgumentParser(description="答题提交对账（只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--activity-name", required=True, help="活动名（跟页面标题一字不差）")
    parser.add_argument("--user", type=int,
                        help="账号 user_id（不填 = 先看环境变量 UITEST_USER_ID，再退回到"
                             "「该活动最近一条提交是谁」）")
    parser.add_argument("--mode", choices=["score", "points"], default="score",
                        help="score（默认）=提交后的对账；points=只读一下余额/今日已得（提交前快照用）")
    parser.add_argument("--expect-submits", type=int, help="顺便校验：该活动现在的提交数与这个值是否一致")
    args = parser.parse_args(argv)

    if args.user is None and os.environ.get("UITEST_USER_ID"):
        args.user = int(os.environ["UITEST_USER_ID"])

    read_config(args.config)  # 早失败：配置读不了就别连库
    conn = load_conn(args.config)
    try:
        cur = conn.cursor()
        cur.execute("select id, activity_name from home_activity where activity_name = %s", (args.activity_name,))
        found = cur.fetchall()
        resolved, why = pick_activity_id(found, args.activity_name)
        if resolved is None:
            print("\n[拒绝] 没能唯一定位活动：%s" % why)
            return 2
        activity_id = resolved

        cap, cap_on = global_rule(cur)

        # ---- 模式 1：只读快照（提交前用：记下余额与"这一笔之前"的额度）----
        if args.mode == "points":
            if not args.user:
                print("\n[拒绝] points 模式要知道查哪个账号：给 --user，"
                      "或者把账号写进 config/env.yaml 的 user_id（run.py 会设成 UITEST_USER_ID）")
                return 2
            earned, detail, _quiz = today_earned(cur, args.user)
            left = max(0, cap - earned) if cap_on else None
            cur.execute("select points from user where id = %s", (args.user,))
            row = cur.fetchone()
            points = int(row[0] or 0) if row else None
            print("\n=== 提交前快照：账号 %s ===" % args.user)
            print("  余额：%s ｜ 今日已得：%s ｜ 上限：%s（开关=%s）｜ 还剩：%s"
                  % (points, earned, cap if cap_on else "未启用",
                     "开" if cap_on else "关", "不适用" if left is None else left))
            for d in detail:
                print("    · %s" % d)
            print("[QUIZSCORE] mode=points user=%s points=%s today_earned=%s cap=%s cap_on=%s left=%s"
                  % (args.user, points, earned, cap, cap_on, "none" if left is None else left))
            return 0

        print("\n=== 答题提交对账：%s（活动 id=%s）===" % (args.activity_name, activity_id))

        if args.expect_submits is not None:
            cur.execute("select count(*) from %s where activity_id = %%s" % ANSWER_TABLE, (activity_id,))
            n = int(cur.fetchone()[0])
            print("  该活动现有提交记录：%s 条（期望 %s 条）" % (n, args.expect_submits))
            print("[QUIZSCORE] activity=%s mode=count submits=%s expect=%s"
                  % (activity_id, n, args.expect_submits))
            return 0 if n == args.expect_submits else 2

        scores = question_scores(cur, activity_id)
        per_point = int(scores[0][1]) if scores else 0
        uniform = len({int(s[1]) for s in scores}) <= 1  # 每题分值是否一致（不一致时"答对数 × 分值"不成立）
        print("  题目：%d 题，每题分值 %s（按第一题取；多题不同分值时看下面的应得核对）"
              % (len(scores), per_point))
        print("  分值明细：%s" % ", ".join("q%s=%s" % (i + 1, s) for i, (_id, s) in enumerate(scores)))

        row = latest_submit(cur, activity_id, args.user)
        if not row:
            print("  还没有提交记录 —— 这条活动（该账号）还没提交过。")
            print("[QUIZSCORE] activity=%s user=%s submits=0" % (activity_id, args.user or ""))
            return 0

        submit_id, user_id, qcount, correct, should, actual, status, submit_time = row
        # 今日已得**含**这一笔；"这一笔之前的额度"要把这一笔扣出来（否则会自己把自己算进去）
        earned_after, detail, quiz_rows = today_earned(cur, user_id)
        this_is_today = any(int(r[0]) == int(submit_id) for r in quiz_rows)
        earned_before = earned_after - int(actual or 0) if this_is_today else earned_after
        left_before = max(0, cap - earned_before) if cap_on else None
        left_after = max(0, cap - earned_after) if cap_on else None
        cur.execute("select points from user where id = %s", (user_id,))
        prow = cur.fetchone()
        user_points = int(prow[0] or 0) if prow else None
        print("  最近一条提交：user=%s 题数=%s 答对=%s 应得=%s **实得=%s** 状态=%s 时间=%s"
              % (user_id, qcount, correct, should, actual, status, submit_time))
        print("  今日已得：这一笔之前 %s → 这一笔之后 %s（含本笔 %s）" % (earned_before, earned_after, actual))
        print("  每日上限：%s（开关=%s）｜ 这一笔之前的剩余额度：%s ｜ 现在还剩：%s"
              % (cap if cap_on else "未启用", "开" if cap_on else "关",
                 "不适用" if left_before is None else left_before,
                 "不适用" if left_after is None else left_after))
        print("  账号当前积分余额：%s" % user_points)
        print("  今日已得是怎么算出来的（产品的两本账）：")
        for d in detail:
            print("    · %s" % d)
        print("  这道题按「答对得分」算应是：%s × %s = %s（实际应得 %s）"
              % (correct, per_point, int(correct or 0) * per_point, should))

        print("[QUIZSCORE] activity=%s user=%s questions=%s correct=%s should=%s actual=%s status=%s "
              "per_point=%s uniform=%s today_before=%s today_after=%s cap=%s cap_on=%s "
              "left_before=%s left_after=%s points=%s"
              % (activity_id, user_id, qcount, correct, should, actual, status,
                 per_point, 1 if uniform else 0, earned_before, earned_after, cap, cap_on,
                 "none" if left_before is None else left_before,
                 "none" if left_after is None else left_after, user_points))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
