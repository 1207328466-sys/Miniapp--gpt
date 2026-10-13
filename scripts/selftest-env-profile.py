# -*- coding: utf-8 -*-
"""环境档案（`config/env.yaml`）的自检（**离线**，不需要手机）。

盯住三件"坏了也不报错"的事：
  1. 挑了不存在的环境 -> 必须**列出可选环境名**（不能让打错字表现成"跑不起来"）；
  2. 环境缺 appid（就是生产现在的情况）-> 必须**拒绝开跑**并说清怎么办 ——
     这是安全阀的判据：拿不到 appid 就排除不了"其实跑到了另一个小程序上"；
  3. 环境不许写数据 -> 写开关必须被**真的清掉**（不是打印一句提醒了事）。
第 3 条尤其要测"本来设了开关"的情况：那才是它有意义的时候。

用法：python scripts/selftest-env-profile.py
退出码：0 = 全部符合预期；1 = 有不符合的
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

import use_env as e  # noqa: E402

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


# ---------- 1) 仓库里真实的那份档案：测试环境必须能跑 ----------
real = e.load()
prof, err = e.resolve(real, "test")
check("真实档案里的 test 环境能跑（appid 非空）", prof is not None and not err, err or "拿到 %s" % prof)
if prof:
    check(
        "test 环境就是 knowledge 里记的那个 appid",
        prof["appid"] == "wx3de2e1d179b60303",
        "档案里是 %s" % prof["appid"],
    )

# ---------- 2) 生产环境：现在没 appid，必须拒绝开跑 ----------
prof_prod, err_prod = e.resolve(real, "prod")
check(
    "prod 没填 appid 时拒绝开跑（安全阀）",
    prof_prod is None and "没有 appid" in err_prod,
    "实际：prof=%s err=%s" % (prof_prod, err_prod),
)
check(
    "拒绝的说明里要写清「怎么办」（去哪填）",
    "config/env.yaml" in err_prod and "owner" in err_prod,
    err_prod,
)

# ---------- 3) 环境名打错：必须列出可选项 ----------
_p, err_name = e.resolve(real, "tesst")
check(
    "环境名写错时列出可选环境（不许只说「不存在」）",
    "test" in err_name and "prod" in err_name,
    err_name,
)

# ---------- 4) 生产环境：写开关必须被清掉 ----------
sample = {
    "envs": {
        "prod_ok": {"label": "假的生产", "appid": "wx0000000000000000", "db_config": "", "allow_write": False},
        "test_ok": {"label": "假的测试", "appid": "wx1111111111111111", "db_config": "config/db.local.yaml", "allow_write": True},
    }
}
prof_prod2, err2 = e.resolve(sample, "prod_ok")
check("填了 appid 的只读环境能跑", prof_prod2 is not None and not err2, err2)

fake_environ = {"UITEST_ALLOW_SUBMIT": "1", "PATH": "x"}
done = e.apply(prof_prod2, fake_environ)
check(
    "只读环境：本来设了写开关也会被清掉",
    "UITEST_ALLOW_SUBMIT" not in fake_environ and done.get("UITEST_ALLOW_SUBMIT") == "(已清掉)",
    "environ=%s done=%s" % (fake_environ, done),
)
check(
    "只读环境：appid 与环境名照样设上（安全阀通电）",
    fake_environ.get("UITEST_APP_ID") == "wx0000000000000000" and fake_environ.get("UITEST_ENV") == "prod_ok",
    "environ=%s" % fake_environ,
)

# ---------- 5) 可写环境：写开关不由这里打开（要人显式设） ----------
fake_environ2 = {"PATH": "x"}
done2 = e.apply(prof_test_ok := e.resolve(sample, "test_ok")[0], fake_environ2)
check(
    "可写环境不会「顺手」打开写开关（写数据必须是人显式决定）",
    "UITEST_ALLOW_SUBMIT" not in fake_environ2,
    "environ=%s" % fake_environ2,
)
# ---------- 5b) 库配置必须是**绝对路径**（真踩过：相对路径在 test_case/ 下找不到）----------
# 现象：pytest 会把工作目录切到 test_case/，档案里写 `config/db.local.yaml` 到那边就是"文件不存在"，
# 于是所有用数据库的动作一起失败，报错只说"读配置失败"，很难看出是路径问题。
db_path = fake_environ2.get("UITEST_DB_CONFIG") or ""
check(
    "可写环境的库配置被解析成绝对路径（pytest 会把工作目录切到 test_case/）",
    os.path.isabs(db_path) and db_path.replace("\\", "/").endswith("config/db.local.yaml"),
    "拿到的是 %r" % db_path,
)
check(
    "解析出来的库配置真的存在",
    os.path.exists(db_path),
    "%s 不存在" % db_path,
)
_prof_empty, _err_empty = e.resolve(
    {"envs": {"x": {"label": "没有库配置", "appid": "wx2", "db_config": ""}}}, "x"
)
check(
    "档案不写库配置时：环境变量留空（而不是塞个空串进去）",
    e.env_vars_for(_prof_empty).get("UITEST_DB_CONFIG") is None,
    "%s" % e.env_vars_for(_prof_empty),
)

# ---------- 6) 档案缺字段：报出来，别静默 ----------
_p, err_no_label = e.resolve({"envs": {"x": {"appid": "wx1"}}}, "x")
check("环境缺 label 会报出来", _p is None and "label" in err_no_label, err_no_label)
_p, err_empty = e.resolve({"envs": {}}, "test")
check("档案里一个环境都没有会报出来", _p is None and "一个环境都没有" in err_empty, err_empty)

print()
if failed:
    print("有 %d 项不符合预期：" % len(failed))
    for f in failed:
        print("  · %s" % f)
    sys.exit(1)
print("全部通过（%d 项）" % passed)
