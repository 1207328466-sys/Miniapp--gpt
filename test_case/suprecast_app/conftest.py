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
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

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

# ---------- 「填表就能写用例」：表格里的每条用例各占一个 pytest 用例项 ----------
# 表格（cases/用例表.xlsx）里同一个「用例编号」的若干行合起来是一条用例。
# 若整个文件只算一个 pytest 用例项，报告里就是一大堆步骤捆成一条，
# 某条挂了要翻半天才知道是哪条 —— 所以这里按用例编号拆开，
# 并用环境变量把「这次跑哪一条」告诉 node 侧（见 test_case/suprecast_app/test_from_table.js）。
TABLE_CASE_FILE = "test_from_table.js"
CASE_ID_ENV = "UITEST_CASE_ID"
TABLE_JSON = Path(__file__).resolve().parents[2] / "cases" / "用例表.json"

_log = logging.getLogger("uitest")


def load_table_cases():
    """读表格导出的 json，取出 [(用例编号, 用例名称), ...]。

    读不到就返回 []（交给 node 侧报「表格还没导出」这个更准确的原因）——
    conftest 只是桥接层，不该替用例决定成败，也不该把「表格文件读不了」当作用例失败。
    """
    try:
        with open(TABLE_JSON, encoding="utf-8") as f:
            data = json.load(f)
        return [(str(c["id"]), str(c.get("name") or c["id"])) for c in data.get("cases", [])]
    except Exception:
        return []


# 用例文件里 `meta: { title: "..." }` 那一行的中文用例名
TITLE_IN_FILE = re.compile(r'title:\s*"([^"\n]+)"')


def case_display_name(path):
    """给 pytest 用例项取一个**中文**名字（控制台、报告里都用它）。

    为什么要在这里读用例文件：pytest 的用例项名字必须在**收集阶段**就定下来，
    而中文名只有用例文件自己有（`meta: { title: ... }`）。所以收集时扫一遍文件，
    把 title 抠出来；抠不到就退回文件名。

    【为什么非要这么做】文件名是英文（代码惯例：`test_switch_to_user_center.js`），
    但报告和控制台是**给人看**的 —— 之前那些地方显示的全是英文文件名，
    看的人（尤其是零基础的同事）认不出来哪条是哪条。
    """
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return path.name
    m = TITLE_IN_FILE.search(text)
    return m.group(1) if m else path.name


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


# Allure 里截图怎么贴（2026/10/13）。
#
# **默认只贴失败步骤**（owner 2026/10/13 拍板："算了不要每一步都贴吧"）。
# 每步都贴过一次：压到宽 700 的 JPEG 后约 70KB/张、全量十几 MB，技术上跑得动；
# 但报告的重点是"哪条红了、为什么"，几百张绿步骤的图只会让人翻不到要看的。
# 所以默认回到最小，需要复盘每一步时再临时打开 all。
#
#      UITEST_ALLURE_SHOTS=failed  只贴失败步骤的原图（默认）
#      UITEST_ALLURE_SHOTS=all     每步一张压缩图 + 失败那步补原图（复盘用）
#      UITEST_ALLURE_SHOTS=none    都不贴
#
# 失败时贴的是**原图**（1216×2640，看清细节比省空间重要）；只有 all 档才压缩 ——
# 一张原图中位 467KB，一次全量约 150 张 ≈ 70MB，那个量级必须压。
SHOT_MODE = os.environ.get("UITEST_ALLURE_SHOTS", "failed").strip().lower()
SHOT_MAX_WIDTH = 700
SHOT_JPEG_QUALITY = 72


def _shrink_for_report(shot):
    """把截图压小一点再进报告。压不了就返回 None（调用方退回贴原图）—— 不影响用例结果。"""
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        import io as _io

        with Image.open(shot) as im:
            im = im.convert("RGB")
            if im.width > SHOT_MAX_WIDTH:
                h = int(im.height * SHOT_MAX_WIDTH / im.width)
                im = im.resize((SHOT_MAX_WIDTH, h))
            buf = _io.BytesIO()
            im.save(buf, format="JPEG", quality=SHOT_JPEG_QUALITY, optimize=True)
            return buf.getvalue()
    except Exception:
        return None


def _attach_to_allure(entries, case_name):
    """把步骤日志还原成 Allure 的层次结构，并把截图贴进去"""
    if allure is None:
        return

    header = next((e for e in entries if e.get("type") == "case"), {})
    steps = [e for e in entries if e.get("type") == "step"]
    summary = next((e for e in entries if e.get("type") == "summary"), None)

    # feature -> story -> title 三层，报告里才有的分组可看
    allure.dynamic.feature(header.get("feature") or "未分类")
    allure.dynamic.story(header.get("story") or case_name)
    allure.dynamic.title(header.get("title") or case_name)

    # 表格用例的「前置条件 / 备注 / 类型分类」也贴进报告（2026/10/14 加的列，类型分类 10/16 加）：
    # 报告里挂了的时候，第一件想确认的就是"跑这条之前手机该是什么状态" ——
    # 只写在 Excel 里的话，看报告的人（可能是别人）根本没机会看到。
    precondition = str(header.get("precondition") or "").strip()
    note = str(header.get("note") or "").strip()
    case_type = str(header.get("type") or "").strip()
    if precondition or note or case_type:
        lines = []
        if case_type:
            lines.append("类型分类：%s" % case_type)
        if precondition:
            lines.append("前置条件：%s" % precondition)
        if note:
            lines.append("备注：%s" % note)
        allure.dynamic.description("\n".join(lines))

    for s in steps:
        with allure.step(f"{s.get('num')}. {s.get('name')} ({s.get('duration')}s)"):
            if s.get("error"):
                allure.attach(str(s["error"]), "错误信息", allure.attachment_type.TEXT)
            shot = s.get("screenshot")
            failed = s.get("status") == "failed"
            if not shot or not os.path.exists(shot) or SHOT_MODE == "none":
                continue
            if SHOT_MODE == "failed" and not failed:
                continue
            # all 档：每步一张压缩版（只有失败那步再补原图，看细节）
            if SHOT_MODE == "all":
                small = _shrink_for_report(shot)
                if small is not None:
                    allure.attach(
                        small,
                        name="截图（压缩版 %s）" % os.path.basename(shot),
                        attachment_type=allure.attachment_type.JPG,
                    )
            if failed:
                allure.attach.file(
                    shot,
                    name="截图（原图 %s）" % os.path.basename(shot),
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

    def __init__(self, node_script, case_id=None, **kwargs):
        super().__init__(**kwargs)
        self.node_script = node_script
        # 只有「表格用例」才有：告诉 node 侧这次只跑表格里的哪一条
        #（同一个文件被拆成多个 pytest 用例项时，靠它区分）
        self.case_id = case_id

    def runtest(self):
        node = shutil.which("node") or "node"

        # 步骤日志写到临时文件：与本次运行一一对应，既不污染仓库也不会并发串台
        fd, step_log_path = tempfile.mkstemp(prefix="uitest_steps_", suffix=".jsonl")
        os.close(fd)
        env = {**os.environ, "UITEST_STEP_LOG": step_log_path}
        if self.case_id:
            env[CASE_ID_ENV] = self.case_id
        # 把"当前这个 Python 解释器"交给 JS 侧：写链路用例要调 tools/quiz_data_cleanup.py
        # 读库（pymysql/yaml 装在这个解释器里）。用 `python` 这个裸命令的话，
        # 在多虚拟环境/多 Python 的机器上可能调到另一个没装依赖的解释器上。
        env["UITEST_PYTHON"] = sys.executable

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
            # 用 self.name 而不是文件名：表格用例被拆成了多条，用文件名的话
            # Allure 里几条用例的标题会一模一样，看不出是哪条
            _attach_to_allure(entries, self.name)

            # 退出码约定：0 = 通过；3 = 前置条件不满足（用例不适用）；其它非 0 = 失败。
            #
            # 为什么要有 3：像"答题活动未上线""活动卡已换成别的"这类情况，
            # 报 FAILED 会让报告里长期躺着一条假失败 —— 久而久之没人再看它
            #（正是"报告说谎"的另一种形式）。记为 SKIPPED 才反映真实语义。
            #
            # ⚠️ 注意：skip 必须**可见且可计数**。pytest 会把 SKIPPED 单独统计并打印原因，
            # Allure 也标 skipped —— 若某次运行里 skip 数量异常增多，那是信号，不是"全绿"。
            if result.returncode == SKIP_EXIT_CODE:
                # ⚠️ 必须 **stdout + stderr 一起找**：JS 侧的 `[PRECONDITION]` 是用
                # `console.error` 打的（走 stderr），第一版只读了 stdout —— 于是每次都退回到
                # 兜底文案「前置条件不满足：xxx.js」，把"为什么跳过"这个最有用的信息丢了。
                reason = (
                    self._precondition_reason((result.stdout or "") + "\n" + (result.stderr or ""))
                    or f"前置条件不满足：{self.node_script.name}"
                )
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
        # 「表格用例」特殊对待：表格里每条用例各算一个 pytest 用例项，
        # 这样报告里每条用例单独一行成功/失败，而不是捆成全文件一条。
        if self.path.name == TABLE_CASE_FILE:
            cases = load_table_cases()
            if cases:
                for case_id, case_name in cases:
                    yield JsTestItem.from_parent(
                        self,
                        name=f"{case_id} {case_name}",
                        node_script=self.path,
                        case_id=case_id,
                    )
                return
            # 表格还没导出（或读不了）：仍然生成一个用例项，
            # 让 node 侧报出「先填表 / 先导出」这个具体原因，而不是这里悄悄少收集一条
        yield JsTestItem.from_parent(self, name=case_display_name(self.path), node_script=self.path)


def pytest_collect_file(file_path, parent):
    """钩子：让 pytest 直接收集并执行 test_*.js 脚本"""
    if file_path.suffix == ".js" and file_path.name.startswith("test_"):
        return JsTestFile.from_parent(parent, path=file_path)
    return None


# ============================================================================
# 跑完给一份**中文摘要**（给"不想开 Allure、只想看结果"的人）
# ============================================================================
#
# 【为什么要它】Allure 报告好看，但要 Java + allure CLI + 浏览器，而且还得知道点哪。
# 零基础的同事跑完真正想知道的是三句话：**过了几条、哪条红了、为什么红**。
# 于是每次跑完都在 report/结果摘要.md 落一份，并在控制台把"红的和跳过的"直接打出来
# （全绿的用例不用列 —— 21 行里找那 1 行红的，是负担）。
#
# 【纪律：摘要必须是**从真实结果生成**的，不许自己编】
# 数据来源是 pytest 自己的 report 对象（runtest_logreport），不是我们另外判断一遍。
# 另外：**没有产生的报告不写** —— 宁可不生成文件，也不给一份"看起来全绿"的假摘要。

_OUTCOMES = {}  # nodeid -> {"outcome", "when", "duration", "reason"}


def _display_name(nodeid):
    """把 `suprecast_app/test_from_table.js::ZW_001 首页活动入口…` 取成后半截给人看"""
    return nodeid.split("::")[-1] if "::" in nodeid else Path(nodeid).name


def _reason_of(report):
    """从 pytest 的 report 里抠出**人话原因**。

    踩过的坑：`pytest.skip(reason)` 的 longrepr 在"跳过"时是个三元组
    `(文件, 行号, 'Skipped: 原因')`，直接 `str()` 出来给用户看就是一坨元组，
    所以跳过要取第三项并去掉 `Skipped: ` 前缀；失败则优先找我们自己的那句
    `node 执行失败(...)`（比一整段 traceback 有用）。
    """
    if report.skipped:
        lr = report.longrepr
        text = str(lr[2]) if isinstance(lr, tuple) and len(lr) >= 3 else (getattr(report, "longreprtext", "") or "")
        return text.replace("Skipped: ", "").strip()

    lines = [l.strip() for l in (getattr(report, "longreprtext", "") or "").splitlines() if l.strip()]
    for l in lines:
        if "node 执行失败" in l:
            return l
    return lines[-1] if lines else ""


def pytest_runtest_logreport(report):
    """把每条用例的结果攒起来（pytest 自己产出的 report，不另做判断）"""
    rec = _OUTCOMES.setdefault(report.nodeid, {"outcome": "passed", "duration": 0.0, "reason": ""})
    rec["duration"] += report.duration or 0.0
    # 三个阶段都看：setup（前置条件跳过就在这）／call／teardown（收尾炸了也算）
    if report.failed:
        rec["outcome"] = "failed"
        rec["reason"] = _reason_of(report)
    elif report.skipped and rec["outcome"] != "failed":
        rec["outcome"] = "skipped"
        rec["reason"] = _reason_of(report)


def pytest_sessionfinish(session, exitstatus):
    """跑完写摘要文件 + 在控制台打印"红的和跳过的"（全绿时只说一句全绿）"""
    if not _OUTCOMES:
        return  # 一条都没跑（例如 --collect-only）：不产出摘要，免得给人错觉

    passed = [n for n, r in _OUTCOMES.items() if r["outcome"] == "passed"]
    failed = [(n, r) for n, r in _OUTCOMES.items() if r["outcome"] == "failed"]
    skipped = [(n, r) for n, r in _OUTCOMES.items() if r["outcome"] == "skipped"]

    out_dir = Path(__file__).resolve().parents[2] / "report"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "结果摘要.md"

    lines = [
        "# 本次测试结果（中文摘要）",
        "",
        "> 自动生成，别手改 —— 数据来自 pytest 每条用例的真实结果。",
        "",
        f"- 时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 合计：**{len(_OUTCOMES)} 条**（通过 {len(passed)}，失败 {len(failed)}，跳过 {len(skipped)}）",
        f"- 详细报告（带截图）：report/allure-report/index.html",
        "",
    ]
    if failed:
        lines += ["## ❌ 失败的（要看这几条）", ""]
        for n, r in failed:
            lines += [f"### {_display_name(n)}", "", f"- 原因：{r['reason'] or '(没拿到原因，去看控制台)'}", ""]
    if skipped:
        lines += ["## ⏭ 跳过的（= 这次没测，不算通过）", ""]
        for n, r in skipped:
            lines += [f"- **{_display_name(n)}**：{r['reason'] or '(没写原因)'}"]
        lines += [""]
    if passed:
        lines += ["## ✅ 通过的", ""]
        for n in passed:
            lines += [f"- {_display_name(n)}（{_OUTCOMES[n]['duration']:.1f}s）"]
        lines += [""]

    out_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    bar = "=" * 62
    emit("\n" + bar)
    emit(f"本次结果：合计 {len(_OUTCOMES)} 条，通过 {len(passed)}，失败 {len(failed)}，跳过 {len(skipped)}")
    for n, r in failed:
        emit(f"  [红] {_display_name(n)}")
        emit(f"       {r['reason'] or '(没拿到原因)'}")
    for n, r in skipped:
        emit(f"  [跳过] {_display_name(n)}：{r['reason'] or '(没写原因)'}")
    if not failed and not skipped:
        emit("  全绿：没有失败，也没有跳过。")
    emit(f"中文摘要（可以直接发给同事）：report/结果摘要.md")
    emit("单条复跑（改了用例/想再确认一次时用）：python run.py -k 用例名里的几个字")
    emit(bar)
