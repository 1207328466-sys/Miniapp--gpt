# -*- coding: UTF-8 -*-
"""跑单个 pytest 用例，并把输出以正确编码写入日志文件。

【为什么需要这个脚本】
PowerShell 处理 node 输出时会破坏中文：直接用 `python -m pytest ... *> log`
得到的是 UTF-16 文件、且中文已经损坏，结果是"用例明明失败，日志里却看不出原因"。
本脚本用 cmd 重定向，让原始字节直接落盘，再用 Python 按正确编码（utf-8 -> gbk 回退）读取。

（本脚本借鉴自原仓库工作副本的 test_case/diagnostic/run_case.py —— 那边先踩了这个坑。
我们这边也踩过一次：`*> 文件` 之后按 UTF-8 读出来全是 `������ʷ`。）

用法（项目任意目录下）：
    python test_case/diagnostic/run_case.py test_learn_center_column.js
    python test_case/diagnostic/run_case.py suprecast_app/test_example.js
"""

import io
import os
import re
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# 本文件位于 test_case/diagnostic/，项目根在上两级
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CASE_DIR = os.path.join(ROOT, "test_case")
LOG = os.path.join(ROOT, "report", "diagnostic", "case_run.log")

case = sys.argv[1] if len(sys.argv) > 1 else "test_learn_center_column.js"
# 允许带 suprecast_app/ 前缀，也允许只给文件名
if not case.startswith("suprecast_app"):
    case = os.path.join("suprecast_app", case)

os.makedirs(os.path.dirname(LOG), exist_ok=True)
if os.path.exists(LOG):
    os.remove(LOG)

# 关键：cmd /c 直接重定向，避免 PowerShell 管道破坏中文
cmd = 'cmd /c "python -m pytest %s -v -s -p no:rerunfailures > %s 2>&1"' % (
    case.replace("/", "\\"),
    LOG,
)
print("执行: pytest %s" % case)
print()

proc = subprocess.run(cmd, cwd=CASE_DIR, shell=True)
exit_code = proc.returncode
print("退出码: %d" % exit_code)

print("\n=== 日志关键行 ===")
raw = open(LOG, "rb").read()
for enc in ("utf-8", "gbk"):
    try:
        text = raw.decode(enc)
        used = enc
        break
    except UnicodeDecodeError:
        continue
else:
    text = raw.decode("utf-8", errors="replace")
    used = "utf-8(replace)"
print("(按 %s 解码)\n" % used)

pat = re.compile(
    r"步骤执行完成|\[OK\]|\[ERROR\]|\[WARN\]|自愈|尝试|已点击|已到达|已切换到|已在|"
    r"重新获取|详情页标记|列表页标记|用例失败|passed|failed|PASSED|FAILED|"
    r"元素数|第一张卡片名称|步骤明细|合计|上下文"
)
for line in text.splitlines():
    s = line.strip()
    if s and pat.search(s):
        print("  " + s)
