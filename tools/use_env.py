# -*- coding: utf-8 -*-
"""环境切换：测试环境 / 生产环境是**两个不同的小程序**，这套脚本负责把该带的参数带上。

为什么需要（2026/10/13）：
  · 框架里早有「appid 安全阀」（候选页按期望 appid 硬过滤，找不到就报错），
    但**从来没人在跑之前设过 `UITEST_APP_ID`** —— 于是每次跑都是"不校验、可能跑到别的小程序上"。
    这个脚本把它接上电：跑之前按环境把 appid 塞进环境变量。
  · 另一个好处是"跑的是哪个环境"变成**看得见**的东西：每跑一次都会打一行「本次环境：…」，
    不会出现"事后翻记录才发现跑错环境了"。

档案写在 `config/env.yaml`（入库，含 appid 但不含任何密码）。两个环境：
  · `test` —— 测试环境，appid 已知，是现在唯一真正能跑的环境；
  · `prod` —— 生产环境，**appid 还没补**。没补的这段时间选 prod 会直接停下：
    拿不到 appid 就没法保证没测到别的小程序上（安全阀宁可停，不要猜）。
    而且 prod 一律**不许写数据**：写开关会被强制关掉。

用法：
    python tools/use_env.py                 # 看当前环境 + 两个环境的参数
    python tools/use_env.py prod            # 把 current 切成 prod（写回 config/env.yaml）
    python tools/use_env.py --vars test     # 只打印该环境要设的环境变量（给脚本用）
退出码：0 = 正常；1 = 参数不对 / 环境档案有问题
"""

import io
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF = os.path.join(REPO, "config", "env.yaml")


class EnvError(Exception):
    """环境档案本身有问题（读不了/缺字段）—— 带上人话解释"""


def load(path=CONF):
    """读环境档案。**刻意手写一个极简 YAML 读取**：

    本仓的 Python 侧至今没有 YAML 依赖（`config/config.yaml` 也只被 base_config 简单读），
    为一个两环境的小档案引入 PyYAML 不值得（还要考虑 JS 侧能不能读）。
    格式限制在"两层缩进 + key: value"这几行里，够用且看得懂；写复杂了就该换库了。
    """
    if not os.path.exists(path):
        raise EnvError("找不到环境档案：%s\n    修法：从版本库恢复 config/env.yaml" % path)

    data = {"envs": {}}
    cur_env = None
    with io.open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line.strip() or line.strip().startswith("#"):
                continue
            indent = len(line) - len(line.lstrip(" "))
            key, _, val = line.strip().partition(":")
            val = val.strip().strip('"').strip("'")
            if indent == 0:
                if key == "envs":
                    cur_env = None
                    continue
                data[key] = val
            elif indent == 2 and not val:  # 形如 "  test:"
                cur_env = key
                data["envs"][cur_env] = {}
            elif indent == 4 and cur_env:
                data["envs"][cur_env][key] = val
            else:
                raise EnvError("config/env.yaml 第 %r 行看不懂（只支持两层缩进）：%s" % (line, line))
    return data


def resolve(profile_data, name):
    """挑出一个环境并检查它能不能跑。**纯函数**（便于离线自检）。

    @returns (profile_dict, error_message)；挑不出来时 profile 为 None
    错误分三种，都说清"为什么"和"怎么办"：
      1. 环境名不认识 -> 列出可选项（别让打错字变成"跑不起来"）
      2. 少了 appid   -> 这是安全阀：没有 appid 就不允许跑（尤其生产）
      3. 档案缺字段   -> 说明缺哪个
    """
    envs = (profile_data or {}).get("envs") or {}
    if not envs:
        return None, "环境档案里一个环境都没有（config/env.yaml 的 envs 下面应有 test / prod）"
    if name not in envs:
        return None, "没有叫「%s」的环境。可选：%s" % (name, "、".join(sorted(envs)))

    prof = dict(envs[name])
    prof["name"] = name
    if not prof.get("label"):
        return None, "环境「%s」没写 label（这是给人看的一句话，比如「测试环境 · 超云生态平台」）" % name
    if not prof.get("appid"):
        return None, (
            "环境「%s」没有 appid，**拒绝开跑**（%s）。\n"
            "    为什么：appid 是安全阀唯一的判据。拿不到它就无法排除"
            "「其实测到了另一个小程序上」——两个小程序可能同时被这台手机缓存（见 knowledge/环境与目标小程序.md）。\n"
            "    怎么办：把该小程序的 appid 填进 config/env.yaml 的 %s.appid；"
            "生产小程序的 appid 需要 owner 提供。" % (name, prof.get("label"), name)
        )
    return prof, ""


def env_vars_for(prof):
    """这个环境该设哪些环境变量（**纯函数**）。返回值里 None 表示"要清掉这个变量" """
    out = {
        "UITEST_ENV": prof["name"],
        "UITEST_APP_ID": prof["appid"],
    }
    out["UITEST_DB_CONFIG"] = prof.get("db_config") or None
    if not prof.get("allow_write"):
        # 生产：把写开关**强制清掉**（不是"提醒一下"，是清掉）
        out["UITEST_ALLOW_SUBMIT"] = None
    return out


def apply(prof, os_environ=os.environ):
    """把环境变量设进当前进程；值为 None 的删掉。@returns 实际设了什么（给人看/给自检用）"""
    done = {}
    for key, val in env_vars_for(prof).items():
        if val is None:
            if key in os_environ:
                del os_environ[key]
                done[key] = "(已清掉)"
            continue
        os_environ[key] = val
        done[key] = val
    return done


def banner(prof):
    """每跑一次都要打的那行 —— "跑的是哪个环境"必须是看得见的"""
    warn = ""
    if not prof.get("allow_write"):
        warn = "  ⚠️ 这套环境下写开关会被强制关掉"
    return "本次环境：%s（appid %s）%s" % (prof.get("label"), prof.get("appid"), warn)


def switch(name, path=CONF):
    """把 current 改写成 name（**保留注释**：只动 current 那一行）"""
    with io.open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    done = False
    for i, line in enumerate(lines):
        if line.strip().startswith("current:"):
            lines[i] = "current: %s\n" % name
            done = True
            break
    if not done:
        raise EnvError("config/env.yaml 里找不到 current: 这一行")
    with io.open(path, "w", encoding="utf-8", newline="") as fh:
        fh.writelines(lines)


def main(argv):
    if "--vars" in argv:
        i = argv.index("--vars")
        name = argv[i + 1] if len(argv) > i + 1 else ""
        prof, err = resolve(load(), name)
        if err:
            print(err)
            return 1
        for key, val in env_vars_for(prof).items():
            print("%s=%s" % (key, "" if val is None else val))
        return 0

    data = load()
    if argv:
        name = argv[0]
        prof, err = resolve(data, name)
        if err:
            print(err)
            return 1
        switch(name)
        print("已切换到环境：%s" % name)

    data = load()
    current = data.get("current", "")
    print("当前环境：%s\n" % (current or "(没写 current)"))
    for name in sorted(data.get("envs", {})):
        prof, err = resolve(data, name)
        mark = "← 当前" if name == current else ""
        if err:
            print("  【%s】%s  ⚠️ 不能跑 %s" % (name, (data["envs"][name].get("label") or "?"), mark))
            print("        %s" % err.splitlines()[0])
            continue
        print("  【%s】%s  appid=%s  %s" % (name, prof["label"], prof["appid"], mark))
    print("\n跑测试：python run.py    （临时换环境：python run.py --env prod）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
