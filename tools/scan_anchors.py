# -*- coding: utf-8 -*-
"""扫小程序**前端源码**，当「选择器词典」用（owner 2026/10/15 给的源码）。

【它解决什么问题】
写用例要填选择器时，真机 DOM 里有两类 class，长得一样但**寿命完全不同**：

  - **业务类名**：`eco-tab-item`、`case-list-card`、`overlay-mask`……
    从 TSX 的 `className` 直接来，**看得懂、稳**（实测：运行时 DOM 里原样保留、没有 hash 后缀）。
  - **原子类**：`fs-28`、`text-_h3D3D3D_`、`whitespace-nowrap`……
    是样式系统编译出来的**样式名**，一屏上到处都是、换个设计稿就变。
    抄它写用例等于抄了个随时会烂的东西（踩坑记录里那条「.fs-28 text-blacks28 ml-2 找不到选择器」
    就是照抄原子类抄出来的）。

哪个是业务类名、哪个是原子类，光看真机 DOM 分不出来（都长得像 class），**看源码才分得出来**。
所以这个脚本把源码里的 className 全抽出来，供两件事：

  ① **查**：`--find 案例` / `--module 页面 cases` —— 想知道"某个东西叫什么"时来这儿找；
  ② **核对**：`--check-doc` —— 检查 `knowledge/前端源码与选择器对照.md` 里教的锚点
     **源码里是不是真的有**（文档教错锚点，比不教更坏；这道闸门接在 scripts/verify-all.py 里）。

【用法】
    python tools/scan_anchors.py --find case        # 按关键词找类名
    python tools/scan_anchors.py --find tab --module qa
    python tools/scan_anchors.py --module cases     # 看这个页面/组件下有哪些类名
    python tools/scan_anchors.py --check-doc        # 校验对照文档里的锚点都存在（闸门用）
    python tools/scan_anchors.py --src <目录>       # 指定源码 src 目录

【源码目录找不到时】打印一行提示、退出码 0（**不算失败**）——
源码是同事电脑上的工作副本，别的地方不一定有；那种情况下跳过这道闸门，
而不是把"没有源码"报成"框架坏了"。
"""

import io
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, "knowledge", "前端源码与选择器对照.md")

# 源码目录的默认候选：按顺序找第一个存在的
DEFAULT_SRC_CANDIDATES = [
    os.path.join(os.path.expanduser("~"), "Desktop", "eco-microapp", "src"),
    os.path.join(os.path.dirname(REPO), "eco-microapp", "src"),
]

SRC_SUFFIXES = (".tsx", ".ts", ".jsx")
SKIP_DIRS = {"node_modules", "dist", ".swc", ".git", "__tests__", "mock", "mocks"}


_STR = re.compile(r"\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`")
_IDENT = re.compile(r"\b([A-Za-z_$][\w$]*)\b")
_KEYWORDS = {"true", "false", "null", "undefined", "cn", "clsx", "classnames", "String", "Array", "Object", "Math"}


def _strings_in(s):
    return [m[1:-1] for m in _STR.findall(s)]


def _balanced(text, start):
    """从 `{` 处取到配对的 `}`，返回中间那段（找不到就返回到文件末尾）。"""
    depth = 0
    j = start
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return text[start + 1 : j]


def class_exprs(text):
    """把一段源码里所有**静态 class 文本**抽出来。

    三种写法都要能吃到（漏一种就会出现"源码明明有、工具说没有"的假警报）：
      1. `className="a b"` / `className={'a b'}` / `className={`a ${x}`}`
      2. `className: "a b"` —— 写在 props 对象里的（Swiper 之类组件常见，实测就踩到过）
      3. `className={rootClassName}` —— **名字存在变量里**：回头去文件里找
         `const rootClassName = ...` 再抽一遍（`eco-tabs-bar` 就是这么写的）
    """
    out = []
    for m in re.finditer(r"className\s*[:=]\s*", text):
        i = m.end()
        if i >= len(text):
            continue
        ch = text[i]
        if ch in "\"'`":
            j = text.find(ch, i + 1)
            if j > i:
                out.append(text[i + 1 : j])
        elif ch == "{":
            body = _balanced(text, i)
            # 外层串（把 ${...} 抠掉再抽，免得一个模板串把里面的引号一起吞了）
            out.extend(_strings_in(strip_dynamic(body)))
            # ${...} **里面**的串也要 —— 实测踩到：tab 的选中态就写在里面
            #   className={`tab-item eco-tab-item${active ? " active eco-tab-item-active" : ""}`}
            # 少了这一句，工具就会说"源码里没有 eco-tab-item-active"（假警报）
            for inner in re.findall(r"\$\{([^{}]*)\}", body):
                out.extend(_strings_in(inner))
            # 变量名 -> 去文件里找它的赋值语句
            for ident in sorted(set(_IDENT.findall(body))):
                if ident in _KEYWORDS or ident[0].isupper():
                    continue
                for decl in re.findall(
                    r"(?:const|let|var)\s+%s\s*=\s*([^;]{0,600});" % re.escape(ident), text, re.S
                ):
                    out.extend(_strings_in(decl))
    return out


def strip_dynamic(raw):
    """去掉 ${...} 这类插值，只留静态部分。"""
    return re.sub(r"\$\{[^}]*\}", " ", raw)


def module_key(rel):
    """归到「页面/组件」：pages/qa/index.tsx -> 页面 qa；components/eco-tabs-bar/index.tsx -> 组件 eco-tabs-bar"""
    parts = rel.replace("\\", "/").split("/")[:-1]
    if "pages" in parts:
        i = parts.index("pages")
        tail = parts[i + 1 :]
        return "页面 " + (tail[0] if tail else "?")
    if "components" in parts:
        i = len(parts) - 1 - parts[::-1].index("components")
        tail = parts[i + 1 :]
        return "组件 " + (tail[0] if tail else "?")
    return "其它 " + ("/".join(parts) or "根目录")


def scan(src_root):
    """-> {类名: {模块: 次数}}, 以及 {模块: {文件: [类名]}}"""
    by_class = {}
    by_module = {}
    for root, dirs, files in os.walk(src_root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in sorted(files):
            if not f.endswith(SRC_SUFFIXES):
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, src_root).replace("\\", "/")
            try:
                with io.open(path, encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            mod = module_key(rel)
            for raw in class_exprs(text):
                for name in strip_dynamic(raw).split():
                    if not re.match(r"^-?[A-Za-z_][\w-]*$", name):
                        continue
                    by_class.setdefault(name, {}).setdefault(mod, 0)
                    by_class[name][mod] += 1
                    by_module.setdefault(mod, {}).setdefault(rel, set()).add(name)
    return by_class, by_module


def find_src(explicit):
    if explicit:
        return explicit if os.path.isdir(explicit) else None
    env = os.environ.get("UITEST_SRC")
    if env and os.path.isdir(env):
        return env
    for cand in DEFAULT_SRC_CANDIDATES:
        if os.path.isdir(cand):
            return cand
    return None


def cmd_find(by_class, kw, mod_filter):
    """按关键词找类名。排序：命中开头 > 含关键词；同分按用到的模块数、次数降序。"""
    kw_l = kw.lower()
    rows = []
    for name, mods in by_class.items():
        if kw_l not in name.lower():
            continue
        if mod_filter and not any(mod_filter.lower() in m.lower() for m in mods):
            continue
        hits = sum(mods.values())
        mod_list = sorted(mods, key=lambda m: -mods[m])
        if mod_filter:
            mod_list = [m for m in mod_list if mod_filter.lower() in m.lower()] + [
                m for m in mod_list if mod_filter.lower() not in m.lower()
            ]
        rows.append((0 if name.lower().startswith(kw_l) else 1, -len(mods), -hits, name, mod_list, mods))
    rows.sort()
    if not rows:
        print("没找到含 %r 的类名。" % kw)
        return 0
    print("找到 %d 个（抄的时候前面加个点，例如 .%s）：\n" % (len(rows), rows[0][3]))
    for _o, _m, _h, name, mod_list, mods in rows[:40]:
        where = "、".join("%s×%d" % (m, mods[m]) for m in mod_list[:3])
        print("  .%-40s %s" % (name, where))
    if len(rows) > 40:
        print("\n（还有 %d 个没显示，把关键词写细一点）" % (len(rows) - 40))
    print("\n⚠️ 挑的时候记住：名字里带 fs-28 / text-_XXXXXX_ / whitespace-nowrap 这种原子类别用。")
    return 0


def cmd_module(by_class, mod_filter):
    mods = sorted({m for mods in by_class.values() for m in mods if mod_filter.lower() in m.lower()})
    if not mods:
        print("没有匹配 %r 的页面/组件。列一下有哪些：" % mod_filter)
        for m in sorted({m for mods in by_class.values() for m in mods}):
            print("  " + m)
        return 1
    for mod in mods:
        names = sorted(n for n, ms in by_class.items() if mod in ms)
        print("\n=== %s（%d 个类名）===" % (mod, len(names)))
        for n in names:
            print("  .%s" % n)
    return 0


def cmd_check_doc(src_root, by_class):
    """校验对照文档里教的锚点，源码里都真的存在。

    口径：只认文档里的**行内代码** `` `.xxx` `` 里、以点开头、看着像单个 class 的名字
    （`.eco-tab-item`）。像 `.case-list-card-stats` 这种也照查。
    刻意保守：**只查以点开头、且不含空格/括号/冒号的**，免得把 `.hot-topics .inline-flex`
    这类组合写法、或者 `[class*=...]` 误判成"类名不存在"。
    """
    with io.open(DOC, encoding="utf-8") as f:
        text = f.read()
    names = sorted(set(re.findall(r"`\.([A-Za-z][\w-]*)`", text)))
    if not names:
        print("FAIL 对照文档里一个 `.类名` 都没抽到（文档格式变了？）")
        return 1
    missing = [n for n in names if n not in by_class]
    print("对照文档里教了 %d 个锚点：%s" % (len(names), "、".join("." + n for n in names)))
    if missing:
        print("\nFAIL 这几个在源码里找不到（名字写过时了 / 是原子类 / 源码副本比手机旧）：")
        for n in missing:
            print("  .%s" % n)
        print("\n改法：python tools/scan_anchors.py --find <关键词> 找到真名再改文档。")
        return 1
    print("OK   都在源码里（%s）" % src_root)
    return 0


def main():
    args = sys.argv[1:]
    src = None
    if "--src" in args:
        i = args.index("--src")
        if i + 1 < len(args):
            src = args[i + 1]
    kw = None
    if "--find" in args:
        i = args.index("--find")
        kw = args[i + 1] if i + 1 < len(args) else ""
    mod = None
    if "--module" in args:
        i = args.index("--module")
        mod = args[i + 1] if i + 1 < len(args) else ""
    mod_filter = None
    if "--in" in args:
        i = args.index("--in")
        mod_filter = args[i + 1] if i + 1 < len(args) else ""

    src_root = find_src(src)
    if not src_root:
        print("没找到小程序前端源码目录 —— 跳过（不算失败）。")
        print("  想跑的话：python tools/scan_anchors.py --src <eco-microapp 的 src 目录>")
        return 0

    by_class, by_module = scan(src_root)
    print("源码：%s（%d 个类名，%d 个页面/组件模块）\n" % (
        src_root, len(by_class), len(by_module)))

    if kw is not None:
        return cmd_find(by_class, kw, mod_filter)
    if mod is not None:
        return cmd_module(by_class, mod)
    if "--check-doc" in args:
        return cmd_check_doc(src_root, by_class)

    print("用法：")
    print("  python tools/scan_anchors.py --find <关键词>        # 找类名（选择器词典）")
    print("  python tools/scan_anchors.py --find <关键词> --in <模块>")
    print("  python tools/scan_anchors.py --module <页面/组件>   # 看这个模块下有哪些类名")
    print("  python tools/scan_anchors.py --check-doc            # 校验对照文档里的锚点都存在")
    return 0


if __name__ == "__main__":
    sys.exit(main())
