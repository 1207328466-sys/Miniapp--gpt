# -*- coding: utf-8 -*-
"""框架不变式检查（**离线**，不需要手机）：盯住几处「一旦坏了就静默出错」的约定。

为什么单独一道：`check-safety.py` 管「数据/凭据安全」，这里管**框架自身的完整性** ——
下面每一条坏掉时都不会报错，只会以某种难看的方式表现出来：

  1. **表格动作 ↔ JS 实现必须一一对应**：清单里有、实现里没有 -> 只会在真机跑到那一步才炸
     （原本靠 `test_from_table.js` 的 `checkActionList` 兜，那也得先连上手机）。
  2. **每个 .js 用例都要有 `meta.title`**：没有就退回英文文件名（owner 提过「英文看不懂」）。
  3. **每个 .js 用例都要有 `process.exit(1)` 兜底**：删了它，用例**永远通过**（假绿）。
  4. **appid 安全阀的硬校验还在**：少了它，两个小程序同时被缓存时可能静默测到生产上。
  5. **文档里写的动作数量与实际一致**：烂掉的数字比没有数字更误导。

用法：python scripts/check-invariants.py
退出码：0 = 全部通过；1 = 有违反
"""

import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'tools'))

import export_cases as m  # noqa: E402

TABLE_DRIVER = 'test_from_table.js'  # 表格用例的驱动：标题是动态拼的，不要求字面量

failures = []
passed = 0


def check(name, ok, detail=''):
    global passed
    if ok:
        passed += 1
        print('OK   %s' % name)
    else:
        failures.append('%s（%s）' % (name, detail))
        print('FAIL %s（%s）' % (name, detail))


def read(rel):
    with open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return f.read()


# ---------- 1) 表格动作 ↔ JS 实现 ----------
table_js = read('test_case/suprecast_app/test_from_table.js')
block = table_js.split('const HANDLERS = {', 1)[1].rsplit('};', 1)[0]
implemented = set(re.findall(r'(?m)^  ([^\s:{}]+):\s*\{', block))
declared = {a['name'] for a in m.ACTIONS}
missing_impl = sorted(declared - implemented)
extra_impl = sorted(implemented - declared)
check('表格动作在 JS 里都有实现', not missing_impl, '缺实现：%s' % '、'.join(missing_impl))
check('JS 实现都在动作清单里', not extra_impl, '多出来：%s' % '、'.join(extra_impl))

# ---------- 2) 每个 .js 用例都有 meta.title 与 exit(1) 兜底 ----------
case_dir = os.path.join(REPO, 'test_case') + os.sep + 'suprecast_app'
no_title = []
no_exit = []
for name in sorted(os.listdir(case_dir)):
    if not (name.startswith('test_') and name.endswith('.js')) or name == TABLE_DRIVER:
        continue
    text = read('test_case/suprecast_app/' + name)
    if not re.search(r'title:\s*"([^"]+)"', text):
        no_title.append(name)
    if 'process.exit(1)' not in text:
        no_exit.append(name)
check('每个 .js 用例都有中文 meta.title', not no_title, '缺：%s' % '、'.join(no_title))
check('每个 .js 用例都有 process.exit(1) 兜底', not no_exit, '缺：%s' % '、'.join(no_exit))

# ---------- 3) appid 安全阀的硬校验还在 ----------
app_common = read('common/app_common.js')
check(
    'appid 安全阀：候选页按期望 appid 硬过滤',
    'appIdOf(p.url()) === expected' in app_common,
    '找不到按 expected appid 过滤候选页的代码',
)
check(
    'appid 安全阀：找不到时报错而不是退回推断',
    '安全阀拦截' in app_common,
    '找不到这段报错文案',
)

# ---------- 4) 文档里的动作数量与实际一致 ----------
n = len(m.ACTIONS)
docs = ['README.md', 'docs/使用手册-零基础.md', 'knowledge/可自动化需求清单.md']
bad_docs = []
for rel in docs:
    for num in re.findall(r'(\d+)\s*个动作', read(rel)):
        if int(num) != n:
            bad_docs.append('%s 写着 %s 个' % (rel, num))
check('文档里的动作数量与实际一致（%d 个）' % n, not bad_docs, '；'.join(bad_docs))

# ---------- 5) 写链路的"自证"：有开关就必须有复位 ----------
# 为什么盯这条：写数据的用例**必须**跑完把自己造的记录清掉。
# 如果以后有人照抄写链路用例、只留了开关却把复位那步删了，数据就会被留在库里
# —— 而且用例本身还是"绿的"，没有任何报错。这种"静默把库弄脏"必须由闸门挡住。
from pathlib import Path as _Path  # noqa: E402

WRITE_CASE_DIR = _Path(REPO) / 'test_case' / 'suprecast_app'
no_reset = []
for p in sorted(WRITE_CASE_DIR.glob('test_*.js')):
    if p.name == TABLE_DRIVER:
        continue
    text = read('test_case/suprecast_app/' + p.name)
    if 'UITEST_ALLOW_SUBMIT' not in text:
        continue  # 只读用例，不涉及复位
    # ⚠️ 判据要按**两种复位机制的真实痕迹**来（两次反向验证各抓到一次错）：
    #   ①「案例复制」用 `--reset` + 水位（case_copy_reset.py）
    #   ②「答题」用 `--yes` 直接删（quiz_data_cleanup.py，没有 --reset 这种参数）
    # 所以认"Do 调过数据工具"这件事本身：`--reset` 或 `runDbTool(`。
    # 最早写成"含「复位」两个字"—— 注释里写「复位」就能骗过它（判据太松，等于没查）。
    has_reset = ('--reset' in text) or ('runDbTool(' in text) or ('.reset(' in text)
    if not has_reset:
        no_reset.append(p.name)
check('写链路用例都带复位（有开关就必须有复位）', not no_reset, '缺复位：%s' % '、'.join(no_reset))

case_copy = read('app_sub_function/suprecast_app/case_copy.js')
check(
    '表格动作「复制当前案例」的一条龙里含复位',
    '--reset' in case_copy,
    'case_copy.js 里看不到 --reset —— 复制动作会把数据留在库里',
)

print()
if failures:
    print('有 %d 项不通过：' % len(failures))
    for f in failures:
        print('  · %s' % f)
    sys.exit(1)
print('全部通过（%d 项）' % passed)
