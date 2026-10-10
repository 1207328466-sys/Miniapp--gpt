# -*- coding: UTF-8 -*-
"""文档防腐检查（最小版）：校验文档里**包反引号的仓内路径真实存在**。

规则借自团队工作流的「文档防腐规范」：
  - 真实存在的路径一律包反引号 -> 包了就等于向校验器声明"这个路径应该存在"
  - 占位符/示例一律用尖括号（含 `<`、`YYYY`、`xx`、`*` 或空格的 token 自动跳过）
  - 推论：别给不存在的路径包反引号；不带反引号的文字提及不会被查

【刻意不做的事】**不校验文档里的命令能不能跑**。
工作流里实测过：做了会大量误报（凡是"警告某命令已坏"的文档，本身就会命中坏模式），
所以他们把它改成人眼铁律 —— **凡改到长期文档里的命令，必须在本次会话真跑一遍**。
这条比自动校验更重要，所以它写在本文件的输出里，而不是伪装成一条检查。

用法：
    python scripts/check-docs.py
退出码：0 = 没发现死链；1 = 有死链（列出文件与行号）
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 要检查的文档（新增长期文档时加进来）
SOURCES = ["README.md"] + [
    os.path.join(d, f)
    for d in ("docs", "knowledge")
    for f in sorted(os.listdir(os.path.join(REPO, d)))
    if f.endswith(".md")
] if os.path.isdir(os.path.join(REPO, "docs")) else ["README.md"]

# 反引号里的 token：只查"像仓内路径"的
CODE = re.compile(r"`([^`\n]+)`")
PLACEHOLDER = re.compile(r"[<>*]|\bYYYY\b|\bxx\b|\.\.\.|…")
KNOWN_EXT = (".md", ".js", ".py", ".json", ".yaml", ".yml", ".ini", ".txt", ".html", ".sql", ".ts")

# 跳过的目录（依赖 / 产物，不是"文档该引用的东西"）
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".pytest_cache", "report", "local", ".venv"}

# 仓内顶层目录名（用于识别"目录引用"）
TOP_DIRS = {"docs", "knowledge", "scripts", "tools", "common", "test_case",
            "app_sub_function", "config", "report", "local", "driver"}

# 允许缺失的路径（对应团队工作流规范里的 ALLOW_MISSING）：
# 这些路径**包了反引号但故意不存在**，原因写在这里，免得每次检查都报一遍。
ALLOW_MISSING = {
    # 读者需要自己创建的（入库的只有 .example）
    "config/config.yaml": "自带 .gitignore 忽略，读者从 .example 复制而来",
    # 运行期生成的产物
    "report/": "运行产物，report/ 整体已 gitignore",
    # 规划中但尚未创建
    "home_page.js": "首页页面对象尚未创建（首页无可信页面标记，不凭猜测造）",
    # 文档里用来说明"命名规则"的示例文件名
    "search.js": "示例文件名：用来说明「不以 test_ 开头不会被收集」",
    "test_search.js": "示例文件名：用来说明「必须 test_ 开头」",
    # 历史文档提到、后来被清理的文件（保留历史原貌，不改写）
    "page1.html": "历史诊断产物，已随 report/ 清理",
    "page2.html": "历史诊断产物，已随 report/ 清理",
    "probe_page_identity.js": "历史一次性探针，已清理",
    "verify_refactor2.js": "历史验证脚本，已清理",
    "refactor/": "历史诊断截图目录，已清理",
    "refactor2/": "历史诊断截图目录，已清理",
    "config/config.py": "外部参考框架（webzdh4.7）的文件，不在本仓",
    # 外部仓（团队工作流仓），本仓只引用不复制
    "miniapp-flow/": "外部仓：团队工作流（规范/复盘/知识），同级目录",
    "webzdh4.7/": "外部仓：同事的 Web UI 框架，同级目录",
    "config.yaml": "本仓的完整路径是 config/config.yaml（自建，见上）",
    # 「清理记录」表里列出的历史一次性脚本（记录它们存在过，本身已删）
    "probe_selector.js": "清理记录：历史一次性探针",
    "probe_scroll.js": "清理记录：历史一次性探针",
    "probe_click_method.js": "清理记录：历史一次性探针",
    "probe_tap.js": "清理记录：历史一次性探针",
    "diagnose_failures.js": "清理记录：历史一次性诊断脚本",
    "diagnose_switch.js": "清理记录：历史一次性诊断脚本",
    "verify_refactor.js": "清理记录：历史验证脚本（被 verify_refactor2 取代）",
}

# 行内含这些词的，说明讲的就是"不存在/已清理"的东西，不算死链
SKIP_CONTEXT = ("已删", "已清理", "已搬", "历史", "不存在", "尚未创建", "规划",
                "从未实现", "未实现", "清理记录")


def build_repo_index():
    """收集仓内所有文件路径，供"简写路径"（如 pages/base_page.js）按后缀匹配。"""
    files = []
    for root, dirs, names in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for d in dirs:
            files.append(os.path.relpath(os.path.join(root, d), REPO).replace("\\", "/"))
        for n in names:
            files.append(os.path.relpath(os.path.join(root, n), REPO).replace("\\", "/"))
    return files


REPO_FILES = None  # 懒加载


def exists_in_repo(probe):
    """存在判定：完整相对路径命中，或**能唯一对应到某个文件的后缀**命中。

    为什么允许后缀匹配：文档里常写 `pages/base_page.js` 这种简写。
    按团队工作流的规矩本该写完整路径，但为了不让检查器淹没在噪音里，
    这里放宽成"能在仓里找到以它结尾的文件就算存在" —— 仍能抓住改名/搬走造成的真死链。
    """
    global REPO_FILES
    if REPO_FILES is None:
        REPO_FILES = build_repo_index()
    p = probe.replace("\\", "/").lstrip("./")
    if os.path.exists(os.path.join(REPO, probe)):
        return True
    suffix = "/" + p
    return any(f == p or f.endswith(suffix) for f in REPO_FILES)


def allowed_missing(tok):
    """是否在 ALLOW_MISSING 白名单里（按 token 或去尾斜杠的形式匹配）"""
    t = tok.strip()
    if t in ALLOW_MISSING or t.rstrip("/") + "/" in ALLOW_MISSING:
        return True
    # 白名单里以 / 结尾的（如 report/）按前缀放行
    return any(k.endswith("/") and t.startswith(k) for k in ALLOW_MISSING)


def looks_like_repo_path(tok):
    t = tok.strip()
    if not t or PLACEHOLDER.search(t):
        return False
    if t.startswith(("http://", "https://", "git@", "ws://", "C:", "/", "$", "-", "=", "~")):
        return False
    if ":" in t:  # 形如 SHA256:+DiY...、或"路径:行号"引用
        return False
    if " " in t:  # 命令或自然语言片段
        return False
    if "：" in t or "，" in t:
        return False
    # 排除"看着像代码/调用"的：带括号、或形如 a.b/c.d 的成员链
    if any(ch in t for ch in "()（）"):
        return False
    if len(t) <= 4:  # 形如 `.js`、`x/` 这种太碎的
        return False
    # 有扩展名才算"文件"；否则只有带 / 的才进一步看（目录引用）
    if not t.endswith(KNOWN_EXT) and "/" not in t:
        return False
    # 带 / 但不是文件、也不以 / 结尾的（如 try/catch、JsTestFile/JsTestItem）-> 不是路径
    if "/" in t and not t.endswith(KNOWN_EXT) and not t.endswith("/"):
        return False
    # 形如 ctx.set/get/require、JsTestFile/JsTestItem：**首段含点**且没有扩展名 -> 不是路径
    if "/" in t and not t.endswith(KNOWN_EXT):
        if "." in t.split("/")[0]:
            return False
        # 目录引用：必须真像一个仓内目录（首段是已知顶层目录或以 -/_ 结尾的普通词）
        if t.endswith("/"):
            t = t.rstrip("/")
        if "/" not in t and t not in TOP_DIRS:
            return False
    return True


def main():
    missing = []
    checked = 0
    for rel in SOURCES:
        path = os.path.join(REPO, rel)
        if not os.path.exists(path):
            print(f"[WARN] 待检查的文档不存在：{rel}")
            continue
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                # 讲"不存在/已清理"的行整行跳过（否则清理记录表会被误报成死链）
                if any(w in line for w in SKIP_CONTEXT):
                    continue
                for tok in CODE.findall(line):
                    if not looks_like_repo_path(tok):
                        continue
                    if allowed_missing(tok):
                        continue
                    checked += 1
                    # 允许 "路径:行号" 或 "路径#锚点" 形式
                    probe = tok.split(":")[0].split("#")[0].strip()
                    if not exists_in_repo(probe):
                        missing.append((rel, lineno, tok))

    print(f"检查了 {len(SOURCES)} 份文档，{checked} 个路径 token")
    if missing:
        print(f"\n发现 {len(missing)} 处死链（路径包了反引号但文件不存在）：")
        for rel, lineno, tok in missing:
            print(f"  {rel}:{lineno}  ->  {tok}")
        print(
            "\n修法：路径改名/搬走后顺手全仓 grep 旧路径；"
            "占位符改写成尖括号形式（如 changes/<需求>/01-需求.md）。"
        )
        return 1

    print("没有死链。")
    print(
        "\n提醒（人眼铁律，机器不查）：**凡改到长期文档里的命令，必须在本次会话真跑一遍**。\n"
        "  一条跑不通的命令比没有命令更坏：照着做的人学到的不是「文档错了」，而是「别信文档」。"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
