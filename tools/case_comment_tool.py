# -*- coding: utf-8 -*-
"""案例评论「带图评论」夹具（造 / 删，只动我们自己的那两条记录）。

【为什么要有它】缺陷 713369819：「发布带图的评论到案例详情，查看时图片未显示」要做成回归用例，
就得先有一条"带图评论"。而这条评论**只能自己造**：
  · 管理后台只有"查评论/删评论"（`/manager/simulationCase/getCommentList`、`deleteCommentByManager`），
    **没有"造评论"的接口**（评论是小程序端用户发的）；
  · 小程序端发评论要过微信的**原生图片选择器**，框架现在驱动不了。

【数据形态（2026/10/15 实测核对）】
  · 评论本体：`locution_comment`（`biz_id`=案例id、`clazz_type`=1 案例库、
    `status`=3、`manager_status`=0、`is_deleted`=0、`level`=1、`parent_id`=0）
  · 评论图片：`upload_file`（`biz_id`=**评论id**、`file_type`=7、`path`=图片的 OSS 引用）
    —— 后台接口返回的 `img` 字段就是从这儿拼出来的（实测：评论 144 的 `img` 末尾
    `73dd778bbe…_20260820142825091.jpg` 与 `upload_file` 里 biz_id=144 的那行 `path` 一模一样）

【我们怎么认得出自己造的那条】内容里写死一个**标记**（默认 `UITEST带图评论`），
删的时候只删"内容=这个标记"的行 —— 绝不按时间/范围乱删。

三道闸（和本仓其它写工具一致）：
  1. 库名必须像测试库（含 alpha/test/dev/beta），否则拒绝；
  2. 必须点名案例（`--case <id>` 或 `--case-title <标题>`，标题重名拒绝）；
  3. 默认只预览，要真写加 `--yes`。

用法：
    python tools/case_comment_tool.py --case 60                 # 预览：这条案例现在有几条评论
    python tools/case_comment_tool.py --case 60 --add --yes      # 造一条带图评论
    python tools/case_comment_tool.py --case 60 --remove --yes   # 删掉我们造的那条
    python tools/case_comment_tool.py --case 60 --list           # 只列评论（含有没有图）

机器读的输出：
    [CASECMT] mode=state case=60 comments=4 ours=0
    [CASECMT] mode=add   case=60 comment=137 image=yes
    [CASECMT] mode=remove case=60 deleted=1 images=1
退出码：0 正常；1 被闸门拦下；2 参数问题
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

TEST_DB_HINTS = ("alpha", "test", "dev", "beta")
MARK = "UITEST带图评论"  # 认领我们造的那条评论（删的时候只认它）
IMG_NAME = "uitest_case_comment.jpg"  # 认领我们那张图片行（**不能只按 biz_id 删**：
                                     # `upload_file.biz_id` 会跟别的业务撞车，实测 biz_id=147 上就有别人的行）
OUR_USER = 1966910  # 这台手机登录的测试账号（config/env.yaml 的 user_id）


def pick_case(cur, case_id, case_title):
    if case_id:
        cur.execute("select id, title from simulation_case where id = %s", (case_id,))
        row = cur.fetchone()
        if not row:
            print("[拒绝] simulation_case 里没有 id=%s" % case_id)
            return None
        return row
    cur.execute(
        "select id, title from simulation_case where title = %s and is_deleted = 0",
        (case_title,),
    )
    rows = cur.fetchall()
    if not rows:
        print("[拒绝] 没有标题为 %r 的案例" % case_title)
        return None
    if len(rows) > 1:
        print(
            "[拒绝] 标题 %r 有 %d 条重名（id=%s）—— 请改用 --case"
            % (case_title, len(rows), ",".join(str(r[0]) for r in rows))
        )
        return None
    return rows[0]


def pick_image_path(cur):
    """借一张**已经存在的**评论图（照抄它的 path/尺寸），保证图片是真实可访问的。

    实测口径（2026/10/15，拿"接口确实返回了 img"的评论 144/145 反查）：
      · 评论自己的图 = `biz_type=2`（**评论**）+ `file_type=7`，`biz_id` = 评论 id，带 width/height/file_size；
      · `biz_type=1`（**案例**）+ `file_type=4` 那些行虽然 biz_id 也等于评论 id，
        其实属于**同号的案例**（biz_id 撞车）—— 照抄它们，后台接口的 `img` 还是 null（实测踩过）。
    """
    cur.execute(
        "select u.path, u.width, u.height, u.file_size, u.file_type, u.biz_type"
        " from upload_file u join locution_comment lc on lc.id = u.biz_id"
        " where lc.clazz_type = 1 and lc.is_deleted = 0"
        " and u.biz_type = 2 and u.file_type = 7 and u.width is not null and u.path like %s"
        " order by u.id desc limit 1",
        ("srn:%",),
    )
    row = cur.fetchone()
    if not row:
        print("[拒绝] 库里找不到「挂在案例评论上」的图片，没法照抄路径")
        return None
    return row


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="案例带图评论夹具（默认只预览）")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--case", type=int, help="案例 id（simulation_case.id）")
    ap.add_argument("--case-title", help="案例标题（重名会拒绝，让你改用 --case）")
    ap.add_argument("--add", action="store_true", help="造一条带图评论")
    ap.add_argument("--remove", action="store_true", help="删掉我们造的那条（按内容标记认领）")
    ap.add_argument("--list", action="store_true", help="只列评论")
    ap.add_argument("--yes", action="store_true", help="真的写库（不加就是只预览）")
    args = ap.parse_args(argv)

    if args.add and args.remove:
        print("[拒绝] 二选一：--add 或 --remove")
        return 2
    if not args.case and not args.case_title:
        print("[拒绝] 要点名案例：--case 60 或 --case-title 凝固应力")
        return 2

    cfg = read_config(args.config)
    db = str(cfg.get("database") or "")
    if not any(h in db.lower() for h in TEST_DB_HINTS):
        print("[拒绝] 库名 %r 看起来不像测试库（只认含 %s 的），不写。" % (db, "/".join(TEST_DB_HINTS)))
        return 1

    conn = load_conn(args.config)
    cur = conn.cursor()
    case = pick_case(cur, args.case, args.case_title)
    if not case:
        return 1
    case_id, title = case
    print("案例：id=%s 标题=%r" % (case_id, title))

    cur.execute(
        "select id, user_id, content, is_deleted, status, manager_status,"
        " (select count(*) from upload_file u where u.biz_id = lc.id) as files"
        " from locution_comment lc where biz_id = %s and clazz_type = 1 order by id",
        (case_id,),
    )
    rows = cur.fetchall()
    ours = [r for r in rows if (r[2] or "").strip() == MARK]
    print("现有评论 %d 条（其中我们造的 %d 条）：" % (len(rows), len(ours)))
    for r in rows:
        print(
            "  id=%-5s user=%-8s 删除=%s 状态=%s 屏蔽=%s 图=%s 内容=%r"
            % (r[0], r[1], r[3], r[4], r[5], r[6], (r[2] or "")[:20])
        )
    print("[CASECMT] mode=state case=%s comments=%d ours=%d" % (case_id, len(rows), len(ours)))

    if args.list:
        conn.close()
        return 0

    if args.add:
        if ours:
            print("已经有我们造的评论了（id=%s），先 --remove 再 --add。" % ours[0][0])
            return 0
        img = pick_image_path(cur)
        if not img:
            return 1
        path, width, height, fsize, ftype, btype = img
        print("要造的评论：内容=%r、图片照抄 %s" % (MARK, path[:60] + "…"))
        print("  （图片行：file_type=%s biz_type=%s %sx%s）" % (ftype, btype, width, height))
        if not args.yes:
            print("（预览：没写。确认后加 --yes）")
            conn.close()
            return 0
        cur.execute(
            "insert into locution_comment"
            " (biz_id, clazz_type, user_id, content, parent_id, to_user_id, create_time,"
            "  score, top_flag, status, like_count, manager_status, level, is_deleted)"
            " values (%s, 1, %s, %s, 0, NULL, now(), 0, 0, 3, 0, 0, 1, 0)",
            (case_id, OUR_USER, MARK),
        )
        comment_id = cur.lastrowid
        cur.execute(
            "insert into upload_file (file_name, file_type, biz_type, biz_id, create_time, path,"
            " status, width, height, sort, file_size)"
            " values (%s, %s, %s, %s, now(), %s, 0, %s, %s, 0, %s)",
            (IMG_NAME, ftype, btype, comment_id, path, width, height, fsize),
        )
        conn.commit()
        cur.execute(
            "select count(*) from upload_file where biz_id = %s and file_name = %s",
            (comment_id, IMG_NAME),
        )
        print("[已造] 评论 id=%s，我们那张图片行 %s 行" % (comment_id, cur.fetchone()[0]))
        print("[CASECMT] mode=add case=%s comment=%s image=yes" % (case_id, comment_id))
        conn.close()
        return 0

    if args.remove:
        if not ours:
            print("没有我们造的评论（内容=%r），不删。" % MARK)
            print("[CASECMT] mode=remove case=%s deleted=0 images=0" % case_id)
            conn.close()
            return 0
        ids = [r[0] for r in ours]
        print("要删：评论 %s（连同它们的图片行）" % ids)
        if not args.yes:
            print("（预览：没删。确认后加 --yes）")
            conn.close()
            return 0
        # 只删**我们造的那一行图片**：biz_id 会跟别的业务撞车，光按 biz_id 删会误伤
        cur.execute(
            "delete from upload_file where file_name = %%s and biz_id in (%s)" % ",".join(["%s"] * len(ids)),
            [IMG_NAME] + ids,
        )
        images = cur.rowcount
        cur.execute("delete from locution_comment where id in (%s)" % ",".join(["%s"] * len(ids)), ids)
        deleted = cur.rowcount
        conn.commit()
        print("[已删] 评论 %s 条、图片 %s 行" % (deleted, images))
        print("[CASECMT] mode=remove case=%s deleted=%s images=%s" % (case_id, deleted, images))
        conn.close()
        return 0

    print("（预览模式：什么都没改。要造加 --add、要删加 --remove，都要 --yes）")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
