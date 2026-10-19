# -*- coding: utf-8 -*-
"""OCR 降级通道（**不需要 CDP**）：截图 → 识别文字与位置 → 打印 / 找 / 点。

【什么时候用它】微信侧没开 webview 调试端口（CDP）时，框架读不到 DOM；
这时用它至少能看到"屏幕上有哪些字、各在什么位置"，也能按文字点。

【它做不到什么（别拿它替代正式回归）】
  · 元素数量 / 行数 / 是否完整在视口 / 计算样式 —— 这些必须读 DOM；
  · 长文字会被切成几段（同一行可能被识别成两块）→ "出现次数"会数错；
  · 图片里的字、图标按钮（没有文字的）识别不到；
  · 一次约 3~5 秒（初始化模型 2 秒 + 推理 2 秒）。

用法:
    python tools/ocr_probe.py                          # 打印当前屏幕全部文字 + 坐标
    python tools/ocr_probe.py --grep 最新提问           # 只看匹配的行
    python tools/ocr_probe.py --tap 最新提问            # 点它（取匹配框的中心）
    python tools/ocr_probe.py --tap 推荐 --nth 2        # 点第 2 个匹配
    python tools/ocr_probe.py --image some.png         # 用已有截图（不连手机）
    python tools/ocr_probe.py --json                   # 机器可读

退出码: 0 成功；1 没找到目标 / 识别失败；2 环境问题（adb / 模型）
"""

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def adb_screenshot():
    """用 adb 截一张图，返回临时文件路径（PNG）。"""
    adb = "adb"
    path = os.path.join(tempfile.gettempdir(), "ocr_shot.png")
    with open(path, "wb") as f:
        r = subprocess.run([adb, "exec-out", "screencap", "-p"], stdout=f, stderr=subprocess.PIPE)
    if r.returncode != 0 or os.path.getsize(path) < 10000:
        raise RuntimeError("截图失败（adb exec-out screencap）：%s" % r.stderr.decode("utf-8", "replace")[:200])
    return path


def normalize(s):
    return "".join(str(s or "").split())


def run_ocr(image_path):
    from rapidocr_onnxruntime import RapidOCR

    ocr = RapidOCR()
    res, _ = ocr(image_path)
    out = []
    for item in res or []:
        box, text, score = item
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        out.append(
            {
                "text": str(text),
                "score": float(score),
                "box": [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))],
                "center": [int((min(xs) + max(xs)) / 2), int((min(ys) + max(ys)) / 2)],
            }
        )
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="OCR 降级通道：截图 → 文字/坐标 → 打印/点")
    ap.add_argument("--image", default="", help="用已有截图，不连手机")
    ap.add_argument("--grep", default="", help="只显示/匹配包含这段文字的项")
    ap.add_argument("--tap", default="", help="按文字点（取匹配框中心）")
    ap.add_argument("--nth", type=int, default=1, help="--tap 时取第几个匹配（从 1 数）")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    ap.add_argument("--top", type=int, default=0, help="只打印前 N 行（默认全部）")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    try:
        image = args.image or adb_screenshot()
    except Exception as e:
        print("[失败] %s" % e)
        return 2

    try:
        items = run_ocr(image)
    except Exception as e:
        print("[失败] OCR 初始化/识别失败：%s" % str(e).split("\n")[0])
        print("  安装：.venv\\Scripts\\python.exe -m pip install rapidocr_onnxruntime")
        return 2

    needle = normalize(args.grep or args.tap)
    hits = [it for it in items if needle and needle in normalize(it["text"])] if needle else items

    if args.json:
        print(json.dumps({"image": image, "items": items, "hits": hits}, ensure_ascii=False, indent=2))
        return 0 if (hits or not needle) else 1

    print("截图：%s" % image)
    print("识别到 %d 段文字%s" % (len(items), ("，其中匹配「%s」的 %d 段" % (args.grep or args.tap, len(hits))) if needle else ""))
    show = hits if needle else items
    if args.top:
        show = show[: args.top]
    for it in show:
        print(
            "  %-18s center=(%4d,%4d) box=(%4d,%4d)-(%4d,%4d) score=%.2f"
            % (
                it["text"][:18],
                it["center"][0],
                it["center"][1],
                it["box"][0],
                it["box"][1],
                it["box"][2],
                it["box"][3],
                it["score"],
            )
        )

    if args.tap:
        if not hits:
            print("\n[失败] 屏幕上没识别到「%s」" % args.tap)
            return 1
        idx = max(1, args.nth) - 1
        if idx >= len(hits):
            print("\n[失败] 「%s」只匹配到 %d 段，取不到第 %d 个" % (args.tap, len(hits), args.nth))
            return 1
        x, y = hits[idx]["center"]
        print("\n点「%s」：adb input tap %d %d" % (hits[idx]["text"], x, y))
        subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)], check=False)
        return 0
    return 0 if (hits or not needle) else 1


if __name__ == "__main__":
    sys.exit(main())
