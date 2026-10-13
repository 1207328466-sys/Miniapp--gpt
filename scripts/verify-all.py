# -*- coding: utf-8 -*-
"""一键跑完所有**离线**检查（不需要手机）：提交前跑这个，绿了再提交。

它把散着的几道闸门串起来（见 `docs/交接文档.md` 约定第 14 条）：

  1. 语法：所有 .js 过 `node --check`；所有 .py 过 `py_compile`
  2. 用例收集：`pytest --collect-only`（能查出 conftest / 用例收集被改坏）
  3. `scripts/check-docs.py`            文档死链
  4. `scripts/selftest-export-cases.py` 表格校验与体检规则（17 项，含"一条填错只红它自己"）
  5. `scripts/selftest-quiz-cleanup.py` 复位工具的安全闸门（15 项：该拦的必须拦、该放的必须放）
  5b. `scripts/selftest-case-copy-reset.py` 案例复制复位工具的护栏（14 项：库名/点名案例/量上限/重名）
  6. `test_case/diagnostic/selftest_quiz_question_options.js` 答题"选项 2~6 且互不相同"规则（10 项，纯函数，正反都验）
  7. `test_case/diagnostic/selftest_course_zero_lesson_match.js` 课程"0 课时对账"的匹配规则（12 项，含前缀误报边界）
  8. `scripts/selftest-run-preflight.py` run.py 开跑前"设备预检"的解析规则（11 项，含 unauthorized/offline 反例）
  9. `scripts/check-doc-index.py`       文档索引不许漂移（目录↔正文、踩坑索引、文档地图登记）
  10. `scripts/check-safety.py`         数据/凭据安全不变式（14 项）
  11. `scripts/check-invariants.py`     框架自身完整性（11 项：动作↔实现、中文名、退出码兜底、安全阀、
      文档数字、写链路带复位、README 里"照抄即可"的代码引用的函数是否真实存在）
  12. `tools/calibrate_android_doc.py --check`  android.js 逐行详解里的行号引用是否漂移
  13. `tools/build_actions_doc.py --check`      docs/动作清单-分类.md 与 ACTIONS 是否一致
      （这份文档是生成的：手册曾经写着「47 个动作」却只列了 44 个，就是靠它挡住）

为什么值得有：这些检查分开跑很容易"忘了其中一个"；串成一条命令，纪律才落得住。

用法：python scripts/verify-all.py
退出码：0 = 全绿；1 = 有红的（逐个列出）
"""

import os
import subprocess
import sys

# Windows 控制台默认 GBK：子进程输出里出现无法编码的字符时，print 会直接抛
# UnicodeEncodeError，把「全绿」误报成「脚本崩了」。统一降级为替换字符，保证不炸。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_CASE = os.path.join(REPO, "test_case")

failures = []


def run(name, args, cwd=REPO, shell=False):
    print("\n===== %s =====" % name)
    # 子进程统一按 UTF-8 输出，避免中文在管道里被解码成乱码
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    r = subprocess.run(
        args,
        cwd=cwd,
        shell=shell,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    tail = "\n".join(out.splitlines()[-8:]) if out else "(没有输出)"
    print(tail)
    if r.returncode != 0:
        failures.append("%s（退出码 %s）" % (name, r.returncode))
    return r.returncode


def main():
    # 1) 语法检查
    js_files, py_files = [], []
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".venv", "report", "__pycache__")]
        for f in files:
            p = os.path.join(root, f)
            if f.endswith(".js"):
                js_files.append(p)
            elif f.endswith(".py"):
                py_files.append(p)

    bad = []
    for p in js_files:
        r = subprocess.run(["node", "--check", p], capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            bad.append(os.path.relpath(p, REPO))
    print("\n===== node --check（%d 个 .js）=====" % len(js_files))
    if bad:
        print("语法不通过：%s" % "、".join(bad))
        failures.append("node --check（%s）" % "、".join(bad))
    else:
        print("全部通过")

    bad = []
    for p in py_files:
        r = subprocess.run(
            [sys.executable, "-m", "py_compile", p], capture_output=True, text=True, encoding="utf-8"
        )
        if r.returncode != 0:
            bad.append(os.path.relpath(p, REPO))
    print("\n===== py_compile（%d 个 .py）=====" % len(py_files))
    if bad:
        print("语法不通过：%s" % "、".join(bad))
        failures.append("py_compile（%s）" % "、".join(bad))
    else:
        print("全部通过")

    # 2) 用例收集（不需要设备：--collect-only 只收集不执行）
    run("pytest --collect-only（用例收集）", [sys.executable, "-m", "pytest", "--collect-only", "-q"], cwd=TEST_CASE)

    # 3~5) 三道闸门
    run("check-docs（文档死链）", [sys.executable, os.path.join("scripts", "check-docs.py")])
    run("selftest-export-cases（表格规则）", [sys.executable, os.path.join("scripts", "selftest-export-cases.py")])
    run("selftest-quiz-cleanup（复位护栏）", [sys.executable, os.path.join("scripts", "selftest-quiz-cleanup.py")])
    run("selftest-case-copy-reset（复制复位护栏）", [sys.executable, os.path.join("scripts", "selftest-case-copy-reset.py")])
    run(
        "selftest-quiz-question-options（答题选项规则）",
        ["node", os.path.join("test_case", "diagnostic", "selftest_quiz_question_options.js")],
    )
    run(
        "selftest-course-zero-lesson（课程 0 课时对账规则）",
        ["node", os.path.join("test_case", "diagnostic", "selftest_course_zero_lesson_match.js")],
    )
    run("selftest-run-preflight（设备预检解析）", [sys.executable, os.path.join("scripts", "selftest-run-preflight.py")])
    run("check-doc-index（文档索引漂移）", [sys.executable, os.path.join("scripts", "check-doc-index.py")])
    run("check-safety（安全不变式）", [sys.executable, os.path.join("scripts", "check-safety.py")])
    run("check-invariants（框架不变式）", [sys.executable, os.path.join("scripts", "check-invariants.py")])
    run(
        "calibrate_android_doc --check（逐行详解的行号）",
        [sys.executable, os.path.join("tools", "calibrate_android_doc.py"), "--check"],
    )
    run(
        "build_actions_doc --check（动作清单文档是否最新）",
        [sys.executable, os.path.join("tools", "build_actions_doc.py"), "--check"],
    )

    print("\n" + "=" * 60)
    if failures:
        print("有 %d 项不通过：" % len(failures))
        for f in failures:
            print("  · %s" % f)
        return 1
    print("离线检查全绿，可以提交。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
