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
  6. **写链路的 .js 用例都要带复位**：只写不复位，跑一次就把真实数据留在库里。
  7. **README 里"照抄即可"的代码，引用的函数必须真实存在**：能照抄的代码是文档里
     最容易过期的一段（2026/10/13 真踩到：骨架指着两个早被删掉的函数）。

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

# ---------- 4b) 每个动作都归类了（表格下拉框的顺序 / 动作文档的分组都靠它）----------
# 为什么盯这条：ACTION_GROUPS 是"给人看的顺序"的唯一来源。漏一个动作不会报错，
# 只会让它**悄悄掉到下拉框最后**，还标着「（还没归类）」—— 那种东西没人会去看。
_grouped = [name for _t, _note, names in m.ACTION_GROUPS for name in names]
_dup = sorted({x for x in _grouped if _grouped.count(x) > 1})
_declared = {a['name'] for a in m.ACTIONS}
check(
    '每个动作都在 ACTION_GROUPS 里（不漏不重）',
    not _dup and not (_declared - set(_grouped)) and not (set(_grouped) - _declared),
    '重复：%s；没归类：%s；名字对不上：%s'
    % ('、'.join(_dup) or '无',
       '、'.join(sorted(_declared - set(_grouped))) or '无',
       '、'.join(sorted(set(_grouped) - _declared)) or '无'),
)

# ---------- 4c) 每个动作都有「怎么填（示例）」，而且示例跟候选项对得上 ----------
# 为什么盯这条：示例是照着抄的东西 —— 漏一个只是那一格显示「（还没写示例）」没人管；
# 而示例和下拉框不一致更坏：照抄的人会被导出/真机报错挡住（示例自己就是错的）。
_no_example = sorted(a['name'] for a in m.ACTIONS if not m.ACTION_EXAMPLES.get(a['name']))
check('每个动作都有「怎么填（示例）」', not _no_example, '缺示例：%s' % '、'.join(_no_example))

_bad_examples = []
for _a in m.ACTIONS:
    _ex = str(m.ACTION_EXAMPLES.get(_a['name'], ''))
    for _param, _vals in (m.ACTION_PARAM_CHOICES.get(_a['name'], {}) or {}).items():
        if _vals and not any(str(v) in _ex for v in _vals):
            _bad_examples.append('%s（示例里没有 %s 的候选值：%s）' % (_a['name'], _param, '/'.join(_vals)))
check(
    '示例里出现的值都在该动作的候选项里（照抄不会报错）',
    not _bad_examples,
    '；'.join(_bad_examples),
)

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


# ---------- README 里"照抄即可"的骨架：引用的函数必须真实存在 ----------
# 起因（2026/10/13）：README 的极简骨架写着 login / clickElementByText，而这两个函数
# 早在"框架瘦身"那轮就被当死代码删掉了 —— 照抄的人第一行就报 `login is not a function`，
# 还会以为是自己的环境问题。**能照抄的代码，是文档里最容易过期的一段**，所以盯住它。
def _exported_names(js_text):
    """抠出 `module.exports = { ... }` 里的名字（按行拆，够用且不引依赖）"""
    names = set()
    for blk in re.findall(r'module\.exports\s*=\s*\{(.*?)\n\}', js_text, re.S):
        flat = blk.replace('\n', ' ')
        for item in flat.split(','):
            item = item.strip()
            if item:
                names.add(item.split(':')[0].strip())
    return names


readme = read('README.md')
android_exports = _exported_names(read('app_sub_function/suprecast_app/android.js'))

bad_android = []
for destructured in re.findall(r'const\s*\{([^}]*)\}\s*=\s*require\([^)]*android[^)]*\)', readme):
    for name in [n.strip() for n in destructured.split(',') if n.strip()]:
        if name not in android_exports:
            bad_android.append(name)
check(
    'README 骨架里 require 的 android.js 函数都还在',
    not bad_android,
    'android.js 里没有：%s（照抄的人会直接报错）' % '、'.join(bad_android),
)

pages_index = read('app_sub_function/suprecast_app/pages/index.js')
page_map = dict(re.findall(r'(\w+)\s*:\s*require\("\./(\w+)"\)', pages_index))
bad_pages = []
for key, fn in sorted(set(re.findall(r'pages\.(\w+)\.(\w+)', readme))):
    if key not in page_map:
        bad_pages.append('入口里没有 %s' % key)
        continue
    if fn not in _exported_names(read('app_sub_function/suprecast_app/pages/%s.js' % page_map[key])):
        bad_pages.append('%s.js 里没有 %s' % (page_map[key], fn))
check(
    'README 骨架里调的页面对象函数都还在',
    not bad_pages,
    '；'.join(bad_pages),
)

print()
if failures:
    print('有 %d 项不通过：' % len(failures))
    for f in failures:
        print('  · %s' % f)
    sys.exit(1)
print('全部通过（%d 项）' % passed)
