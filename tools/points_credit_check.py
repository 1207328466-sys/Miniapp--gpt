# -*- coding: utf-8 -*-
"""只读排查：**积分有没有真的落到账号余额上**。

【为什么要有它】2026/10/14 真机上遇到：答题写链路红了 ——
库里这一笔的实得明明白白（`actual_point=949`），今日已得的记录也在，
可**账号余额一分没动**。当时靠手工几条 SQL 才把话说清楚，于是固化成这个工具。

它回答三个问题（都是只读）：
  ① 账号余额是多少、**最后一次变动是什么时候**（`user.point_update_time`）；
  ② 今天有哪些"任务的"发放记录（`point_task_record` × `point_rule.points`，只算计入每日上限的规则）；
  ③ 今天有哪些"答题的"发放记录（`home_activity_quiz_answer.actual_point`）。
最后给一句判断：今天记录的发放金额，和"余额最后变动时间"对不对得上。

⚠️ 它不判断"产品对不对" —— 只把**事实**摆出来。判红/判绿仍然由用例的断言负责
（`test_case/suprecast_app/test_quiz_submit.js` 的「余额增量 == 实得」就是那条断言）。

用法：
    python tools/points_credit_check.py --user 1966910
    python tools/points_credit_check.py --user 1966910 --expect-today 0   # 顺便校验"今天应发放 0"这类期望
退出码：0 = 读数成功；2 = 参数/连接问题
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_report import DEFAULT_CONFIG, load_conn  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description="只读：看积分发放有没有落到余额上")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    ap.add_argument("--user", type=int, required=True, help="账号 id（config/env.yaml 的 user_id）")
    ap.add_argument("--expect-today", type=int, help="今天应发放的分数（给了就顺便对一下）")
    args = ap.parse_args(argv)

    conn = load_conn(args.config)
    cur = conn.cursor()

    # ① 余额 + 最后变动时间
    cur.execute("select points, point_update_time from user where id = %s", (args.user,))
    row = cur.fetchone()
    if not row:
        print("[!] 库里没有这个账号：%s" % args.user)
        return 2
    points, updated = row
    points = int(points or 0)
    print("\n=== 账号 %s ===" % args.user)
    print("  余额：%s" % points)
    print("  余额最后变动：%s" % (updated or "（从没变动过）"))

    # ② 今天的任务发放
    cur.execute(
        "select r.rule_name, r.points, t.complete_count from point_task_record t "
        "join point_rule r on r.id = t.rule_id "
        "where t.user_id = %s and t.task_date = curdate() and r.include_daily_total = 1",
        (args.user,),
    )
    task_rows = cur.fetchall()
    task_total = sum(int(p or 0) * int(c or 0) for _n, p, c in task_rows if int(p or 0) > 0 and int(c or 0) > 0)
    print("\n=== 今天的任务发放（计入每日上限的）===")
    for name, p, c in task_rows:
        print("   %s %s 次 × %s 分 = %s" % (name, c, p, int(p or 0) * int(c or 0)))
    if not task_rows:
        print("   （没有）")
    print("   小计：%s 分" % task_total)

    # ③ 今天的答题发放
    cur.execute(
        "select id, activity_id, correct_count, should_point, actual_point, point_status, submit_time "
        "from home_activity_quiz_answer "
        "where user_id = %s and submit_time >= curdate() and submit_time < curdate() + interval 1 day",
        (args.user,),
    )
    quiz_rows = cur.fetchall()
    quiz_total = sum(int(r[4] or 0) for r in quiz_rows)
    print("\n=== 今天的答题发放 ===")
    for r in quiz_rows:
        print("   提交 id=%s 活动=%s 答对=%s 应得=%s 实得=%s 状态=%s 提交时间=%s" % r)
    if not quiz_rows:
        print("   （没有）")
    print("   小计：%s 分" % quiz_total)

    # ④ 结论：今天记录的发放 vs 余额最后变动时间
    today_total = task_total + quiz_total
    print("\n=== 结论 ===")
    if today_total == 0:
        print("  今天没有任何发放记录 —— 余额不动是正常的。")
    elif updated and str(updated)[:10] < datetime.now().strftime("%Y-%m-%d"):
        print(
            "  ⚠️ 今天有 %s 分的发放记录，但余额最后一次变动是 **%s**（不在今天）——\n"
            "     说明这些发放**没有落到余额上**。先怀疑环境/产品侧的发放链路（积分服务有没有在跑、"
            "库有没有指对），不是框架问题；把这两行数据发给开发即可。" % (today_total, updated)
        )
    else:
        print("  今天有 %s 分的发放记录，余额今天也动过 —— 具体到没到账要看用例的断言（余额增量 == 实得）。" % today_total)

    if args.expect_today is not None:
        ok = today_total == args.expect_today
        print("  期望今天应发放 %s 分，实际 %s 分 → %s" % (args.expect_today, today_total, "一致" if ok else "不一致"))
        if not ok:
            cur.close()
            conn.close()
            return 2

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
