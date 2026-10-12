# -*- coding: utf-8 -*-
"""课程/课时体检（**只读**）：把"课时数为 0 的课程"列出来，供小程序端对账。

【为什么需要它】
  需求 713367615 第 1 条：「管理后台的课程下的课时数为 0 时，**小程序端不显示该课程**」。
  要验这条，就得知道"哪些课程是 0 课时" —— 答案在数据库里，不在界面上（界面上它们本来就不该出现）。
  于是这里把名单打出来（机器友好的 JSON 一行），表格动作「检查课时数为0的课程不显示」拿它对账。

【只读】本工具一个写操作都没有，纯 SELECT。

用法:
    python tools/course_list_report.py                  # 只列"课时数为 0 的公开课程"
    python tools/course_list_report.py --all            # 顺便把全部课程与课时数打出来
退出码: 0 成功；1 读配置/连库失败
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_cleanup import DEFAULT_CONFIG, load_conn  # noqa: E402

# 课时数怎么数：按 course_tag 关联；软删掉的不算
LESSON_COUNT_SQL = (
    "(select count(*) from course_lesson l where l.course_tag = c.course_tag and l.is_deleted = 0)"
)

# 只关心"公开 + 未删"的课程：非公开的课程本来就不该出现在小程序端
VISIBLE_WHERE = "c.del_tag = 0 and c.is_public = 1"


def main(argv=None):
    parser = argparse.ArgumentParser(description="课程/课时体检（只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--all", action="store_true", help="顺便打印全部课程与课时数")
    args = parser.parse_args(argv)

    conn = load_conn(args.config)
    try:
        cur = conn.cursor()
        cur.execute(
            "select c.id, c.course_name, %s as lessons from course_info c where %s order by c.id"
            % (LESSON_COUNT_SQL, VISIBLE_WHERE)
        )
        rows = cur.fetchall()
        zero = [(int(r[0]), str(r[1])) for r in rows if int(r[2] or 0) == 0]

        print("\n=== 公开且未删的课程：%d 门 ===" % len(rows))
        print("=== 其中课时数为 0 的：%d 门（需求 713367615：这些在小程序端【不该显示】）===" % len(zero))
        for cid, name in zero:
            print("   id=%-4s %s" % (cid, name))

        # 机器可读的一行：表格动作靠它把名单读进去
        print(
            "[COURSE] mode=no-lesson visible=%d zero=%d names=%s"
            % (len(rows), len(zero), json.dumps([n for _, n in zero], ensure_ascii=False))
        )

        if args.all:
            print("\n=== 全部课程与课时数 ===")
            for cid, name, lessons in rows:
                print("   id=%-4s 课时=%-3s %s" % (cid, lessons, name))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
