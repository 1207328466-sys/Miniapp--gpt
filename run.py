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
    python run.py -k ZW_001   # 「填表就能写用例」：只跑 cases/用例表.xlsx 里的这一条
    python run.py --env prod      # 这次改用「生产」环境跑（默认取 config/env.yaml 的 current）
"""

import os
import re
import shutil
import subprocess
import sys
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
TEST_CASE = ROOT / "test_case"
REPORT = ROOT / "report"
ALLURE_RESULTS = REPORT / "allure-results"
ALLURE_HTML = REPORT / "allure-report"

# 「填表就能写用例」：开跑前先把 Excel 用例表导出成 json
CASES_XLSX = ROOT / "cases" / "用例表.xlsx"
EXPORT_SCRIPT = ROOT / "tools" / "export_cases.py"
TABLE_CASE_JSON = ROOT / "cases" / "用例表.json"
TABLE_CASE_FILE = "test_from_table.js"

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


def export_case_table(argv):
    """把 cases/用例表.xlsx 导出成 cases/用例表.json（「填表就能写用例」的第一步）。

    为什么由脚本做、而不是让用户记得手动跑：表格改了却忘了导出，跑的就是
    **上一次的表格** —— 一份看着全绿、其实没测到你改的东西的报告。
    那是本项目反复踩到的「报告说谎」，所以把它收进代码。

    返回 True = 继续跑；False = 应当停止本次运行。
    """
    if not (EXPORT_SCRIPT.exists() and CASES_XLSX.exists()):
        return True  # 没在用表格的人（或表格还没建）不受影响

    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        # 子进程的输出编码：Windows 上 Python 往管道写字默认用 GBK，
        # 这里统一成 UTF-8，否则中文提示走到这里会变成乱码
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    for stream in (result.stdout, result.stderr):
        if stream and stream.strip():
            print(stream.strip())

    if result.returncode == 0:
        return True
    if result.returncode == 2:
        # 没有表格，脚本刚生成了模板：这次先不跑表格用例（node 侧会记成 SKIPPED）
        print("  （首次使用：这次先跳过表格用例，把表填好再跑一次）")
        return True

    # 表格内容有错：再往下跑就会拿上一次导出的旧表格出结果 -> 假绿。
    # 只有「本次运行明确点名了别的用例文件」时才放行，其余一律停下来。
    #
    # 判断只看"像文件路径"的参数（.js/.py 或带目录分隔符）。为什么不能只看
    # "不以 - 开头的参数"：`python run.py -k ZW_002` 里的 ZW_002 也不是以 -
    # 开头，但它恰恰**是**表格里的一条用例编号（实际踩到：表格坏了却照旧跑出一条
    # 漂亮的「通过」）。所以 -k 这种无法事先判断命中范围的，一律按"可能命中表格"处理。
    files = [a for a in argv if not a.startswith("-")]
    path_like = [f for f in files if f.endswith((".js", ".py")) or "/" in f or "\\" in f]
    if path_like and not any(TABLE_CASE_FILE in f for f in path_like):
        print("\n[!] 用例表有错，但本次运行只点名了别的用例文件，因此继续（不受表格影响）")
        return True

    print("\n[!] 用例表有错，已停止本次运行 —— 继续跑会拿上一次导出的旧表格出结果，那种「通过」是假的。")
    print("    改好 cases/用例表.xlsx 再跑；若只想跑别的用例，点名到文件即可，例如：")
    print("      python run.py suprecast_app/test_example.js")
    print("    （用 -k 时无法事先判断会不会命中表格里的用例，所以这里保守地停下来）")
    return False


def looks_like_case_id(token, case_ids):
    """这个位置参数看起来是不是**用例编号**？—— **纯函数**（离线自检直接调它）。

    【为什么要有它】2026/10/14 owner 实际踩到：`python run.py ZW_029` ——
    这里的 `ZW_029` 会被 pytest 当成**文件/目录路径**去收集，找不到就：

        ERROR: file or directory not found: ZW_029
        collected 0 items          （退出码 4）

    而人想说的是"只跑这一条"。pytest 里那是 `-k` 的活：

        python run.py -k ZW_029

    报错本身没说这句人话（"命令行参数错误"听着像参数写错了格式，其实是"位置参数的含义不对"），
    所以这里在开跑前就把它翻译出来。判据刻意保守：**只有在用例表里真能找到这个编号**才算命中 ——
    路径该长什么样就交给 pytest 自己报错（`file or directory not found` 已经够清楚）。

    @param {string} token 一个不以 - 开头的命令行参数
    @param {Iterable[str]} case_ids 用例表里的编号（大小写不敏感）
    @returns {bool}
    """
    t = str(token or "").strip().strip("\\/")  # 末尾的 \ 或 / 是路径分隔符，去掉再看
    if not t or t.startswith("-"):
        return False
    # 看着就是文件/目录路径的，不归这里管（交给 pytest 报"找不到"）
    if t.endswith((".js", ".py", ".xlsx", ".json")) or "/" in t or "\\" in t:
        return False
    return t.lower() in {str(c).lower() for c in (case_ids or [])}


# 这些选项**后面那一个词是它们的值**，不是位置参数 —— 判断时要跳过它。
# ⚠️ 漏掉这一步真踩到过（2026/10/14 写完立刻验到的）：`python run.py -k ZW_029` 里
# 的 ZW_029 会被当成"位置参数"拦下来 —— 而那正是**正确**写法。所以先按选项把值摘出去。
VALUE_OPTIONS = ("-k", "-m", "-n", "--env", "--alluredir", "--deselect")


def positional_candidates(argv):
    """挑出「真正会被 pytest 当成 文件/目录 去收集」的位置参数（选项的值不算）。

    **纯函数**，离线自检直接调它。判据：
      · `-k` / `--env` 这类"带值选项"后面那一个词 -> 是值，跳过；
      · 其余以 - 开头的 -> 是选项本身，跳过；
      · 剩下的就是位置参数。
    """
    out, skip_next = [], False
    for a in argv or []:
        if skip_next:
            skip_next = False
            continue
        if a in VALUE_OPTIONS:
            skip_next = True
            continue
        if str(a).startswith("-"):
            continue
        out.append(a)
    return out


def preflight_case_selector(argv):
    """按用例编号挑一条时要写 `-k`；写成位置参数的话，在这里就讲清楚（别等 pytest 报天书）。

    @returns 能不能继续（False = 已把原因和正确写法打印出来，本次不跑）
    """
    case_ids, titles = [], {}
    try:
        payload = json.loads(TABLE_CASE_JSON.read_text(encoding="utf-8"))
        for c in payload.get("cases", []):
            case_ids.append(c.get("id", ""))
            titles[str(c.get("id", ""))] = c.get("name", "")
    except Exception:
        return True  # 没有/读不了 json：不拦（后面 pytest 该报什么报什么）

    hits = [a for a in positional_candidates(argv) if looks_like_case_id(a, case_ids)]
    if not hits:
        return True

    for token in hits:
        cid = str(token).strip().strip("\\/")
        title = titles.get(cid) or titles.get(cid.upper(), "")
        print(f"\n[!] 「{token}」是**用例编号**，这样传跑不起来 —— " + (f"（{cid}「{title}」）" if title else ""))
        print("    位置参数在 pytest 里表示「收集哪个文件/目录」，它不是名字筛选：")
        print(f"      ERROR: file or directory not found: {token}")
        print("      collected 0 items（退出码 4，看着像参数格式写错了，其实是位置参数的含义不对）")
        print("    只跑这一条的正确写法是给它加个 -k：")
        print(f"      python run.py -k {cid}        # -k 后面写编号，或标题里的几个字")
        print(
            "    （后面什么都不写就是跑表里的全部 %d 条；点名单个 .js 用例文件时才直接给路径）"
            % len([c for c in case_ids if c])
        )
    return False


def parse_focus_app(text):
    """从 `dumpsys window displays` 的输出里判断**前台是不是小程序**（纯函数，便于离线自检）。

    为什么看这个：框架要抓的是微信的小程序 webview；但"微信开了、小程序却退到后台/被切走"时，
    它抓不到 —— 于是**20 多条用例会挨个报「找不到前台小程序webview」**（2026/10/13 真跑遇到过一次，
    一上午的回归里红了两条，白等十几分钟）。这里在开跑前先看一眼前台是谁。

    @returns {"appbrand" | "wechat" | "other" | "unknown"}
    """
    # 注意别在 `/` 处截断：窗口名是 `com.tencent.mm/com.tencent.mm.plugin.appbrand.ui.AppBrandUI00`，
    # 只取到 `com.tencent.mm` 就会把"小程序在前台"误判成"微信在前台"（第一版就是这么错的）
    m = re.search(r"mCurrentFocus=\S+\s+\S+\s+([^\s}]+)", str(text or ""))
    if not m:
        return "unknown"
    win = m.group(1)
    if "appbrand" in win.lower():
        return "appbrand"
    if win.startswith("com.tencent.mm"):
        return "wechat"
    return "other"


def parse_adb_devices(text):
    """把 `adb devices` 的输出解析成 (可用设备号列表, 原始行列表) —— **纯函数**，便于离线自检。

    为什么要单独抽出来：这段判断一旦写松（比如把 `unauthorized` / `offline` 也算可用），
    后面就是"以为有设备、结果一路失败"。纯函数 + 自检能把它钉住（见 scripts/selftest-run-preflight.py）。
    """
    raw = [l.strip() for l in str(text or "").splitlines() if l.strip()]
    body = [l for l in raw if not l.startswith("List of devices attached") and not l.startswith("*")]
    # 只有"设备号 + 状态"两列、且状态正好是 device 的才算可用
    ready = [l.split()[0] for l in body if len(l.split()) >= 2 and l.split()[1] == "device"]
    return ready, body


def devtools_socket_names(text):
    """从 `cat /proc/net/unix` 的输出里挑出 **webview 调试 socket** 的名字（纯函数，便于离线自检）。

    只认名字里带 `devtools_remote` 的 —— 微信小程序的 CDP 端口就是这个形状
    （Playwright 也是靠它找到 webview 的）。

    ⚠️ 系统有可能把**别的进程**的 socket 名打码成 `@@@@...`。所以"这里 0 个"
    只用来**提醒**，不用来拦人（硬拦会误伤那些"能跑、但名字看不见"的机器）。
    """
    out = []
    for line in str(text or "").splitlines():
        m = re.search(r"@([^\s@]*devtools_remote[^\s]*)", line, re.I)
        if m:
            out.append(m.group(1))
    return out


def preflight_webview_debug(argv):
    """开跑前提醒一句：**微信侧的小程序调试端口在不在**。

    真实场景（2026/10/19）：设备在、小程序也在前台（前两道预检都过），但
    `/proc/net/unix` 里一个 `*_devtools_remote*` 都没有 —— 微信的调试开关掉了。
    框架会在 30 秒后报「找不到前台小程序webview」；以前那句话还会把人引去查
    "小程序在不在前台"（那两条明明都成立）。这里提前把真正的原因说清楚。

    **只提醒、不拦**：名字可能被系统打码（见 `devtools_socket_names`），
    拦下来会误伤；而一句提醒足以省掉一轮"重启小程序 / 拔插数据线"的白折腾。
    """
    if any(a in ("--collect-only", "--co", "-h", "--help", "--version") for a in argv):
        return True
    adb = shutil.which("adb")
    if adb is None:
        return True
    try:
        out = subprocess.run(
            [adb, "shell", "cat /proc/net/unix"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except Exception:
        return True
    if not out.stdout.strip():
        return True  # 读不到（权限/机型差异）-> 不猜
    names = devtools_socket_names(out.stdout)
    if names:
        return True
    print("\n[!] 提示：手机上一个 webview 调试端口都没看到（可能只是名字被系统打码，先别急着停）。")
    print("    如果下面报「找不到前台小程序webview」，原因多半是**微信侧的小程序调试开关掉了** ——")
    print("    小程序里的 vConsole 角标是**小程序自己**开的，跟这个 CDP 调试端口不是一回事。")
    print("    恢复（任选一条）：① 小程序右上角「…」→ 有「打开调试 / 开发调试」就点它；")
    print("    ② 让前端用「微信开发者工具 → 真机调试」连一次；③ 重开小程序 / 重启微信。")
    print('    判据：adb shell "cat /proc/net/unix | grep -i devtools_remote" 至少要有一行')
    return True


def preflight_foreground(argv):
    """开跑前看一眼**前台是不是小程序** —— 不是就当场停下并说清怎么弄。

    真实场景（2026/10/13）：手机连着、adb 也正常，但小程序退到了后台（或微信被切走）。
    那次全量跑里两条 .js 用例直接报「找不到前台小程序webview」，其余用例照样一条条跑完 ——
    十几分钟里真正的原因只有一句。所以这里先看一眼，不是小程序就停下。

    （`--collect-only` 这类不碰手机的运行照常放行。）
    """
    if any(a in ("--collect-only", "--co", "-h", "--help", "--version") for a in argv):
        return True

    adb = shutil.which("adb")
    if adb is None:
        return True  # 上一步的 preflight_device 已经就"找不到 adb"报过错了

    try:
        out = subprocess.run(
            [adb, "shell", "dumpsys", "window", "displays"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except Exception:
        return True  # 拿不到就算了：这只是"提前提醒"，不该把能跑的运行拦下

    who = parse_focus_app(out.stdout)
    if who in ("appbrand", "unknown"):
        # unknown = 输出里没看到 mCurrentFocus（有的机型/权限下读不到）—— 不拦
        return True

    print("\n[!] 前台不是小程序，已停下。")
    if who == "wechat":
        print("    现在前台是微信本体（不是某个小程序）。")
    else:
        print("    现在前台是别的应用。")
    print("    要跑真机用例，先做这一步：")
    print("      在手机上把**被测小程序点开、停在它的页面上**（框架不会替你打开微信/小程序）。")
    print("    然后重跑 `python run.py`。（只想收集用例：python run.py --collect-only）")
    return False


def resolve_environment(argv):
    """把本次要跑的**环境**定下来，并把该带的参数接上（2026/10/13）。

    为什么放在最前面：测试环境和生产环境是**两个不同的小程序**，先在控制台把
    「本次环境：…（appid …）」打出来，事后才不会出现"翻记录才发现跑错环境了"。

    它做三件事：
      1. 吃掉 `--env 名字` 这个参数（不然 pytest 会报"不认识的参数"）；
      2. 按环境把 `UITEST_APP_ID` 塞进环境变量 —— 这一条**接通了早就写好但从没通电的 appid 安全阀**
         （候选页按期望 appid 硬过滤；在这之前没人设过它，等于每次跑都不校验）；
      3. 生产环境**强制清掉写开关**（不是提醒，是清掉），并且 appid 没填时**直接停下**。

    @returns (要透传给 pytest 的 argv, 能不能继续)
    """
    sys.path.insert(0, str(ROOT / "tools"))
    import use_env as envmod

    # 1) 挑出 --env / --env=xxx，其余原样留给 pytest
    rest, name = [], None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--env":
            if i + 1 >= len(argv):
                print("\n[!] --env 后面要跟环境名，例如：python run.py --env prod")
                return rest, False
            name, i = argv[i + 1], i + 2
            continue
        if arg.startswith("--env="):
            name, i = arg.split("=", 1)[1], i + 1
            continue
        rest.append(arg)
        i += 1

    # 2) 读档案。**档案本身读不了**（文件被删/写坏）不算致命：提示一下、按老样子跑，
    #    免得一个配置文件把人彻底挡在门外；但**选了某个环境而它不合法**（比如生产没 appid）必须停。
    try:
        data = envmod.load()
    except envmod.EnvError as e:
        print(f"\n[提示] 环境档案没读到，这次不设置环境（appid 也不会校验）：{e}")
        return rest, True

    if name is None:
        name = data.get("current", "")
    prof, err = envmod.resolve(data, name)
    if err:
        print("\n[!] " + err)
        print("    看有哪些环境：python tools/use_env.py")
        return rest, False

    done = envmod.apply(prof)
    print(envmod.banner(prof))
    if done.get("UITEST_ALLOW_SUBMIT") == "(已清掉)":
        print("    （这套环境本来就禁止写数据：你设的 UITEST_ALLOW_SUBMIT 已被清掉）")
    return rest, True


def preflight_device(argv):
    """开跑前先确认**手机上连着设备** —— 否则 20 多条用例会一条条失败，白等十几分钟。

    真实场景（2026/10/12 实际发生）：owner 把数据线拔了，此时跑 `python run.py`，
    每条用例都会以「adb 没有识别到任何设备」失败 —— 报告里 25 条红，
    但真正的原因只有一句。所以这里**先查一次 adb**，没设备就当场说清怎么处理。

    只在"真的要跑用例"时才拦：`--collect-only` / `--help` 这类不需要手机的运行放行。
    """
    if any(a in ("--collect-only", "--co", "-h", "--help", "--version") for a in argv):
        return True

    adb = shutil.which("adb")
    if adb is None:
        print("\n[!] 找不到 adb 命令 —— 框架测试小程序要靠它。")
        print("    装法：装 Android SDK Platform-Tools，并把它的目录加进 PATH；")
        print("    装完重开一个 PowerShell 再试（`adb version` 能看到版本号就对了）。")
        return False

    try:
        out = subprocess.run([adb, "devices"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    except Exception as e:
        print(f"\n[!] 执行 `adb devices` 失败：{e}")
        return False

    ready, lines = parse_adb_devices(out.stdout)
    if ready:
        print(f"设备检查：找到 {len(ready)} 台可用的设备（{ '、'.join(ready) }）")
        return True

    print("\n[!] 没有可用设备，已停下（不然接下来 20 多条用例会一条条失败，白等十几分钟）。")
    print("    现在 `adb devices` 里看到的是：")
    for l in lines or ["    （空的，一台都没有）"]:
        print(f"      {l}")
    print("    按这三步看：")
    print("      1) 手机上打开「开发者选项 → USB 调试」；")
    print("      2) 换一根**能传数据**的线（有些线只能充电）；")
    print("      3) 插上后手机若有「允许 USB 调试」弹窗，点允许。")
    print("    好了再跑：adb devices   —— 看到一行 xxx device 就行。")
    print("    （只想收集用例、不跑真机：python run.py --collect-only）")
    return False


def main(argv):
    if not TEST_CASE.is_dir():
        print(f"找不到用例目录：{TEST_CASE}")
        return 2

    # 先把「这次跑哪个环境」定下来（生产没填 appid 会在这里停下，见函数内说明）
    argv, env_ok = resolve_environment(argv)
    if not env_ok:
        return 2

    if not preflight():
        return 2

    # 手机没连上就当场停下（细节见函数里的说明）
    if not preflight_device(argv):
        return 2

    # 小程序没在前面也当场停下（不然每条用例都会报「找不到前台小程序webview」）
    if not preflight_foreground(argv):
        return 2

    # 微信侧的调试端口在不在：只提醒、不拦（名字可能被系统打码，见函数内说明）
    preflight_webview_debug(argv)

    # 表格用例：开跑前先导出一次（表格有错会在这里停下来，见函数内说明）
    if not export_case_table(argv):
        return 2

    # 「python run.py ZW_029」这种写法：ZW_029 会被当成文件路径 -> 0 条用例（退出码 4）。
    # 在这里翻译成人话并给出正确写法（-k），见函数内说明。
    if not preflight_case_selector(argv):
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
