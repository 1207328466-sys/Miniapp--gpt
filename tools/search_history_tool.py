# -*- coding: utf-8 -*-
"""搜索历史 造数 / 复位（**会写库**；默认只预览，不加 --yes 不动数据）。

【为什么需要它 —— 这是"中文搜索"的钥匙】（2026/10/13 实测）
  框架往搜索框输入关键词靠 `adb shell input text`，而它**只支持 ASCII**：中文发过去不报错也不生效。
  另外两条路都试过、都不通：
    · Playwright `keyboard.insertText()`（走 CDP）→ 小程序的输入框是**原生组件**，
      DOM 里那个 `<input>` 是 `disabled + visibility:hidden` 的镜像，CDP 的字进不去；
    · JS 注入（给 wx-input 赋 value + 派发 input 事件）→ 只改到"镜像属性"，
      提交后行为跟"没输入"一模一样（小程序不认）。

  但实测发现一条**全自动、不用装任何东西**的路：
    `search_history` 这张表就是搜索页上那排「搜索历史」词条（库里的 7 条和手机上的 7 个词一一对应）。
    往这张表插一行中文关键词 → 重新进搜索页就能看到那个词 → **点它就直接触发一次中文搜索**。
  于是中文搜索变成："造一行历史 -> 用例点那个词 -> 断言结果页/空态"。

【三道闸】（和 quiz_data_cleanup / course_record_tool 一个路子）
  1. **默认只预览**：不加 --yes 一个字节都不写；
  2. **必须点名**：--user 和 --keyword 都给（防写错账号、防手滑删一片）；
  3. **只认测试库**：库名里必须含 alpha / test，否则拒绝（要动别的库得显式 --force-db）。

用法：
    python tools/search_history_tool.py --user 1966910 --keyword 压铸        # 预览
    python tools/search_history_tool.py --user 1966910 --keyword 压铸 --add --yes
    python tools/search_history_tool.py --user 1966910 --keyword 压铸 --delete --yes
    python tools/search_history_tool.py --user 1966910 --keyword 压铸 --expect 1
退出码：0 正常；1 读配置/连库失败；2 被安全闸门挡下（没动任何数据）
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

TABLE = "search_history"
TEST_DB_MARKERS = ("alpha", "test")


def decide(db_name, user_id, keyword, existing, add, delete, force_db=False):
    """这一票能不能动数据 —— **纯函数，不碰库**。@returns (allowed, reasons)"""
    reasons = []
    if not user_id:
        reasons.append("没给 --user。改数据必须点名「哪个账号」，否则可能写到别人身上。")
    if not keyword:
        reasons.append("没给 --keyword。必须点名是哪个关键词（否则可能删掉一整片历史）。")
    name = str(db_name or "").lower()
    if not any(m in name for m in TEST_DB_MARKERS) and not force_db:
        reasons.append("数据库名 %r 不像测试库（不含 %s）。确认是测试库再加 --force-db。"
                       % (db_name, " / ".join(TEST_DB_MARKERS)))
    if delete and existing == 0:
        reasons.append("要删，但库里这个账号 + 这个关键词一条都没有 —— 没什么可删的。")
    if add and existing > 0:
        reasons.append("这个账号已经有这个关键词了（%d 条）—— 小程序按关键词去重，再插一条没有意义。"
                       % existing)
    return (not reasons), reasons


def count_rows(cur, user_id, keyword):
    cur.execute("select count(*) from %s where user_id = %%s and keyword = %%s" % TABLE, (user_id, keyword))
    return int(cur.fetchone()[0])


def list_rows(cur, user_id, limit=10):
    cur.execute(
        "select id, keyword, create_time, is_deleted from %s where user_id = %%s order by id desc limit %d"
        % (TABLE, int(limit)),
        (user_id,),
    )
    return cur.fetchall()


def main(argv=None):
    parser = argparse.ArgumentParser(description="搜索历史 造数/复位（默认只预览）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--user", type=int, help="账号 user_id（必填），例如 1966910")
    parser.add_argument("--keyword", help="关键词（必填）—— 中文也可以，这正是这个工具的用途")
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--add", action="store_true", help="造一行搜索历史（需要 --yes 才真写）")
    g.add_argument("--delete", action="store_true", help="删掉这个账号 + 这个关键词的历史（需要 --yes）")
    parser.add_argument("--yes", action="store_true", help="真的执行（不加就是预览）")
    parser.add_argument("--force-db", action="store_true", help="放行「库名不像测试库」的情况")
    parser.add_argument("--expect", type=int, help="只校验：读到的条数不等于这个值就以退出码 2 结束")
    args = parser.parse_args(argv)

    db_name = read_config(args.config)["database"]
    conn = load_conn(args.config)
    try:
        cur = conn.cursor()
        existing = count_rows(cur, args.user, args.keyword) if (args.user and args.keyword) else 0

        print("\n=== 搜索历史：账号 %s / 关键词 %r ===" % (args.user, args.keyword))
        print("  现在这个账号 + 这个关键词：%s 条" % existing)
        if args.user:
            rows = list_rows(cur, args.user)
            if rows:
                print("  这个账号最近的历史（最多 10 条）：%s"
                      % "、".join("%s(%s)" % (r[1], r[2].strftime("%m-%d %H:%M")) for r in rows))

        if args.expect is not None:
            print("\n[校验] 当前 %s 条（期望 %s 条）" % (existing, args.expect))
            print("[SEARCH_HISTORY] mode=verify user=%s keyword=%s rows=%s expect=%s"
                  % (args.user, args.keyword, existing, args.expect))
            return 0 if existing == args.expect else 2

        allowed, reasons = decide(db_name, args.user, args.keyword, existing,
                                  args.add, args.delete, args.force_db)
        if not allowed:
            print("\n[拒绝执行] 一个字节都没动：")
            for r in reasons:
                print("  · %s" % r)
            print("[SEARCH_HISTORY] mode=refused user=%s keyword=%s" % (args.user, args.keyword))
            return 2

        if not (args.add or args.delete):
            print("\n（只是预览。要造数加 --add --yes；要复位加 --delete --yes）")
            print("[SEARCH_HISTORY] mode=preview user=%s keyword=%s rows=%s" % (args.user, args.keyword, existing))
            return 0

        if not args.yes:
            print("\n[预览] 将会%s 1 行（user=%s keyword=%s）"
                  % ("写入" if args.add else "删除", args.user, args.keyword))
            print("  确认无误就加 --yes 真跑一次。")
            print("[SEARCH_HISTORY] mode=dry-run user=%s keyword=%s rows=%s" % (args.user, args.keyword, existing))
            return 0

        if args.add:
            cur.execute(
                "insert into %s (user_id, keyword, create_time, is_deleted) values (%%s, %%s, now(), 0)" % TABLE,
                (args.user, args.keyword),
            )
            conn.commit()
            print("\n[已写入] 1 行搜索历史（小程序**重新进搜索页**就能看到这个词）")
        else:
            cur.execute("delete from %s where user_id = %%s and keyword = %%s" % TABLE, (args.user, args.keyword))
            conn.commit()
            print("\n[已删除] %s 行" % cur.rowcount)

        after = count_rows(cur, args.user, args.keyword)
        print("[SEARCH_HISTORY] mode=%s user=%s keyword=%s rows=%s"
              % ("add" if args.add else "delete", args.user, args.keyword, after))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
