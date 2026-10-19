# -*- coding: utf-8 -*-
"""只读冒烟（**OCR 版**，不需要 CDP）：首页 → 学习中心 → 专栏 → 我的 → 回首页，逐页断言关键文字。

【为什么要有它】微信侧不给 webview 调试端口时，表格用例（依赖 DOM）跑不了。
但"页面到没到、关键文字在不在"可以用截图 + OCR 验 —— 这条就是那种最粗的冒烟，
用来回答一个问题：**现在这台手机、这个小程序，框架还能不能带着它走一遍主路径。**

【它不是回归用例】
  · 不断言元素数量 / 行数 / 视口 / 样式（那些必须读 DOM）；
  · 长文字可能被 OCR 切成几段，所以只做"包含"判断，不做"出现几次"；
  · 每步 3~5 秒（OCR 推理）。

运行：python test_case/diagnostic/ocr_smoke.py
退出码：0 全过；1 有失败
"""

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import ocr_probe  # noqa: E402


def shot_items():
    path = ocr_probe.adb_screenshot()
    return ocr_probe.run_ocr(path)


def texts_of(items):
    return [it["text"] for it in items]


def find(items, word, prefer="any"):
    """按文字找一项；prefer=bottom 时取 y 最大的（底部 tab 用），top 取最小的。"""
    hit = [it for it in items if ocr_probe.normalize(word) in ocr_probe.normalize(it["text"])]
    if not hit:
        return None
    if prefer == "bottom":
        return max(hit, key=lambda it: it["center"][1])
    if prefer == "top":
        return min(hit, key=lambda it: it["center"][1])
    return hit[0]


def tap_text(items, word, prefer="any", wait=2.0):
    it = find(items, word, prefer)
    if not it:
        raise AssertionError("屏幕上没找到「%s」（OCR 识别到：%s）" % (word, "、".join(texts_of(items))[:120]))
    x, y = it["center"]
    subprocess.run(["adb", "shell", "input", "tap", str(x), str(y)], check=False)
    time.sleep(wait)
    return it


def expect(items, words, label):
    missing = [w for w in words if not find(items, w)]
    if missing:
        raise AssertionError("%s：缺少 %s（OCR 看到：%s）" % (label, missing, "、".join(texts_of(items))[:160]))


STEPS = []


def step(name):
    def deco(fn):
        STEPS.append((name, fn))
        return fn

    return deco


@step("回到首页（底部 tab「有问必答」）")
def _home():
    items = shot_items()
    try:
        tap_text(items, "有问必答", prefer="bottom", wait=2.5)
    except AssertionError:
        # 已经在首页时，底部 tab 上「有问必答」永远在；找不到说明不在小程序里
        raise
    items = shot_items()
    expect(items, ["最新提问", "推荐", "精选问答", "我的关注"], "首页筛选栏")
    return items


@step("学习中心：三个顶部 tab")
def _learn():
    items = shot_items()
    tap_text(items, "学习中心", prefer="bottom", wait=3.0)
    items = shot_items()
    expect(items, ["课程", "专栏", "压铸百科"], "学习中心顶部 tab")
    return items


@step("专栏列表：热门/往期 至少一个")
def _column():
    items = shot_items()
    tap_text(items, "专栏", prefer="top", wait=3.0)
    items = shot_items()
    if not (find(items, "热门专栏") or find(items, "往期专栏")):
        raise AssertionError("专栏列表页没看到「热门专栏/往期专栏」（OCR：%s）" % "、".join(texts_of(items))[:160])
    return items


@step("我的：积分商城入口")
def _mine():
    items = shot_items()
    tap_text(items, "我的", prefer="bottom", wait=3.0)
    items = shot_items()
    expect(items, ["积分商城"], "用户中心")
    return items


@step("回首页交还现场")
def _back_home():
    items = shot_items()
    tap_text(items, "有问必答", prefer="bottom", wait=2.5)
    items = shot_items()
    expect(items, ["最新提问"], "回到首页")
    return items


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    passed = failed = 0
    for name, fn in STEPS:
        t0 = time.time()
        try:
            fn()
            passed += 1
            print("[OK  ] %s  %.1fs" % (name, time.time() - t0))
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("[FAIL] %s  %.1fs\n        %s" % (name, time.time() - t0, str(e).split("\n")[0][:300]))
            # 失败也尽量回首页，别把手机留在二级页
            try:
                items = shot_items()
                tap_text(items, "有问必答", prefer="bottom", wait=2.0)
            except Exception:
                pass
    print("\n[OCR-SMOKE] passed=%d failed=%d" % (passed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
