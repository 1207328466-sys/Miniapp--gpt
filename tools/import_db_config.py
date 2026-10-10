# -*- coding: UTF-8 -*-
"""从团队工作流仓的 .env 读取数据库连接，写进本仓**被 gitignore** 的 config/db.local.yaml。

为什么绕这一道：凭据绝不能进版本库，也不该出现在对话与日志里。
但团队工作流仓的 .env 里已经有权威的那份——`miniapp-flow/knowledge/环境与账号.md`
的「数据库」一节明确记载：alpha 测试库的凭据段就是 `MYSQL_DEV_*`。
所以这里"读权威来源 -> 写本地配置"，全程**只回显打码后的结果**。

用法：
    python tools/import_db_config.py [.env 路径]
默认 .env 路径：与本仓同级的 ../miniapp-flow/.env

产出：config/db.local.yaml（**已 gitignore**，不会入库；脚本里也不打印密码）
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ENV = os.path.join(os.path.dirname(REPO), "miniapp-flow", ".env")
OUT = os.path.join(REPO, "config", "db.local.yaml")

MAPPING = [
    ("MYSQL_DEV_HOST", "host"),
    ("MYSQL_DEV_PORT", "port"),
    ("MYSQL_DEV_USER", "user"),
    ("MYSQL_DEV_PASSWORD", "password"),
    ("MYSQL_DEV_DB", "database"),
]


def read_env(path):
    vals = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def main(argv):
    env_path = argv[0] if argv else DEFAULT_ENV
    if not os.path.exists(env_path):
        print("找不到 .env：" + env_path)
        return 2

    vals = read_env(env_path)
    cfg = {}
    missing = []
    for env_key, yaml_key in MAPPING:
        if vals.get(env_key):
            cfg[yaml_key] = vals[env_key]
        else:
            missing.append(env_key)

    if missing:
        print("以下键在 .env 里为空或缺失，未写入配置：" + "、".join(missing))
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("# 本地数据库配置（**不入库**，由 tools/import_db_config.py 生成）\n")
        fh.write("# 结构对照：miniapp-flow/knowledge/环境与账号.md 的「数据库」一节\n")
        fh.write("# 密码变了重新跑：python tools/import_db_config.py\n")
        for k in ("host", "port", "user", "password", "database"):
            fh.write('%s: "%s"\n' % (k, cfg[k]))

    masked = dict(cfg)
    masked["password"] = "***" if cfg.get("password") else "(空)"
    print("已写入：" + os.path.relpath(OUT, REPO) + "（已 gitignore）")
    print("  实际配置：" + "，".join("%s=%s" % (k, masked[k]) for k in ("host", "port", "user", "password", "database")))
    print("  密码不回显 —— 这是刻意设计。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
