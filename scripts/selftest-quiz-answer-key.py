# -*- coding: utf-8 -*-
"""答题「判分口径」复算的自检（**离线**，不需要手机、不需要连库）。

为什么单独一道：判分口径是需求 713594985 里最容易被想当然的一条 ——
**多选「所选集合必须与答案集合完全一致」**，少选一个、多选一个都算错。
这套规矩写在 `tools/quiz_answer_key_report.py` 的 `expected_result()` 里（纯函数），
这里就正反两个方向把它钉住：该对的必须判对，少选/多选/选错的必须判错。

用法：python scripts/selftest-quiz-answer-key.py
退出码：0 = 全部符合预期；1 = 有不符合的
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

from quiz_answer_key_report import expected_result  # noqa: E402

failed = []
passed = 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("OK   %s" % name)
    else:
        failed.append("%s（%s）" % (name, detail))
        print("FAIL %s（%s）" % (name, detail))


def q(qtype, score, options, answers, name=""):
    """造一道题：options 是选项 label 序列（顺序即页面上从上到下），answers 是正确集合"""
    assert all(a in options for a in answers), "答案必须来自选项"
    return {"id": name or qtype, "type": qtype, "score": score, "stem": name, "options": options, "answers": sorted(answers)}


def case(name, questions, select_first, want_correct, want_should):
    correct, should, _rows = expected_result(questions, select_first)
    check(
        "%s -> 答对 %s 题 / 应得 %s 分" % (name, want_correct, want_should),
        (correct, should) == (want_correct, want_should),
        "实际算出来是 %s 题 / %s 分" % (correct, should),
    )


# ---------- 正例：单选/判断 选对那一个 ----------
case("单选：第一个选项就是答案", [q(1, 10, ["A", "B"], ["A"])], 1, 1, 10)
case("判断：第一个选项是「正确」", [q(3, 5, ["A", "B"], ["A"])], 1, 1, 5)

# ---------- 多选：集合必须完全一致（这条是重点）----------
case("多选：只选了其中一个正确答案（少选）→ 判错", [q(2, 50, ["A", "B", "C"], ["A", "C"])], 1, 0, 0)
case(
    "多选：把两个正确答案都选了 → 判对",
    [q(2, 50, ["A", "C"], ["A", "C"])],
    2,
    1,
    50,
)
case(
    "多选：正确答案之外的也选了（多选）→ 判错",
    [q(2, 60, ["A", "B", "D"], ["B", "D"])],
    3,
    0,
    0,
)

# ---------- 反例：选错那一个 ----------
case("单选：选了非答案 → 判错", [q(1, 10, ["A", "B"], ["B"])], 1, 0, 0)
case("判断：答案=错误，选了正确 → 判错", [q(3, 5, ["A", "B"], ["B"])], 1, 0, 0)

# ---------- 分值累加 + 混合题库（照真活动 349 的形状来）----------
case(
    "混合题库：对的累加、错的记 0",
    [
        q(1, 1, ["A", "B"], ["A"]),
        q(1, 10, ["A", "B"], ["B"]),
        q(2, 50, ["A", "C"], ["A", "C"]),
        q(3, 5, ["A", "B"], ["A"]),
        q(1, 1000, ["A", "B"], ["A"]),
    ],
    1,
    3,
    1 + 5 + 1000,
)

# ---------- 边界：一道题都没有时不能崩 ----------
case("空题库：0 题 0 分", [], 1, 0, 0)

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
