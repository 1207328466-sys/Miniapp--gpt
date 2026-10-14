# -*- coding: utf-8 -*-
"""run.py 开跑前"设备预检"的自检（**不需要手机**）：`adb devices` 的解析要正反都对。

为什么要它：这段判断一旦写松 —— 比如把 `unauthorized` / `offline` 也算"可用设备" ——
后果是"以为有设备，结果 20 多条用例一条条失败"，而且报错指向的是每条用例，
真正的原因（设备没就绪）被埋了。这正是本仓最忌讳的"看起来跑了、其实没跑对"。

用法：python scripts/selftest-run-preflight.py
退出码：0 = 全部通过；1 = 有不符合预期的
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

import run as runpy  # noqa: E402

failed = []
passed = 0


def expect(name, text, want_ready):
    """解析一段 adb 输出，核对"可用设备列表"是不是期望的那样"""
    global passed
    ready, _ = runpy.parse_adb_devices(text)
    if ready != want_ready:
        failed.append("%s：解析出 %s，期望 %s" % (name, ready, want_ready))
        return
    passed += 1
    print("OK   %s -> %s" % (name, ready))


HEADER = "List of devices attached\n\n"

# ---------- 正例 ----------
expect("一台就绪的设备", HEADER + "3B1F64EA9BBUTE00\tdevice\n", ["3B1F64EA9BBUTE00"])
expect(
    "两台都就绪",
    HEADER + "emulator-5554\tdevice\n3B1F64EA9BBUTE00\tdevice\n",
    ["emulator-5554", "3B1F64EA9BBUTE00"],
)
expect("设备号后带额外信息也能认（按第一列取）", HEADER + "abc123\tdevice product:PKX110 model:PKX110\n", ["abc123"])

# ---------- 反例（关键：没就绪的绝不能算"可用"）----------
expect("一台都没有", HEADER, [])
expect("空输出", "", [])
expect("只有表头（连空行都没有）", "List of devices attached", [])
expect("unauthorized 不算可用", HEADER + "3B1F64EA9BBUTE00\tunauthorized\n", [])
expect("offline 不算可用", HEADER + "3B1F64EA9BBUTE00\toffline\n", [])
expect("no permissions 不算可用", HEADER + "3B1F64EA9BBUTE00\tno permissions\n", [])
expect(
    "就绪与未就绪混在一起时，只取就绪的",
    HEADER + "aaa\tunauthorized\nbbb\tdevice\nccc\toffline\nddd\tdevice\n",
    ["bbb", "ddd"],
)
# ---------- 前台是谁（决定"要不要提示先打开小程序"）----------
def expect_focus(name, line, want):
    """核对前台应用解析（纯函数）。第一版正则在 `/` 处截断，把小程序误判成微信 —— 这条就是为它加的。"""
    global passed
    got = runpy.parse_focus_app(line)
    if got != want:
        failed.append("%s：解析出 %s，期望 %s" % (name, got, want))
        return
    passed += 1
    print("OK   %s -> %s" % (name, got))


expect_focus(
    "小程序在前台（AppBrandUI）",
    "  mCurrentFocus=Window{64caf8d u0 com.tencent.mm/com.tencent.mm.plugin.appbrand.ui.AppBrandUI00}",
    "appbrand",
)
expect_focus(
    "微信本体在前台（聊天列表）",
    "  mCurrentFocus=Window{a1b2c3d u0 com.tencent.mm/com.tencent.mm.ui.LauncherUI}",
    "wechat",
)
expect_focus("别的应用在前台", "  mCurrentFocus=Window{9f8e7d u0 com.android.settings/.Settings}", "other")
expect_focus("读不到 mCurrentFocus -> unknown（不拦）", "  (没有任何 focus 行)", "unknown")
expect_focus(
    "小程序但类名里没有 AppBrandUI 字样（按包名判断的兜底）",
    "  mCurrentFocus=Window{111 u0 com.tencent.mm/com.tencent.mm.plugin.appbrand.ui.AppBrandUI}",
    "appbrand",
)

expect("adb 的守护进程提示行（* daemon not running…）不算设备", "* daemon not running; starting now at tcp:5037\n" + HEADER, [])

# ---------- 「按编号挑一条」要写 -k（2026/10/14 owner 实际踩到）----------
# 为什么盯它：`python run.py ZW_029` 里的 ZW_029 会被 pytest 当成**文件路径**，
# 找不到 -> collected 0 items + 退出码 4，而报错里完全没提"你该用 -k"。
# 这里的判据只认"真的在用例表里出现过的编号"，路径该报错还是让 pytest 自己报。
def expect_selector(name, token, want):
    """核对「这个位置参数像不像用例编号」的判断"""
    global passed
    got = runpy.looks_like_case_id(token, CASE_IDS)
    if got != want:
        failed.append("%s：判成 %s，期望 %s" % (name, got, want))
        return
    passed += 1
    print("OK   %s -> %s" % (name, got))


CASE_IDS = ["ZW_001", "ZW_022", "ZW_029"]

# 正例：确实是用例编号（要拦下来并提示 -k）
expect_selector("用例编号（就是 owner 踩到的那个）", "ZW_029", True)
expect_selector("带末尾反斜杠（Windows 路径写法）", "ZW_029\\", True)
expect_selector("带末尾斜杠", "ZW_029/", True)
expect_selector("前后有空格", "  ZW_022  ", True)
expect_selector("小写也认（编号不区分大小写）", "zw_029", True)

# 反例（都不能误伤）
expect_selector("-k 之后的那个词不该被当成位置参数处理", "-k", False)
expect_selector("正常的 .js 用例文件路径", "suprecast_app/test_example.js", False)
expect_selector("带目录的路径", "suprecast_app/hhh.js", False)
expect_selector("用例表里没有的编号 -> 交给 pytest 报错，不猜", "ZW_999", False)
expect_selector("完全不相干的词", "专栏", False)
expect_selector("空串", "", False)


def expect_positionals(name, argv, want):
    """核对「哪些词会被 pytest 当文件/目录收集」。

    ⚠️ 这条是为一个**当天写完就验出来的自伤**加的：第一版没跳过 `-k` 的值，
    于是把正确写法 `python run.py -k ZW_029` 也拦了下来（把 -k 后面的编号当成了位置参数）。
    """
    global passed
    got = runpy.positional_candidates(argv)
    if got != want:
        failed.append("%s：挑出 %s，期望 %s" % (name, got, want))
        return
    passed += 1
    print("OK   %s -> %s" % (name, got))


expect_positionals("★正确写法：-k 的值不算位置参数", ["-k", "ZW_029"], [])
expect_positionals("--env 的值也不算", ["--env", "test", "ZW_029"], ["ZW_029"])
expect_positionals("光秃秃一个编号（owner 踩到的写法）", ["ZW_029\\"], ["ZW_029\\"])
expect_positionals("-vs 是开关（不带值），后面的编号仍是位置参数", ["-vs", "ZW_029"], ["ZW_029"])
expect_positionals("点名 .js 文件", ["suprecast_app/test_example.js"], ["suprecast_app/test_example.js"])
expect_positionals("什么都不给 = 跑全部", [], [])

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
