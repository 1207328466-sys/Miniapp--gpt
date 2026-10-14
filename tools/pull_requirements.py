# -*- coding: utf-8 -*-
"""一条命令自动拉取需求（CodeArts 工作项）并与知识库对账。

【为什么要有它】（2026/10/14）
  以前知识库是"人工从 CodeArts 导出 4 个 30 列 xlsx → build_requirements_kb.py"两步走：
  导出要人手点、文件名带时间戳、还容易漏。而工作区里已经有同事整理好的 CLI（`oacli`），
  它直接调 CodeArts 的 projectman OpenAPI —— 于是拉需求可以变成**一条命令**。

  实测（2026/10/14）：用正确的项目 id 拉「超云生态平台」的 Story = **247 条**，
  与知识库 `knowledge/工作项清单.md` 里的 247 条**id 完全一致、零差异** —— 这条路可信。

【两个必须记住的坑】
  1. **项目别拉错**：oacli 默认项目是「智铸超云(Saas)V3」，拉出来是另一个项目的 1170 条 Story、
     与知识库**没有任何交集**。本工具默认锁死「超云生态平台」= `78b2e310f37c4e28bfb3ef86179ac134`
     （见 `oacli/codearts/request_codearts.py` 的 `ProjectId` 枚举）。
  2. **凭据不入库**：账号密码放在 `oacli/.env`（已被 .gitignore 忽略），`accounts.json` 里只写
     `${...}` 引用。本工具只调 CLI，不碰凭据、也不打印它们。

用法:
    python tools/pull_requirements.py                 # 拉全量 Story 并对账，结果落 report/需求拉取/
    python tools/pull_requirements.py --days 7        # 只拉最近 7 天更新的
    python tools/pull_requirements.py --status 新建    # 只看某个状态
    python tools/pull_requirements.py --from-json X   # 不联网，直接分析一份已有的拉取结果
退出码：0 正常（含"有新增需求"——那是信息，不是错误）；1 拉取/解析失败
"""

import argparse
import io
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OACLI_DIR = ROOT / "oacli"
OACLI_PY = OACLI_DIR / "oacli.py"
KB_LIST = ROOT / "knowledge" / "工作项清单.md"
OUT_DIR = ROOT / "report" / "需求拉取"

# 超云生态平台（小程序那个项目）。**别改**，除非确实要拉别的项目 —— 见文件头的坑 1。
PROJECT_CYST = "78b2e310f37c4e28bfb3ef86179ac134"
PROJECT_NAME = "超云生态平台"


def oacli_python():
    """oacli 自己的 venv 优先；没有就用当前这个解释器（依赖 click/requests/python-dotenv）"""
    venv = OACLI_DIR / ".venv" / "Scripts" / "python.exe"
    return str(venv) if venv.exists() else sys.executable


def pull(tracker="story", days=None, status=None, project_id=PROJECT_CYST, timeout=180):
    """调 CLI 拉工作项，返回它输出的 JSON（dict）。失败抛 RuntimeError，带 CLI 的原话。"""
    if not OACLI_PY.exists():
        raise RuntimeError("找不到 oacli：%s（这个工具依赖它，见 oacli/README.md）" % OACLI_PY)
    args = [oacli_python(), str(OACLI_PY), "--json", "list_issues",
            "--project_id", project_id, "--tracker", tracker, "--all"]
    if days:
        args += ["--days", str(days)]
    else:
        args += ["--start", "2020-01-01 00:00"]  # 不带窗口时 CLI 默认只给"昨天→现在"，这里要全量
    if status:
        args += ["--status", status]
    r = subprocess.run(args, cwd=str(OACLI_DIR), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=timeout,
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    out = (r.stdout or "").strip()
    if r.returncode != 0 or not out.startswith("{"):
        tail = "\n".join(((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-4:])
        raise RuntimeError("oacli 拉取失败（退出码 %s）：\n%s" % (r.returncode, tail))
    return json.loads(out)


def parse_kb(path=KB_LIST):
    """从知识库清单里读出 {id: {"status":…, "title":…}} —— **纯函数**（离线自检用）。

    清单是 build_requirements_kb.py 生成的表格，一行一条：
        | 712880447 | Story | 已关闭 |  | 小程序-压铸百科 | 俞振豪 | 2025/06/19 … |
    """
    text = io.open(path, encoding="utf-8").read()
    items = {}
    for line in text.splitlines():
        m = re.match(r"^\|\s*(\d{9})\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|", line)
        if not m:
            continue
        items[m.group(1)] = {"tracker": m.group(2).strip(), "status": m.group(3).strip(),
                             "title": m.group(5).strip()}
    return items


def summarize(items):
    """把拉取结果整理成 {id: {...}} —— **纯函数**"""
    out = {}
    for it in items:
        out[str(it.get("id"))] = {
            "title": (it.get("subject") or "").strip(),
            "status": (it.get("status") or "").strip(),
            "assigned": (it.get("assigned") or "").strip(),
            "updated": (it.get("updated_str") or "").strip(),
        }
    return out


def diff(kb, pulled):
    """对账 —— **纯函数**：返回 (新增, 消失, 状态变化)。"""
    added = sorted(set(pulled) - set(kb))
    gone = sorted(set(kb) - set(pulled))
    changed = sorted(
        (i, kb[i]["status"], pulled[i]["status"])
        for i in set(kb) & set(pulled)
        if kb[i]["status"] and pulled[i]["status"] and kb[i]["status"] != pulled[i]["status"]
    )
    return added, gone, changed


def render_report(pulled, kb, added, gone, changed, meta):
    """把对账结果写成 markdown（人看的那份）"""
    lines = [
        "# 需求拉取对账（%s）" % meta["time"],
        "",
        "> 自动生成，别手改。项目：**%s**（`%s`）｜来源：`oacli list_issues --tracker story`"
        % (meta["project_name"], meta["project_id"]),
        "",
        "| 项 | 数 |",
        "|---|---|",
        "| 这次拉到 | %d |" % len(pulled),
        "| 知识库清单里 | %d |" % len(kb),
        "| **新增**（拉到了、知识库没有） | %d |" % len(added),
        "| **消失**（知识库有、这次没拉到） | %d |" % len(gone),
        "| **状态变化** | %d |" % len(changed),
        "",
    ]
    if added:
        lines += ["## 新增（值得顺手看一眼是不是新需求）", "",
                  "| id | 状态 | 标题 | 处理人 | 更新时间 |", "|---|---|---|---|---|"]
        lines += ["| %s | %s | %s | %s | %s |" % (i, pulled[i]["status"], pulled[i]["title"],
                                                 pulled[i]["assigned"], pulled[i]["updated"]) for i in added]
        lines.append("")
    if gone:
        lines += ["## 消失（知识库有、这次没拉到 —— 可能被删了，或项目选错了）", "",
                  "| id | 状态 | 标题 |", "|---|---|---|"]
        lines += ["| %s | %s | %s |" % (i, kb[i]["status"], kb[i]["title"]) for i in gone]
        lines.append("")
    if changed:
        lines += ["## 状态变化（知识库里记的是旧状态）", "",
                  "| id | 旧 | 新 | 标题 |", "|---|---|---|---|"]
        lines += ["| %s | %s | %s | %s |" % (i, old, new, pulled[i]["title"]) for i, old, new in changed]
        lines.append("")
    if not (added or gone or changed):
        lines += ["**零差异**：这次拉到的和知识库清单完全一致（id 集合与状态都对得上）。", ""]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description="自动拉取需求并对账（见文件头说明）")
    parser.add_argument("--tracker", default="story", help="工作项类型（默认 story=需求）")
    parser.add_argument("--days", type=int, help="只拉最近 N 天更新的（不填 = 全量）")
    parser.add_argument("--status", help="按状态过滤（CLI 侧是本地过滤，会自动翻页）")
    parser.add_argument("--project-id", default=PROJECT_CYST, help="项目 UUID（默认超云生态平台）")
    parser.add_argument("--from-json", help="不联网：直接分析一份已有的拉取结果 JSON")
    args = parser.parse_args(argv)

    if args.from_json:
        data = json.load(io.open(args.from_json, encoding="utf-8"))
    else:
        data = pull(tracker=args.tracker, days=args.days, status=args.status, project_id=args.project_id)

    pulled = summarize(data.get("issues") or [])
    kb = parse_kb()
    added, gone, changed = diff(kb, pulled)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    meta = {"time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "project_id": args.project_id,
            "project_name": PROJECT_NAME if args.project_id == PROJECT_CYST else "(自定义项目)"}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    snap = OUT_DIR / ("需求快照-%s.json" % stamp)
    with io.open(snap, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"meta": meta, "issues": data.get("issues") or []}, ensure_ascii=False, indent=2))
    report = OUT_DIR / ("对账-%s.md" % stamp)
    with io.open(report, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(render_report(pulled, kb, added, gone, changed, meta))

    print("拉取完成：%s —— %d 条 %s" % (meta["project_name"], len(pulled), args.tracker))
    print("  快照：%s" % snap.relative_to(ROOT))
    print("  对账：%s" % report.relative_to(ROOT))
    print("  新增 %d 条 ｜ 消失 %d 条 ｜ 状态变化 %d 条" % (len(added), len(gone), len(changed)))
    if added:
        print("  新增的（前 8 条）：")
        for i in added[:8]:
            print("    %s  %s  %s" % (i, pulled[i]["status"], pulled[i]["title"]))
    if gone:
        print("  消失的（前 5 条）：%s" % "、".join(gone[:5]))
    if changed:
        print("  状态变化（前 5 条）：")
        for i, old, new in changed[:5]:
            print("    %s  %s -> %s  %s" % (i, old, new, pulled[i]["title"]))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 顶层兜底：把失败原因打成人话
        print("拉取需求失败：%s" % e)
        sys.exit(1)
