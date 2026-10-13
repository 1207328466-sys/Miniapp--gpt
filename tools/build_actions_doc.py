# -*- coding: utf-8 -*-
"""生成 `docs/动作清单-分类.md`：把表格能填的动作**按用途分类**排一遍（owner 2026/10/13 要的）。

为什么生成而不是手写：
  这份清单已经漂移过一次 —— 手册里写着「47 个动作」，实际只列了 44 个（少了 3 个：
  后来加动作时只改了 xlsx 的「动作清单」页，没回来补文档）。**手写的清单一定会再漂一次。**
  所以改成从唯一来源（`tools/export_cases.py` 的 `ACTIONS`）生成，并带 `--check`：
  文档和 `ACTIONS` 对不上就报红（接在 `scripts/verify-all.py` 的闸门里）。

分类表写在下面的 `GROUPS` 里。**新加了动作却忘了归类**会直接报错（宁可报错，
也不要让它悄悄掉进「其他」那一栏 —— 那样没人会去看它）。

用法：
    python tools/build_actions_doc.py            # 生成/刷新文档
    python tools/build_actions_doc.py --check    # 只检查是否最新（闸门用），不写文件
退出码：0 = 一致（或已生成）；1 = 对不上 / 有动作没归类
"""

import io
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

import export_cases as m  # noqa: E402

OUT = os.path.join(REPO, "docs", "动作清单-分类.md")

# 「用了几次」的统计口径：只统计**表格用例**（.js 用例直接调函数，不走动作名）
# 分组与顺序**不在这里重复定义**：直接用 tools/export_cases.py 的 ACTION_GROUPS
# —— 表格下拉框的顺序、这份文档的分组，是同一份定义（一处改动，两处同步，漏了会被闸门报红）。
GROUPS = m.ACTION_GROUPS

HEADER = """# 动作清单（按用途分类）

> ⚙️ **这份文档是生成的**：`python tools/build_actions_doc.py`，别手改
> （手改会在离线闸门里报红）。唯一来源是 `tools/export_cases.py` 里的 `ACTIONS`；
> 加/改动作改那里，再跑一次生成。
>
> 表格里「动作」列填的就是下表的名字（**一字不差**；那一列是下拉框，可以直接选）。
>
> 本文档**刻意不写「用了几次」这类统计**：那种数字每改一次用例就变，会让这道闸门天天空红，
> 而天天空红的闸门最后一定被忽略。想统计的话临时跑一下即可，别写进长期文档。

## 目录

- ① 到达 / 导航
- ② 搜索与内容（点进去看，只读）
- ③ 通用交互
- ④ 通用断言（检查「看得见没有」）
- ⑤ 需求专项检查
- ⑥ 答题 / 写链路（要开开关，跑完必须复位）
- 一次都没被表格用例用到的那几个
- 想加一个新动作
"""

FOOTER = """## 一次都没被表格用例用到的那几个

下面这几个在表格用例里出现 0 次，但**都留着**（owner 2026/10/13 拍板：留）：

- `逐题作答` / `提交答卷` / `复位答题记录` / `检查答题记录数` —— 写链路的四个步骤。
  它们在 `.js` 用例 `test_case/suprecast_app/test_quiz_submit.js` 里用（表格里没有写链路的用例，
  因为写链路要「造数 → 断言 → 复位」一整套，写在 `.js` 里更好读）。**别删**，删了就没有验收写链路的模板了。
- `点文字` / `等待` / `检查文字出现次数` / `检查答题页` —— 给新手兜底的工具。
  「点文字」「等待」是找不到更合适的动作时的退路；「检查文字出现次数」用于「出现 N 次」这类断言；
  「检查答题页」只在**单题**活动上成立（多题活动会记跳过并说明原因）。

## 想加一个新动作

加动作不是只在表格里写一行就行 —— 表格里能填的动作是**白名单**，要按这套顺序加：

1. 在 `app_sub_function/suprecast_app/` 的页面对象里写函数（别忘了 `return page`、异常要往上抛）；
2. 在 `tools/export_cases.py` 的 `ACTIONS` 里加一条（中文名字、`p1`/`p2` 写参数名、
   `desc` 说清干什么；会改数据的加 `risk`）；
3. 在 `test_case/suprecast_app/test_from_table.js` 的 `HANDLERS` 里实现同名处理函数；
4. 跑这两条：

   ```powershell
   python tools/build_actions_doc.py     # 刷新本文档（新动作必须归到某一类，否则报错）
   python scripts/verify-all.py          # 离线闸门（动作↔实现、文档数字、本文档是否最新…）
   ```

新的动作名没出现在 `GROUPS` 里会直接报错 —— 这是故意的，防止它悄悄漏在清单外没人看。
"""


def render():
    """拼出整份文档（纯函数：同样的 ACTIONS 一定拼出同样的文本）"""
    by_name = {a["name"]: a for a in m.ACTIONS}

    grouped = set()
    for _title, _note, names in GROUPS:
        for n in names:
            if n in grouped:
                raise SystemExit("分类表里有重复的动作：%s" % n)
            grouped.add(n)

    problems = []
    missing = [a["name"] for a in m.ACTIONS if a["name"] not in grouped]
    unknown = sorted(n for n in grouped if n not in by_name)
    if missing:
        problems.append(
            "这些动作还没归类（在 tools/build_actions_doc.py 的 GROUPS 里补上）：%s" % "、".join(missing)
        )
    if unknown:
        problems.append("分类表里有名字对不上动作清单（可能改名了）：%s" % "、".join(unknown))
    if problems:
        raise SystemExit("\n".join(problems))

    lines = [HEADER]
    for title, note, names in GROUPS:
        lines.append("\n## %s\n" % title)
        lines.append("%s\n" % note)
        lines.append("| 动作 | 参数1 | 参数2 | 干什么 | 会不会改数据 |")
        lines.append("|---|---|---|---|---|")
        for name in names:
            a = by_name[name]
            lines.append(
                "| %s | %s | %s | %s | %s |"
                % (name, a["p1"] or "", a["p2"] or "",
                   a["desc"].replace("\n", " "), a.get("risk", "不会"))
            )
    lines.append("\n" + FOOTER)
    return "\n".join(lines)


def main(argv):
    check_only = "--check" in argv
    text = render()
    old = ""
    if os.path.exists(OUT):
        with io.open(OUT, encoding="utf-8") as fh:
            old = fh.read()

    if check_only:
        if old == text:
            print("OK   %s 与动作清单一致（%d 个动作）"
                  % (os.path.relpath(OUT, REPO), len(m.ACTIONS)))
            return 0
        print("FAIL %s 与动作清单对不上（手改了？或者加了动作没重新生成）"
              % os.path.relpath(OUT, REPO))
        print("     修法：python tools/build_actions_doc.py")
        return 1

    with io.open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print("已生成：%s（%d 个动作，分 %d 类）"
          % (os.path.relpath(OUT, REPO), len(m.ACTIONS), len(GROUPS)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
