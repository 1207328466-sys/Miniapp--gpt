# -*- coding: utf-8 -*-
"""一键跑完所有**离线**检查（不需要手机）：提交前跑这个，绿了再提交。

它把散着的几道闸门串起来（见 `docs/交接文档.md` 约定第 14 条）：

  1. 语法：所有 .js 过 `node --check`；所有 .py 过 `py_compile`
  2. 用例收集：`pytest --collect-only`（能查出 conftest / 用例收集被改坏）
  3. `scripts/check-docs.py`            文档死链
  4. `scripts/selftest-export-cases.py` 表格校验与体检规则（14 项）
  5. `scripts/check-safety.py`          数据/凭据安全不变式（9 项）
  6. `scripts/check-invariants.py`      框架自身完整性（7 项：动作↔实现、中文名、退出码兜底、安全阀、文档数字）
  7. `tools/calibrate_android_doc.py --check`  android.js 逐行详解里的行号引用是否漂移

为什么值得有：这些检查分开跑很容易"忘了其中一个"；串成一条命令，纪律才落得住。

用法：python scripts/verify-all.py
退出码：0 = 全绿；1 = 有红的（逐个列出）
"""

import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_CASE = os.path.join(REPO, "test_case")

failures = []


def run(name, args, cwd=REPO, shell=False):
    print("\n===== %s =====" % name)
    r = subprocess.run(
        args, cwd=cwd, shell=shell, capture_output=True, text=True, encoding="utf-8", errors="replace"
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
    run("check-safety（安全不变式）", [sys.executable, os.path.join("scripts", "check-safety.py")])
    run("check-invariants（框架不变式）", [sys.executable, os.path.join("scripts", "check-invariants.py")])
    run(
        "calibrate_android_doc --check（逐行详解的行号）",
        [sys.executable, os.path.join("tools", "calibrate_android_doc.py"), "--check"],
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
