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

# 跑起来必需的 Python 依赖（缺一个就会以"看不懂的报错"失败）
REQUIRED_MODULES = ["pytest", "pytest_asyncio", "pytest_html", "allure_pytest"]

# pytest 退出码的含义（直接打给人看，省得去查）
EXIT_MEANING = {
    0: "全部通过",
    1: "有用例失败",
    2: "运行被中断",
    3: "pytest 内部错误",
    4: "命令行参数错误（最常见原因：插件没装，或参数写错）",
    5: "没有收集到任何用例",
}


def preflight():
    """开跑前先确认依赖齐全 —— 否则会以'看不懂的报错'失败。

    真实案例（2026/10/10）：在 .venv 里跑 run.py，那个环境缺 allure_pytest，
    pytest 不认识 --alluredir，报了一句 usage 错误；更糟的是脚本后面照样打印
    "报告生成成功"（其实是拿旧结果生成的），把人误导成"跑通了"。
    """
    import importlib.util

    missing = [m for m in REQUIRED_MODULES if importlib.util.find_spec(m) is None]
    if not missing:
        return True

    print("当前 Python 环境缺少这些依赖：" + "、".join(missing))
    print("  正在使用的解释器：" + sys.executable)
    in_venv = sys.prefix != sys.base_prefix
    if in_venv:
        # 注意：不要用 emoji（⚠️ 这类字符在 GBK 控制台会抛 UnicodeEncodeError，
        # 反而把真正的提示吞掉 —— 团队踩坑记录里有专门一条）
        print("  [提示] 你现在在虚拟环境里（" + sys.prefix + "），这个环境没装全依赖。")
        print("     两个办法（选一个）：")
        print("       ① 就在这个环境里装依赖：  pip install -r requirements.txt")
        print("       ② 退出虚拟环境（敲 deactivate），改用系统 Python 再跑")
    else:
        print("  请先安装依赖：pip install -r requirements.txt")
    return False


def main(argv):
    if not TEST_CASE.is_dir():
        print(f"找不到用例目录：{TEST_CASE}")
        return 2

    if not preflight():
        return 2

    # 日志与 Allure 结果目录先建好：pytest 的 log_file 不会自动创建多级目录
    (REPORT / "log").mkdir(parents=True, exist_ok=True)
    # 结果目录由脚本自己清空：不能指望 pytest 的 --clean-alluredir ——
    # 插件没装时那个参数根本不会生效，于是"旧结果"会被误当成"本次的结果"，
    # 生成出一份旧报告还显示成功（2026/10/10 实际踩到）。
    if ALLURE_RESULTS.exists():
        shutil.rmtree(ALLURE_RESULTS)
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

    if code not in (0, 1):
        print(f"\n[!] pytest 没有正常跑完（退出码 {code}：{EXIT_MEANING.get(code, '未知')}）")

    # 只有真的产生了结果才生成报告 —— 否则会拿上一次的旧结果生成，
    # 让人误以为"这次跑通了"（2026/10/10 实际踩到过）。
    produced = sorted(ALLURE_RESULTS.glob("*-result.json")) if ALLURE_RESULTS.is_dir() else []
    if not produced:
        print("\n本次运行没有产生 Allure 结果，跳过报告生成（也不要看上一次的报告，那是旧的）。")
        return code

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
