# -*- coding: utf-8 -*-
"""案例复制的「体检 / 复位」工具（**会删数据，默认只读**）。

【为什么需要它】
  需求 713381608 里「案例复制完成后弹提示」这一条，只有**真的复制一次**才测得到。
  复制会写两张表：
    · `simulation_copy_record` 加一条记录
    · `simulation_case.copy_count` 加一
  没有复位手段就只能测一次。这个工具就是那个复位动作 —— 和答题的
  `quiz_data_cleanup.py` 是同一套思路（owner 2026/10/12 授权：**可以改这个用户的数据**）。

【怎么保证"只删自己刚造的那条"】
  靠**标记水位**：复制前先 `--report` 记下当时最大的记录 id（marker），
  复制后 `--reset --since-id <marker>` 只删"id 比 marker 大的、且属于这个案例的"记录，
  并把 `copy_count` 减掉同样条数。这样别人同时也在复制也不会被误删。

用法:
    python tools/case_copy_reset.py --case 60                 # 体检（只读）：复制数 + 记录数 + 水位
    python tools/case_copy_reset.py --case-title 凝固应力      # 按标题找（重名会拒绝执行）
    python tools/case_copy_reset.py --case 60 --reset --since-id 182 --yes   # 复位
    python tools/case_copy_reset.py --case 60 --expect-records 5             # 校验记录条数

退出码: 0 正常；1 配置/连库失败；2 被安全闸门挡下（没删任何东西）或校验不通过
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_cleanup import DEFAULT_CONFIG, TEST_DB_MARKERS, load_conn, read_config  # noqa: E402

CASE_TABLE = "simulation_case"
RECORD_TABLE = "simulation_copy_record"

# 没有 --force 时，一次最多删这么多条复制记录（owner 授权的是"我们自己造的少量记录"）
MAX_ROWS_WITHOUT_FORCE = 20


def decide_reset(db_name, case_id, rows_to_delete, force=False, force_db=False):
    """能不能删 —— 纯函数（不碰库），便于离线自测。返回 (allowed, reasons)"""
    reasons = []
    if not case_id:
        reasons.append("没给 --case / --case-title。复位必须点名「哪个案例」，否则可能删掉一大片。")
    name = str(db_name or "").lower()
    if not any(m in name for m in TEST_DB_MARKERS) and not force_db:
        reasons.append(
            "数据库名 %r 不像测试库（不含 %s）。删数据不可逆：确认这是测试库再加 --force-db。"
            % (db_name, " / ".join(TEST_DB_MARKERS))
        )
    if int(rows_to_delete or 0) > MAX_ROWS_WITHOUT_FORCE and not force:
        reasons.append(
            "这次会删 %d 条复制记录，超过上限 %d 条（owner 授权的是「我们自己造的少量记录」）。"
            "确认无误再加 --force。" % (int(rows_to_delete or 0), MAX_ROWS_WITHOUT_FORCE)
        )
    return (not reasons), reasons


def pick_case_id(rows, key):
    """按标题挑出唯一的那个案例（纯函数）。0 个 / 多个都拒绝 —— 不猜。"""
    rows = list(rows or [])
    if not rows:
        return None, "在 %s 里找不到标题为 %r 的案例" % (CASE_TABLE, key)
    if len(rows) > 1:
        return None, "有 %d 个案例都叫 %r（id: %s）—— 名字不唯一，改用 --case 指定 id" % (
            len(rows),
            key,
            "、".join(str(r[0]) for r in rows),
        )
    return int(rows[0][0]), None


def case_state(cur, case_id):
    cur.execute("select id, title, points, copy_count from %s where id = %%s" % CASE_TABLE, (case_id,))
    row = cur.fetchone()
    cur.execute("select count(*), ifnull(max(id), 0) from %s where ori_case_id = %%s" % RECORD_TABLE, (case_id,))
    records, max_id = cur.fetchone()
    return {
        "case": row,  # (id, title, points, copy_count) 或 None
        "records": int(records or 0),
        "max_record_id": int(max_id or 0),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="案例复制的体检 / 复位（默认只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--case", type=int, help="案例 id")
    parser.add_argument("--case-title", help="案例标题（跟页面上一字不差；重名会拒绝）")
    parser.add_argument("--since-id", type=int, help="水位：只删 id 比它大的记录（复制前 --report 读到的 max_record_id）")
    parser.add_argument("--reset", action="store_true", help="执行复位（不加就只体检）")
    parser.add_argument("--yes", action="store_true", help="确认执行（配合 --reset）")
    parser.add_argument("--force", action="store_true", help="放行超过上限的批量删除")
    parser.add_argument("--force-db", action="store_true", help="放行「库名不像测试库」")
    parser.add_argument("--expect-records", type=int, help="校验：这个案例现在的复制记录数应当等于它")
    parser.add_argument("--expect-copy-count", type=int, help="校验：这个案例现在的 copy_count 应当等于它")
    args = parser.parse_args(argv)

    if args.case and args.case_title:
        print("--case 和 --case-title 只能给一个")
        return 2

    db_name = read_config(args.config)["database"]
    conn = load_conn(args.config)
    try:
        cur = conn.cursor()

        if args.case_title:
            cur.execute("select id, title from %s where title = %%s" % CASE_TABLE, (args.case_title,))
            found = cur.fetchall()
            resolved, why = pick_case_id(found, args.case_title)
            if resolved is None:
                print("\n[拒绝执行] 没能唯一定位案例：%s" % why)
                print("[COPY] mode=refused case-title=%s" % args.case_title)
                return 2
            print("\n按标题定位到案例 id：%s（%s）" % (resolved, args.case_title))
            args.case = resolved

        st = case_state(cur, args.case)
        if st["case"] is None:
            print("\n[拒绝执行] 案例 id=%s 在 %s 里不存在" % (args.case, CASE_TABLE))
            print("[COPY] mode=refused case=%s" % args.case)
            return 2
        cid, title, points, copy_count = st["case"]
        print("\n=== 案例 %s「%s」===" % (cid, title))
        print("  积分：%s ｜ copy_count：%s" % ("免费" if points in (None, 0) else points, copy_count))
        print("  复制记录：%s 条（最大记录 id = %s，这就是复位用的水位）" % (st["records"], st["max_record_id"]))
        # points 也带上：付费案例复制会扣积分（记在中台），用例侧要能据此提醒"这一步扣了分"
        print(
            "[COPY] mode=report case=%s copy_count=%s records=%s max_record_id=%s points=%s"
            % (cid, copy_count, st["records"], st["max_record_id"], points if points is not None else "free")
        )

        if args.expect_records is not None:
            ok = st["records"] == args.expect_records
            print("\n[校验] 复制记录 %s 条（期望 %s 条）-> %s" % (st["records"], args.expect_records, "通过" if ok else "不通过"))
            print("[COPY] mode=verify case=%s records=%s expect=%s" % (cid, st["records"], args.expect_records))
            return 0 if ok else 2
        if args.expect_copy_count is not None:
            ok = int(copy_count or 0) == args.expect_copy_count
            print("\n[校验] copy_count %s（期望 %s）-> %s" % (copy_count, args.expect_copy_count, "通过" if ok else "不通过"))
            print("[COPY] mode=verify case=%s copy_count=%s expect=%s" % (cid, copy_count, args.expect_copy_count))
            return 0 if ok else 2

        if not args.reset:
            print("\n[预览] 没有加 --reset，什么都没删。复位命令形如：")
            print("  python tools/case_copy_reset.py --case %s --reset --since-id %s --yes" % (cid, st["max_record_id"]))
            return 0

        since = args.since_id if args.since_id is not None else st["max_record_id"]
        cur.execute(
            "select count(*) from %s where ori_case_id = %%s and id > %%s" % RECORD_TABLE, (cid, since)
        )
        rows_to_delete = int(cur.fetchone()[0])
        allowed, reasons = decide_reset(db_name, cid, rows_to_delete, force=args.force, force_db=args.force_db)
        if not allowed:
            print("\n[拒绝执行] 安全闸门拦下了这次复位：")
            for r in reasons:
                print("  · %s" % r)
            print("[COPY] mode=refused case=%s rows=%s" % (cid, rows_to_delete))
            return 2
        if not args.yes:
            print("\n[预览] 没加 --yes：这次会删 %d 条复制记录（并把 copy_count 减 %d），但**什么都没做**" % (rows_to_delete, rows_to_delete))
            return 0

        if rows_to_delete:
            cur.execute("delete from %s where ori_case_id = %%s and id > %%s" % RECORD_TABLE, (cid, since))
            deleted = cur.rowcount
            # copy_count 往下减，但不允许减成负数（数据被别处改过时不要把水位弄坏）
            cur.execute(
                "update %s set copy_count = greatest(ifnull(copy_count, 0) - %%s, 0) where id = %%s" % CASE_TABLE,
                (deleted, cid),
            )
            conn.commit()
        else:
            deleted = 0

        after = case_state(cur, cid)
        print("\n[已复位] 删掉复制记录 %s 条；现在 copy_count=%s、记录 %s 条" % (deleted, after["case"][3], after["records"]))
        print(
            "[COPY] mode=reset case=%s deleted=%s copy_count=%s records=%s"
            % (cid, deleted, after["case"][3], after["records"])
        )
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
