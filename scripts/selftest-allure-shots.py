# -*- coding: utf-8 -*-
"""Allure 截图附件的自检（**离线**，不需要手机）：验证"压缩后再贴"这条路真的成立。

为什么要有它：Allure 里贴不贴截图、贴多大的，是**一次改动、长期生效**的事 ——
坏了不会报错，只会表现为"报告里图看不清"或者"报告大到打不开"。
而这件事的核心假设只有两条，正好都能离线验：

  1. 压缩**确实能把图变小**，且压完**还是一张能打开的图**（不然报告里是坏图）；
  2. 原图确实比压缩版大得多（不然费劲压缩没意义）—— 这条靠真实截图量一次。

顺带把三种开关（all / failed / none）写进输出，方便以后回头看当初为什么这么定：
  · all（默认）：每步一张压缩版，失败步骤再补一张原图 —— 复盘时每步都能看，报告也就十几 MB；
  · failed：只贴失败步骤（旧行为，报告最小，但全绿时报告里一张图都没有）；
  · none：都不贴。

用法：python scripts/selftest-allure-shots.py
退出码：0 = 符合预期；1 = 不符合
"""

import io
import os
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "test_case", "suprecast_app"))

from PIL import Image  # noqa: E402

import conftest as c  # noqa: E402

failed = []
passed = 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
        print("OK   %s" % name)
    else:
        failed.append("%s（%s）" % (name, detail))
        print("FAIL %s（%s）" % (name, detail))


tmp = tempfile.mkdtemp(prefix="uitest_shots_")
shot = os.path.join(tmp, "fake_shot.png")

# 造一张"像真截图"的图：1216×2640（就是我们手机的分辨率），带点内容（纯色图压缩率不真实）
im = Image.new("RGB", (1216, 2640), (240, 240, 245))
for y in range(0, 2640, 40):
    for x in range(0, 1216, 40):
        im.putpixel((x, y), ((x * 7) % 255, (y * 5) % 255, (x + y) % 255))
im.save(shot, format="PNG")
raw = os.path.getsize(shot)

small = c._shrink_for_report(shot)
check("压缩返回值不是 None（Pillow 这条路是通的）", small is not None, "拿到 %r" % (small and len(small)))

if small:
    with Image.open(io.BytesIO(small)) as back:
        check(
            "压完还是一张能打开的图（不是坏文件）",
            back.format == "JPEG" and back.width == c.SHOT_MAX_WIDTH,
            "实际 format=%s 宽=%s（期望 JPEG / %s）" % (back.format, back.width, c.SHOT_MAX_WIDTH),
        )
        check(
            "压完比原图小（不然压缩没意义）",
            len(small) < raw,
            "原图 %d 字节 / 压缩后 %d 字节" % (raw, len(small)),
        )

# ---------- 真实截图：量一下到底能省多少（这是当初定"压缩后再贴"的依据）----------
real = []
for root, dirs, files in os.walk(os.path.join(REPO, "report", "photo_app")):
    for f in files:
        if f.endswith(".png"):
            real.append(os.path.join(root, f))
    if len(real) >= 3:
        break

if real:
    pairs = []
    for p in real[:3]:
        s = c._shrink_for_report(p)
        if s:
            pairs.append((os.path.getsize(p), len(s)))
    if pairs:
        ratio = sum(b for _a, b in pairs) / sum(a for a, _b in pairs)
        print("     真实截图抽样 %d 张：原图合计 %.2f MB → 压缩后 %.2f MB（约 %.0f%%）"
              % (len(pairs), sum(a for a, _b in pairs) / 1024 / 1024,
                 sum(b for _a, b in pairs) / 1024 / 1024, ratio * 100))
        check(
            "真实截图能压到原大小的 30% 以下（否则报告还是会很大）",
            ratio < 0.3,
            "压到了 %.0f%%" % (ratio * 100),
        )
else:
    print("     （report/photo_app 下没有截图可抽样，跳过真实截图那条 —— 不算失败）")

# ---------- 开关只能取这三个值 ----------
check(
    "贴图开关取值合法（all / failed / none）",
    c.SHOT_MODE in ("all", "failed", "none"),
    "当前 UITEST_ALLURE_SHOTS=%r" % c.SHOT_MODE,
)

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
