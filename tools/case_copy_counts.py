# -*- coding: utf-8 -*-
"""案例「复制数」对账（**只读**）：把上架未删案例的 `copy_count` 打出来，供小程序端比。

【为什么需要它】缺陷 713453275「复制数的查看无数据返回」。
案例库列表卡片右下角显示的复制数，**必须跟库里对得上** —— 而源码里写的是
`copyCount ?? 0`（`src/components/case-list/index.tsx`），也就是**永远有个数字**：
"卡片上有数字"这种断言会**假绿**（缺陷回归清单里就这么提醒过）。
只有拿库里的 `copy_count` 对账，才抓得到"数字没返回来 / 显示成 0"。

【口径】只算 `status = 1`（上架）且 `is_deleted = 0` 的案例 —— 没上架的本来就不该出现在列表里。
同名标题**单独列出来**（`dup`）：重名时无法确定卡片对的是哪一条，调用方应当跳过它、别硬比。

用法:
    python tools/case_copy_counts.py --titles 亲亲,60      # 查这几个标题的复制数
    python tools/case_copy_counts.py --top 15             # 列复制数最高的 15 条（挑样本用）

机器读的那一行（表格动作按它解析）:
    [CASE_COPY] counts={"亲亲": 4} dup=["60"] total=44

退出码: 0 成功；1 读配置/连库失败/参数不对
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from quiz_data_cleanup import DEFAULT_CONFIG, load_conn  # noqa: E402


def aggregate(rows):
    """rows: [(title, copy_count)] -> (counts, dup)。

    **纯函数**（不碰库），便于离线自测：
      · counts 只收"库里唯一"的标题（同名出现两次以上就不给数，免得比到别的那条）；
      · dup 是重名标题（调用方要跳过）。
    """
    counts = {}
    dup = set()
    for title, cnt in rows:
        name = str(title or "").strip()
        if not name:
            continue
        if name in counts:
            dup.add(name)
            counts.pop(name, None)
        elif name not in dup:
            counts[name] = int(cnt or 0)
    return counts, sorted(dup)


def main(argv=None):
    parser = argparse.ArgumentParser(description="案例复制数对账（只读）")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--titles", default="", help="逗号分隔的案例标题；给了就查这几个")
    parser.add_argument("--top", type=int, default=0, help="顺便列复制数最高的 N 条")
    args = parser.parse_args(argv)

    wanted = [t.strip() for t in args.titles.split(",") if t.strip()]
    conn = load_conn(args.config)
    cur = conn.cursor()
    cur.execute(
        "select title, copy_count from simulation_case where status = 1 and is_deleted = 0"
    )
    rows = cur.fetchall()
    counts, dup = aggregate(rows)
    print("[CASE_COPY] counts=%s dup=%s total=%d" % (
        json.dumps(counts, ensure_ascii=False), json.dumps(dup, ensure_ascii=False), len(rows)))

    if args.top:
        top = sorted(((t, int(c or 0)) for t, c in rows if t), key=lambda x: -x[1])[: args.top]
        print("复制数最高的 %d 条（挑样本用）：" % len(top))
        for t, c in top:
            print("   %-6s %s" % (c, t))

    if wanted:
        print("点名要查的 %d 个标题：" % len(wanted))
        for t in wanted:
            if t in dup:
                print("   %-30s 库里重名（无法确定对哪一条，调用方应当跳过）" % t)
            elif t in counts:
                print("   %-30s copy_count=%s" % (t, counts[t]))
            else:
                print("   %-30s 库里找不到（上架未删的案例里没有这个标题）" % t)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
