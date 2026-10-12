# -*- coding: utf-8 -*-
"""「填表就能写用例」：把 Excel 用例表导出成用例文件能读的 JSON。

【为什么用 Excel，而不是让人写 YAML / JSON】
这份框架的用户是代码零基础的人。让他手写 YAML，一次缩进错、一次中文冒号，
换来的就是一条看不懂的报错。Excel 是他本来就会用的东西，而且**填错时能精确告诉他
「第几行、哪一列、错在哪」**（见下面 validate 的报错文案）—— 这比缩进/引号报错友好得多。

【数据流】
    cases/用例表.xlsx   --(本脚本)-->   cases/用例表.json   --(test_from_table.js)-->  真机
    人填这张表                          机器读这个文件            表格里每一行 = 一个步骤

【两份产物都进仓库，各有各的用处】
    xlsx 是「人改的源文件」：不进仓库，下一个人就没法接着改；
    json 是「机器读的产物」：进仓库，没装 Excel/openpyxl 的机器也能跑用例。
    两者不一致时**以 xlsx 为准** —— `python run.py` 每次开跑前都会重新导出一遍。

【「动作清单」是唯一白名单】
表里「动作」列只允许写 ACTIONS 里的名字。JS 侧
（test_case/suprecast_app/test_from_table.js）有同名实现，而且启动时会拿这份清单
反过来校验一遍：清单里有、JS 没实现 -> 直接报错。宁可报错，也不要静默跳过某一行
（「静默跳过」就是另一种形式的「报告说谎」）。

用法:
    python tools/export_cases.py           # 读 cases/用例表.xlsx，写 cases/用例表.json
    python tools/export_cases.py --init    # 生成模板（表已存在时报错，加 --force 才覆盖）
    python tools/export_cases.py --dropdown # 给已有表格补「动作」列下拉框（不动已填内容）
退出码: 0 成功；1 表格有错；2 没有表格（已生成模板）；3 缺少 openpyxl
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES_DIR = ROOT / "cases"
XLSX_PATH = CASES_DIR / "用例表.xlsx"
JSON_PATH = CASES_DIR / "用例表.json"

SHEET_DATA = "用例"
SHEET_ACTIONS = "动作清单"
SHEET_HELP = "填写说明"

HEADERS = ["用例编号", "用例名称", "步骤序号", "动作", "参数1", "参数2", "备注"]

# ---------- 动作清单（改这里 = 改表格里允许写的动作；JS 侧要同步实现同名函数）----------
# p1 / p2 是参数列的「表头提示」：填了 = 这个动作要用该参数，空着 = 不用。
ACTIONS = [
    {
        "name": "回到首页",
        "p1": "",
        "p2": "",
        "desc": "自导航到「有问必答」首页（幂等；当前在二级页时会自动点返回）。用例第一步建议都用它",
    },
    {"name": "切到用户中心", "p1": "", "p2": "", "desc": "点底部 tab「我的」，进入用户中心"},
    {
        "name": "打开积分商城",
        "p1": "",
        "p2": "",
        "desc": "从用户中心点「积分商城」进商城首页（已在则原地不动）。积分商城是二级页，没有底部 tab 栏",
    },
    {"name": "打开学习中心专栏", "p1": "", "p2": "", "desc": "进学习中心，并切到「专栏」列表"},
    {
        "name": "打开搜索并输入",
        "p1": "关键词",
        "p2": "",
        "desc": "点搜索栏进搜索页并输入关键词。注意：只能是字母/数字/下划线/点/连字符（adb 不支持中文输入）",
    },
    {
        "name": "打开搜索页",
        "p1": "",
        "p2": "",
        "desc": "只进搜索页、不输入关键词（搜索页上能看到「搜索历史」和「热门话题」）",
    },
    {
        "name": "点第一个热门话题",
        "p1": "",
        "p2": "",
        "desc": "点搜索页「热门话题」里的第 1 条，跳转到该话题的搜索结果页（需求 713129788）",
    },
    {
        "name": "打开第一个帖子",
        "p1": "",
        "p2": "",
        "desc": "在首页信息流点第一张帖子卡片，进帖子详情页（只读：不点赞、不评论）",
    },
    {
        "name": "点主页按钮",
        "p1": "",
        "p2": "",
        "desc": "点二级页导航栏上的「主页」图标回到首页（需求 713256065 的返回首页那半句）",
    },
    {
        "name": "执行搜索",
        "p1": "",
        "p2": "",
        "desc": "在搜索页按回车把搜索跑起来（只读：只是查一次）。不执行的话停在「搜索历史」面板，看不到结果页/空态",
    },
    {"name": "打开答题活动", "p1": "", "p2": "", "desc": "打开「答题赢积分」活动页（只读：不选选项、不提交）"},
    {
        "name": "点文字",
        "p1": "文字",
        "p2": "",
        "desc": "按页面上看得见的文字点一下。提交/兑换/支付这类会改数据的文字被默认禁止（见「填写说明」）",
    },
    {"name": "返回上一页", "p1": "", "p2": "", "desc": "点返回按钮退回上一页（会校验页面确实变了）"},
    {
        "name": "等待",
        "p1": "毫秒",
        "p2": "",
        "desc": "纯等待，例如 2000 = 等 2 秒。能不用就不用：先试试用「检查…」类动作替代",
    },
    {
        "name": "检查文字显示",
        "p1": "文字",
        "p2": "",
        "desc": "断言页面上看得见这段文字（会反复重试，默认最多等 8 秒）",
    },
    {"name": "检查文字不显示", "p1": "文字", "p2": "", "desc": "断言页面上看不见这段文字"},
    {
        "name": "检查元素存在",
        "p1": "选择器",
        "p2": "",
        "desc": "断言页面上找得到这个选择器，例如 .search-container",
    },
    {
        "name": "检查元素数量",
        "p1": "选择器",
        "p2": "期望数量",
        "desc": "断言选择器命中的元素个数正好是期望值，例如 .search-container / 1",
    },
    {
        "name": "检查答题页符合需求",
        "p1": "",
        "p2": "",
        "desc": "按需求 713594985 校验答题页：吸顶进度、选项 2~6 个、提交按钮状态与「是否选完」一致。"
        "只适用于**一道题**的活动；多选题库活动会记成「跳过」并说明原因（见 docs/踩坑记录.md）",
    },
    {
        "name": "检查活动入口",
        "p1": "",
        "p2": "",
        "desc": "按需求 713594979 校验首页活动入口在 最新提问/推荐/精选问答/我的关注 4 个 tab 下都显示",
    },
    {
        "name": "检查首页tab顺序",
        "p1": "",
        "p2": "",
        "desc": "按需求 713341876 校验：筛选 tab 顺序是 最新提问→推荐→精选问答→我的关注，且默认选中「最新提问」",
    },
    {
        "name": "检查回到顶部按钮",
        "p1": "",
        "p2": "",
        "desc": "按需求 713582097 校验积分商城的「回到顶部」按钮：未滚动隐藏 / 滚过阈值出现 / 点击后回顶部并隐藏",
    },
    # ---------- 下面这一批是 2026/10/10 追加的「能做的都做上」----------
    # 判据：只读 / 不改数据、零基础能填、失败信息足够定位。登录、提交、选选项**故意不加**（见 README）。
    {
        "name": "打印页面文字",
        "p1": "",
        "p2": "",
        "desc": "把当前屏幕上看得见的文字打进日志（长文截断）。挑「检查文字显示」该填什么时，先用它看一眼",
    },
    {
        "name": "点选择器",
        "p1": "选择器",
        "p2": "",
        "desc": "按选择器点第一处元素（比按文字点更准：文字有重名时用它），例如 .search-container",
    },
    {
        "name": "滑动",
        "p1": "次数",
        "p2": "方向",
        "desc": "滑动屏幕，次数 1~10、方向填 上 或 下。列表要滑到底才看得到的东西用「上」；滑完想滚回顶部用「下」",
    },
    {
        "name": "切换筛选tab",
        "p1": "tab名",
        "p2": "",
        "desc": "切首页信息流那排筛选 tab（切完会验证真的选中了）",
    },
    {
        "name": "切换学习中心顶部tab",
        "p1": "tab名",
        "p2": "",
        "desc": "切学习中心顶部那排 tab（切完会验证真的选中了）",
    },
    {
        "name": "点第一张专栏",
        "p1": "",
        "p2": "",
        "desc": "在学习中心的专栏列表里点第一张卡，进它的详情页",
    },
    {
        "name": "检查输入框的值",
        "p1": "选择器",
        "p2": "期望值",
        "desc": "读出输入框里真实的值再比较。这是表格里唯一能「读出来再比较」的检查，例如 wx-input.search-input / test",
    },
    {
        "name": "检查文字出现次数",
        "p1": "文字",
        "p2": "期望次数",
        "desc": "整页里这段文字被命中几次。注意外层包裹元素也会被算一次，所以数字常比肉眼看到的多",
    },
    {
        "name": "检查元素不存在",
        "p1": "选择器",
        "p2": "",
        "desc": "断言这个选择器一个都命中不到（例如首页上不该出现 .activity-quiz-page）。它等的是「消失」，本来就不在时会立刻通过",
    },
]

ACTION_BY_NAME = {a["name"]: a for a in ACTIONS}

# 有些动作的参数是「只能从这几个里选」——在导出时就挡住错别字（例如「最新问题」）。
# JS 侧同样会校验一次，但把错误挡在导出这一步，报错信息更早、更好懂。
ACTION_PARAM_CHOICES = {
    "切换筛选tab": {"p1": ["最新提问", "推荐", "精选问答", "我的关注"]},
    "切换学习中心顶部tab": {"p1": ["课程", "专栏", "压铸百科"]},
    "滑动": {"p2": ["上", "下"]},
}

# ---------- 模板里预置的 3 条用例：都是**只读**的，跑起来不改任何数据 ----------
# 前两条真机验证过、稳定；第三条要看当时首页轮播里有没有「答题」卡，看不到会记成跳过。
SAMPLE_ROWS = [
    ["活动入口_001", "首页活动入口在各筛选 tab 下都显示", 1, "回到首页", "", "", "需求 713594979；只读"],
    ["活动入口_001", "", 2, "检查活动入口", "", "", "只切 tab + 数活动卡，不改数据"],
    ["搜索页_001", "搜索页能打开并输入关键词", 1, "回到首页", "", "", "先摆正起点"],
    [
        "搜索页_001",
        "",
        2,
        "打开搜索并输入",
        "test",
        "",
        "关键词只能字母/数字/下划线/点/连字符（adb 不支持中文输入）",
    ],
    ["搜索页_001", "", 3, "检查元素存在", "wx-input.search-input", "", "搜索页的真实输入框"],
    ["搜索页_001", "", 4, "回到首页", "", "", "把手机交还给下一条用例"],
    [
        "答题页_001",
        "答题活动页能打开且吸顶文案齐全",
        1,
        "回到首页",
        "",
        "",
        "先摆正起点。注意：首页轮播里没有「答题」卡时，打开这一步会记成「跳过」",
    ],
    ["答题页_001", "", 2, "打开答题活动", "", "", "只读：不选选项、不提交"],
    ["答题页_001", "", 3, "检查元素存在", ".activity-quiz-page", "", "答题页根容器，只在答题页出现"],
    [
        "答题页_001",
        "",
        4,
        "检查文字显示",
        "答对最多可赢积分",
        "",
        "吸顶栏文案（需求 713594985）",
    ],
    ["答题页_001", "", 5, "回到首页", "", "", "把手机交还给下一条用例"],
]

HELP_LINES = [
    "怎么用这张表（零基础版）",
    "",
    "1. 一行 = 一个步骤。同一个「用例编号」的若干行，按「步骤序号」顺序执行；它们一起算一条用例。",
    "2. 必填三列：用例编号、步骤序号、动作。「用例名称」只在某条用例的第一行写一次就行。",
    "3. 「动作」只能填「动作清单」工作表里列出的名字 —— 填别的会在导出时报错，不会静默跳过。",
    "4. 「参数1 / 参数2」按动作需要填，不用就留空。填多了（该动作用不到）也会报错，防手滑。",
    "5. 「备注」随便写，只出现在日志和报告里，不影响执行。",
    "6. 填完执行：python run.py      （它会先自动把本表导出成 json，再跑用例）",
    "   只想跑表格里的某一条：python run.py -k 活动入口_001",
    "7. 每条用例开头都先用「回到首页」把起点摆正；会把手机停在二级页（搜索页/详情页/答题页）的用例，",
    "   最后再补一步「回到首页」把手机交还。原因：表里的用例共用同一部手机，",
    "   上一条停在二级页上，下一条可能报「找不到底部 tab」—— 开头摆正 + 结尾交还就不受影响。",
    "8. 「动作」列是**下拉框**（点单元格右边的小箭头选），可选项来自「动作清单」工作表；",
    "   「步骤序号」列只接受 1、2、3… 这样的正整数。填错的动作名根本选不出来，省一轮报错。",
    "9. 不知道「检查文字显示」该填哪段字？先加一行「打印页面文字」跑一次 ——",
    "   当前屏幕上看得见的文字会打进日志，照着抄就行（挑完把它删掉即可）。",
    "",
    "默认禁止（安全阀，避免手滑把真实数据改了）",
    "   · 「点文字」不能点这些字：提交、兑换、签到、下单、支付、购买、领取、抽奖、报名、删除、退出登录、退款、取消订单",
    "     原因：这些操作会改真实数据/消耗真实积分。真要测它们，得单独写用例并显式打开开关，不能靠表格里写一行就触发。",
    "   · 「打开答题活动」只打开页面，不选选项、不提交（选选项会消耗答题机会）。",
    "",
    "已知限制（诚实标注，别误读成框架不行）",
    "   · 搜索关键词只能是字母/数字/下划线/点/连字符：关键词是通过 adb 发过去的，adb 发中文不报错但不生效。",
    "   · 「点文字」点的是屏幕上看得见的文字；同名文字有多个时点第 1 个。",
    "   · 断言的等待时间写死在框架里（文字类 8 秒、元素类 8 秒），表格里暂时改不了。",
]


class TableError(Exception):
    """表格内容有问题。带上全部错误一起报，避免「改一个跑一次」来回折腾。"""

    def __init__(self, errors):
        self.errors = errors
        super().__init__("用例表有 %d 处问题" % len(errors))


def cell_text(value):
    """把单元格的值转成字符串。

    openpyxl 会把数字读成 int/float：序号写 1 读出来是 1，写 1.0 读出来是 1.0。
    这里统一成 "1"，免得后面拿 "1.0" 和 "1" 比不明白。
    """
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def add_dropdowns(ws, last_row=1000):
    """给「用例」工作表加两个下拉/校验（**不改任何已填内容**）：

      1. 动作列（D）：下拉选择，选项来自「动作清单」工作表的 A 列 ——
         好处是"能选的动作"只有一处定义：以后加动作只改那张表，下拉跟着变；
         而且填错的动作名**在输入时就选不出来**，省掉一轮导出报错。
      2. 步骤序号列（C）：只能填 ≥1 的整数。

    范围一路铺到第 last_row 行（默认 1000），所以以后往下加行也有下拉。

    ⚠️ 为什么校验比"随便填"好：本项目最怕的是**静默出错**。下拉 = 在源头挡掉
    手滑（把「检查文字显示」打成「检查文字」，或者填成旁边那列的内容），
    比"导出时才发现"早一步。
    """
    from openpyxl.worksheet.datavalidation import DataValidation

    # 1) 动作列：跨表引用「动作清单」的 A2:A(n+1)
    dv_action = DataValidation(
        type="list",
        formula1="='%s'!$A$2:$A$%d" % (SHEET_ACTIONS, len(ACTIONS) + 1),
        allow_blank=True,  # 表格尾部常有空行
        showErrorMessage=True,
    )
    dv_action.promptTitle = "动作"
    dv_action.prompt = "点右边的小箭头选一个动作（可选项见「动作清单」工作表）"
    dv_action.errorTitle = "没有这个动作"
    dv_action.error = "只能从列表里选。全部可选项见「动作清单」工作表；确实需要新动作时找 AI 加。"
    ws.add_data_validation(dv_action)
    dv_action.add("D2:D%d" % last_row)

    # 2) 步骤序号列：正整数
    dv_seq = DataValidation(
        type="whole",
        operator="greaterThanOrEqual",
        formula1="1",
        allow_blank=True,
        showErrorMessage=True,
    )
    dv_seq.promptTitle = "步骤序号"
    dv_seq.prompt = "同一用例内的顺序号：1、2、3…（要么全写，要么全不写，都不写就按表格先后顺序跑）"
    dv_seq.errorTitle = "序号不合法"
    dv_seq.error = "只能填 1、2、3… 这样的正整数。"
    ws.add_data_validation(dv_seq)
    dv_seq.add("C2:C%d" % last_row)


def fill_actions_sheet(ws):
    """把「动作清单」工作表写满（表头 + 每条动作一行）；已存在则先清空再重写。

    为什么单独抽出来：加动作之后，**已经存在的表**也要刷新这张工作表
    （否则下拉框和清单还是旧的 14 条）—— 走 `--dropdown` 那条路时复用它。
    """
    from openpyxl.styles import Font

    for row in list(ws.iter_rows()):
        for cell in row:
            cell.value = None
    ws.append(["动作", "参数1", "参数2", "说明"])
    for a in ACTIONS:
        ws.append([a["name"], a["p1"], a["p2"], a["desc"]])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for col, width in zip("ABCD", (20, 14, 12, 78)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"


def build_template(path):
    """生成模板（3 个工作表：用例 / 动作清单 / 填写说明）"""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()

    ws = wb.active
    ws.title = SHEET_DATA
    ws.append(HEADERS)
    for row in SAMPLE_ROWS:
        ws.append(row)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for col, width in zip("ABCDEFG", (14, 34, 9, 20, 20, 12, 34)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"  # 滚动时表头冻结，填表时不会看错列
    add_dropdowns(ws)  # 动作列下拉 + 步骤序号校验（不改数据，只是让手滑填不进去）

    wa = wb.create_sheet(SHEET_ACTIONS)
    fill_actions_sheet(wa)

    wh = wb.create_sheet(SHEET_HELP)
    for line in HELP_LINES:
        wh.append([line])
    wh.column_dimensions["A"].width = 100

    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


def read_rows(path):
    """读「用例」工作表；返回 [(Excel 行号, 7 个字段), ...]，跳过整行空的"""
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True)  # data_only：公式取结果值，不取公式本身
    if SHEET_DATA not in wb.sheetnames:
        raise TableError(
            [
                "这份 Excel 里没有名为「%s」的工作表（现在有：%s）。" % (SHEET_DATA, "、".join(wb.sheetnames)),
                "    修法：不用它了，改用 python tools/export_cases.py --init --force 生成的模板",
            ]
        )
    ws = wb[SHEET_DATA]

    rows = []
    for lineno, raw in enumerate(ws.iter_rows(values_only=True), start=1):
        if lineno == 1:
            # 表头必须一字不差：有人把「动作」改成「操作」，后面就会读成一列空值，
            # 报出来的错会很莫名其妙，所以在导入这一步就挡住
            got = [cell_text(v) for v in raw][: len(HEADERS)]
            if got != HEADERS:
                raise TableError(
                    [
                        "表头（第 1 行）被改过了，应该是：",
                        "    " + " | ".join(HEADERS),
                        "    现在读到的是：" + " | ".join(got),
                        "    修法：把第 1 行改回去；或重新生成模板：python tools/export_cases.py --init --force",
                    ]
                )
            continue

        vals = [cell_text(v) for v in raw][: len(HEADERS)]
        vals += [""] * (len(HEADERS) - len(vals))
        if not any(vals):
            continue  # 整行空（很多人会在表格尾部留几行空的）
        rows.append((lineno, vals))
    return rows


def validate(rows):
    """校验并组装成用例结构。有问题一次性全报出来（不要"改一个跑一次"）"""
    errors = []
    cases = []  # 保序：[{"id", "name", "steps": [...]}]
    index = {}  # 用例编号 -> 用例

    for lineno, (cid, cname, cseq, action, p1, p2, note) in rows:
        if not cid:
            errors.append("第 %d 行：「用例编号」是空的。没有编号就不知道该把它并到哪条用例里" % lineno)
            continue
        if not action:
            errors.append("第 %d 行：「动作」是空的。可写哪些动作见「动作清单」工作表" % lineno)
            continue

        case = index.get(cid)
        if case is None:
            case = {"id": cid, "name": cname or cid, "steps": []}
            index[cid] = case
            cases.append(case)
        elif cname and cname != case["name"]:
            errors.append(
                "第 %d 行：用例「%s」已经叫「%s」了，这里又写成「%s」。同一个用例编号只能有一个名字"
                % (lineno, cid, case["name"], cname)
            )

        spec = ACTION_BY_NAME.get(action)
        if spec is None:
            errors.append(
                "第 %d 行：不认识动作「%s」。可用的动作（共 %d 个）：%s"
                % (lineno, action, len(ACTIONS), "、".join(a["name"] for a in ACTIONS))
            )
            continue

        # 参数校验：该用的必须填，不该用的不许填 —— 后者专治「把参数填错了列」
        if spec["p1"] and not p1:
            errors.append("第 %d 行：动作「%s」的「参数1」要填「%s」，现在是空的" % (lineno, action, spec["p1"]))
        if not spec["p1"] and p1:
            errors.append("第 %d 行：动作「%s」用不到「参数1」，请清空（现在填的是 %s）" % (lineno, action, p1))
        if spec["p2"] and not p2:
            errors.append("第 %d 行：动作「%s」的「参数2」要填「%s」，现在是空的" % (lineno, action, spec["p2"]))
        if not spec["p2"] and p2:
            errors.append("第 %d 行：动作「%s」用不到「参数2」，请清空（现在填的是 %s）" % (lineno, action, p2))

        seq = None
        if cseq:
            if not cseq.isdigit() or int(cseq) <= 0:
                errors.append("第 %d 行：「步骤序号」只能填 1、2、3… 这样的正整数，现在填的是 %s" % (lineno, cseq))
            else:
                seq = int(cseq)

        if action == "等待" and p1 and not (p1.isdigit() and int(p1) > 0):
            errors.append("第 %d 行：「等待」的参数1 是毫秒数，应该像 2000 这样，现在填的是 %s" % (lineno, p1))
        if action == "检查元素数量" and p2 and not (p2.isdigit() and int(p2) >= 0):
            errors.append("第 %d 行：「检查元素数量」的参数2 是数量，应该像 1 这样，现在填的是 %s" % (lineno, p2))
        if action == "滑动" and p1 and not (p1.isdigit() and 1 <= int(p1) <= 10):
            errors.append("第 %d 行：「滑动」的参数1 是次数，只能填 1~10 之间的整数，现在填的是 %s" % (lineno, p1))
        if action == "检查文字出现次数" and p2 and not (p2.isdigit() and int(p2) >= 0):
            errors.append("第 %d 行：「检查文字出现次数」的参数2 是次数，应该像 1 这样，现在填的是 %s" % (lineno, p2))

        # 只能从固定几个值里选的动作：填错字当场挡下（比真机跑到一半再报错友好）
        for field, value in (("p1", p1), ("p2", p2)):
            allowed = ACTION_PARAM_CHOICES.get(action, {}).get(field)
            if allowed and value and value not in allowed:
                errors.append(
                    "第 %d 行：动作「%s」的「参数%s」只能填这 %d 个之一：%s（现在填的是 %s）"
                    % (lineno, action, field[-1], len(allowed), " / ".join(allowed), value)
                )

        case["steps"].append(
            {
                "seq": seq,
                "_line": lineno,
                "action": action,
                "param1": p1,
                "param2": p2,
                "note": note,
            }
        )

    # 排序与编号：要么都写步骤序号（按它排），要么都不写（按表格里的先后顺序）
    for case in cases:
        steps = case["steps"]
        seqs = [s["seq"] for s in steps]
        if all(s is not None for s in seqs):
            steps.sort(key=lambda s: s["seq"])
            seen, dup = set(), set()
            for s in steps:
                if s["seq"] in seen:
                    dup.add(s["seq"])
                seen.add(s["seq"])
            if dup:
                errors.append(
                    "用例「%s」里有重复的「步骤序号」：%s。同一条用例里的序号必须互不相同"
                    % (case["id"], "、".join(str(d) for d in dup))
                )
        elif any(s is not None for s in seqs):
            bad = [str(s["_line"]) for s in steps if s["seq"] is None]
            errors.append(
                "用例「%s」里有的步骤写了「步骤序号」、有的没写（没写的是第 %s 行）。"
                "要么全写，要么全不写（全不写就按表格里的先后顺序执行）" % (case["id"], "、".join(bad))
            )

    if errors:
        raise TableError(errors)

    for case in cases:
        for i, step in enumerate(case["steps"], start=1):
            step["num"] = i
            step.pop("seq", None)
            step.pop("_line", None)

    if not cases:
        raise TableError(
            [
                "「用例」工作表里一行数据都没有（只有表头）。",
                "    要么填几行，要么用 python tools/export_cases.py --init --force 恢复示例。",
                "    这里刻意报错、不写出空 json：空表格跑出「0 通过 0 失败」也是假绿。",
            ]
        )
    return cases


# 「检查类」动作：名字以「检查」开头的就是（以后加检查动作不用改这里）
CHECK_ACTIONS = tuple(a["name"] for a in ACTIONS if a["name"].startswith("检查"))

# `--dropdown` 走完导出之后要不要"摸"一下 json 的时间戳（见 main 里的说明）
_touch_json_after_export = False

# 这些动作跑完，手机多半会停在二级页（搜索页 / 答题页 / 专栏详情页）——
# 表里的用例共用同一部手机，停在二级页会让下一条报「找不到底部 tab」（坑 15 / 坑 17）
LEAVES_SECOND_LEVEL_PAGE = ("打开搜索并输入", "打开答题活动", "点第一张专栏")

START_ACTION = "回到首页"


def lint_cases(cases):
    """对表格用例做**体检**，返回一组「建议」（不是错误，导出照常成功）。

    为什么要有它：下面这几条都是本项目用真金白银换来的规矩，但它们原本只写在文档里 ——
    零基础的人填表时看不到。把规矩变成导出时的一句提示，比事后解释便宜得多。

    规则（每条都来自真实的坑）：
      1. 一条用例里一个「检查」都没有 -> 这条用例测不出任何东西
         （README §五 的反例 test_login_and_navigation.js 就是这个毛病）；
      2. 第一步不是「回到首页」 -> 起点不干净，上一条用例的残留会带进来（坑 15 / 17）；
      3. 最后一步会停在二级页 -> 建议补一步「回到首页」把手机交还（坑 15）。

    注意：**只提示、不拦截**。拦下来会挡住"我就是要这样写"的合理场景，
    提示的价值在于让人知道有这么回事。
    """
    warnings = []
    for c in cases:
        actions = [s["action"] for s in c["steps"]]
        if not any(a in CHECK_ACTIONS for a in actions):
            warnings.append(
                "用例「%s」里一个「检查…」动作都没有 —— 只有操作没有检查的用例测不出问题，"
                "建议补一条断言（参考 README §五 的反例说明）" % c["id"]
            )
        if actions and actions[0] != START_ACTION:
            warnings.append(
                "用例「%s」的第一步是「%s」，不是「回到首页」—— 起点不先摆正的话，"
                "上一条用例停在哪儿会带进来（筛选 tab、二级页都可能有残留）" % (c["id"], actions[0])
            )
        if actions and actions[-1] in LEAVES_SECOND_LEVEL_PAGE:
            warnings.append(
                "用例「%s」最后一步是「%s」，跑完手机很可能停在二级页 —— 建议末尾补一步"
                "「回到首页」把手机交还给下一条" % (c["id"], actions[-1])
            )
    return warnings


def write_json_if_changed(payload, path):
    """内容没变就不重写文件。

    为什么在意这个：`python run.py` 每次开跑都会调本脚本导出。如果每次都写一遍
    generated_at，用例表一个字没改、仓库也天天显示「用例表.json 被修改」——
    脏工作区里混着这种噪音，真改动反而容易被看漏（我们这个工作区是多人/多 AI 共用）。
    """
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            a, b = dict(old), dict(payload)
            a.pop("generated_at", None)
            b.pop("generated_at", None)
            if a == b:
                return False
        except Exception:
            pass  # 旧文件坏了或被手改过 -> 直接覆盖
    # newline="\n"：这个仓库的 .gitattributes 把换行锁定成 LF。
    # 不写这一句，Windows 上会把 \n 变成 \r\n，于是这个"生成出来的文件"
    # 在 git 里永远显示为已修改 —— 脏工作区里混进这种噪音，真改动就容易被看漏。
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description="把 Excel 用例表导出成 JSON（填表就能写用例）")
    parser.add_argument("--init", action="store_true", help="生成用例表模板")
    parser.add_argument("--force", action="store_true", help="配合 --init：覆盖已存在的用例表")
    parser.add_argument(
        "--dropdown",
        action="store_true",
        help="给现有的用例表补上「动作」列下拉框（不改动你已经填好的内容）",
    )
    parser.add_argument("--xlsx", default=str(XLSX_PATH), help="用例表路径（默认 cases/用例表.xlsx）")
    parser.add_argument("--json", default=str(JSON_PATH), help="导出路径（默认 cases/用例表.json）")
    args = parser.parse_args(argv)

    xlsx = Path(args.xlsx)
    json_path = Path(args.json)

    try:
        import openpyxl  # noqa: F401  只用它探测「装了没」
    except ImportError:
        print("缺少 openpyxl（读 Excel 要用它）。装一下：pip install -r requirements.txt")
        return 3

    if args.init:
        if xlsx.exists() and not args.force:
            print("用例表已存在：%s" % xlsx)
            print("  里面有你的内容，不会自动覆盖。真要重生成模板再加 --force（会丢掉现在的内容）")
            return 1
        build_template(xlsx)
        print("已生成用例表模板：%s" % xlsx)
        print("  用 Excel/WPS 打开，按「填写说明」填，然后跑：python run.py")
        return 0

    if args.dropdown:
        if not xlsx.exists():
            print("还没有用例表：%s" % xlsx)
            print("  先跑 python tools/export_cases.py --init 生成模板（新模板自带下拉框）")
            return 1
        from openpyxl import load_workbook

        wb = load_workbook(xlsx)
        if SHEET_DATA not in wb.sheetnames:
            print("这份表里缺少「%s」工作表，加不了下拉框。" % SHEET_DATA)
            print("  建议换成 python tools/export_cases.py --init --force 生成的新模板")
            return 1
        if SHEET_ACTIONS not in wb.sheetnames:
            wb.create_sheet(SHEET_ACTIONS)
        fill_actions_sheet(wb[SHEET_ACTIONS])  # 清单跟着最新动作走
        ws = wb[SHEET_DATA]
        # 先清空旧的校验规则，重复执行不会叠加（叠加会让 Excel 弹两次提示）
        ws.data_validations.dataValidation = []
        add_dropdowns(ws)
        wb.save(xlsx)
        print("已刷新用例表：%s" % xlsx)
        print("  · 「动作清单」工作表已更新为最新的 %d 个动作" % len(ACTIONS))
        print("  · 动作列（D）下拉框已重建，选项来自「动作清单」")
        print("  · 步骤序号列（C）只接受 1、2、3… 这样的正整数")
        print("  · 你已经填好的内容一行都没动")
        print("\n顺带重新导出一遍（刷完表格不导出的话，json 会比 xlsx 旧，"
              "真机跑起来会提示「本次跑的是 json 里的内容」——那是个假警报）")
        # 故意**不 return**：接着往下走正常导出流程；并且把 json 的时间戳刷新到最新，
        # 免得"只是刷了下拉框、用例内容没变"也触发上面那条提示
        global _touch_json_after_export
        _touch_json_after_export = True

    if not xlsx.exists():
        build_template(xlsx)
        print("还没有用例表，已为你生成模板：%s" % xlsx)
        print("  打开填好之后跑：python run.py（它会自动导出，不需要手动执行本脚本）")
        return 2

    try:
        cases = validate(read_rows(xlsx))
    except TableError as e:
        print("用例表有问题（%d 处），没有导出：%s" % (len(e.errors), xlsx))
        for err in e.errors:
            print("  · %s" % err)
        print("\n  改完这张表再跑一次；若只想跑别的用例：python run.py suprecast_app/test_example.js")
        return 1

    warnings = lint_cases(cases)

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "generated_by": "tools/export_cases.py",
        "source": "cases/用例表.xlsx",
        "warnings": warnings,
        "actions": [
            {
                "name": a["name"],
                "p1": a["p1"],
                "p2": a["p2"],
                "desc": a["desc"],
                "choices": ACTION_PARAM_CHOICES.get(a["name"], {}),
            }
            for a in ACTIONS
        ],
        "cases": cases,
    }
    changed = write_json_if_changed(payload, json_path)
    if _touch_json_after_export and not changed:
        # 内容没变 -> 文件没被重写，但它的时间戳比 xlsx 旧，会让真机那边弹"本次跑的是 json 里的内容"。
        # 这里只更新时间戳（内容不动，git 也不会看到改动）。
        json_path.touch()

    total_steps = sum(len(c["steps"]) for c in cases)
    print("用例表导出成功：%s" % json_path)
    print("  共 %d 条用例、%d 个步骤%s" % (len(cases), total_steps, "" if changed else "（表格内容没变，文件未改动）"))
    for c in cases:
        print("    - %s  %s（%d 步）" % (c["id"], c["name"], len(c["steps"])))
    if warnings:
        print("\n[建议] 表格能跑，但这几处按经验值得改一改（只提示，不影响执行）：")
        for w in warnings:
            print("  · %s" % w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
