# -*- coding: UTF-8 -*-
'''
@author: weiyue.zhang
@project_name: UITest
@cur_file: conftest.py
@create_date: 2026/10/8
'''
import shutil
import subprocess
import sys

import pytest

# Windows 控制台默认是 GBK 代码页。node 用例的输出里一旦出现当前代码页
# 表示不了的字符，print() 会抛 UnicodeEncodeError，把真正的失败原因
# 掩盖成一行编码错误。
# 这里只放宽错误处理、不改编码 —— 改编码会让在 GBK 控制台里运行的人
# 看到满屏乱码。想在本机看到完整 UTF-8 输出，运行前先 chcp 65001。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        # 被 pytest 替换成捕获对象时没有 reconfigure，忽略即可
        pass


class JsTestFailure(Exception):
    """JS 脚本执行失败异常"""


class JsTestItem(pytest.Item):
    """将 .js 脚本包装成 pytest 测试项，直接调用 node 执行"""

    def __init__(self, node_script, **kwargs):
        super().__init__(**kwargs)
        self.node_script = node_script

    def runtest(self):
        node = shutil.which("node") or "node"
        result = subprocess.run(
            [node, str(self.node_script)],
            cwd=str(self.node_script.parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        if result.returncode != 0:
            raise JsTestFailure(f"node 执行失败(exit={result.returncode}): {self.node_script.name}")

    def repr_failure(self, excinfo, outerr=None):
        if isinstance(excinfo.value, JsTestFailure):
            return str(excinfo.value)
        return super().repr_failure(excinfo, outerr)

    def reportinfo(self):
        return self.path, 0, f"js test: {self.name}"


class JsTestFile(pytest.File):
    """收集 test_*.js 文件"""

    def collect(self):
        yield JsTestItem.from_parent(self, name=self.path.name, node_script=self.path)


def pytest_collect_file(file_path, parent):
    """钩子：让 pytest 直接收集并执行 test_*.js 脚本"""
    if file_path.suffix == ".js" and file_path.name.startswith("test_"):
        return JsTestFile.from_parent(parent, path=file_path)
    return None
