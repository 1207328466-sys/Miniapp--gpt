# -*- coding: UTF-8 -*-
'''
@author: weiyue.zhang
@project_name: UITest
@cur_file: conftest.py
@create_date: 2026/10/8

桥接层：让 pytest 能执行 .js 用例，并把 JS 侧的**结构化步骤日志**还原成报告。

【为什么报告放在这一层做】
JS 那边只负责"跑步骤 + 写 JSONL"，把步骤明细变成
  - 控制台可读摘要
  - Allure 的 feature -> story -> step 层次 + 失败步骤截图
是 Python 侧的活。这样 JS 不必关心 pytest/Allure，Python 也不必关心测试逻辑。

【步骤日志的路径怎么传】
由这里生成一个**临时文件**路径，经环境变量 UITEST_STEP_LOG 交给 node 进程。
不采用"约定固定目录再扫描回来"的做法 —— 那样并发跑（xdist）时必然串台，
而且还要处理"这次是哪个文件"的歧义。
'''

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile

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

try:
    import allure
except Exception:  # allure 只是报告增强，缺了也要能正常跑
    allure = None


# node 侧退出码约定（与用例里的 process.exit 对应）
SKIP_EXIT_CODE = 3  # 前置条件不满足：用例不适用，记 SKIPPED 而不是 FAILED

_log = logging.getLogger("uitest")


def emit(text=""):
    """同时写到控制台和日志文件。

    【为什么必须两边都写】
    第一版只在 pytest.ini 里配了 log_file，结果日志文件**一直是 0 字节** ——
    因为 Python 侧根本没有产生任何 logging 记录（JS 的输出走的是 print）。
    教训：配了日志设施不等于有日志，得有东西往里写。

    控制台给人当下看，日志文件给事后追查（report/log/pytest.log）。
    另注意：pytest.ini 里 log_cli 关掉了，否则同一行会被打印两遍
    （我们的 print 一次 + logging 再回显一次）。
    """
    print(text)
    for line in str(text).splitlines() or [""]:
        _log.info("%s", line)


class JsTestFailure(AssertionError):
    """JS 脚本执行失败异常。

    刻意继承 AssertionError（而不是普通 Exception）：pytest 会把它记成
    **用例失败(failed)**，Allure 也标 failed；用普通 Exception 时 Allure 会标成
    **broken**，报告读者会误以为"框架/环境坏了"，而实际上是用例断言没过 ——
    这两种状态在报告里的含义完全不同，会直接误导排查方向。
    """


def _read_step_log(path):
    """读取 JSONL 步骤日志。

    读不到或解析失败时**不抛错**：报告是附加价值，不该因为它影响用例结论；
    但也不能静默 —— 所以两种情况都明确告警。
    """
    try:
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        emit("[WARN] 没有生成步骤日志：JS 侧可能没读到 UITEST_STEP_LOG")
        return []
    except Exception as exc:
        emit(f"[WARN] 步骤日志解析失败：{exc}")
        return []


def _print_step_summary(entries):
    """在控制台打印人可读的步骤明细（不用去翻 JSON）"""
    steps = [e for e in entries if e.get("type") == "step"]
    summary = next((e for e in entries if e.get("type") == "summary"), None)
    if not steps:
        return

    emit("\n--- 步骤明细 ---")
    for s in steps:
        mark = "OK  " if s.get("status") == "passed" else "FAIL"
        emit(f"  [{mark}] {s.get('num')}. {s.get('name')}  {s.get('duration')}s")
        if s.get("error"):
            emit(f"          错误: {s['error']}")
        if s.get("screenshot"):
            emit(f"          截图: {s['screenshot']}")

    if summary:
        emit(
            f"  合计 {summary.get('steps')} 步：通过 {summary.get('passed')}，"
            f"失败 {summary.get('failed')}，总耗时 {summary.get('total')}s"
        )
        if summary.get("context"):
            emit(f"  上下文: {json.dumps(summary['context'], ensure_ascii=False)}")


def _attach_to_allure(entries, case_name):
    """把步骤日志还原成 Allure 的层次结构"""
    if allure is None:
        return

    header = next((e for e in entries if e.get("type") == "case"), {})
    steps = [e for e in entries if e.get("type") == "step"]
    summary = next((e for e in entries if e.get("type") == "summary"), None)

    # feature -> story -> title 三层，报告里才有的分组可看
    allure.dynamic.feature(header.get("feature") or "未分类")
    allure.dynamic.story(header.get("story") or case_name)
    allure.dynamic.title(header.get("title") or case_name)

    for s in steps:
        with allure.step(f"{s.get('num')}. {s.get('name')} ({s.get('duration')}s)"):
            if s.get("error"):
                allure.attach(str(s["error"]), "错误信息", allure.attachment_type.TEXT)
            # 只把**失败步骤**的截图塞进报告：每步都塞会让报告膨胀到几十 MB。
            # 通过的步骤本来就在磁盘上留着截图（report/photo_app/...），不必都进报告。
            shot = s.get("screenshot")
            if s.get("status") == "failed" and shot and os.path.exists(shot):
                allure.attach.file(
                    shot,
                    name=os.path.basename(shot),
                    attachment_type=allure.attachment_type.PNG,
                )

    if summary and summary.get("context"):
        allure.attach(
            json.dumps(summary["context"], ensure_ascii=False, indent=2),
            "用例上下文",
            allure.attachment_type.JSON,
        )
    allure.attach(
        json.dumps(entries, ensure_ascii=False, indent=2),
        "步骤日志(原始 JSON)",
        allure.attachment_type.JSON,
    )


class JsTestItem(pytest.Item):
    """将 .js 脚本包装成 pytest 测试项，直接调用 node 执行"""

    def __init__(self, node_script, **kwargs):
        super().__init__(**kwargs)
        self.node_script = node_script

    def runtest(self):
        node = shutil.which("node") or "node"

        # 步骤日志写到临时文件：与本次运行一一对应，既不污染仓库也不会并发串台
        fd, step_log_path = tempfile.mkstemp(prefix="uitest_steps_", suffix=".jsonl")
        os.close(fd)
        env = {**os.environ, "UITEST_STEP_LOG": step_log_path}

        try:
            result = subprocess.run(
                [node, str(self.node_script)],
                cwd=str(self.node_script.parent),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )

            if result.stdout:
                emit(result.stdout)
            if result.stderr:
                emit(result.stderr)

            # 先出报告再判成败：失败时恰恰更需要看到步骤明细
            entries = _read_step_log(step_log_path)
            _print_step_summary(entries)
            _attach_to_allure(entries, self.node_script.name)

            # 退出码约定：0 = 通过；3 = 前置条件不满足（用例不适用）；其它非 0 = 失败。
            #
            # 为什么要有 3：像"答题活动未上线""活动卡已换成别的"这类情况，
            # 报 FAILED 会让报告里长期躺着一条假失败 —— 久而久之没人再看它
            #（正是"报告说谎"的另一种形式）。记为 SKIPPED 才反映真实语义。
            #
            # ⚠️ 注意：skip 必须**可见且可计数**。pytest 会把 SKIPPED 单独统计并打印原因，
            # Allure 也标 skipped —— 若某次运行里 skip 数量异常增多，那是信号，不是"全绿"。
            if result.returncode == SKIP_EXIT_CODE:
                reason = self._precondition_reason(result.stdout) or f"前置条件不满足：{self.node_script.name}"
                pytest.skip(reason)

            if result.returncode != 0:
                raise JsTestFailure(
                    f"node 执行失败(exit={result.returncode}): {self.node_script.name}"
                )
        finally:
            try:
                os.remove(step_log_path)
            except OSError:
                pass

    @staticmethod
    def _precondition_reason(stdout):
        """从 node 输出里取 [PRECONDITION] 那一行作为 skip 原因（取不到就返回 None）"""
        for line in (stdout or "").splitlines():
            if line.startswith("[PRECONDITION]"):
                return line.replace("[PRECONDITION]", "").strip()
        return None

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
