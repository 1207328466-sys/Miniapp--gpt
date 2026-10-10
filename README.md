# 小程序自动化测试框架

用 pytest 调度的微信小程序 UI 自动化测试框架 —— 真机驱动、Node.js 写用例、Playwright 操作元素。

> 新人请从第二节「5 分钟上手」开始读，读完就能跑起第一条用例。

---

## 一、这套框架是什么

一句话：**pytest 当调度器 + Playwright 的 Android 实验性 API 当驱动 + Node.js 写用例**。

- 不用 Appium
- 不用微信开发者工具
- 直接连接**真机上的微信**，抓取小程序 WebView 的 `Page` 对象，然后用标准 Playwright 的 DOM 定位能力操作小程序元素

### 四层架构

| 层 | 位置 | 职责 | 改动频率 |
|---|---|---|---|
| 用例层 | `test_case/suprecast_app/test_*.js` | 描述「测什么」：把页面对象的操作按顺序排好 | 最常改 |
| **页面对象层** | `app_sub_function/suprecast_app/pages/` | 描述「某个页面长什么样」：该页的选择器、页面标记、幂等导航 | **小程序改版时改这里** |
| 关键字层 | `app_sub_function/suprecast_app/android.js` | 提供「怎么操作」：点击、输入、滑动、找前台页、断言 | 常改 |
| 驱动层 | `common/app_common.js` | 「连接与执行」：连设备、抓 WebView、跑步骤、截图 | 少改 |

设计原则：**用例层只描述业务步骤，不出现任何选择器**。选择器下沉到页面对象，
原子操作下沉到关键字层。这样小程序改版时，你只需要改**页面对象**一个地方。

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

推荐用统一入口 —— 它会自己切到 `test_case`，避免"在错误目录下跑导致一条用例都收集不到"（踩坑记录坑 5）：

```powershell
python run.py                       # 跑全部用例 + 生成 Allure HTML 报告
python run.py -k 专栏                # 其余参数原样透传给 pytest
python run.py suprecast_app/test_example.js
```

也可以照旧手动跑（**必须在 `test_case` 目录下**）：

```powershell
cd test_case
python -m pytest -v
```

### 第 6 步：看结果

- **控制台步骤明细**：每条用例跑完会打印一张紧凑的步骤表 —— 状态、耗时、截图路径一目了然，
  失败的那一步直接给出错误首行，不用再去翻日志或按时间戳找截图：

  ```
  --- 步骤明细 ---
    [OK  ] 1. ensureOnColumnList  5.21s
    [FAIL] 2. openFirstColumn  5.64s
            错误: 点击第一张专栏卡片后没有进入详情页...
            截图: report\photo_app\...\_openFirstColumn_1010_121256.png
    合计 5 步：通过 4，失败 1，总耗时 33.2s
    上下文: {"firstColumnName": "N1-预热期专栏"}
  ```

- **截图**：`report/photo_app/{用例文件}_{用例函数}/_{步骤名}_{时间戳}.png`
- **Allure 报告**：`run.py` 生成 `report/allure-report/index.html`，按
  `feature -> story -> 步骤` 分层，失败步骤附带错误信息与截图
- **日志文件**：`report/log/pytest.log`

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

负责这件事的是 `common/app_common.js` 里的 `resolveForegroundPage(page)`：

| 函数 | 思路 | 适用场景 |
|---|---|---|
| `resolveForegroundPage(page)` | 谁是前台？**看谁还在产生动画帧** | 首选，通用；一次兜住"已销毁"和"已降级为后台页"两种失效 |
| `findPageWith(page, selector)` | 谁含有目标选择器，谁就是目标页 | 已知目标页有独特元素时（在 `android.js`） |

`resolveForegroundPage` 的判据很巧妙：

- 后台页对应的原生 WebView 已被系统**挂起**，渲染线程不再产出画面，所以 `requestAnimationFrame` 不会触发
- 于是往每个 page 里注入一段探针，等一帧（默认 500ms），**能等到帧的那个就是前台页**
- 多个 page 同时在出帧时（页面切换的过渡窗口），**再探一轮**来消歧——见账本 根因 10

⚠️ 另外两个直觉上更"正统"的判据实测**不可用**：`document.visibilityState` 与
`document.hasFocus()`，它们在**所有** page 上都返回 `visible` / `true`，区分不出前后台。

⚠️ 代码注释特别警告：**不能用 `locator.isVisible()` 判断**。因为后台页里的元素，`isVisible()` 同样返回 `true`，区分不出来。

**由此推出两条规则**：

1. **切换页面后必须重新取前台页** —— 好消息是**框架已经帮你做了**：
   `runAppSteps` 在每个步骤开始前都会用 `resolveForegroundPage(page)` 重新解析一次，
   用例里不用再自己写"重新获取页面"那套代码。

   但如果你在**同一个函数内部**要做多次判断（例如"先看是不是列表页，再看是不是详情页"），
   就必须**先把前台页解析出来存进一个变量，所有判断都作用在这一个对象上**。
   否则会出现"两个判据看两个页面、结论自相矛盾"——详见账本 根因 9。
2. **业务函数必须 `return page`**，否则调用链上后面的步骤会拿到 undefined。

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

### 用页面对象组织用例（推荐）

当用例开始变多、同一个页面被多条用例操作时，把"这个页面的知识"收进页面对象。
示范就是 [test_learn_center_column.js](test_case/suprecast_app/test_learn_center_column.js)
—— 整个文件里**没有任何选择器字面量**：

```js
const pages = require("../../app_sub_function/suprecast_app/pages");
const learnCenter = pages.learnCenter;
const columnDetail = pages.columnDetail;

const funcList = [
  // 幂等：已在专栏列表页就直接返回；在详情页就点返回；在别的 tab 就切 tab
  [learnCenter.ensureOnColumnList, null],
  [learnCenter.switchToColumnTab, null],
  [assertTextVisible, { text: learnCenter.MARKER_COLUMN_LIST }],
  [learnCenter.openFirstColumn, null],
  [assertSelectorCount, { selector: columnDetail.SEL.title, expected: 1 }],
];
```

页面对象怎么写？**每个函数都是"纯函数 + page 作第一个参数"，不用 class / this**：

```js
// pages/xxx_page.js
const base = require("./base_page");

const SEL = { someBtn: ".some-btn" };      // 选择器集中在这里

async function isOn(page) {                 // 页面身份判定
  const fg = await base.foreground(page);
  return (await base.countOf(fg, SEL.someBtn)) > 0;
}

module.exports = { SEL, isOn };
```

**为什么不用 class**：`runAppSteps` 靠 `func.name` 打日志、算耗时、命名截图文件，
并且是以 `func(page, kwargs)` 的形式**独立调用**步骤函数的。
用 class 方法会丢 `this`；用闭包包一层会让 `func.name` 变成无意义的名字。
写成具名导出的纯函数，`[pageObj.someAction, null]` 直接就是合法步骤。

已有的页面对象：`learnCenter`（学习中心，含「专栏」列表）、`columnDetail`（专栏详情页）、
`userCenter`（用户中心）。缺哪个页面就照上面的形状补一个 —— **别把新选择器写回用例里**。

### 什么时候该抽成公共函数

如果你的用例里出现这段逻辑第 3 次，就该把它抽到 `android.js` 里。判断标准：**换一个小程序版本，这段逻辑会不会变？** 会变，就抽出去。

### 怎么写断言（第三轮已补断言层）

框架提供 4 个断言函数，都是**"等待 + 断言"合体**（内部轮询）。小程序渲染时序抖动很大，
"点完立刻断言"几乎必然失败；让用例自己 `sleep` 猜时间则既慢又不稳 —— 所以等待内建在断言里。

| 函数 | 断言什么 | 典型用法 |
|---|---|---|
| `assertTextVisible` | 页面**可见文本**里出现某段文字 | `[assertTextVisible, { text: "热门专栏" }]` |
| `assertTextNotVisible` | 页面可见文本里**不再**出现某段文字 | 确认已经从列表页跳进了详情页 |
| `assertSelectorExists` | 选择器至少命中 1 个元素 | `[assertSelectorExists, { selector: ".column-card" }]` |
| `assertSelectorCount` | 选择器命中数量恰好等于 N | `[assertSelectorCount, { selector: ".col-title", expected: 1 }]` |

它们直接写进 `funcList` 即可，和普通步骤没有区别：

```js
const funcList = [
  [stepClickColumnTab, null],
  [assertTextVisible, { text: MARKER_LEARN_CENTER }],   // 等到「热门专栏」出现
  [assertSelectorExists, { selector: SEL_COLUMN_CARD }],
];
```

三个值得知道的设计细节：

1. **它们返回"真正断言过的那一页"**，所以 `runAppSteps` 会把最新 page 传给后续步骤。
2. **失败信息自带现场证据**（当前前台页元素数 + 可见文本前 200 字），不用再翻截图对时间。
3. 判断"文字是否可见"用的是 `document.body.innerText` —— 只返回可见文本，自动排除隐藏
   元素与 `<style>`/`<script>` 里的同名字符串（用 `page.content()` 会误判）。

> ⚠️ 断言函数本身也要验证"该失败时真的失败"。本轮做过一次反向验证：故意传不存在的
> 文本/选择器、故意把期望数量写错，4 个断言全部正确失败且报错有信息量 —— 没有假通过。

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
注意它**可能仍然活着、仍然在 `context.pages()` 里**，只是不再是屏幕上显示的那一个，
内容是冻结的 —— 所以"检查 `isClosed()`"这种判断挡不住它。

**解决**：框架已自动处理（`runAppSteps` 每步前重新解析前台页）。
自己写脚本时用 `await resolveForegroundPage(page)`。

### 换了台电脑/手机就跑不起来

**已修复（第四轮）**：设备序列号不再硬编码。解析顺序是
显式参数 > 环境变量 `UITEST_DEVICE_SERIAL` > 唯一连接的设备；
接了多台设备会**直接报错**，而不是随便挑一台静默测错对象。

换机器时：只有一台设备连着就什么都不用做；多台就设一次环境变量：

```powershell
$env:UITEST_DEVICE_SERIAL = "你的设备序列号"   # adb devices 里那一串
```

### 输入中文没反应，还不报错

**原因**：`adb shell input text` **不支持中文**。传中文进去不报错，但字不会进去 ——
又是那类最危险的"静默失败"。

**现状**：`qaPage.typeKeyword` 会**主动拒绝**非 ASCII 关键词并明确报错，
而不是让你拿到一个"跑了但什么都没测"的绿结果。

**可行方案（尚未实现）**：装 `ADBKeyboard` 这类专用输入法，用
`adb shell am broadcast` 发中文；或改用剪贴板粘贴。需要在手机上装 APK，
所以先记在这里，真要用的时候再上。

### 「有问必答」和「首页」是同一个页面

文档里这两个叫法指的是**同一页**（实测 418 元素、标题是`压铸人的社区百科`）：
底部 tab 上写的是「有问必答」，早期文档叫它「首页（社区百科）」。
判据是页面上有 `.search-container` 搜索栏。别再当成两页。

### 输入框的值读不到，是不是没输进去？

**不一定 —— 很可能是读法错了。**小程序的自定义输入组件（`wx-input`）把值放在
**`value` 属性**上，不在 DOM property 上：

| 读法 | 结果 |
|---|---|
| `el.value` | `undefined`（自定义元素没有这个 property） |
| `el.querySelector("input").value` | `""`（内层是 `visibility:hidden disabled` 的占位 input） |
| `el.getAttribute("value")` | ✅ 真实内容 |

用错读法做校验，会得到"输入未生效"的**假失败**（本轮实测踩到）。
统一用 `pages/base_page.js` 的 `inputValue()`，它按上面的顺序取第一个有效的。

---

## 八、当前已知问题与优化路线

> **2026/10/10 更新（四轮）**
>
> **第一轮**修掉 7 个根本缺陷，核心交互能力（点击、滑动、页面切换、元素断言）全部可用。
> **第二轮**修的是「页面的前后台身份」这条主线：导航后旧 page 会**降级为后台页**
> （活着、仍在 `context.pages()` 里，但内容冻结）。用例只检查"还活着吗"就会一直拿着
> 冻结页做判据，表现为「界面明明已经切到目标页、判据却说没切过去」，然后反复点击到超时。
> 现在这件事由框架统一处理（`resolveForegroundPage`）。
> **第三轮**补上断言层 —— 这是"用例通过"到底意味着什么的分水岭：此前只有
> `assertElementExists` 一个断言，功能坏了用例照样报 passed。
> **第四轮**清掉 P0：设备序列号 / `pkg` / `webviewTimeout` 三个"定义了却没用"的参数
> 真正接通，`goBack` 换成真实点击返回按钮，Python 侧的 `import common` 与配置样例补上。
>
> 完整根因分析与实测证据见 [框架能力与问题账本.md](docs/框架能力与问题账本.md)。

### 已修复 · 第一轮（7 项，此处仅列标题）

| # | 缺陷 | 修复要点 |
|---|---|---|
| 1 | `appTest` 取到 `/preload/` 空壳页 | 新增 `pickForegroundPage`，用 RAF 判据选前台页 + 校验 appid |
| 2 | `#id` 选择器对小程序 id 失效 | 改用属性选择器 `[id="..."]` |
| 3 | `getByText` 缺 `.first()` | 首页「我的」与「我的关注」冲突 |
| 4 | `tapElement` 按零宽文字节点取坐标 | 新增 `findClickableAncestor` 向上找可点击容器 |
| 5 | 所有点击用合成 `.click()` | 8 处改真实 adb tap（实测 `.click()` 会误报失败） |
| 6 | `swipeUp` 用合成鼠标事件 | 改 `adb input swipe` + 位移校验 |
| 7 | `switchToUserCenter` 在旧 page 上验证 | 重新获取前台页 + 幂等 + 重试 |

### 已修复 · 第二轮（5 项）

| # | 缺陷 | 修复要点 |
|---|---|---|
| 8 | 导航后 page 降级为后台页，框架无自动恢复机制 | 新增 `resolveForegroundPage`：context 缓存 + appid 过滤 + 并行 RAF 探测；`runAppSteps` 每步前自动重新解析 |
| 9 | 过渡窗口里新旧页面同时出帧，按"元素最多"挑会选错 | 多候选时二次探测消歧（实测旧列表页 188 元素与新详情页 118 元素同时出帧） |
| 10 | 用例选择器用子串匹配 `[class*="header-tab"]`，命中容器且排首位 | 改精确类名 `.header-tab`；点击坐标由 `(326,245)` 纠正为 `(273,245)` |
| 11 | `tapElement` 面积判据过严，小文字节点找不到真正的容器 | 上限改为 `max(起点×8, 10000)`（span 面积 190 时，容器 4239 曾被误判为"过大"） |
| 12 | node 输出中文时 pytest 打印抛 `UnicodeEncodeError` | `conftest.py` 放宽 stdout 错误处理，避免掩盖真实失败原因 |

> 顺带确认了两个**不可用**的前台页判据（实测在**所有** page 上返回值相同，无法区分前后台）：
> `document.visibilityState` 全是 `visible`、`document.hasFocus()` 全是 `true`。
> 别在这两条路上浪费时间 —— RAF 才是有效判据，而且已经用 adb 截图校准过。

### 已修复 · 第三轮（1 项）

| # | 缺陷 | 修复要点 |
|---|---|---|
| 13 | 缺结果断言层，功能坏了用例也会报 passed | 新增 `assertTextVisible` / `assertTextNotVisible` / `assertSelectorExists` / `assertSelectorCount`：内部轮询等待、失败自带现场证据、返回最新前台页 |

### 已修复 · 第四轮（P0 全部 5 项）

| 问题 | 修复要点 |
|---|---|
| 设备序列号硬编码，`options.deviceSerial` 解构了却从未使用 | 新增 `pickDevice()`：显式参数 > 环境变量 `UITEST_DEVICE_SERIAL` > **唯一**连接的设备；接了多台就**报错**，而不是随便挑一台静默测错对象 |
| `pkg` / `webviewTimeout` 定义了却从未使用 | 新增 `resolveWebviewOptions()`（参数 > 环境变量 > 默认值）；`getWxWebviewPage` 优先按 `pkg` 找 webview，并用 `withTimeout` 自己兜超时，不再依赖底层 API 的签名 |
| `goBack` 用浏览器后退，**实测无效** | 改为真实点击返回按钮（一组候选选择器 + `keyevent 4` 兜底），并且要求**页面确实变了**才算成功 |
| `common/__init__.py` 导入 8 个不存在的模块，`import common` 直接报错 | 只导出确实存在的内容（`BaseSCConfig` / `BaseSCLog`），`import common` 恢复可用 |
| `config/config.yaml` 不存在，配置管理类无法工作 | 补 `config/config.yaml.example` 模板；`base_config.py` 缺文件时给出可操作的报错，并修掉硬编码反斜杠的跨平台隐患 |

> ⚠️ 配置目前**分属两套机制**：JS 侧读「显式参数 / 环境变量」，Python 侧读
> `config/config.yaml`，样例文件里写清了这条边界。把 JS 侧也接到 YAML 是后续项
> （需要引入 YAML 解析依赖，或由 Python 侧生成）。

### 已修复 · 第六轮（3 项）

| # | 缺陷 | 修复要点 |
|---|---|---|
| 14 | `inputText` 的读回校验用了错的读法，必然误报"未真正写入" | 改为优先读 `value` 属性（`getAttribute("value")`）；小程序自定义组件把值放在属性上 |
| 15 | 搜索路径的页面知识硬编码在关键字层，关键词写死 `test` | 新增 `pages/qa_page.js`（有问必答页 + 搜索页）；`focusSearchInput` 退化为兼容外壳 |
| 16 | `test_example.js` 必须人工把手机停在有问必答页，否则必失败 | `openSearch` 自导航（幂等）；用例改为"打开搜索页 → 输入关键词 → 读回校验" |

> ⚠️ **仍未覆盖**：提交搜索与结果页校验（结果页结构还没实测，不凭猜测写断言）。
> ⚠️ **中文限制**：`adb input text` 不支持中文，`typeKeyword` 会主动拒绝非 ASCII 关键词。

### 已修复 · 第七轮（4 项，借鉴 Web 框架后补齐工程化）

这一轮的四个改动来源是 `webzdh4.7`（同事的 Web UI 框架）——它用 Selenium + Excel 数据驱动，
有几处工程化做得比我们好，借过来补齐：

| # | 缺陷 | 修复要点 |
|---|---|---|
| 17 | 只有控制台日志，没有步骤级报告；失败要人肉按时间戳翻截图 | 新增 `common/step_log.js`（JSONL）+ `conftest.py` 还原：控制台步骤明细、Allure `feature -> story -> step` 分层、失败步骤附错误与截图 |
| 18 | **步骤之间没法传数据** | 新增 `createCaseContext()`：上下文作为第 3 个参数传给每个步骤，`ctx.set/get/require`；**每个用例一份**（不学对方用类属性共享，那会跨用例污染） |
| 19 | 必须在 `test_case` 下跑 pytest（踩坑记录坑 5 的根源）；没有任何日志配置 | 新增 `run.py` 统一入口；`pytest.ini` 补 `log_file` + `log_cli` |
| 20 | JS 用例失败在 Allure 里显示成 **broken**（像是环境故障） | `JsTestFailure` 改为继承 `AssertionError`，报告里正确显示为 **failed** |

> 同轮还顺手改掉 `pytest.ini` 里一处注释与配置不符（注释写"重试2次/间隔1秒"，
> 实际是 `reruns=1`/`reruns_delay=10`），并加了一句提醒：UI 用例的重试会重复点击，
> 可能把偶发失败变成状态污染。

### 已修复 · 第八轮（与另一份工作副本合并 + 真机验证发现的缺口）

原仓库里还有一份**并行实现**（另一个 AI 在同一个基线上做的）。按 owner 决定，**以本分支为基**：
把对方独有的价值挑进来，其余保持我们这条路线。

| # | 内容 | 说明 |
|---|---|---|
| 21 | **二级页起步导致自导航失败**（真机验证发现） | 专栏详情页 / 搜索页 / 话题页 / 答题页都没有底部 tab 栏，`ensureOnColumnList` 原先只特判了详情页一种。新增 `base.ensureOnTabPage()` 通用自愈 |
| 22 | 配了 `log_file` 却没有日志（真机发现） | Python 侧没产生 logging 记录 -> 加 `emit()`（print + logging），并关掉 `log_cli` 避免重复打印 |
| 23 | **答题活动用例**（移植对方独有内容） | 新增 `pages/quiz_activity_page.js` + `test_quiz_activity.js`，用我们的原语重写；页面结构知识收进页面对象 |
| 24 | **"用例不适用"与"用例失败"混为一谈** | 引入退出码约定：`3` = 前置条件不满足 -> pytest 记 **SKIPPED**（活动没上线不再报假失败）；skip 必须可见且可计数 |
| 25 | `withTimeout` 出错时看不出实际延时（隐患自查） | 错误消息带上实际使用的超时值（自建测量工具先验自身） |

> 对方的 `run_case.py`（绕开 PowerShell 破坏中文）也已借鉴过来。
> 但对方用**截图哈希**判前台页，我们**没照搬**：实测 RAF 在稳定态下可靠
>（16 轮采样 + 截图比对，见账本第十八节），截图哈希是为"不信 RAF"准备的重型机械，
> 收进来只会平添复杂度。

### P0 · 仍待修

无。

### P1 · 结构缺失

- ~~**没有结果断言层**~~ ✅ 已补（第三轮，4 个断言函数）
- ~~**没有页面对象（Page Object）**~~ ✅ 已补（第五轮）：新增 `app_sub_function/suprecast_app/pages/`，选择器与页面级操作按页面归拢；`switchToUserCenter` 已迁入页面对象，用例层不再出现选择器字面量
- **步骤失败会跳出整个循环**：`runAppSteps` 里 `throw savedError` 会让后续步骤不再执行
- **设备连接有两套**：`appTest` 一套、`getDevice()` 一套，互不知情

### P2 · 工程化

- ~~无根 `.gitignore`~~ ✅ 已补（含 SSH 密钥防护）
- ~~无 README~~ ✅ 已补
- ~~无 `.gitattributes`~~ ✅ 已补（锁定 LF，避免跨平台假 diff）
- ~~诊断脚本堆积在 `test_case/`~~ ✅ 已移入 `test_case/diagnostic/`
- `pytest.ini` 注释写「重试 2 次」，配置却是 `reruns = 1`，注释与实现不一致
- 无 marker（`P0`~`P3`）使用示例：`pytest.ini` 已注册 marker，但 JS 用例里没法直接打 marker
- ~~无公共前置步骤~~ ⏳ 部分完成：`learnCenter.ensureOnColumnList` / `qaPage.openSearch`
  已能自导航；另两条用例仍要求人工把手机停在合适页面
- `addopts` 里的 `-p pytest_asyncio` 对纯 JS 用例无意义

### 建议的推进顺序

1. ~~补文档与工程基础~~ ✅ 已完成
2. ~~修框架根本缺陷~~ ✅ 已完成（第一轮 7 项 + 第二轮 5 项）
3. ~~补断言层~~ ✅ 已完成（第三轮，4 个断言函数）
4. ~~修 P0 缺陷~~ ✅ 已完成（第四轮，5 项）
5. ~~搭页面对象~~ ✅ 已完成（第五轮）。**下一步**：把 `login` 的账号、`focusSearchInput` 的关键词也抽出配置，并按同样形状补 `home_page.js` 等缺失的页面对象
6. **打通 Python 侧**：实现 `sc_config` / `sc_log`，让配置和日志真正驱动 JS 用例
   （第四轮只做到"`import common` 不再报错 + 配置样例就位"，业务类仍未实现）
7. **抽公共前置步骤**：让用例只写业务差异部分

---

## 九、目录结构说明

```text
miniapp_test_case/
├── README.md                        # 【本文件】项目总览与新人上手
├── .gitignore                       # Git 忽略规则（含 SSH 密钥防护）
├── .gitattributes                   # 换行符锁定为 LF
├── package.json                     # Node 依赖（只有 playwright）
├── requirements.txt                 # Python 依赖
├── run.py                           # ★ 一键运行入口（切到 test_case + pytest + Allure 报告）
├── knowledge/                       # 长期事实知识（见 knowledge/README.md 的清单）
│   ├── README.md                    #   索引 + 知识来源 + 数据缺口
│   ├── 小程序功能地图.md              #   功能域 → 页面 → 关联需求（写用例前读）
│   ├── 环境与目标小程序.md            #   环境 / appid 安全阀 / 设备 / 数据安全（动手前读）
│   ├── 工作项清单.md                 #   247 条需求（机器生成）
│   └── 迭代与模块汇总.md              #   计数（机器生成）
├── scripts/
│   └── check-docs.py                # 文档防腐检查：反引号路径是否真实存在
├── tools/
│   └── build_requirements_kb.py     # 从超云生态平台导出生成 knowledge/ 清单
├── docs/
│   ├── 框架导读.md                   # 深度导读（设计原理、执行链路、自测题）
│   ├── android-js-逐行详解.md        # android.js 700 行逐段讲解
│   ├── 框架能力与问题账本.md          # 实测能力清单 + 7 个根因的定位与修复证据
│   ├── 踩坑记录.md                   # 实战踩坑记录
│   └── 交接文档.md                   # ★ 接手必读：现在做到哪、下一步、不能丢的约定
├── common/
│   ├── __init__.py                  # Python 侧导出（只导出确实存在的模块）
│   ├── app_common.js                # ★ 驱动层核心：连设备、抓 WebView、跑步骤、上下文、截图
│   ├── step_log.js                  # ★ 结构化步骤日志（JSONL），供 pytest 侧还原成报告
│   └── share/
│       ├── base_config.py           # 配置基础类（单例 + 懒加载 + 热重载）
│       ├── base_log.py              # 日志基础类（单例 + 双通道 + 按天轮转）
│       └── README.md                # 公共模块说明
├── app_sub_function/                # 关键字层 + 页面对象层
│   └── suprecast_app/
│       ├── android.js               # 关键字层：★ 可复用的原子操作 + 断言
│       └── pages/                   # 页面对象层：★ 每个页面的选择器与页面级操作
│           ├── index.js             #   统一入口（pages.learnCenter / pages.columnDetail ...）
│           ├── base_page.js         #   公共能力：解析前台页 / 判定 / 真实 tap / 轮询等待
│           ├── learn_center_page.js #   学习中心（含「专栏」列表）
│           ├── column_detail_page.js#   专栏详情页
│           ├── user_center_page.js  #   用户中心
│           ├── qa_page.js           #   有问必答页 + 搜索页
│           └── quiz_activity_page.js#   首页活动卡区 + 答题活动页
├── test_case/                       # 用例层
│   ├── pytest.ini                   # pytest 配置
│   ├── diagnostic/                  # 诊断工具（不以 test_ 开头，pytest 不收集）
│   │   ├── capability_check.js      # 15 个函数的能力矩阵探测
│   │   ├── dump_page.js             # 抓页面 DOM 到文件 + 各 page 身份判定
│   │   ├── probe_raf.js             # 校准前台页判据（RAF 信号 vs 截图真值）
│   │   └── run_case.py              # 跑单个用例并把输出按正确编码落盘
│   └── suprecast_app/
│       ├── conftest.py              # ★ 桥接层：让 pytest 能执行 .js
│       ├── test_example.js          # 有问必答 -> 搜索（自导航 + 输入读回校验）
│       ├── test_login_and_navigation.js    # 切用户中心 + 打印页面结构
│       ├── test_learn_center_column.js     # 学习中心 -> 专栏 -> 第一张（含 ctx 断言）
│       ├── test_quiz_activity.js    # 首页活动卡 -> 答题页（**默认不提交**，见文件头）
│       └── test_switch_to_user_center.js   # 切用户中心（带真实验证）
└── report/                          # 测试产物（已 gitignore）
    ├── photo_app/                   # 用例截图
    └── diagnostic/                  # 诊断脚本产物
```

---

## 十、工程纪律（借自团队工作流，代价换来的）

> 这几条来自团队"开发工作流"仓的规范与 30 篇复盘。**每条都有实际代价**，不是原则口号。

### 10.1 断言必须"在该红的时候会红"

新增/修改任何断言、校验、门禁能力时，交付前必须**走一次反向验证**：
故意构造反例（传不存在的文本/选择器、故意写错期望值），确认它**真的失败**，并且报错有信息量。

- 只验正向 = 换一种方式继续生产"假通过"
- 本仓已有先例：断言层 4 个函数、appid 安全阀（4 个方向）、退出码 3 -> SKIPPED，都做了正反验证

### 10.2 判定"哪个页面在前台"要留证据

RAF 判据在**稳定态**下可靠（16 轮采样 + adb 截图真值校准，见账本第十八节），
但**切换瞬间会出现两个页面同时出帧**。所以：断言失败时先看现场证据（页面元素数 + 可见文本），
再判断是"框架选错页"还是"页面被外部切走"。

### 10.3 失败先怀疑测量工具

自建的脚本/封装出错时，**失败信号长得像产品缺陷或环境故障**。

- 自建超时封装必须把**实际使用的延时值**打进错误消息（本仓 `withTimeout` 已这么做）
- 手边有对照组先看对照组（同环境下别的用例跑得通 ⇒ 先 diff 代码，别先重启环境）
- 环境类结论写进文档前先自问："会不会只是我的脚本错了？"

### 10.4 文档防腐

借自团队规范 `文档防腐规范`：

- **真实存在的路径一律包反引号**（包了就等于声明"它应该存在"）；占位符用尖括号
- **状态只写一处**（单一事实源）：别的文档写指针，不复制状态
- **改到长期文档里的命令，必须在本次会话真跑一遍**
  —— 一条跑不通的命令比没有命令更坏：照着做的人学到的不是"文档错了"，而是"别信文档"

机器兜底（可选接成 git hook）：

```powershell
python scripts/check-docs.py     # 校验文档里包反引号的路径是否真实存在
```

### 10.5 并发工作纪律（多个 AI / 会话共用同一仓库或同一部手机）

团队复盘里最贵的一条：两个会话共用同一工作区时，`git reset --soft` **误撤了对方的提交**，
恢复时 `git checkout --` 又**覆盖了对方 16 行从未提交的内容**（git 里找不回来）。

| 纪律 | 说明 |
|---|---|
| 有损 git 操作前先看状态 | `git reflog -5` + `git status --porcelain`；发现陌生条目（他人的 staged 文件）立即停下 |
| **提交用显式列文件**，不要 `git add -A` | `-A` 会把别人未提交的内容一起提交进去 |
| 能不改写就不改写 | 能 `git restore --staged` 就不 `reset`；能新建提交就不改历史 |
| 未提交内容都是易失的 | 重要内容即写即 commit |
| 共用手机时 | 动手前截图确认现场；**偶发失败先怀疑环境**；长流程前先确认独占 |

### 10.6 数据安全

本测试环境**没有独立测试账号**，用的是真实账号（见 `knowledge/环境与目标小程序.md`）。
凡会**写服务端数据**的操作（提交答题、兑换积分、签到、下单、订阅、发帖），
默认禁止，需要显式开关与 owner 同意。

---

## 十一、环境版本参考

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
