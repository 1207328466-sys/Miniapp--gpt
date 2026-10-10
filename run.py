# -*- coding: utf-8 -*-
"""一键运行入口。

【为什么需要它】
框架一直有一条隐含约束：**必须在 test_case/ 目录下执行 pytest**，
否则读不到 pytest.ini、用例也收集不到（docs/踩坑记录.md 坑 5 就是踩的这个）。
与其让每个人记住"要先 cd"，不如把这件事收进代码。

用法:
    python run.py                 # 跑全部用例 + 生成 Allure HTML 报告
    python run.py -k 专栏          # 其余参数原样透传给 pytest
    python run.py suprecast_app/test_example.js
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
TEST_CASE = ROOT / "test_case"
REPORT = ROOT / "report"
ALLURE_RESULTS = REPORT / "allure-results"
ALLURE_HTML = REPORT / "allure-report"


def main(argv):
    if not TEST_CASE.is_dir():
        print(f"找不到用例目录：{TEST_CASE}")
        return 2

    # 日志与 Allure 结果目录先建好：pytest 的 log_file 不会自动创建多级目录
    (REPORT / "log").mkdir(parents=True, exist_ok=True)
    ALLURE_RESULTS.mkdir(parents=True, exist_ok=True)

    # 关键一步：把"必须在 test_case 下跑"收进代码
    os.chdir(TEST_CASE)

    args = [
        "-vs",
        "--alluredir",
        str(ALLURE_RESULTS),
        "--clean-alluredir",
        *argv,
    ]
    print(f"工作目录：{Path.cwd()}")
    print(f"pytest 参数：{' '.join(args)}")
    code = int(pytest.main(args))

    # 生成 HTML 报告。allure 需要 Java；缺了也不影响测试结论，只提示一下。
    allure = shutil.which("allure")
    if allure:
        print("\n正在生成 Allure HTML 报告 ...")
        subprocess.run(
            [allure, "generate", str(ALLURE_RESULTS), "-o", str(ALLURE_HTML), "--clean"],
            check=False,
        )
        print(f"报告：{ALLURE_HTML / 'index.html'}")
    else:
        print(
            "\n未找到 allure 命令行，跳过 HTML 报告生成。\n"
            f"  Allure 原始结果仍在：{ALLURE_RESULTS}（装了 Java + allure CLI 后可再生成）"
        )

    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
