# 小程序自动化测试框架

用 pytest 调度的微信小程序 UI 自动化测试框架 —— 真机驱动、Node.js 写用例、Playwright 操作元素。

> 新人请从第二节「5 分钟上手」开始读，读完就能跑起第一条用例。

---

## 一、这套框架是什么

一句话：**pytest 当调度器 + Playwright 的 Android 实验性 API 当驱动 + Node.js 写用例**。

- 不用 Appium
- 不用微信开发者工具
- 直接连接**真机上的微信**，抓取小程序 WebView 的 `Page` 对象，然后用标准 Playwright 的 DOM 定位能力操作小程序元素

### 三层架构

| 层 | 位置 | 职责 | 改动频率 |
|---|---|---|---|
| 用例层 | `test_case/suprecast_app/test_*.js` | 描述「测什么」：把操作函数按顺序排好 | 最常改 |
| 关键字层 | `app_sub_function/suprecast_app/android.js` | 提供「怎么操作」：点击、输入、滑动、找前台页 | 常改 |
| 驱动层 | `common/app_common.js` | 「连接与执行」：连设备、抓 WebView、跑步骤、截图 | 少改 |

设计原则：**用例层只描述业务步骤，不出现任何 `page.locator(...)` 之类的定位细节**。定位细节全部下沉到关键字层。这样小程序改版时，你只需要改关键字层一个地方。

---

## 二、5 分钟上手

### 第 1 步：确认环境

```powershell
node -v          # 需要 Node.js（本机实测 v24.19.0）
python -V        # 需要 Python 3.11+（本机实测 3.11.9）
adb devices      # 必须能看到设备，状态是 device 而不是 unauthorized
```

`adb devices` 看不到设备时：检查手机已开「USB 调试」、数据线支持传输（不是只能充电的线）、电脑装了手机驱动。

### 第 2 步：装依赖

```powershell
# Node 依赖（只有一个 playwright）
npm install

# Python 依赖
pip install -r requirements.txt
```

### 第 3 步：准备被测现场（最容易忘，也最容易失败）

**框架不会帮你打开小程序。** 执行前必须手动在手机上把微信小程序停到用例的起始页面。

比如跑 `test_example.js`（搜索用例），你需要手动：
1. 打开微信
2. 进入目标小程序
3. 切到「有问必答」页（因为这个页面才有 `.search-container` 搜索栏）

否则用例会报 `没有 page 含搜索栏 .search-container，请先切到有问必答页`。

### 第 4 步：先做「只收集不执行」的干跑

```powershell
cd test_case
python -m pytest --collect-only -v
```

期望输出：

```
collected 1 item
<Package test_case>
  <Dir suprecast_app>
    <JsTestFile test_example.js>
      <JsTestItem test_example.js>
```

看到这个说明**收集链路正常**，还不用连手机。这一步是排查问题的第一道分界线：
- **收集不到** → 问题在 `conftest.py` / `pytest.ini`（配置问题）
- **收集到但执行失败** → 问题在设备、小程序现场、或元素定位

### 第 5 步：真正执行

```powershell
cd test_case
python -m pytest -v
```

### 第 6 步：看结果

- **控制台**：pytest 会把 JS 里的 `console.log` 打印出来
- **截图**：`report/photo_app/{用例文件}_{用例函数}/_{步骤名}_{时间戳}.png`
- **HTML 报告**：`pytest.ini` 里配了 `--self-contained-html`，加 `--html=report/result.html` 可生成单文件报告

---

## 三、一次用例的完整执行链路

```text
① 命令行：pytest（在 test_case/ 目录下）
        │  pytest 启动，读取 pytest.ini
        ▼
② conftest.py 的 pytest_collect_file 钩子
   · 发现 test_*.js → 包成 JsTestFile / JsTestItem
   · 关键点：pytest 原生不认识 .js，是靠这个钩子"骗"它收集的
        │
        ▼
③ JsTestItem.runtest()
   · shutil.which("node") 找到 node 可执行文件
   · subprocess.run([node, 用例.js], capture_output=True)
   · 子进程 exit code != 0 → 抛 JsTestFailure → pytest 标记为 FAILED
        │
        ▼
④ test_example.js 里的 async IIFE 开始跑
   · 组装 funcList = [[操作函数, 参数字典], ...]
        │
        ▼
⑤ appTest(funcList, { photosPath })
   ├─ android.devices()            连设备（Playwright 的 _android API）
   ├─ getWxWebviewPage(device)     遍历 device.webViews()，挑 url 含 servicewechat.com 的那个
   │     ├─ waitForLoadState("domcontentloaded")
   │     └─ waitForFunction(clientWidth > 10)   等视口就绪
   ├─ getCaller()                  反射调用栈，拿到"哪个文件哪个函数"用于截图命名
   └─ runAppSteps(page, funcList, photosPath, caller)
        └─ for [func, kwargs] of funcList:
             ├─ kwargs 为空 → func(page)
             ├─ 否则        → func(page, kwargs)
             ├─ 每步截图到 report/photo_app/<文件>_<函数>/_<步骤>_<时间戳>.png
             ├─ 每步计时，最后打印耗时统计
             └─ 步骤抛错 → 先存起来(savedError) → 截图 → 再抛出
        │
        ▼
⑥ 每个业务函数内部
   · 定位：page.locator("#id") / page.getByText("文本")
   · 点击：真实 adb tap（见第四节要点 1）
   · return page（链式传递，page 可能被替换成前台页）
```

### 小白术语对照表

| 术语 | 人话解释 |
|---|---|
| `pytest` | Python 的测试运行器。负责发现用例、执行、统计通过/失败、出报告 |
| `conftest.py` | pytest 的「插件约定文件」。放在目录里，pytest 会自动加载，里面的钩子函数会被调用 |
| 钩子（hook） | pytest 在特定时机主动回调你的函数。如 `pytest_collect_file` 在「收集用例文件」时被调用 |
| `subprocess.run` | Python 启动一个外部程序（这里是 node）并等它跑完 |
| `Page` | Playwright 里代表一个网页/WebView。所有定位、点击、输入都通过它 |
| `locator` | 定位器，「怎么找到这个元素」的描述。如 `page.locator("#submit")` |
| `async / await` | 异步写法。等待一个耗时操作完成，不阻塞其他事。框架里几乎每个操作都要 `await` |
| `funcList` | 本框架的步骤清单，一个数组，每项是 `[函数, 参数字典或 null]` |
| `exit code` | 程序退出码。`0` 表示成功，非 `0` 表示失败。pytest 靠它判定 JS 用例成败 |

---

## 四、五条必须理解的设计经验

这五条是框架里最值钱的部分，理解了它们，你就知道**为什么代码要这么写**，也能少踩 80% 的坑。

### 要点 1：小程序视图层不响应「合成事件」→ 必须真实 tap

在 `app_sub_function/suprecast_app/android.js` 的 `tapElement` 函数注释里写着：

> 小程序视图层只响应真实触摸事件，Playwright 合成的鼠标事件点了没反应。

**什么叫合成事件？** 你用代码「模拟」出来的点击。浏览器里这样点通常有效，但小程序的 `wx-view` 组件不认。

**解决办法**：绕开浏览器，直接让手机系统在指定坐标点一下。流程是四步：

```js
locator.boundingBox()                // 1. 取元素在页面里的坐标
page.evaluate(() => window.devicePixelRatio)   // 2. 取缩放比（页面坐标 → 物理像素的倍数）
坐标 × dpr                            // 3. 换算成手机屏幕的物理坐标
device.shell("input tap x y")        // 4. 通过 adb 让系统真实点一下
```

**写用例时的判断准则**：如果某个元素 `locator.click()` 点了没反应，就换成走 `tapElement` 这条路线。

### 要点 2：同一时刻有多个 Page，必须动态找「前台页」

小程序在同一个浏览器 context 下**并存多个视图层 page**：首页、我的、弹窗页、预加载页……

**切换页面后，你手里的 `page` 会变成后台页，再操作它会一直等到超时。**

框架给了两种找前台页的思路：

| 函数 | 思路 | 适用场景 |
|---|---|---|
| `getForegroundPage(page)` | 谁是前台？**看谁还在产生动画帧** | 首选，通用 |
| `findPageWith(page, selector)` | 谁含有目标选择器，谁就是目标页 | 已知目标页有独特元素时 |

`getForegroundPage` 的原理很巧妙：

- 后台页对应的原生 WebView 已被系统**挂起**，渲染线程不再产出画面，所以 `requestAnimationFrame` 不会触发
- 于是往每个 page 里注入一段探针，等一帧（默认 500ms），**能等到帧的那个就是前台页**

⚠️ 代码注释特别警告：**不能用 `locator.isVisible()` 判断**。因为后台页里的元素，`isVisible()` 同样返回 `true`，区分不出来。

**由此推出两条写业务函数的铁律**：

1. 切换页面后要重新取：`page = await getForegroundPage(page)`
2. **必须 `return page`**，否则调用链上后面的步骤还拿着旧的 page

### 要点 3：输入文字前必须等软键盘真的弹出来

框架里有 `waitImeShown(device, page)`，它轮询 `adb shell dumpsys input_method`，检查输出里有没有 `mInputShown=true`。

**为什么必须等？** 输入框没真正拿到焦点时，`adb shell input text` 发过去的按键事件会被系统**丢弃**。

最可怕的是：**它不报错，但字没输进去**。用例看起来「跑完了」，实际什么都没测到 —— 这是最隐蔽的假通过。

所以框架宁可先花几百毫秒等键盘弹出，也不冒这个风险。

### 要点 4：`funcList` 传的是函数引用，不是函数名字符串

```js
const funcList = [
  [focusSearchInput, null],        // ✅ 对：函数引用
  ["focusSearchInput", null],      // ❌ 错：字符串
];
```

**为什么？** 因为 `runAppSteps` 靠 `func.name` 这个属性来打日志、算耗时、命名截图文件。字符串没法调用，而**匿名函数没有有意义的 name**。

**所以业务函数必须写成具名函数声明**：

```js
async function myStep(page, { text }) { ... }   // ✅ name 是 "myStep"
const myStep = async (page) => { ... }          // ⚠️ name 可能是 "myStep"，但用箭头函数容易踩坑
```

### 要点 5：失败也一定留证据

`runAppSteps` 里的 `finally` 块保证了一件事：**即使步骤执行失败，也要先把当前画面截下来，再抛异常**。

```js
} catch (e) {
  savedError = e;              // 先把错误存起来，不立刻抛
} finally {
  if (photoPath) {
    await page.screenshot(...); // 先截图，留下失败现场
  }
  if (savedError) throw savedError;   // 再抛出，让 pytest 标记失败
}
```

这样任何一次失败，`report/photo_app/` 里都有一张「出事那一刻」的截图，而不是只有一行报错文本。

---

## 五、怎么新增一条用例

### 极简骨架（照抄即可）

```js
const path = require("path");
const { appTest } = require("../../common/app_common");
const { login, clickElementByText } = require("../../app_sub_function/suprecast_app/android");

(async () => {
  const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
  const funcList = [
    [login, null],
    [clickElementByText, { text: "有问必答" }],
  ];
  await appTest(funcList, { photosPath });
  console.log("用例执行完成");
})().catch((e) => {
  console.error(e);
  process.exit(1);     // 关键：必须让 exit code 非 0，pytest 才知道失败了
});
```

**四个要素**：
1. `require` 驱动层 + 需要的业务函数
2. `photosPath` 指向 `report/photo_app`
3. `funcList` 步骤数组
4. `appTest(...)` + **结尾必须 `.catch(... process.exit(1))`**

### 文件放哪、怎么命名

- 目录：`test_case/suprecast_app/`
- 文件名：**必须以 `test_` 开头，后缀必须是 `.js`**
  - 这是 `conftest.py` 里 `file_path.name.startswith("test_")` 的判断条件
  - 叫 `search.js` 不会被收集，必须叫 `test_search.js`

### 怎么加一个新的操作函数

在 `app_sub_function/suprecast_app/android.js` 里：

```js
/**
 * 函数说明（写清楚参数含义，方便别人和你自己以后看）
 * @param {import('playwright').Page} page 小程序 webview 页面
 * @param {{text: string, timeout?: number}} params 参数字典
 * @returns {Promise<import('playwright').Page>} page
 */
async function 你的函数名(page, { text, timeout = 10000 } = {}) {
  try {
    // 操作逻辑
    return page;          // 必须返回 page
  } catch (e) {
    console.error(`操作失败 [${text}]: ${e.message}`);
    throw e;              // 必须往上抛，runAppSteps 才能记录并截图
  }
}
```

最后在文件底部的 `module.exports = { ... }` 里**加上你的函数名**，否则用例 `require` 不到它。

### 什么时候该抽成公共函数

如果你的用例里出现这段逻辑第 3 次，就该把它抽到 `android.js` 里。判断标准：**换一个小程序版本，这段逻辑会不会变？** 会变，就抽出去。

---

## 六、截图与产物

### 截图路径规则

```text
report/photo_app/{调用者文件名}_{调用者函数名}/_{步骤函数名}_{MMDD_HHMMSS}.png
```

举例：

```text
report/photo_app/test_example_anonymous/_focusSearchInput_1009_173114.png
               └─ 用例文件       └─ 函数名   └─ 步骤函数名      └─ 10月09日 17:31:14
```

`anonymous` 是因为当前示例用的是匿名 IIFE，拿不到有意义的函数名 —— 这正好印证了要点 4。

「调用者」信息由 `getCaller()` 从 `Error().stack`（JS 的调用栈）里取第 4 帧获得，等价于 Python 的 `inspect.stack()[1]`。

### 时间戳格式

`MMDD_HHMMSS`，由 `timestamp()` 函数生成。同一秒内多次截图会覆盖，写高频用例时要注意。

---

## 七、常见问题排查

### 收集不到用例

**现象**：`collected 0 items`

**排查清单**：
1. 文件名是不是 `test_` 开头、`.js` 结尾？
2. 是不是在 `test_case/` 目录下执行的 pytest？（`pytest.ini` 里 `testpaths = ./`）
3. `conftest.py` 是不是和用例在同一个目录？

### `找不到前台小程序webview`

**原因**：微信没打开小程序，或者小程序在后台。

**解决**：手动把小程序切到前台，停在起始页面。

### `没有 page 含搜索栏 .search-container，请先切到有问必答页`

**原因**：小程序没停在「有问必答」页。

**解决**：手动切过去。这是框架当前的设计限制 —— 它不负责导航到起始页。

### 点击了但没反应

**原因**：用 `locator.click()` 点了 `wx-view` 类型的元素。

**解决**：改用真实 tap 路线（见第四节要点 1）。

### 输入了文字但没进去，还不报错

**原因**：输入框没拿到焦点，adb 事件被丢弃（见第四节要点 3）。

**解决**：先调 `waitImeShown`，或先 `tapElement` 点一下输入框。

### 操作某个元素一直超时

**原因**：页面切换了，你手里的 `page` 已是后台页。

**解决**：操作前 `page = await getForegroundPage(page)`。

### 换了台电脑/手机就跑不起来

**原因**：设备序列号在代码里硬编码了（详见第八节 P0 问题）。

**临时解决**：改 `common/app_common.js` 顶部的 `DEFAULT_DEVICE_SERIAL`。

---

## 八、当前已知问题与优化路线

按优先级排列，这是我们后续一起动手的清单。

### P0 · 必须优先修

| 问题 | 位置 | 影响 |
|---|---|---|
| 设备序列号硬编码，且 `options.deviceSerial` 传参无效 | `common/app_common.js:20` 和 `:206` | 换设备就挂，只能靠 `\|\| devices[0]` 兜底 |
| `pkg` / `webviewTimeout` 参数定义了从未使用 | `common/app_common.js:193` | 传参无效果，超时时间硬编码 5000ms |
| `common/__init__.py` 导入不存在的模块，`import common` 直接报错 | `common/__init__.py:9-14` | Python 侧能力完全没接通 |
| `config/config.yaml` 不存在 | `common/share/base_config.py:35` | 配置管理类无法工作 |

### P1 · 结构缺失

- **没有断言层**：目前唯一的校验是 `assertElementExists`，失败全靠 Playwright 超时抛错。缺少「期望值 vs 实际值」的可读对比
- **没有页面对象（Page Object）**：`"我的"`、`"4148"` 这类选择器和测试数据硬编码在函数里，小程序改版要全局搜替换
- **步骤失败会跳出整个循环**：`runAppSteps` 里 `throw savedError` 会让后续步骤不再执行

### P2 · 工程化

- ~~无根 `.gitignore`~~ ✅ 已补
- ~~无 README~~ ✅ 已补
- `pytest.ini` 注释写「重试 2 次」，配置却是 `reruns = 1`，注释与实现不一致
- 无 marker（`P0`~`P3`）使用示例：`pytest.ini` 已注册 marker，但 JS 用例里没法直接打 marker
- 无公共前置步骤：每个 JS 文件都要自己连设备、自己回到起点页
- `addopts` 里的 `-p pytest_asyncio` 对纯 JS 用例无意义

### 建议的推进顺序

1. **补文档与工程基础**（本次已完成）
2. **修 P0 缺陷**：设备序列号配置化、参数接通
3. **搭断言层 + 页面对象**
4. **打通 Python 侧**：实现 `sc_config` / `sc_log`，让配置和日志真正驱动 JS 用例
5. **抽公共前置步骤**：让用例只写业务差异部分

---

## 九、目录结构说明

```text
miniapp_test_case/
├── README.md                        # 【本文件】项目总览与新人上手
├── .gitignore                       # Git 忽略规则
├── package.json                     # Node 依赖（只有 playwright）
├── requirements.txt                 # Python 依赖
├── docs/
│   └── 框架导读.md                   # 深度导读（含设计原理、自测题）
├── common/
│   ├── __init__.py                  # ⚠️ 导入不存在的模块，待修
│   ├── app_common.js                # ★ 驱动层核心
│   └── share/
│       ├── base_config.py           # 配置基础类（单例 + 懒加载 + 热重载）
│       ├── base_log.py              # 日志基础类（单例 + 双通道 + 按天轮转）
│       └── README.md                # 公共模块说明
├── app_sub_function/                # 关键字层
│   └── suprecast_app/
│       └── android.js               # ★ 所有可复用操作 + 元素选择器常量
├── test_case/                       # 用例层
│   ├── pytest.ini                   # pytest 配置
│   └── suprecast_app/
│       ├── conftest.py              # ★ 桥接层：让 pytest 能执行 .js
│       └── test_example.js          # 用例示例
└── report/
    └── photo_app/                   # 截图产物
```

---

## 十、环境版本参考

| 组件 | 本机实测版本 | 要求 |
|---|---|---|
| Node.js | v24.19.0 | 支持 `_android` API 的版本 |
| npm | 11.17.0 | — |
| Python | 3.11.9 | 3.11+ |
| pytest | 9.0.2 | — |
| Playwright (Node) | ^1.64.0 | — |
| 数据库/其他 | 见 `requirements.txt` | `pymysql`、`celery`、`Redis` 等为预留能力，当前框架未使用 |

### 手机端要求

- 已开启「USB 调试」
- `adb devices` 状态为 `device`
- 微信已登录，且已手动打开目标小程序并停在起始页
