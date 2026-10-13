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
    python tools/export_cases.py --dropdown # 刷新已有表格的排版与下拉框：动作清单 + 下拉框 +
                                            # 「同一条用例并成一格」（不动已填内容）
退出码: 0 成功（含「某几条用例自己填错了」——那种错误记在那条用例身上，导出的 json 照常有它，
           真机跑的时候**只有那一条红**，其他用例不受影响）；
        1 表格本身有错（表头被改 / 缺工作表 / 整行没有用例编号 / 一条用例都没有）—— 不导出；
        2 没有表格（已生成模板）；3 缺少 openpyxl
"""

import argparse
import json
import os
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
SHEET_CHOICES = "名称候选"

# 这几个动作的参数要填**数据里的名字**（一字不差），候选值列在「名称候选」工作表里
NAME_PARAM_ACTIONS = ("打开课程详情", "打开案例", "复位答题记录", "检查答题记录数")


def plain_text(s):
    """把说明里的 markdown 记号去掉 —— 这张表是给人在 Excel 里看的，`**` 和反引号只会碍眼。"""
    return str(s or "").replace("**", "").replace("`", "")

HEADERS = ["用例编号", "用例名称", "步骤序号", "动作", "参数1", "参数2", "备注"]

# ---------- 动作清单（改这里 = 改表格里允许写的动作；JS 侧要同步实现同名函数）----------
# p1 / p2 是参数列的「表头提示」：填了 = 这个动作要用该参数，空着 = 不用。
ACTIONS = [
    {
        "name": "回到首页",
        "p1": "",
        "p2": "",
        "desc": "自导航到「有问必答」首页信息流（幂等；在二级页/搜索页会先点返回退出），并把筛选 tab 归位到「最新提问」。用例第一步建议都用它",
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
        "name": "打开第一个热门话题",
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
        "risk": "会（提交/兑换/支付类文字已被默认拦住）",
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
        "name": "检查答题页",
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
        "name": "检查首页筛选栏顺序",
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
        "risk": "会（和「点文字」同一道安全阀）",
    },
    {
        "name": "滑动",
        "p1": "次数",
        "p2": "方向",
        "desc": "滑动屏幕，次数 1~10、方向填 上 或 下。列表要滑到底才看得到的东西用「上」；滑完想滚回顶部用「下」",
    },
    {
        "name": "切换首页筛选栏",
        "p1": "筛选栏名称",
        "p2": "",
        "desc": "切首页信息流那排筛选 tab（切完会验证真的选中了）",
    },
    {
        "name": "切换学习中心顶部栏",
        "p1": "顶部栏名称",
        "p2": "",
        "desc": "切学习中心顶部那排 tab（切完会验证真的选中了）",
    },
    {
        "name": "打开第一张专栏",
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
    # ---------- 2026/10/12 追加：答题的「写链路」（owner 当天拍板可以测写，见 docs/待owner拍板.md Q2/Q3）----------
    {
        "name": "逐题作答",
        "p1": "",
        "p2": "",
        "desc": "把答题页上每道题都选上第一个选项（多题活动会一题一题点过去，屏幕外的题会自动滚进可视区）。"
        "只改前端选中态、**不写库**，所以不需要开关；但选完不提交的话，离开页面就没了"
        "（需求原文：未提交已选的选项不会保存）",
        "risk": "只改前端选中态（不写库、不需要开关）",
    },
    {
        "name": "提交答卷",
        "p1": "",
        "p2": "",
        "desc": "点答题页的提交按钮 —— **会真的写数据**。必须打开开关 UITEST_ALLOW_SUBMIT=1，"
        "否则这一步直接报错（不跳过、不静默）。跑完记得用「复位答题记录」把数据清掉",
        "risk": "**会写库**（必须开开关）",
    },
    {
        "name": "复位答题记录",
        "p1": "活动名",
        "p2": "",
        "desc": "删掉这个活动在测试库里留下的答题记录（提交 + 明细），让「答题机会」回到能用状态。"
        "⚠️ 这是护栏动作：**默认只预览、不删**，真删要打开开关 UITEST_ALLOW_SUBMIT=1；"
        "活动名要跟页面上的标题一字不差（例如 Z-B4-答题角标）；名字找不到或有重名会被拒绝执行",
        "risk": "**会删库**（默认只预览；真删要开开关）",
    },
    {
        "name": "检查答题记录数",
        "p1": "活动名",
        "p2": "期望条数",
        "desc": "读数据库，断言这个活动的**提交记录**正好是 N 条（例如提交前填 0、提交后填 1）。"
        "用来把「界面上说提交成功」和「库里真有这条」对上 —— 只读，不需要开关",
    },
    # ---------- 2026/10/12 追加：案例库（需求 713381608）----------
    {
        "name": "打开案例库",
        "p1": "",
        "p2": "",
        "desc": "打开案例库列表（**底部 tab「设计专区」打开就是它**，这是 2026/10/12 才找到的入口；"
        "页面顶部还有一排 tab：仿真案例库 / 压铸护航服务）",
    },
    {
        "name": "检查案例库列表",
        "p1": "",
        "p2": "",
        "desc": "按需求 713381608 校验案例库列表页：① 分类**上方**有介绍 banner（按坐标判「在上方」）；"
        "② 每张卡片右下角是「**复制图标 + 复制数**」，且整页找不到评论图标。只读",
    },
    {
        "name": "打开第一个案例",
        "p1": "",
        "p2": "",
        "desc": "在案例库列表点开第一张卡片，进案例详情页（只读：不点赞、不收藏、不复制、不评论）",
    },
    {
        "name": "打开案例",
        "p1": "案例名",
        "p2": "",
        "desc": "按名字点开指定案例（点不到会往下滚几屏再找）。给「付费案例复制」挑样本时用它，"
        "例如 填充任务1。只读：不点赞、不收藏、不复制",
    },
    {
        "name": "检查案例详情页",
        "p1": "",
        "p2": "",
        "desc": "按需求 713381608 校验案例详情页：① 评论区标题是「全部评论」（页面上不能再有「全部回答」）；"
        "② 详情页底部**没有**复制数/评论数图标（实测只有点赞/收藏/分享）。只读",
    },
    {
        "name": "打开案例库介绍长图",
        "p1": "",
        "p2": "",
        "desc": "点案例库首页那张介绍 banner（在分类上方），进「介绍长图详情页」。只读",
    },
    {
        "name": "检查案例库介绍长图",
        "p1": "",
        "p2": "",
        "desc": "按需求 713381608 校验介绍长图页：整页是**单张图片**，而且是**长图**（图高远大于屏高）。只读",
    },
    {
        "name": "复制当前案例",
        "p1": "",
        "p2": "",
        "desc": "在案例详情页点「复制案例」—— **一条龙**：记下水位 → 点复制 → 断言提示"
        "「复制成功 / 使用手机号登录智铸超云，即可查看案例详情」逐字出现 → 读数据库确认复制记录 +1、复制数 +1 → "
        "**自动复位**（删掉这次那条记录、把复制数改回去）。"
        "⚠️ 会写测试库数据：必须打开开关 UITEST_ALLOW_SUBMIT=1，否则这一步记「跳过」（并说明原因）。"
        "先用「打开案例库」+「打开第一个案例」走到详情页再用它",
        "risk": "**会写库**（要开开关；没开时记跳过）",
    },
    # ---------- 2026/10/12 追加：课程详情页（需求 713367615）----------
    {
        "name": "打开课程详情",
        "p1": "课程名",
        "p2": "",
        "desc": "打开某门课的详情页（学习页）：自己走到 学习中心 → 课程 tab → 按名字点课程。"
        "只读：不播放视频、不购买。课程名要跟列表上一字不差，例如 717",
    },
    {
        "name": "检查课程详情页",
        "p1": "期望选中的标签",
        "p2": "",
        "desc": "按需求 713367615 校验课程详情页：有「课程介绍 / 课程目录」两个 tab、**默认选中填的那个**"
        "（未开始学习填 课程介绍；已开始学习填 课程目录）、展示课程标题、展示第一课时封面和视频。只读",
    },
    {
        "name": "检查0课时课程不显示",
        "p1": "",
        "p2": "",
        "desc": "按需求 713367615 第 1 条校验：先去数据库拿「0 课时的公开课程」名单，"
        "再确认这些名字**一个都没出现在**小程序的课程列表里（会自己滚到列表底部）。只读",
    },
    {
        "name": "检查未购买点课时",
        "p1": "课程名",
        "p2": "",
        "desc": "按需求 713367615 第 2 条校验：**未购买**的课程上点课时，封面图和标题都不变、始终显示课程名称。"
        "参数1 填一门我们账号**没买过**的课（例如 7.8课程new）；页面不是未购买态会明确报错，不会假装通过。只读",
    },
]

ACTION_BY_NAME = {a["name"]: a for a in ACTIONS}

# ---------- 动作按用途分 6 类：表格下拉框里的顺序就是它（2026/10/13）----------
#
# 【为什么要有它】以前下拉开出来的顺序是"历史追加顺序"：`打开搜索并输入`、`点文字`、`等待`、
# 三个检查动作、然后突然又冒出一个 `滑动`、再一个 `切换筛选tab`…… 对填表的人（尤其是不写代码的）
# 就是一份**没有目录的清单**。按用途归类之后，下拉里连着出现的都是同一类东西，找起来像翻目录。
#
# ⚠️ 每个动作都必须在这里出现一次：漏了、重了都会被 `scripts/check-invariants.py` 报红
#    （动作清单文档 docs/动作清单-分类.md 也是照这份分组生成的，一处定义、两处使用）。
ACTION_GROUPS = [
    (
        "① 到达 / 导航",
        "把手机摆到该在的页面上。用例第一步几乎都是「回到首页」，最后也建议用它收尾",
        ["回到首页", "切到用户中心", "打开积分商城", "打开学习中心专栏", "切换学习中心顶部栏",
         "返回上一页", "点主页按钮", "打开搜索页", "打开案例库", "打开课程详情"],
    ),
    (
        "② 搜索与内容（点进去看，只读）",
        "打开某块内容看。全部只读：不点赞、不评论、不复制",
        ["打开搜索并输入", "执行搜索", "打开第一个热门话题", "打开第一个帖子", "打开第一张专栏",
         "打开第一个案例", "打开案例库介绍长图", "打开案例"],
    ),
    (
        "③ 通用交互",
        "点、滑、等这类通用动作。**能不用「等待」就别用**：先看有没有对应的「检查…」动作",
        ["点文字", "点选择器", "滑动", "切换首页筛选栏", "等待", "打印页面文字"],
    ),
    (
        "④ 通用断言（检查「看得见没有」）",
        "断言类动作，用例靠它们才有意义。**只有操作没有检查的用例，测不出问题**",
        ["检查文字显示", "检查文字不显示", "检查文字出现次数", "检查元素存在",
         "检查元素不存在", "检查元素数量", "检查输入框的值"],
    ),
    (
        "⑤ 需求专项检查",
        "把某条需求的原文写成断言。名字里的需求号就是那条需求（见 `knowledge/需求描述汇编.md`）",
        ["检查活动入口", "检查首页筛选栏顺序", "检查回到顶部按钮", "检查答题页",
         "检查案例库列表", "检查案例详情页", "检查案例库介绍长图", "检查课程详情页",
         "检查0课时课程不显示", "检查未购买点课时"],
    ),
    (
        "⑥ 答题 / 写链路（要开开关，跑完必须复位）",
        "**会改真实数据**的动作。开关是环境变量 `UITEST_ALLOW_SUBMIT=1`；"
        "不带开关时：写动作要么报错、要么记「跳过」并写明原因（绝不假装通过）",
        ["打开答题活动", "逐题作答", "提交答卷", "复位答题记录", "检查答题记录数", "复制当前案例"],
    ),
]

# 动作名 -> 它在下拉框里排第几（**全局位置**，不只是组号：
# 只按组号排的话，组内的先后会退回"历史追加顺序"，跟这份清单差一截）
ACTION_ORDER = {
    name: i
    for i, name in enumerate(n for _t, _n, names in ACTION_GROUPS for n in names)
}


def ordered_actions():
    """按用途分组排好序的动作清单。

    ⚠️ 归类漏掉的动作**排在最后**（不静默丢掉）—— 它们会同时被 check-invariants 报红，
    所以这里不抛异常也能保证"人一定会看到"。
    """
    return sorted(ACTIONS, key=lambda a: ACTION_ORDER.get(a["name"], len(ACTION_ORDER)))


# 有些动作的参数是「只能从这几个里选」——在导出时就挡住错别字（例如「最新问题」）。
# JS 侧同样会校验一次，但把错误挡在导出这一步，报错信息更早、更好懂。
ACTION_PARAM_CHOICES = {
    "切换首页筛选栏": {"p1": ["最新提问", "推荐", "精选问答", "我的关注"]},
    "切换学习中心顶部栏": {"p1": ["课程", "专栏", "压铸百科"]},
    # 次数只能是 1~10（以前要人自己记住范围、手打数字；现在下拉选）
    "滑动": {"p1": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "p2": ["上", "下"]},
    "检查课程详情页": {"p1": ["课程介绍", "课程目录"]},
    # 出现次数这类"小整数"也给下拉：防止有人填 0 或 100（那样这条断言基本没意义）
    "检查文字出现次数": {"p2": ["1", "2", "3", "4", "5"]},
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
    "2. 一条用例怎么摆：第一行写「用例编号 + 用例名称」，下面几行的这两列**并成一格、空着就行** ——",
    "   表上看起来就是「一案一块」，一眼数得出有几条用例、每条几步。每行都要填的是「步骤序号」和「动作」。",
    "   （按这个排版，导出时编号空着的行会自动并到上一条用例；但**第一行数据必须写编号**，否则整表报错。）",
    "3. 「动作」只能填「动作清单」工作表里列出的名字 —— 填别的会在导出时报错，不会静默跳过。",
    "3b. 有几类参数要填**数据里的名字**（课程名 / 案例名 / 活动名），一字不差才行；",
    "    候选值在「名称候选」工作表里，直接复制粘贴即可（刷新它：python tools/export_cases.py --dropdown）。",
    "4. 「参数1 / 参数2」按动作需要填，不用就留空。填多了（该动作用不到）也会报错，防手滑。",
    "5. 「备注」随便写，只出现在日志和报告里，不影响执行。",
    "6. 填完执行：python run.py      （它会先自动把本表导出成 json，再跑用例）",
    "   只想跑表格里的某一条：python run.py -k 活动入口_001",
    "7. 每条用例开头都先用「回到首页」把起点摆正；会把手机停在二级页（搜索页/详情页/答题页）的用例，",
    "   最后再补一步「回到首页」把手机交还。原因：表里的用例共用同一部手机，",
    "   上一条停在二级页上，下一条可能报「找不到底部 tab」—— 开头摆正 + 结尾交还就不受影响。",
    "8. 「动作」列是**下拉框**（点单元格右边的小箭头选），可选项来自「动作清单」工作表；",
    "   「步骤序号」列只接受 1、2、3… 这样的正整数。填错的动作名根本选不出来，省一轮报错。",
    "8b. 自己新加的行不会自动并格。改完想让它并回去、顺便刷新下拉框，跑一次：",
    "    python tools/export_cases.py --dropdown    （只动排版，不动你填的内容；Excel 开着这份表时先关掉）",
    "9. 不知道「检查文字显示」该填哪段字？先加一行「打印页面文字」跑一次 ——",
    "   当前屏幕上看得见的文字会打进日志，照着抄就行（挑完把它删掉即可）。",
    "",
    "默认禁止（安全阀，避免手滑把真实数据改了）",
    "   · 「点文字」不能点这些字：提交、兑换、签到、下单、支付、购买、领取、抽奖、报名、删除、退出登录、退款、取消订单",
    "     原因：这些操作会改真实数据/消耗真实积分。真要测它们，得单独写用例并显式打开开关，不能靠表格里写一行就触发。",
    "   · 「打开答题活动」只打开页面，不选选项、不提交（选选项会消耗答题机会）。",
    "",
    "要测「会改数据」的操作？开着开关跑（owner 2026/10/12 同意）",
    "   · 开关就是一句环境变量：跑之前先执行  $env:UITEST_ALLOW_SUBMIT=\"1\"  （PowerShell）",
    "     不设这个开关时，下面这两个动作会**直接报错**，不会偷偷执行，也不会假装跳过。",
    "   · 「复位答题记录」（参数1=活动名）：删掉该活动在测试库里留下的答题记录。",
    "     默认只预览不删；开了开关才真删。跑完写数据的用例，务必用它把记录清干净。",
    "   · 「提交答卷」：真的提交一次，用来测「提交后按钮变成已提交已参加」这条需求。",
    "   · 「逐题作答」「检查答题记录数」不需要开关：前者只改前端选中态（不写库），后者是只读。",
    "   · 写链路的标准写法（照抄即可）：回到首页 → 打开答题活动 → 复位答题记录(活动名) →",
    "     逐题作答 → 检查文字显示(已答) → 提交答卷 → 检查文字显示(已参加) →",
    "     检查答题记录数(活动名 / 1) → 复位答题记录(活动名) → 回到首页",
    "   · 现成模板：test_case/suprecast_app/test_quiz_submit.js（跑法：$env:UITEST_ALLOW_SUBMIT=\"1\"; python run.py -k 答题写链路）",
    "",
    "已知限制（诚实标注，别误读成框架不行）",
    "   · 搜索关键词只能是字母/数字/下划线/点/连字符：关键词是通过 adb 发过去的，adb 发中文不报错但不生效。",
    "   · 「点文字」点的是屏幕上看得见的文字；同名文字有多个时点第 1 个。",
    "   · 断言的等待时间写死在框架里（文字类 8 秒、元素类 8 秒），表格里暂时改不了。",
    "   · 「复位答题记录」只能删答题相关的两张表；别的写操作（积分兑换、签到）还没做复位手段。",
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


def fetch_name_choices(timeout=30):
    """跑 tools/table_choices.py 取候选名字（**只读**）。@returns (data|None, 为什么没取到)

    为什么放在 `--dropdown` 里而不是导出路径里：导出（`python run.py`）必须能**离线**跑，
    不能因为"连不上测试库"就导不出用例表。而 `--dropdown` 是人工手动刷表格的动作，
    顺手取一次候选值是合理的。
    """
    script = str(ROOT / "tools" / "table_choices.py")
    if not Path(script).exists():
        return None, "找不到 tools/table_choices.py"
    try:
        import json as _json
        import subprocess

        # 允许用环境变量换一份数据库配置（和 JS 侧 UITEST_DB_CONFIG 同一个名字）：
        # 验证"连不上库时会不会好好降级"就靠它，不用动真实的 config/db.local.yaml
        extra = ["--config", os.environ["UITEST_DB_CONFIG"]] if os.environ.get("UITEST_DB_CONFIG") else []
        r = subprocess.run(
            [sys.executable, script, "--json"] + extra,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=timeout,
        )
        if r.returncode != 0:
            # stdout 和 stderr 都要看：工具的"连不上测试库"人话提示可能落在任一边
            out = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()
            lines = [l for l in out.splitlines() if l.strip()] or ["(没有输出)"]
            # 挑"最有信息量"的那行：优先带「连不上」的（工具的人话提示），否则用最后一行
            pick = next((l for l in lines if "连不上" in l), lines[-1])
            return None, "读候选值时出错：%s" % pick.strip()[:160]
        return _json.loads(r.stdout.strip().splitlines()[-1]), ""
    except Exception as e:
        return None, "读候选值时出错：%s" % str(e)[:120]


def fill_choices_sheet(ws, data, reason=""):
    """写「名称候选」工作表：把"要填名字"的那几个参数的候选值列出来。

    为什么要有它（2026/10/13）：表格里有一类参数是**数据里的名字**（课程名 / 案例名 / 活动名），
    必须一字不差，填错要等真机跑起来才报"找不到"。对不写代码的人来说那只能靠猜。
    这里把测试库里的候选值抄一份进来，可以复制粘贴。

    连不上库时**不报错**：写一行原因进去（"这次没连上库"），刷新表格这件事不能被它挡住。
    """
    from openpyxl.styles import Font

    if ws.max_row:
        ws.delete_rows(1, ws.max_row)
    ws.append(["类型", "名字", "备注"])
    for cell in ws[1]:
        cell.font = Font(bold=True)

    if not data:
        ws.append(["(没取到)", "", reason or "这次没连上测试库，跳过候选值（连上后重跑 python tools/export_cases.py --dropdown）"])
        ws.column_dimensions["A"].width = 14
        ws.column_dimensions["B"].width = 40
        ws.column_dimensions["C"].width = 80
        ws.freeze_panes = "A2"
        return 0

    n = 0
    for c in data.get("课程", []):
        note = "买没买=%s；课时数=%s" % (c.get("bought") or "-", c.get("lessons"))
        ws.append(["课程", c["name"], note])
        n += 1
    for a in data.get("答题活动", []):
        ws.append(["答题活动", a["name"], "id=%s" % a["id"]])
        n += 1
    for c in data.get("案例", []):
        ws.append(["案例", c["name"], ""])
        n += 1
    for note in data.get("notes", []):
        ws.append(["（说明）", "", plain_text(note)])

    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 42
    ws.column_dimensions["C"].width = 80
    ws.freeze_panes = "A2"
    return n


def merge_case_cells(ws):
    """把同一条用例的「用例编号 / 用例名称」两列**纵向并成一格**（webzdh 那种「一案一块」的排版）。

    为什么：一条用例常有 3~5 个步骤，编号重复 5 遍，看久了分不清「哪几行是一起的」。
    并起来之后，表上一条用例就是一块，一眼能数出「几号用例、几步」。

    刻意做得保守的三点：
      · 只在**紧挨着**且属于同一条用例的行之间并（中间夹了别的用例绝不并，免得把两块误并成一块）；
      · 只在「值和首行一样」时清掉下面重复的值 —— 万一有人把名字写岔了，
        那个不一样的名字**留着**，导出时照样能报「同一个用例编号只能有一个名字」；
      · 先拆 A/B 两列上旧的合并再重并（重复执行不叠加）。

    并了之后下面那些行的编号是空的 —— 导出时按「接着上一条用例」处理（见 validate 的承接逻辑），
    所以**合并只是排版，不改用例内容**。

    @returns 并了几块（给打印/自检用）
    """
    # 1) 拆掉 A/B 两列上旧的合并（别动用户自己在别的列上做的合并）
    for rng in list(ws.merged_cells.ranges):
        if rng.min_col == rng.max_col <= 2:
            ws.unmerge_cells(str(rng))

    # 2) 先看每一行归哪条用例：编号非空 = 新用例开始；编号空 = 接着上一条
    owner = {}
    cur = None
    for r in range(2, ws.max_row + 1):
        cid = cell_text(ws.cell(r, 1).value)
        row_blank = all(cell_text(ws.cell(r, c).value) == "" for c in range(1, len(HEADERS) + 1))
        if row_blank:
            continue  # 表格尾部的空行不参与（中间的空行会断开合并，这也是我们要的）
        if cid:
            cur = cid
        owner[r] = cur

    # 3) 把「连着的一串同编号行」收成段
    runs = []
    for r in sorted(owner):
        cid = owner[r]
        if cid is None:
            continue  # 第一行就没编号：交给 validate 报错，这里不动它
        if runs and runs[-1][2] == cid and runs[-1][1] == r - 1:
            runs[-1][1] = r
        else:
            runs.append([r, r, cid])

    merged = 0
    for r1, r2, _cid in runs:
        if r2 <= r1:
            continue  # 只有一步，没什么可并的
        for c in (1, 2):
            # **一列一列地并**（A 列自己一块、B 列自己一块）。
            # 千万别并成 A:B 一整块：openpyxl.merge_cells 会把"除左上角以外"的单元格清空，
            # 而名字在 B 列 —— 并成 A:B 就直接把名字吃掉了，导出时用例名会退化成编号。
            # 真踩过（2026/10/13，自检里那条"合并后名字还在吗"就是为它加的）。
            for r in range(r1 + 1, r2 + 1):
                if ws.cell(r, c).value == ws.cell(r1, c).value:
                    ws.cell(r, c).value = None  # 重复的同一个值：清掉（不一样的值留着，好让导出去报错）
            ws.merge_cells(start_row=r1, start_column=c, end_row=r2, end_column=c)
        merged += 1
    return merged


def fill_actions_sheet(ws):
    """把「动作清单」工作表写满（表头 + 每条动作一行）；已存在则先清空再重写。

    为什么单独抽出来：加动作之后，**已经存在的表**也要刷新这张工作表
    （否则下拉框和清单还是旧的 14 条）—— 走 `--dropdown` 那条路时复用它。
    """
    from openpyxl.styles import Font

    # 先**把旧行删掉**再写。只清空值是不够的：append 是往 max_row 后面接，
    # 而清空不会让 max_row 变小 —— 于是每刷一次，整块清单就往下挪一截。
    # 真踩过（2026/10/13）：刷了 9 次之后清单跑到了第 436 行，而下拉框还指着 A2:A48（空行），
    # 表现就是"动作列的下拉框里一个选项都没有"，还很难看出是脚本自己挪走的。
    if ws.max_row:
        ws.delete_rows(1, ws.max_row)
    ws.append(["动作", "参数1", "参数2", "会不会改数据", "说明", "属于哪一类"])
    # 顺序 = 按用途分的那 6 类（见 ACTION_GROUPS）：下拉框里连着出现的都是同一类东西
    group_of = {n: t for t, _note, names in ACTION_GROUPS for n in names}
    for a in ordered_actions():
        desc = plain_text(a["desc"])
        if a["name"] in NAME_PARAM_ACTIONS and a.get("p1"):
            desc += "（「%s」填数据里的名字：候选值见「%s」工作表，可直接复制）" % (a["p1"], SHEET_CHOICES)
        # 参数的可选值直接写在参数列里：填表的人不用再翻别的文档（以前只有下拉框里能看到）
        choices = ACTION_PARAM_CHOICES.get(a["name"], {})
        p1 = a["p1"]
        p2 = a["p2"]
        if p1 and choices.get("p1"):
            p1 = "%s（只能填：%s）" % (p1, " / ".join(choices["p1"]))
        if p2 and choices.get("p2"):
            p2 = "%s（只能填：%s）" % (p2, " / ".join(choices["p2"]))
        ws.append(
            [a["name"], p1, p2, plain_text(a.get("risk", "不会")), desc,
             group_of.get(a["name"], "（还没归类）")]
        )
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for col, width in zip("ABCDEF", (20, 26, 20, 26, 78, 26)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "A2"


def build_template(path):
    """生成模板（4 个工作表：用例 / 动作清单 / 填写说明 / 名称候选）"""
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
    merge_case_cells(ws)  # 同一条用例的编号/名称纵向并成一格（一案一块，一眼看得出几条几步）
    add_dropdowns(ws)  # 动作列下拉 + 步骤序号校验（不改数据，只是让手滑填不进去）

    wa = wb.create_sheet(SHEET_ACTIONS)
    fill_actions_sheet(wa)

    # 「名称候选」先建一张空壳：真正的候选值要连测试库取（--dropdown 会填）。
    # 这里刻意**不连库** —— 生成模板这件事必须能离线做。
    wc = wb.create_sheet(SHEET_CHOICES)
    fill_choices_sheet(wc, None, "还没取过候选值：连上测试库后跑 python tools/export_cases.py --dropdown")

    wh = wb.create_sheet(SHEET_HELP)
    for line in HELP_LINES:
        wh.append([plain_text(line)])  # 工作表里不显示 markdown 记号（跟「动作清单」一个处理）
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
    """校验并组装成用例结构。有问题一次性全报出来（不要「改一个跑一次」）。

    【两类错误刻意分开处理】（2026/10/12 owner 定的口径）
      · **能归到某条用例身上的**（动作名写错、参数填错、序号重复 / 漏写…）
        → 记在那条用例的 `errors` 里，**导出照常成功**。真机跑的时候只有那一条红，
          别的用例照常跑 —— 表格里有一条填错，不该把整轮测试废掉。
      · **归不到用例的**（整行没有「用例编号」、表头被改、工作表名不对、一条用例都没有）
        → 整张表报错、不导出。没有编号就不知道该算谁的问题，
          而且这几种情况会让"跑出来的结果"整体不可信（宁可停下来）。

    【编号留空 = 接着上一条用例】（2026/10/13 owner 要的 webzdh 式排版）
      表里同一条用例的「用例编号 / 用例名称」被并成了一格，读出来只有第一行有值、
      下面几行是空的。所以空编号不再一律当错：**上面有可承接的用例**就并进去，
      **上面什么都没有**（表格第一行数据就没编号）才算整表错误。
      代价说明：以前"漏写编号"会被当场抓出来，现在它会安静地并进上一条用例 ——
      换来的是排版能一眼看出"一案多步"。两种口径都写在「填写说明」里，填表时看得见。
    """
    table_errors = []  # 表格级：归不到具体某条用例
    cases = []  # 保序：[{"id", "name", "steps": [...]}]
    index = {}  # 用例编号 -> 用例
    last_id = ""  # 上一个**写了编号**的行属于哪条用例（用来承接合并单元格下方的空编号行）

    def case_errors_of(case):
        """取（必要时建）这条用例自己的错误清单"""
        return case.setdefault("errors", [])

    for lineno, (cid, cname, cseq, action, p1, p2, note) in rows:
        if not cid:
            if not last_id:
                table_errors.append(
                    "第 %d 行：「用例编号」是空的，而且上面没有能承接的用例 —— "
                    "这行不知道该算谁的。第一行数据必须写「用例编号」" % lineno
                )
                continue
            cid = last_id  # 空编号 = 还说上面那条用例（合并单元格的下面那些行就是这样）
        else:
            last_id = cid

        # 先建/找到这条用例，后面所有问题都能挂在它身上（这样才做得到"只让那一条红"）
        case = index.get(cid)
        if case is None:
            case = {"id": cid, "name": cname or cid, "steps": []}
            index[cid] = case
            cases.append(case)
        elif cname and cname != case["name"]:
            case_errors_of(case).append(
                "第 %d 行：用例「%s」已经叫「%s」了，这里又写成「%s」。同一个用例编号只能有一个名字"
                % (lineno, cid, case["name"], cname)
            )

        if not action:
            case_errors_of(case).append(
                "第 %d 行：「动作」是空的。可写哪些动作见「动作清单」工作表" % lineno
            )
            continue

        spec = ACTION_BY_NAME.get(action)
        if spec is None:
            case_errors_of(case).append(
                "第 %d 行：不认识动作「%s」。可用的动作（共 %d 个）：%s"
                % (lineno, action, len(ACTIONS), "、".join(a["name"] for a in ordered_actions()))
            )
            continue

        # 参数校验：该用的必须填，不该用的不许填 —— 后者专治「把参数填错了列」
        if spec["p1"] and not p1:
            case_errors_of(case).append(
                "第 %d 行：动作「%s」的「参数1」要填「%s」，现在是空的" % (lineno, action, spec["p1"])
            )
        if not spec["p1"] and p1:
            case_errors_of(case).append(
                "第 %d 行：动作「%s」用不到「参数1」，请清空（现在填的是 %s）" % (lineno, action, p1)
            )
        if spec["p2"] and not p2:
            case_errors_of(case).append(
                "第 %d 行：动作「%s」的「参数2」要填「%s」，现在是空的" % (lineno, action, spec["p2"])
            )
        if not spec["p2"] and p2:
            case_errors_of(case).append(
                "第 %d 行：动作「%s」用不到「参数2」，请清空（现在填的是 %s）" % (lineno, action, p2)
            )

        seq = None
        if cseq:
            if not cseq.isdigit() or int(cseq) <= 0:
                case_errors_of(case).append(
                    "第 %d 行：「步骤序号」只能填 1、2、3… 这样的正整数，现在填的是 %s" % (lineno, cseq)
                )
            else:
                seq = int(cseq)

        if action == "等待" and p1 and not (p1.isdigit() and int(p1) > 0):
            case_errors_of(case).append(
                "第 %d 行：「等待」的参数1 是毫秒数，应该像 2000 这样，现在填的是 %s" % (lineno, p1)
            )
        if action == "检查元素数量" and p2 and not (p2.isdigit() and int(p2) >= 0):
            case_errors_of(case).append(
                "第 %d 行：「检查元素数量」的参数2 是数量，应该像 1 这样，现在填的是 %s" % (lineno, p2)
            )
        if action == "滑动" and p1 and not (p1.isdigit() and 1 <= int(p1) <= 10):
            case_errors_of(case).append(
                "第 %d 行：「滑动」的参数1 是次数，只能填 1~10 之间的整数，现在填的是 %s" % (lineno, p1)
            )
        if action == "检查文字出现次数" and p2 and not (p2.isdigit() and int(p2) >= 0):
            case_errors_of(case).append(
                "第 %d 行：「检查文字出现次数」的参数2 是次数，应该像 1 这样，现在填的是 %s" % (lineno, p2)
            )
        if action == "检查答题记录数" and p2 and not (p2.isdigit() and int(p2) >= 0):
            case_errors_of(case).append(
                "第 %d 行：「检查答题记录数」的参数2 是条数，应该像 0 或 1 这样，现在填的是 %s" % (lineno, p2)
            )

        # 只能从固定几个值里选的动作：填错字当场挡下（比真机跑到一半再报错友好）
        for field, value in (("p1", p1), ("p2", p2)):
            allowed = ACTION_PARAM_CHOICES.get(action, {}).get(field)
            if allowed and value and value not in allowed:
                case_errors_of(case).append(
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
                case_errors_of(case).append(
                    "用例「%s」里有重复的「步骤序号」：%s。同一条用例里的序号必须互不相同"
                    % (case["id"], "、".join(str(d) for d in dup))
                )
        elif any(s is not None for s in seqs):
            bad = [str(s["_line"]) for s in steps if s["seq"] is None]
            case_errors_of(case).append(
                "用例「%s」里有的步骤写了「步骤序号」、有的没写（没写的是第 %s 行）。"
                "要么全写，要么全不写（全不写就按表格里的先后顺序执行）" % (case["id"], "、".join(bad))
            )

    if table_errors:
        raise TableError(table_errors)

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
LEAVES_SECOND_LEVEL_PAGE = ("打开搜索并输入", "打开答题活动", "打开第一张专栏")

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
        # 这条用例自己就有填错（真机跑到它时直接红）：不用再给它体检了，免得提示里
        # 混进"它还没法跑"和"它写得不够好"两种话，看的人分不清该先改哪个
        if c.get("errors"):
            continue
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
        "--refresh",
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
        # 「名称候选」：要填名字的那几个参数，候选值从测试库抄一份进来（连不上库就写清原因）
        if SHEET_CHOICES not in wb.sheetnames:
            wb.create_sheet(SHEET_CHOICES)
        choices, why = fetch_name_choices()
        n_choices = fill_choices_sheet(wb[SHEET_CHOICES], choices, why)
        ws = wb[SHEET_DATA]
        # 先清空旧的校验规则，重复执行不会叠加（叠加会让 Excel 弹两次提示）
        ws.data_validations.dataValidation = []
        add_dropdowns(ws)
        merged = merge_case_cells(ws)  # 同一条用例的编号/名称并回一格（新加的行会跟着重新并）
        try:
            wb.save(xlsx)
        except PermissionError:
            print("存不进去：这份表正被 Excel/WPS 打开着（%s）。" % xlsx)
            print("  先把表格关掉，再跑一次：python tools/export_cases.py --dropdown")
            return 1
        print("已刷新用例表：%s" % xlsx)
        print("  · 「动作清单」工作表已更新为最新的 %d 个动作" % len(ACTIONS))
        print("  · 动作列（D）下拉框已重建，选项来自「动作清单」")
        if n_choices:
            print("  · 「%s」工作表已更新：%d 条候选名字（课程 / 答题活动 / 案例，从测试库取的）"
                  % (SHEET_CHOICES, n_choices))
        else:
            print("  · 「%s」工作表：这次没取到候选名字（原因写在工作表里）—— 只影响参考，不影响跑用例"
                  % SHEET_CHOICES)
        print("  · 步骤序号列（C）只接受 1、2、3… 这样的正整数")
        print("  · 同一条用例的「用例编号 / 用例名称」已并成一格（%d 块）" % merged)
        print("  · 你已经填好的内容一行都没动（只是把重复的编号并起来了）")
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

    # 填错的行归到了各自用例身上（见 validate 的说明）：导出照常成功，
    # 真机跑的时候只有这几条红，别的照跑。
    bad_cases = [c for c in cases if c.get("errors")]

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
            for a in ordered_actions()
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
        mark = "  [这条填错了]" if c.get("errors") else ""
        print("    - %s  %s（%d 步）%s" % (c["id"], c["name"], len(c["steps"]), mark))
    if bad_cases:
        print("\n[注意] 有 %d 条用例填错了 —— 跑起来时**只有这几条会红**，其他用例照常执行：" % len(bad_cases))
        for c in bad_cases:
            print("  · %s %s" % (c["id"], c["name"]))
            for err in c["errors"]:
                print("      · %s" % err)
    if warnings:
        print("\n[建议] 表格能跑，但这几处按经验值得改一改（只提示，不影响执行）：")
        for w in warnings:
            print("  · %s" % w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
