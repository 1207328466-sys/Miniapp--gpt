# -*- coding: utf-8 -*-
"""离线自检（不联网）：护航预约工具里"哪些算这次新增"的纯逻辑。

【为什么值得钉】成功态用例的判据是"**快照之后新增**的那条" —— 库里已经有一堆同名的
「自动化测试 / 13311111111」（2026/10/19 实测 9 条），判据要是退化成"按名字找最新一条"，
就会把**旧记录**当成本次提交，报告全绿但什么都没验（假绿）。

运行：python scripts/selftest-escort-reserve.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from escort_appointment_tool import new_ids  # noqa: E402

CASES = [
    # (名字, before, records, 期望)
    ("快照里已有的都不算新增", [1, 2], [{"id": 2}, {"id": 3}, {"id": 4}], [3, 4]),
    ("快照是字符串也要认（接口/手填都可能给字符串）", ["1", "2"], [{"id": 2}, {"id": 3}], [3]),
    ("空快照 -> 全是新增", [], [{"id": 5}, {"id": 6}], [5, 6]),
    ("快照覆盖全部 -> 没有新增", [5, 6], [{"id": 6}, {"id": 5}], []),
    ("保持「新在前」的顺序（接口按提交时间倒序给）", [1], [{"id": 9}, {"id": 8}, {"id": 1}], [9, 8]),
    ("坏记录（id 缺失/不是数字）跳过，不要炸", [1], [{"id": None}, {"id": "abc"}, {"id": 7}], [7]),
    ("重复 id 只算一次新增（去重）", [1], [{"id": 7}, {"id": 7}], [7]),
    ("没有记录 -> 没有新增", [1], [], []),
]


def main():
    failed = 0
    for name, before, records, want in CASES:
        try:
            got = new_ids(before, records)
        except Exception as e:  # noqa: BLE001
            print("FAIL %s -> 抛异常：%s" % (name, e))
            failed += 1
            continue
        if got != want:
            print("FAIL %s -> 期望 %s，实际 %s" % (name, want, got))
            failed += 1
        else:
            print("OK   %s" % name)
    if failed:
        print("\n%d 项不通过" % failed)
        return 1
    print("\n全部通过（%d 项）" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
