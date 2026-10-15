# -*- coding: utf-8 -*-
"""数据 / 凭据安全不变式检查（**离线**，不需要手机）。

为什么要有它：这个仓库里最容易「静默变坏」的两件事，都不会报错 ——

  1. **表格动作里混进"会改数据"的操作**：测试环境用的是 owner 的**真实账号**，
     一次误提交/误兑换就是真实数据被改（见 README §十 数据安全）。
  2. **凭据进版本库**：数据库密码、SSH 私钥一旦提交出去，删掉文件也收不回来。

所以把这两件事写成机器检查：改完代码跑一遍，绿了再提交。

用法：python scripts/check-safety.py
退出码：0 = 全部通过；1 = 有违反（会逐条列出）
"""

import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

import export_cases as m  # noqa: E402

# 「会改数据」的词：表格里不许出现带这些词的动作，也不许「点文字」点它们
WRITE_WORDS = (
    "提交", "兑换", "签到", "下单", "支付", "付款", "购买", "领取",
    "抽奖", "报名", "删除", "退款", "取消订单",
)

# owner 2026/10/12 拍板：可以测「会改数据」的操作（见 docs/待owner拍板.md Q2/Q3）。
# 所以这条规则从"一刀切禁止"改成"白名单 + 必须有开关"：
#   · 白名单里的动作，实现里**必须**走 writeSwitchOn()（下面第 3 节逐条检查）
#   · 白名单外，仍然一个字都不许出现 —— 加白名单是件要写进文档的事，不该顺手就加
# owner 同意过、且实现里必须走 UITEST_ALLOW_SUBMIT 开关的写动作。
# 「屏蔽/还原礼品分类」是 2026/10/14 加的**夹具**动作（缺陷 713396918 的回归要用屏蔽后的分类）；
# 名字里没有 WRITE_WORDS 里的词，所以第 1 条规则抓不到它们 —— 放进来是为了让下面
# 「写动作必须走开关」那条**照旧逐条盯着**（一个动作都不能绕开开关写库）。
APPROVED_WRITE_ACTIONS = {"提交答卷", "复位答题记录", "屏蔽礼品分类", "还原礼品分类"}

failures = []
passed = 0


# 否定前缀：动作名里出现「未购买 / 不删除 / 非支付」这类说法时，描述的是**状态**，不是"要写数据"。
# 这条修正是被一次误报逼出来的：新动作「检查未购买点课时」只是**读**页面，
# 却因为名字里有「购买」被当成写操作挡下 —— 闸门太粗会把真问题淹在噪音里。
NEGATION_PREFIXES = ("未", "不", "非", "无")


def action_looks_like_write(name):
    """动作名看起来是不是"会改数据"（先把否定说法摘掉再判）"""
    text = str(name or "")
    for word in WRITE_WORDS:
        for prefix in NEGATION_PREFIXES:
            text = text.replace(prefix + word, "")
    return any(word in text for word in WRITE_WORDS)


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("OK   %s" % name)
    else:
        failures.append("%s（%s）" % (name, detail))
        print("FAIL %s（%s）" % (name, detail))


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as f:
        return f.read()


def tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, text=True, encoding="utf-8"
    )
    return out.stdout.splitlines()


# ---------- 1) 表格动作里不许有"会改数据"的动作（owner 同意的那几个除外）----------
hit = [
    a["name"]
    for a in m.ACTIONS
    if action_looks_like_write(a["name"]) and a["name"] not in APPROVED_WRITE_ACTIONS
]
check(
    "表格动作里没有「会改数据」的动作（owner 同意的 %d 个除外）" % len(APPROVED_WRITE_ACTIONS),
    not hit,
    "发现：%s" % "、".join(hit),
)
declared_names = {a["name"] for a in m.ACTIONS}
check(
    "白名单里的动作确实存在（别写成没用的名字）",
    APPROVED_WRITE_ACTIONS <= declared_names,
    "清单里没有：%s" % "、".join(sorted(APPROVED_WRITE_ACTIONS - declared_names)),
)

# ---------- 2) 「点文字」的安全阀还在（且词表没被缩小）----------
table_js = read("test_case/suprecast_app/test_from_table.js")
m_block = re.search(r"const BLOCKED_TEXT = \[(.*?)\];", table_js, re.S)
blocked = re.findall(r'"([^"]+)"', m_block.group(1)) if m_block else []
check("点文字的安全阀 BLOCKED_TEXT 还在", bool(blocked), "没找到 BLOCKED_TEXT")
missing = [w for w in WRITE_WORDS if w not in blocked]
check("安全阀词表没被缩小", not missing, "少了：%s" % "、".join(missing))
check(
    "点文字的实现里真的用了安全阀",
    "BLOCKED_TEXT.find" in table_js or "BLOCKED_TEXT.includes" in table_js,
    "看起来没调用 BLOCKED_TEXT",
)

# ---------- 3) 默认关闭的"写"开关没有被打开 ----------
quiz_case = read("test_case/suprecast_app/test_quiz_activity.js")
check(
    "test_quiz_activity.js 的 ALLOW_SUBMIT 仍是 false",
    re.search(r"const ALLOW_SUBMIT = false;", quiz_case) is not None,
    "被改成 true 了？提交会写真实数据",
)
quiz_page = read("app_sub_function/suprecast_app/pages/quiz_activity_page.js")
check(
    "submitIfAllowed 默认仍不提交",
    re.search(r"async function submitIfAllowed\(page, \{ allowSubmit = false \} = \{\}\)", quiz_page)
    is not None,
    "默认值被改了",
)
check(
    "selectFirstOption 默认仍不点选项",
    re.search(r"async function selectFirstOption\(page, \{ allowInteract = false \} = \{\}, ctx = null\)", quiz_page)
    is not None,
    "默认值被改了",
)

# ---------- 3.5) 白名单里的"写"动作必须真的被开关保护 ----------
# 这一段查的是"开关有没有被绕过去"：如果有人把 handler 写成直接执行（去掉 writeSwitchOn），
# 表格里随手写一行就会真的写数据 —— 而且**不会报错**。所以要逐条盯住。
handlers = table_js.split("const HANDLERS = {", 1)[1].rsplit("};", 1)[0]


def handler_body(name):
    """取某个动作的实现代码片段（从「  动作名: {」到下一个「  },\n」）"""
    start = handlers.find("\n  %s: {" % name)
    if start < 0:
        return None
    end = handlers.find("\n  },", start)
    return handlers[start : end if end > 0 else len(handlers)]


for name in sorted(APPROVED_WRITE_ACTIONS):
    body = handler_body(name)
    check(
        "写动作「%s」走了环境变量开关" % name,
        bool(body) and "writeSwitchOn" in body,
        "实现里找不到 writeSwitchOn() —— 这样表格里写一行就会直接写数据",
    )

db_tool = read("common/db_tool.js")
check(
    "开关只认「明确等于 1」（不是宽松判断）",
    'process.env.UITEST_ALLOW_SUBMIT === "1"' in db_tool,
    "db_tool.js 里的开关判断被改松了",
)
check(
    "写链路用例默认不跑（没开关就跳过）",
    'process.env.UITEST_ALLOW_SUBMIT === "1"' in read("test_case/suprecast_app/test_quiz_submit.js"),
    "test_quiz_submit.js 的开关判断被改掉或被写死成 true",
)

# ---------- 3.6) 会写数据的 Python 工具：三道闸一个都不能少 ----------
# 这两个工具是仓库里仅有的"会删/会改数据"的脚本。它们的护栏是**代码里写死的**，
# 所以只要有人"顺手"删掉一段，保护就没了、而且不会报错 —— 必须由闸门盯着。
#
# 最后一个布尔：这个工具要不要"库名闸门"。
#   · 改库的工具（答题复位 / 案例复制复位）-> True；
#   · 走**接口**写数据的工具（帖子置顶：置顶状态不在这套库里，只能调管理后台接口）->
#     False，但"默认只预览 + 必须点名目标"这两道闸照旧要盯。
WRITE_TOOLS = (
    ("tools/quiz_data_cleanup.py", "--activity", "答题数据复位", True),
    ("tools/case_copy_reset.py", "--case", "案例复制复位", True),
    ("tools/post_top_tool.py", "--id", "帖子置顶/取消置顶（走管理后台接口）", False),
)
for rel, must_name_target, label, touches_db in WRITE_TOOLS:
    src = read(rel)
    if touches_db:
        check(
            "%s：库名闸门还在（只认测试库）" % label,
            "TEST_DB_MARKERS" in src,
            "%s 里找不到 TEST_DB_MARKERS —— 「只动测试库」这道闸被删了" % rel,
        )
    check(
        "%s：默认只预览（要 --yes 才真删）" % label,
        "args.yes" in src,
        "%s 里看不到 args.yes —— 默认预览这道闸被改掉了" % rel,
    )
    check(
        "%s：必须点名目标（%s）" % (label, must_name_target),
        must_name_target in src,
        "%s 里看不到 %s —— 「不许一把梭全删」这道闸被改掉了" % (rel, must_name_target),
    )

# ---------- 4) 凭据 / 密钥不许进版本库 ----------
tracked = tracked_files()
leaked = [
    f
    for f in tracked
    if f.endswith((".pem", ".key", ".ppk"))
    or re.search(r"(^|/)id_(rsa|ed25519|ecdsa)", f)
    or f.endswith(".local.yaml")
    or f.endswith("/.env")
    or f == ".env"
]
check("没有凭据/密钥文件被 git 跟踪", not leaked, "跟踪了：%s" % "、".join(leaked))

gitignore = read(".gitignore")
need = ["config/db.local.yaml", "config/*.local.yaml", ".env", "id_ed25519", "*.pem"]
missing_rules = [n for n in need if n not in gitignore]
check(".gitignore 的安全规则还在", not missing_rules, "少了：%s" % "、".join(missing_rules))

print()
if failures:
    print("有 %d 项不通过：" % len(failures))
    for f in failures:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
