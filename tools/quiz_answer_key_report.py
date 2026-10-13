# -*- coding: utf-8 -*-
"""答题「答案键」报告（只读）：把每题的正确答案读出来，并按判分口径**复算一遍应得多少分**。

【为什么需要它】
  需求 713594985 的判分口径原文：
    · 单选 / 判断：**对则得分**；
    · **多选：所选集合必须与答案集合完全一致**才算对；
    · 答错不扣分。

  「集合完全一致」最容易翻车的地方是：**只选对了一部分也算错**。
  光看界面看不出来（界面上只有"提交成功"），得拿答案键来复算：
  页面上我们点了哪些选项（表格动作「逐题作答」= 每题点第 1 个选项），
  哪些题刚好等于答案集合 —— 这个数应该与库里 `correct_count` 一致、分值之和应与 `should_point` 一致。

  这样做的好处是：**不用额外提交一次**就能验判分口径（避开了"跑完不能立刻重跑"那条限制）。

用法:
    python tools/quiz_answer_key_report.py --activity-name Z-题干图验证
    python tools/quiz_answer_key_report.py --activity-name Z-题干图验证 --select-first 2   # 每题选前 2 个选项
退出码: 0 正常；1 读配置/连库失败；2 活动定位不到
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_cleanup import pick_activity_id  # noqa: E402
from quiz_data_report import DEFAULT_CONFIG, load_conn, read_config  # noqa: E402

TYPE_NAME = {1: "单选", 2: "多选", 3: "判断"}


def load_questions(cur, activity_id):
    cur.execute(
        "select id, question_type, score, sort, stem from home_activity_question "
        "where activity_id = %s and is_deleted = 0 order by sort, id",
        (activity_id,),
    )
    questions = []
    for qid, qtype, score, sort, stem in cur.fetchall():
        cur.execute(
            "select option_label, option_content, is_answer, sort from home_activity_question_option "
            "where question_id = %s and is_deleted = 0 order by sort, id",
            (qid,),
        )
        options = cur.fetchall()
        questions.append(
            {
                "id": qid,
                "type": int(qtype or 0),
                "score": int(score or 0),
                "stem": str(stem or "")[:24],
                "options": [str(o[0] or "") for o in options],
                "answers": sorted(str(o[0] or "") for o in options if int(o[2] or 0) == 1),
            }
        )
    return questions


def expected_result(questions, select_first=1):
    """按「每题只点前 N 个选项」复算判分结果 —— **纯函数**（离线自检用）。

    判分口径：所选集合 == 答案集合 才算对（单选/判断就是"点对那一个"）。
    @returns (答对题数, 应得总分, 逐题明细)
    """
    correct = 0
    should = 0
    rows = []
    for q in questions:
        selected = sorted(q["options"][:max(0, int(select_first))])
        ok = bool(q["answers"]) and selected == sorted(q["answers"])
        if ok:
            correct += 1
            should += q["score"]
        rows.append((q, selected, ok))
    return correct, should, rows


def main(argv=None):
    parser = argparse.ArgumentParser(description="答题答案键报告（只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="数据库配置（默认 config/db.local.yaml）")
    parser.add_argument("--activity-name", required=True, help="活动名（跟页面标题一字不差）")
    parser.add_argument("--select-first", type=int, default=1,
                        help="复算时假设备题选了前 N 个选项（表格动作「逐题作答」= 1，默认 1）")
    args = parser.parse_args(argv)

    read_config(args.config)
    conn = load_conn(args.config)
    try:
        cur = conn.cursor()
        cur.execute("select id, activity_name from home_activity where activity_name = %s", (args.activity_name,))
        resolved, why = pick_activity_id(cur.fetchall(), args.activity_name)
        if resolved is None:
            print("\n[拒绝] 没能唯一定位活动：%s" % why)
            return 2

        questions = load_questions(cur, resolved)
        n_multi = sum(1 for q in questions if q["type"] == 2)
        correct, should, rows = expected_result(questions, args.select_first)

        print("\n=== 答案键：%s（活动 id=%s，共 %d 题，其中多选 %d 题）==="
              % (args.activity_name, resolved, len(questions), n_multi))
        for i, (q, selected, ok) in enumerate(rows, start=1):
            print("  q%-2d %-4s %4s 分  选%s  答案%s  %s  %s"
                  % (i, TYPE_NAME.get(q["type"], q["type"]), q["score"],
                     "".join(selected) or "-", "".join(q["answers"]) or "-",
                     "对" if ok else "错", q["stem"]))
        print("\n  复算（每题选前 %d 个选项）：答对 %d 题、应得 %s 分"
              % (args.select_first, correct, should))
        print("  —— 库里那条提交的 correct_count / should_point 应当与这两个数一致。")
        print("     多选只要少选一个就算错（需求原文：所选集合与答案集合完全一致）。")
        print("[ANSWERKEY] activity=%s questions=%s multi=%s select_first=%s expected_correct=%s expected_should=%s"
              % (resolved, len(questions), n_multi, args.select_first, correct, should))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
