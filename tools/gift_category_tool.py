# -*- coding: utf-8 -*-
"""积分商城「礼品分类」的**屏蔽 / 还原**工具（只动 `gift_category.status` 一个字段）。

【为什么要有它】缺陷 713396918 的回归用例需要"某个分类已被屏蔽"这个夹具，而
**夹具必须可还原**（owner 2026/10/14：数据改完记得还原）。屏蔽/还原各一条命令，谁都能跑。

口径（来自需求与表字典，实测核对过）：
  · `gift_category.status`：1 = 启用、0 = 未启用（即"屏蔽"）；小程序端积分商城**不展示**未启用分类的礼品
    —— 缺陷原文：「屏蔽某一分类后积分商城首页的全部分类下，不应显示已屏蔽分类的礼品」
  · 只改 status，**不碰 is_deleted**（删除是不可逆的另一回事）

三道闸（和本仓其它写工具同一套）：
  1. 库名必须**像测试库**（含 alpha/test/dev 之类），否则拒绝；
  2. 必须**点名分类 id**（不许"猜一个"）；
  3. 默认**只预览**，要真写必须加 `--yes`。

用法：
    python tools/gift_category_tool.py --id 27                 # 预览：现在是什么状态、要改成什么
    python tools/gift_category_tool.py --id 27 --block  --yes  # 屏蔽（status=0）
    python tools/gift_category_tool.py --id 27 --restore --yes # 还原（status=1）
退出码：0 成功；1 被闸门拦下；2 参数/连接问题

⚠️ 还原的口径：除非用 `--restore`，否则**不会**自动还原 —— 跑夹具的人自己记得跑一次还原
（或者把屏蔽/还原写成用例里的两步，用 `UITEST_ALLOW_SUBMIT=1` 时才允许）。
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

TEST_DB_HINTS = ("alpha", "test", "dev", "beta")


def main(argv=None):
    ap = argparse.ArgumentParser(description="礼品分类 屏蔽/还原（只改 status）")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    ap.add_argument("--id", type=int, help="礼品分类 id（gift_category.id）")
    ap.add_argument("--name", help="礼品分类名（跟后台一字不差；重名会拒绝，让你改用 --id）")
    ap.add_argument("--block", action="store_true", help="屏蔽（status=0）")
    ap.add_argument("--restore", action="store_true", help="还原（status=1）")
    ap.add_argument("--yes", action="store_true", help="真的写库（不加就是只预览）")
    args = ap.parse_args(argv)

    preview_only = not (args.block or args.restore)
    if args.block and args.restore:
        print("[拒绝] 二选一：--block 或 --restore")
        return 2
    if not args.id and not args.name:
        print("[拒绝] 要点名目标：--id 27 或 --name 实物商品")
        return 2

    cfg = read_config(args.config)
    db = str(cfg.get("database") or "")
    if not any(h in db.lower() for h in TEST_DB_HINTS):
        print("[拒绝] 库名 %r 看起来不像测试库（只认含 %s 的），不写。" % (db, "/".join(TEST_DB_HINTS)))
        return 1

    if preview_only:
        target = None  # 只看现状，不改
    else:
        target = 0 if args.block else 1
    conn = load_conn(args.config)
    cur = conn.cursor()
    # 按名字找时**必须唯一**：重名就让人改用 --id（猜一个的后果是改错分类）
    if args.name:
        cur.execute(
            "select id, category_name, status, is_deleted, gift_count from gift_category "
            "where category_name = %s and is_deleted = 0 order by id",
            (args.name,),
        )
        found = cur.fetchall()
        if len(found) > 1:
            print("[拒绝] 名字「%s」有 %d 个未删除的分类，请改用 --id：%s"
                  % (args.name, len(found), [r[0] for r in found]))
            cur.close()
            conn.close()
            return 1
        row = found[0] if found else None
    else:
        cur.execute("select id, category_name, status, is_deleted, gift_count from gift_category where id = %s", (args.id,))
        row = cur.fetchone()
    if not row:
        print("[!] 没有这个分类 id：%s" % args.id)
        cur.close()
        conn.close()
        return 2
    cid, name, status, deleted, gifts = row
    if deleted:
        print("[拒绝] 分类 id=%s「%s」已经是删除状态（is_deleted=1），不在这条工具的责任范围里。" % (cid, name))
        cur.close()
        conn.close()
        return 1

    what = "屏蔽" if args.block else ("还原" if args.restore else "（只看，不改）")
    if preview_only:
        print("分类 id=%s「%s」：现在 status=%s（1=启用 0=未启用）；该分类有 %s 个礼品" % (cid, name, status, gifts))
        print("  要屏蔽：--id %s --block --yes     要还原：--id %s --restore --yes" % (cid, cid))
        cur.close()
        conn.close()
        return 0
    print("分类 id=%s「%s」：status %s → %s（%s）；该分类有 %s 个礼品" % (cid, name, status, target, what, gifts))
    if int(status or 0) == target:
        print("  （已经是这个状态了，幂等：不需要改）")
        cur.close()
        conn.close()
        return 0
    if not args.yes:
        print("  dry-run：没有写库。确认要%s就加 --yes。" % what)
        cur.close()
        conn.close()
        return 0

    cur.execute("update gift_category set status = %s, update_time = now() where id = %s", (target, cid))
    conn.commit()
    cur.execute("select status from gift_category where id = %s", (cid,))
    print("  [已改] 现在 status = %s（要还原请跑：--id %s --restore --yes）" % (cur.fetchone()[0], cid))
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
