# -*- coding: UTF-8 -*-
'''
@author: weiyue.zhang
@project_name: UITest
@cur_file: conftest.py
@create_date: 2026/10/8
'''
import shutil
import subprocess

import pytest


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
