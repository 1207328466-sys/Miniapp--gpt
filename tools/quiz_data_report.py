# -*- coding: utf-8 -*-
"""答题数据体检（**只读**）：看清测试库里到底有哪些答题记录，供「要不要清理、怎么清理」做判断。

背景（为什么需要它）：
  「会改数据的用例」（提交答卷 / 积分兑换 / 签到）目前**默认全部禁止**，原因之一是
  **没有复位手段** —— 跑完留下的真实数据擦不掉，就没法反复跑。要定复位手段，
  第一步得先看清：库里有哪些记录、属于哪个活动、谁提交的、什么时候的。

【本工具只读，一个写操作都没有】
  它只做 SELECT。真要删的时候再加一个显式的 `--clean --yes` 分支，而且**必须 owner 确认过**、
  并且先在测试库上验证一次 —— 删数据不可逆，不该由「顺手写的脚本」来干。

用法：
    python tools/quiz_data_report.py                           # 总览：每个活动有多少提交
    python tools/quiz_data_report.py --activity 347            # 看某个活动：题目数 + 提交明细
    python tools/quiz_data_report.py --activity 347 --user 123 # 只看某个账号的
退出码：0 成功；1 读配置 / 连库失败
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "db.local.yaml"


def read_config(config_path):
    """读 config/db.local.yaml，返回一个规整过的字典（host/port/user/password/database）。

    单独的读配置函数（不连库）：这样别的工具（如 quiz_data_cleanup）也能拿到**库名**
    做安全判断 —— 删数据的工具得先确认"我连的是测试库"，不能靠猜。
    """
    try:
        import yaml
    except ImportError as e:
        print("缺少依赖：%s（装一下：pip install -r requirements.txt）" % e.name)
        sys.exit(1)

    path = Path(config_path)
    if not path.exists():
        print("找不到数据库配置：%s" % path)
        print("  它由 tools/import_db_config.py 从 miniapp-flow/.env 生成（含真实凭据，不入库）。")
        sys.exit(1)

    cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    # 配置可能是平铺的（database 就是库名字符串），也可能分 database / db 段 —— 两种都兼容
    db = cfg if isinstance(cfg.get("database"), str) else (cfg.get("database") or cfg.get("db") or cfg)

    def get(key):
        return db.get(key) or cfg.get(key)

    return {
        "host": get("host"),
        "port": int(get("port") or 3306),
        "user": get("user"),
        "password": get("password"),
        "database": get("database"),
    }


def load_conn(config_path):
    """读 config/db.local.yaml 并连库。配置被 gitignore（含真实凭据），且**不打印密码**。"""
    try:
        import pymysql
    except ImportError as e:
        print("缺少依赖：%s（装一下：pip install -r requirements.txt）" % e.name)
        sys.exit(1)

    cfg = read_config(config_path)
    print("连接：%s@%s/%s（密码不回显）" % (cfg["user"], cfg["host"], cfg["database"]))
    try:
        return pymysql.connect(
            host=cfg["host"],
            port=cfg["port"],
            user=cfg["user"],
            password=cfg["password"],
            database=cfg["database"],
            charset="utf8mb4",
            connect_timeout=8,
        )
    except pymysql.err.OperationalError as e:
        # 【为什么要把报错翻译成人话】2026/10/13 全量跑里 `ZW_018` 红了一条，
        # 报错尾巴是 pymysql 的 traceback（`Can't connect ... (timed out)`）——
        # 看的人第一反应是"框架坏了"，其实是**这台机器连不到测试库**。
        # 真正有用的信息是"接下来该查什么"，所以这里直接说清。
        print()
        print("连不上测试库：%s:%s（库 %s）" % (cfg["host"], cfg["port"], cfg["database"]))
        print("  常见原因，按这个顺序查：")
        print("    ① 不在公司网络 / VPN 没连（测试库只对特定网络开放）；")
        print("    ② 这台机器的出口 IP 不在 RDS 白名单里（今天能连、明天不能，多半是这个）；")
        print("    ③ 测试库临时不可用。")
        print("  自检小技巧：**ping 得通、但 3306 端口连不上** -> 基本就是白名单/防火墙问题")
        print("     （ping 走 ICMP，跟 3306 端口通不通无关）。")
        print("  原始报错：%s" % str(e).splitlines()[0])
        print("  影响范围：依赖数据库的用例会红（答题提交记录/复位、案例复制复位、课程 0 课时对账）；")
        print("            纯界面用例不受影响，可以先跑它们。")
        sys.exit(1)


OVERVIEW_SQL = (
    "select a.activity_id, max(h.activity_name) as name, count(*) as submits,"
    " min(a.submit_time) as first_time, max(a.submit_time) as last_time"
    " from home_activity_quiz_answer a"
    " left join home_activity h on h.id = a.activity_id"
    " group by a.activity_id"
    " order by submits desc"
)


def show_overview(cur):
    """总览：每个活动有多少提交、最早/最近一次是什么时候"""
    cur.execute(OVERVIEW_SQL)
    rows = cur.fetchall()
    print("\n=== 答题提交总览（按提交数排序）===")
    if not rows:
        print("  （一条都没有）")
    else:
        print("  %-9s %-26s %7s  %-19s  %-19s" % ("活动id", "活动名", "提交数", "最早", "最近"))
        for r in rows:
            print(
                "  %-9s %-26s %7s  %-19s  %-19s"
                % (r[0], str(r[1] or "(主表里读不到名字)")[:26], r[2], r[3], r[4])
            )
    cur.execute("select count(*) from home_activity_quiz_answer")
    total_a = cur.fetchone()[0]
    cur.execute("select count(*) from home_activity_quiz_answer_detail")
    total_d = cur.fetchone()[0]
    print("\n  合计：提交 %s 条，明细 %s 条" % (total_a, total_d))
    print("  提醒：这些是**测试环境真实账号**留下的记录；本工具只读，不会动它们。")


def show_activity(cur, activity_id, user_id=None):
    """看某个活动：题目数 + 提交明细 + 「若要清理会涉及多少行」的预览"""
    where = "where activity_id = %s" + (" and user_id = %s" if user_id else "")
    args = (activity_id, user_id) if user_id else (activity_id,)

    cur.execute("select activity_name from home_activity where id = %s", (activity_id,))
    name_row = cur.fetchone()
    print("\n=== 活动 %s：%s ===" % (activity_id, (name_row[0] if name_row else "(主表里没有这个活动 id)")))

    cur.execute("select count(*) from home_activity_question where activity_id = %s", (activity_id,))
    print("  题目数：%s" % cur.fetchone()[0])

    cur.execute("select count(*) from home_activity_quiz_answer " + where, args)
    submits = cur.fetchone()[0]
    cur.execute("select count(*) from home_activity_quiz_answer_detail " + where, args)
    details = cur.fetchone()[0]
    print("  提交记录：%s 条%s" % (submits, ("（限定账号 %s）" % user_id) if user_id else ""))
    print("  作答明细：%s 条" % details)

    cur.execute(
        "select user_id, question_count, correct_count, actual_point, submit_time"
        " from home_activity_quiz_answer " + where + " order by submit_time desc limit 10",
        args,
    )
    rows = cur.fetchall()
    if rows:
        print("\n  最近 10 次提交：")
        print("    %-12s %5s %5s %6s  %s" % ("user_id", "题数", "答对", "得分", "提交时间"))
        for r in rows:
            print("    %-12s %5s %5s %6s  %s" % (r[0], r[1], r[2], r[3], r[4]))

    print(
        "\n  【如果要清理】上面那两行数字就是「会删掉多少行」：提交 %s 条 + 明细 %s 条。"
        % (submits, details)
    )
    print(
        "  本工具**只读**，不会执行删除；删除动作要等确认口径后再单独实现，并且先在测试库上验一次。"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="答题数据体检（只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--activity", type=int, help="只看某个活动 id，例如 347")
    parser.add_argument("--user", type=int, help="只看某个 user_id（配合 --activity 使用）")
    args = parser.parse_args(argv)

    conn = load_conn(args.config)
    try:
        cur = conn.cursor()
        if args.activity:
            show_activity(cur, args.activity, args.user)
        else:
            show_overview(cur)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
