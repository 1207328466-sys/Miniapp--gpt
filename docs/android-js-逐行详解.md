# android.js 逐行详解

> 文件：`app_sub_function/suprecast_app/android.js`
> **当前 700 行**，位于**关键字层**——用例层调用它，它调用驱动层（`common/app_common.js`）。
>
> **📌 版本提示（2026/10/10 更新行号）**
> 本文最初基于 445 行版本编写。此后框架修复了 7 个缺陷，文件增长到 700 行，
> **行号已全部偏移**。下文各节标题中的行号已经更新为当前版本。
>
> 修复涉及的函数，其实现与原始版本已有实质差异，文中已在对应小节标注
> **「已重构」**并说明改动原因。完整修复记录见
> [框架能力与问题账本.md](框架能力与问题账本.md)。
>
> **当前函数行号对照表**（可直接跳转阅读）：
>
> | 行号 | 函数 | 相对原版 |
> |---|---|---|
> | 29 | `getDevice` | 未变 |
> | **57** | **`findClickableAncestor`** | **新增**（配合 `tapElement`） |
> | 119 | `tapElement` | **已重构** |
> | 145 | `findPageWith` | 未变 |
> | 171 | `switchToUserCenter` | **已重构**（幂等 + 重试 + 前台页验证） |
> | 249 | `getForegroundPage` | 未变 |
> | 282 | `login` | **已重构**（改真实 tap） |
> | 322 | `waitImeShown` | 未变 |
> | 341 | `focusSearchInput` | **已重构**（改真实 tap） |
> | 384 | `clickElementById` | **已重构**（属性选择器 + 真实 tap） |
> | 419 | `clickElementByText` | **已重构**（改真实 tap） |
> | 440 | `inputText` | **已重构**（真实 tap + 读回校验） |
> | 483 | `assertElementExists` | **已重构**（属性选择器） |
> | 508 | `swipeUp` | **已重构**（adb input swipe + 位移校验） |
> | 575 | `goBack` | 未变（仍不可用，待修） |
> | 593 | `switchToWxWebview` | 未变 |
> | 626 | `clickWxText` | **已重构**（改真实 tap） |
> | 648 | `dumpElements` | 未变 |
> | 684-700 | `module.exports` | 已增补 `tapElement` |
>
> ⚠️ 文中若出现"原版"写法的代码块，那是**为了对比说明修复前后的差异**，
> 不代表当前代码。以对照表指向的行号为准。

---

## 第 0 节：先建立整体认知

这个文件里有 **18 个函数**，按用途分四类：

| 类别 | 函数 | 谁来调用 |
|---|---|---|
| **内部工具**（不导出） | `getDevice` `tapElement` `findPageWith` `waitImeShown` | 只被本文件其他函数调用 |
| **设备/页面定位**（导出） | `getForegroundPage` `switchToWxWebview` | 用例可以调 |
| **业务操作**（导出） | `login` `switchToUserCenter` `focusSearchInput` | 用例最常调 |
| **通用操作**（导出） | `clickElementById` `clickElementByText` `inputText` `swipeUp` `goBack` `clickWxText` `assertElementExists` `dumpElements` | 用例按需调 |

> ⚠️ 注意上表第一行：**4 个内部工具函数没有出现在 `module.exports` 里**（见第 7 节）。这意味着用例无法直接调用它们，这是当前框架的一个限制。

### 两条贯穿全文的编码约定

**约定一：第一个参数是 `page`，最后 `return page`**

```js
async function clickElementByText(page, { text, timeout = 10000 } = {}) {
  //                   ↑ 第一个参数固定是 page
  return page;   //     ↑ 结尾必须把它返回出去
}
```

为什么要返回 `page`？因为小程序的页面会变（切 tab 后 `page` 就是另一个对象了）。如果函数内部把 `page` 换成了新的，必须通过返回值传出去，否则调用链上下一步还拿着**已经失效的旧页面**。这是"链式传递"。

**例外**：`switchToWxWebview` 第一个参数是 `device`（它需要设备级能力），`tapElement` / `findPageWith` / `waitImeShown` 是内部工具，参数各不相同。

**约定二：参数用"解构 + 默认值"**

```js
async function clickElementByText(page, { text, timeout = 10000 } = {}) {
  //                                     ↑ 从对象里取 text        ↑ 不传 timeout 就用 10000
```

这样调用时写 `{ text: "我的" }` 就行，不用管 timeout。对应的 `funcList` 写法是：

```js
[clickElementByText, { text: "我的" }]   // 第二个元素就是这个对象
```

---

## 第 1 节：文件头与依赖（1-22 行）

```js
1: /*
2:  * @author: weiyue.zhang
3:  * @project_name: UITest
4:  * @cur_file: android.js
5:  * @create_date: 2026/10/8
6:  *
7:  * app_sub_function/suprecast_app/android.py 的 JS 版本。
8:  * 参考根目录 app.js：使用 Playwright 的 Android 实验性 API（_android）连接安卓设备、
9:  * 获取微信小程序 WebView 的 Page，之后所有交互都基于 Playwright 的 Page API（async）。
10:  *
11:  * 说明：所有子函数第一个参数统一为 page，并 return page 以支持链式调用；
12:  * 只有需要设备级能力的 switchToWxWebview 以 device 作为第一个参数。
13:  */
```

- 1-13 行：**块注释**（`/* ... */` 可以跨多行）。说明这个文件是从 Python 版迁移来的，并写明上面那两条约定。
- 注释里提到"参考根目录 app.js"——那是更早的版本，**当前项目里不存在这个文件**，属于历史遗留描述。

```js
15: const WX_WEBVIEW_PKG = "com.tencent.mm:appbrand0";
```

- `const` = 定义常量，**赋值后不能改**（区别于 `let`）
- `WX_WEBVIEW_PKG` 是**微信小程序 WebView 的进程包名**。`com.tencent.mm` 是微信的主包名，`appbrand0` 是它的**小程序子进程**
- `:appbrand0` 这个冒号表示"主进程下的第 N 号子进程"。小程序可能开多个，所以后面数字会变
- ⚠️ 这个常量**当前没有被使用**（唯一用到它的是 `switchToWxWebview`，而那个函数没被用例调用）。真正抓 WebView 的逻辑在 `app_common.js` 里，走的是"遍历所有 webview + 按 URL 判断"的路线

```js
16: const { getWxWebviewPage } = require("../../common/app_common");
17: const { _android: android } = require("playwright");
```

- `require(...)` 是 Node.js 的**导入语法**（相当于 Python 的 `import`）
- 第 16 行：从驱动层导入 `getWxWebviewPage`。路径 `../../` 表示**向上一级、再向上一级**：
  ```
  app_sub_function/suprecast_app/android.js   ← 当前位置
  app_sub_function/suprecast_app/  → ../
  app_sub_function/                → ../../
  common/app_common                ← 目标
  ```
- 第 17 行：`{ _android: android }` 是**解构并重命名**——从 playwright 包里取出 `_android` 这个属性，赋给本地变量 `android`
  - 下划线开头表示这是 Playwright 的**实验性 API**（官方不保证向后兼容，可能在小版本升级时变动）
  - 重命名是因为 `_android` 这个名字不好用，`android` 更自然
- ⚠️ 第 16 行导入的 `getWxWebviewPage` **在本文件里也没被使用**（`focusSearchInput` 用的是自己内部的 `getDevice`）。属于冗余导入

```js
19: // 有问必答页的搜索栏（是个 wx-view，不是输入框）；点击后进入搜索页
20: const SEARCH_BAR = ".search-container";
21: // 搜索页的真实输入框
22: const SEARCH_INPUT = "wx-input.search-input";
```

- 这两个是**元素选择器**，集中定义在文件顶部，方便统一修改
- `.search-container` 里的 `.` 表示"按 class 属性查找"（CSS 选择器语法）
- `wx-input.search-input` 表示"标签名是 `wx-input`，且 class 含 `search-input`"
- 注释强调 `SEARCH_BAR` 是个 `wx-view`——**这正是后面必须用真实 tap 而不能用 `click()` 的原因**（见第 3 节）

**把它们提到顶部的价值**：如果小程序改版、class 名变了，你只改这一处，全文其余地方自动跟着变。但要注意，**文件里还有大量选择器是硬编码在函数中的**（如 `"我的"`、`"4148"`），并没有这样集中管理——这是后面做"页面对象"改造时要解决的问题。

---

## 第 2 节：设备懒加载（24-36 行）

```js
24: /**
25:  * 懒加载安卓设备，仅用 shell() 执行 adb 命令（不依赖 playwright 的 driver apk）
26:  * @returns {Promise<import('playwright').AndroidDevice>}
27:  */
28: let androidDevice = null;
29: async function getDevice() {
30:   if (!androidDevice) {
31:     const devices = await android.devices();
32:     androidDevice = devices[0];
33:     console.log(`AndroidDevice连接成功，设备serial: ${androidDevice.serial()}`);
34:   }
35:   return androidDevice;
36: }
```

- 24-27 行：**JSDoc 注释**（`/** ... */`）。它不是普通注释，而是有格式约定的文档，编辑器能识别并给出参数提示
  - `@returns {Promise<...>}` 说明这个函数返回一个 Promise（异步结果）
- 28 行：`let androidDevice = null` —— `let` 是**可以重新赋值的变量**（区别于 `const`）。这里初始为 `null`（空）
- 29 行：`async function` 表示**异步函数**，内部可以用 `await`。调用它的人也必须 `await`
- 30 行：`if (!androidDevice)` —— `!` 是"取反"。`null` 取反是 `true`，所以**第一次调用时条件成立**
- 31-32 行：`android.devices()` 列出所有连接的安卓设备，取**第 0 个**（第一个）
- 33 行：反引号 `` ` `` 包起来的是**模板字符串**，`${...}` 里可以嵌入变量，比用 `+` 拼接好读
- **这段代码的精髓是"懒加载 + 缓存"**：
  - 第一次调用：连设备，存进 `androidDevice`
  - 之后调用：`if` 不成立，直接返回缓存，**不会重复连接**
  - 好处：`focusSearchInput` 里调用它时，如果之前已经连过，几乎零开销

**⚠️ 这里有两个隐患：**

1. **`devices[0]` 写死了取第一个设备**——没有按序列号筛选，也没有检查 `devices` 是否为空。如果一台设备都没连，`devices[0]` 是 `undefined`，第 33 行访问 `.serial()` 就会抛 `Cannot read properties of undefined`，报错信息很难懂
2. **它和 `app_common.js` 里的 `appTest` 各连各的**：`appTest` 连了一次设备并传给 `runAppSteps`，但业务函数（如 `focusSearchInput`）内部又通过 `getDevice()` **独立连了一次**。等于有两套设备连接，互不知情，最后 `appTest` 关掉的是它自己那套

---

## 第 3 节：真实 adb 点击（38-144 行）★核心原理【已重构】

```js
38: /**
39:  * 用真实 adb tap 点击元素。
40:  * 小程序视图层只响应真实触摸事件，Playwright 合成的鼠标事件点了没反应，
41:  * 因此把 DOM 坐标按 devicePixelRatio 换算成屏幕坐标后走 input tap。
42:  * @param {import('playwright').AndroidDevice} device
43:  * @param {import('playwright').Page} page
44:  * @param {import('playwright').Locator} locator
45:  */
46: async function tapElement(device, page, locator) {
47:   const box = await locator.boundingBox();
48:   if (!box) throw new Error("元素取不到坐标，可能不可见");
49:   const dpr = await page.evaluate(() => window.devicePixelRatio);
50:   const x = Math.round((box.x + box.width / 2) * dpr);
51:   const y = Math.round((box.y + box.height / 2) * dpr);
52:   await device.shell(`input tap ${x} ${y}`);
53:   console.log(`adb tap(${x}, ${y})`);
54: }
```

这是整个框架**最值钱的 8 行代码**，值得逐行吃透。

- 46 行：三个参数——设备、页面、**定位器**（Locator 是 Playwright 里"怎么找到元素"的描述，不是元素本身）
- 47 行：`boundingBox()` 返回元素在**页面坐标系**里的位置和大小：
  ```
  { x: 100, y: 200, width: 300, height: 80 }
  ```
  这是异步操作（要问浏览器），所以 `await`
- 48 行：**防御性检查**。元素不可见或不存在时 `boundingBox()` 返回 `null`，此时直接 `throw` 抛出错误
  - `throw new Error("...")` = 主动报错。这东西会一路向上传播，最终被 `runAppSteps` 捕获、截图、让 pytest 标记失败
  - 如果不写这行，第 50 行访问 `box.x` 会报 `Cannot read properties of null`，信息量差很多
- 49 行：**关键的一步**。取 `devicePixelRatio`（设备像素比）
  - DOM 坐标是 **CSS 像素**（逻辑像素），而 `adb input tap` 需要的是**物理屏幕像素**
  - 例如 CSS 宽 393 的手机，物理宽可能是 1080，`devicePixelRatio ≈ 2.75`
  - `page.evaluate(() => ...)` 的作用是**在页面内部执行这段代码**并把结果传回 Node.js——因为 `window` 只存在于页面里，Node.js 里没有
- 50-51 行：算出元素**中心点**的物理坐标
  - `box.x + box.width / 2` = 中心点的 CSS 横坐标
  - `× dpr` = 换算成物理像素
  - `Math.round` = 四舍五入成整数（adb 不接受小数）
- 52 行：通过 adb 发送**真实触摸事件**
  - `device.shell(...)` 是在手机上执行 shell 命令
  - `input tap x y` 是安卓自带的命令：在 (x, y) 位置模拟一次真实点击
  - **为什么必须这样？** 因为小程序视图层只认真实触摸事件，浏览器层面的合成事件（`page.click()` 发出的那种）它不响应
- 53 行：打印日志，方便排查"到底点了哪个坐标"

**⚠️ 三个已知局限：**

1. **没有等待/重试**：点完立即返回，不等界面响应。调用方得自己加 `waitForTimeout`
2. **坐标可能过期**：如果页面在取坐标和点击之间发生了滚动，会点偏
3. **只支持点击中心点**：没法点元素的特定位置（比如列表项右侧的删除按钮）
4. **横屏未处理**：`input tap` 用的是物理屏幕坐标，如果设备旋转过，这套换算会不准

---

## 第 4 节：按选择器找页面（145-170 行）

```js
63: async function findPageWith(page, selector) {
64:   for (const p of page.context().pages()) {
65:     const count = await p.locator(selector).count().catch(() => 0);
66:     if (count > 0) return p;
67:   }
68:   return null;
69: }
```

- 56-62 行：注释说明背景——**小程序同一个 context 下并存多个 tab 页**，传进来的 `page` 未必是你要的那个
- 64 行：`page.context().pages()` 拿到**同一浏览器上下文里的所有页面**，`for...of` 逐个遍历
  - `context` 可以理解为"一个浏览器会话"，同一小程序的所有页面都在里面
- 65 行：数一数这个页面上有几个匹配 `selector` 的元素
  - `.catch(() => 0)` 是**错误兜底**：如果这个页面已经不可用了（比如预加载页崩溃），`count()` 会抛错，这里把它转成 `0`，相当于"这个页面没有目标元素"，继续看下一个
  - 不写 `.catch` 的话，一个坏页面会让整个查找中断
- 66 行：找到就立即 `return`（结束循环），返回**那个页面**
- 68 行：全都没有，返回 `null`。调用方必须判空

**设计取舍**：这个思路的前提是"**目标页有独特的选择器**"。如果多个页面都有同一个元素，它会返回**第一个**匹配的，可能不是你想要的。

---

## 第 5 节：切换到用户中心（171-208 行）【已重构】

```js
75: async function switchToUserCenter(page) {
76:   try {
77:     await page.waitForTimeout(2000);
78:     const userCenterButton = page.getByText("我的");
79:     await userCenterButton.waitFor({ state: "visible", timeout: 10000 });
80:     await userCenterButton.click({ timeout: 10000,force: true });
81:     console.log("已切换到用户中心");
82:     return page;
83:   } catch (e) {
84:     console.error(`切换到用户中心失败: ${e.message}`);
85:     throw e;
86:   }
87: }
```

- 76 行：`try { ... } catch (e) { ... }` 是**异常捕获**。`try` 块里任何一句出错，都会跳到 `catch`
- 77 行：`waitForTimeout(2000)` = **硬等 2 秒**（`2000` 是毫秒）
  - 这是**最简单的等待方式，但也是最笨的**：无论页面是否已经就绪，都要干等 2 秒。页面快的话浪费时间，页面慢的话 2 秒可能还不够
  - 更好的做法是 `waitFor` 等具体条件（第 79 行就是），这个 2 秒属于"经验值兜底"
- 78 行：`getByText("我的")` 是**按可见文本定位元素**，比 CSS 选择器更贴近人的直觉
  - ⚠️ 注意这里**没加 `.first()`**，而 `login()` 里加了。如果页面上有多个"我的"（比如底部 tab 一个、页面内一个），这里会因"匹配到多个元素"而报错
- 79 行：`waitFor({ state: "visible" })` **等元素出现且可见**，最多等 10 秒
  - 这是"**智能等待**"：元素一出现就继续，不用干等满 10 秒
  - `state` 可选值：`visible`（可见）、`attached`（存在于 DOM 即可，不要求可见）、`hidden`（隐藏）、`detached`（已移除）
- 80 行：点击。`force: true` 表示**强制点击**，跳过 Playwright 的可操作性检查
  - 正常情况下 Playwright 会检查元素是否可见、是否被遮挡、是否可交互，不满足就报错
  - `force: true` 会绕过这些检查——**能点通，但风险是元素真被遮挡时你点到了别的东西上**
  - 这里加 `force` 通常是因为小程序元素的可见性判断不被 Playwright 认可（比如在 iframe 或特殊渲染层里）
- 81 行：写日志
- 84-85 行：**catch 里只做两件事**——打印错误信息、把错误**重新抛出**
  - `e.message` 取错误的文字描述
  - `throw e` 把**原错误对象**继续往上传。必须抛，否则错误被"吃掉"，用例会假装成功——这是**最危险的 bug**
  - 加 `try/catch` 的唯一目的就是"记一条自己的日志"，然后原样放行

**这个模式（try → 操作 → catch → 记日志 → throw e）在本文件里出现了 13 次**，是全文最重复的结构。

---

## 第 6 节：前台页面探测（209-281 行）★核心原理

```js
101: async function getForegroundPage(page, { timeout = 500 } = {}) {
102:   for (const p of page.context().pages()) {
103:     try {
104:       const alive = await p.evaluate(
105:         (ms) =>
106:           new Promise((resolve) => {
107:             let done = false;
108:             requestAnimationFrame(() => {
109:               done = true;
110:               resolve(true);
111:             });
112:             setTimeout(() => {
113:               if (!done) resolve(false);
114:             }, ms);
115:           }),
116:         timeout
117:       );
118:       if (alive) {
119:         return p;
120:       }
121:     } catch (e) {
122:       // 页面不可用（如预加载页），跳过
123:     }
124:   }
125:   return page;
126: }
```

这个函数解决的问题**非常隐蔽**，注释里讲了原理：

> 后台页对应的原生 WebView 已被挂起，渲染线程不再产出帧（`requestAnimationFrame` 不触发）

**逐行解释：**

- 101 行：`{ timeout = 500 }` 单个页面的探测超时，默认 500 毫秒
- 102 行：遍历同一 context 下的**所有页面**
- 103-121 行：**只包住 try 不写 catch 内容**——出错就什么都不做（静默跳过），继续下一个页面
  - 第 122 行是注释，说明这里故意吞掉异常：某些页面（预加载页）访问就会报错，跳过是正常的
- 104 行：`p.evaluate(函数, 参数)` —— **在页面内部执行这段代码**，第二个参数 `timeout` 会作为 `ms` 传进去
- 106 行：`new Promise((resolve) => { ... })` —— 手动创建一个 Promise，用来表示"一段时间后才有结果"
  - `resolve(值)` 表示"完成，结果是什么"。**谁先调用 `resolve`，谁决定结果**
- 107 行：`let done = false` —— 标记"是否已经有结论了"
- 108-111 行：**注册一个动画帧回调**
  - `requestAnimationFrame(回调)` = "下一帧画面渲染前，调用我这个函数"
  - 页面如果**活着并正常渲染**，几毫秒到十几毫秒内就会触发
  - 触发时把 `done` 置为 `true`，并 `resolve(true)` → **判定这个页面是前台页**
- 112-114 行：**同时设一个定时器做超时兜底**
  - 到了 `ms` 毫秒后如果 `done` 还是 `false`，说明这一帧始终没来 → `resolve(false)`
  - **这就是"后台页"的判定方式**：页面的渲染线程被系统挂起了，`requestAnimationFrame` 永远不会触发
- 117 行：`timeout` 作为第二个参数传给页面内的函数，对应上面的 `ms`
- 118-120 行：探测通过，立即返回这个页面
- 125 行：**全都没探测到，返回传进来的原 page**（兜底，不是返回 null）
  - 这个设计很关键：调用方写 `page = await getForegroundPage(page)` 时，最坏情况也拿得到原来的 page，不会变成 `null` 引发后续崩溃
- 注释里的警告（96 行）：**不能用 `locator.isVisible()` 判断**——后台页里的元素，`isVisible()` 同样返回 `true`，根本区分不出来

**⚠️ 性能提醒**：这个函数最坏情况要遍历所有页面 × 每个 500 毫秒。如果 context 里有 5 个页面且全都不响应，就要等 **2.5 秒**。所以调用它不能太频繁。

---

## 第 7 节：登录（282-321 行）【已重构】

```js
134: async function login(page) {
135:   try {
136:     // 切换 tab 后当前页面会变成新的 webview，操作前先定位前台页面
137:     page = await getForegroundPage(page);
138:     await page.getByText("我的").first().click({ timeout: 10000 });
139:     await page.waitForTimeout(1000);
140:     page = await getForegroundPage(page);
141:     await page.getByText("登录/注册").first().click({ timeout: 10000 });
142:     page = await getForegroundPage(page);
143:     await page.getByText("同意协议并继续").first().click({ timeout: 10000 });
144:     await page.getByText("4148").first().click({ timeout: 10000 });
145:     console.log("已登录");
```

- 137 行：**先切换 page 引用**。这是前面反复强调的"**页面会变**"问题的解法：
  ```
  page = await getForegroundPage(page)
  ↑ 把新找到的前台页重新赋给 page      ↑ 用当前的 page 去找
  ```
  每次点击后，小程序的页面可能变了，所以**下一次操作前都要重新定位**
- 138 行：`.first()` 表示**匹配到多个时取第一个**。这里加了，而 `switchToUserCenter` 里没加——两处写法不一致，是个潜在的不稳定点
- 139 行：点击后等 1 秒，让界面反应
- 140 行：**再重新定位一次**，因为切换 tab 后原来的 page 已经变后台了
- 141-143 行：依次点「登录/注册」→「同意协议并继续」
- 144 行：点 `"4148"` —— **这显然是硬编码的测试数据**（很可能是手机号后四位，用于选择某个测试账号）
  - ⚠️ **问题**：账号被写死在代码里。换测试账号、换环境就得改代码
  - 正确做法是放进配置文件，通过参数传入
- 这套流程每一步都**强依赖界面上的具体文案**（"我的"、"登录/注册"、"同意协议并继续"）。**小程序一改文案，这个函数立刻失效**

---

## 第 8 节：等软键盘（322-340 行）★核心原理

```js
161: async function waitImeShown(device, page, timeout = 5000) {
162:   const deadline = Date.now() + timeout;
163:   while (Date.now() < deadline) {
164:     const out = (await device.shell("dumpsys input_method")).toString();
165:     if (/mInputShown=true/.test(out)) return true;
166:     await page.waitForTimeout(300);
167:   }
168:   return false;
169: }
```

解决的问题（见 154-155 行注释）：

> 没聚焦时 `adb input text` 的事件会被丢弃，必须等键盘起来再输入。

**最可怕的是：事件被丢弃不会报错，字没输进去，用例却"跑完了"** —— 这类假通过最难发现。

- 161 行：`timeout = 5000` 最多等 5 秒
- 162 行：`Date.now()` 返回当前时间戳（毫秒）。`deadline` = **截止时间点**
  - 用"截止时间点"而不是"倒计时"，是因为循环里每次都要重新比较，这种方式更精确
- 163 行：`while (Date.now() < deadline)` —— 只要还没到截止时间就一直循环（**轮询**）
- 164 行：`device.shell("dumpsys input_method")` —— 查询安卓**输入法（IME）的当前状态**
  - `dumpsys` 是安卓的"系统信息查询"命令，`input_method` 是输入法服务
  - `.toString()` 把返回结果转成字符串（`shell()` 返回的可能不是标准字符串）
- 165 行：`/mInputShown=true/.test(out)`
  - `/.../ ` 之间是**正则表达式**，用来在长文本里找模式
  - `mInputShown=true` 是输入法状态转储里的一个字段，为 `true` 表示**软键盘正在显示**
  - `.test(out)` 返回"找到了吗"（true/false）
  - 找到了 → `return true` **立即结束**，不用等满 5 秒
- 166 行：没找到就等 300 毫秒，**再查一次**
  - ⚠️ **注意这里用的是 `page.waitForTimeout`，不是 Node.js 的 `setTimeout`**。两者都在等，但用 Playwright 的等待更合适——它同时给了页面喘息时间
- 168 行：5 秒都没等到，返回 `false`
  - 调用方 `focusSearchInput` 会据此抛错（见第 9 节）

**这是一个"轮询等待"的教科书例子**：每隔一小段时间检查条件，满足就走，超时就放弃。比"无脑等 3 秒"既快又可靠。

---

## 第 9 节：打开搜索页（341-383 行）★最复杂的函数

```js
180: async function focusSearchInput(page, { timeout = 10000 } = {}) {
181:   try {
182:     const device = await getDevice();
183:     // 1. 同一 context 下并存多个 tab 页，先在所有 page 中找出含搜索栏的那个
184:     const target = await findPageWith(page, SEARCH_BAR);
185:     if (!target) {
186:       throw new Error(`没有 page 含搜索栏 ${SEARCH_BAR}，请先切到有问必答页`);
187:     }
188:     // 2. 真实 tap 搜索栏，跳到搜索页
189:     await tapElement(device, target, target.locator(SEARCH_BAR).first());
```

**第 1 步（182-187 行）：拿到设备 + 找到有搜索栏的页面**

- 182 行：`getDevice()` 拿设备（懒加载，前面第 2 节讲过）
- 184 行：用第 4 节的 `findPageWith` 在所有页面里找含 `.search-container` 的那个
- 185-187 行：**找不到就抛错，而且错误信息很友好**
  - `` `没有 page 含搜索栏 ${SEARCH_BAR}，请先切到有问必答页` `` —— 直接告诉使用者该怎么办
  - **好的错误信息要能指引行动**。这句就是正面例子："请先切到有问必答页"
- 189 行：**三步连在一起**
  ```
  tapElement(device, target, target.locator(SEARCH_BAR).first())
  ↑ 真实点击   ↑设备   ↑页面   ↑在这个页面上定位搜索栏，取第一个
  ```
  这里用 `tapElement` 而不是 `.click()`，正是因为注释说的"它是 wx-view，点了没反应"

```js
190:     // 3. 搜索页是新出现的 page，等它渲染出来
191:     let searchPage = null;
192:     const deadline = Date.now() + timeout;
193:     while (Date.now() < deadline && !searchPage) {
194:       await target.waitForTimeout(500);
195:       searchPage = await findPageWith(page, SEARCH_INPUT);
196:     }
197:     if (!searchPage) {
198:       throw new Error(`未进入搜索页，没找到 ${SEARCH_INPUT}`);
199:     }
```

**第 2 步（190-199 行）：等新页面出现**

- 191 行：先假设没找到
- 192 行：算出截止时间（又是第 8 节那个模式）
- 193 行：**两个条件都要满足才继续循环**：
  - `Date.now() < deadline` 还没超时
  - `!searchPage` 还没找到
  - **任一不成立就退出**
- 194 行：等 500 毫秒（给新页面渲染的时间）
- 195 行：**在 `page` 的 context 里找含搜索输入框的页面**
  - 注意这里传的是 `page` 而不是 `target`——因为要找的是**新出现的页面**，它和 `target` 是同一个 context 下的兄弟页面
- 197-199 行：超时仍未找到 → 抛错

```js
200:     // 4. tap 输入框聚焦，软键盘弹出说明焦点已拿到
201:     await tapElement(device, searchPage, searchPage.locator(SEARCH_INPUT).first());
202:     if (!(await waitImeShown(device, searchPage))) {
203:       throw new Error("输入框未获得焦点（软键盘没弹出）");
204:     }
205:     console.log("已打开搜索页并聚焦输入框");
```

**第 3 步（200-205 行）：让输入框拿到焦点**

- 201 行：真实点击输入框
- 202 行：**`!(await ...)` 两个操作叠加**：
  - `waitImeShown(...)` 等键盘弹出，返回 true/false
  - `!` 取反
  - 合起来 = "**如果键盘没弹出来**"
  - 括号是必须的：`!(x)` 和 `!x` 在优先级上容易出错，加括号更清晰
- 203 行：键盘没起来 → 抛错，说明点击没让输入框聚焦

```js
206:     await searchPage.waitForTimeout(1500);
207:     await device.shell("input text test");
208:     await device.shell("input keyevent 66");
209:     await device.shell("input keyevent 66");
210:     return searchPage;
```

**第 4 步（206-210 行）：输入关键词并搜索**

- 206 行：硬等 1.5 秒（让键盘动画完成、输入框完全就绪）
- 207 行：`input text test` —— **通过 adb 输入文字 "test"**
  - ⚠️ **硬编码**：搜索关键词写死在代码里。函数名叫 `focusSearchInput`（聚焦搜索输入框），但实际干了"输入 test + 搜索"的活，**名实不符**
  - 注释里说"关键词输入由调用方自行处理"，可代码里又自己输入了 test——**注释和实现矛盾**
- 208-209 行：`input keyevent 66` —— 66 是安卓键码里的 **ENTER（回车）键**
  - **连按两次**，可能第一次是收起键盘，第二次才触发搜索；也可能是为了兼容不同页面的响应方式
  - ⚠️ 这种"猜出来的操作"没有注释说明原因，是典型的**技术债**
- 210 行：返回搜索页，让调用方可以继续在上面操作

**⚠️ 这个函数的核心问题（也是后面要优化的重点）：**

1. **名实不符**：叫"聚焦输入框"，实际完成了"打开 + 聚焦 + 输入 + 搜索"全流程
2. **关键词硬编码**：`"test"` 写死，无法参数化。想搜别的词只能改代码
3. **没有断言**：输入完就返回，**不验证搜索结果是否正确**。用例只能证明"流程没报错"，不能证明"功能是对的"
4. **复合职责**：一个函数干了 4 件事，任何一步失败都难以定位到底是哪个环节出的问题

---

## 第 10 节：五个通用操作（384-574 行）【均已重构】

这五个函数结构高度相似，掌握了规律就能快速看懂。

### `clickElementById`（384-418 行）按 id 点击【已重构】

```js
223: async function clickElementById(page, { elementId, timeout = 10000 } = {}) {
224:   try {
225:     const el = page.locator(`#${elementId}`);
226:     await el.waitFor({ state: "visible", timeout });
227:     await el.click({ timeout });
228:     await page.waitForTimeout(500);
```

- 225 行：`` `#${elementId}` `` —— `#` 在 CSS 选择器里表示"按 id 查找"。传 `elementId: "submit"` 就变成 `#submit`
- 226 行：等元素**可见**（不只是存在）
- 227 行：点击。**这里用的是 Playwright 原生点击，不是 `tapElement`**
  - ⚠️ 如果是 `wx-view` 类元素，这里会点了没反应——**函数没有告诉使用者这个限制**
- 228 行：点完等 500 毫秒让界面反应

### `clickElementByText`（419-439 行）按文本点击【已重构】

```js
245:     const el = page.getByText(text, { exact: false }).first();
246:     await el.waitFor({ state: "visible", timeout });
247:     await el.click({ timeout });
```

- 245 行：三个要点
  - `getByText(text)` 按**可见文本**定位
  - `{ exact: false }` **模糊匹配**——传 "我的" 也能匹配到 "我的页面"。灵活但**可能误匹配**（要精确匹配就传 `true`）
  - `.first()` 取第一个。**必须有**，否则匹配多个时会报错
  - 注意这一行**没有 `await`**，因为它只是"创建一个定位器描述"，还没真正去查。真正的异步操作在下一行的 `waitFor`

### `inputText`（440-482 行）输入文本【已重构】

```js
265:     const el = page.locator(`#${elementId}`);
266:     await el.waitFor({ state: "attached", timeout });
267:     await el.click();
268:     await el.fill(text);
```

- 266 行：这里等的是 **`attached`（存在于 DOM）而不是 `visible`**
  - 区别：元素只需要"存在于页面结构里"，不需要"显示在屏幕上"
  - 对输入框来说，有时它不可见但仍能填内容，所以判断更宽松
- 267-268 行：**先点一下，再填内容**
  - 先 `click()` 是为了让输入框**拿到焦点**（还记得 `waitImeShown` 强调的焦点问题吗）
  - `fill()` 是 Playwright 的方法，会**先清空再填入**，比逐字模拟输入快得多
  - ⚠️ **没有用 `waitImeShown`**：`fill()` 走的是浏览器层面的输入，不依赖软键盘，所以不需要等键盘。但如果这个输入框是 `wx-input` 特殊组件，`fill()` 可能无效，那时就得像 `focusSearchInput` 那样改用 adb
- ⚠️ 267 行的 `click()` 和 268 行的 `fill()` **都没有传 `timeout`**，用的是 Playwright 默认的 30 秒

### `assertElementExists`（483-507 行）断言元素存在【已重构】

```js
286:     await page.locator(`#${elementId}`).waitFor({ state: "attached", timeout });
287:     console.log(`元素存在校验通过: ${elementId}`);
```

- 这是**唯一的"断言"函数**，但它的实现方式很取巧：**靠 `waitFor` 超时报错来充当断言失败**
- 问题：
  1. **失败信息很差**。超时报的是 `Timeout 5000ms exceeded`，你看不出"我是想验证 xxx 元素存在"
  2. **只能断言"元素存在"**，没法断言"文本内容等于 xxx"、"页面跳转到了 xxx"
  3. **默认等 `attached`**，元素存在但被隐藏也算通过——很多时候你其实想验证"用户能看到它"
- ⚠️ **命名与返回值不自洽**：叫 `assert...`（断言），却和其他操作函数一样 `return page`。断言本该没有返回值

### `swipeUp`（508-574 行）向上滑动【已重构】

```js
303:     const size = page.viewportSize() || { width: 0, height: 0 };
304:     const startX = Math.floor(size.width / 2);
305:     const startY = Math.floor(size.height * 0.8);
306:     const endY = Math.floor(size.height * 0.2);
307:     const steps = Math.max(2, Math.round(duration / 100));
308:     await page.mouse.move(startX, startY);
309:     await page.mouse.down();
310:     await page.mouse.move(startX, endY, { steps });
311:     await page.mouse.up();
```

- 303 行：取视口（可视区域）大小。`|| { width: 0, height: 0 }` 是兜底：万一取不到就用 0，避免后面崩
- 304 行：**横坐标取屏幕正中**
- 305-306 行：**纵坐标从 80% 处滑到 20% 处** —— 也就是从下方往上方滑，这就是"向上滑动"（内容向上滚，看到下面的内容）
- 307 行：`steps` 是**把一次滑动拆成几步**。`Math.max(2, ...)` 保证**至少 2 步**
  - 为什么要拆？**一次性瞬移不会被识别成"滑动"，必须模拟出连续移动的轨迹**。小程序和原生手势识别都要求这一点
- 308-311 行：**鼠标按下 → 移动 → 抬起**，这是模拟拖拽的标准三段式
  - ⚠️ **这里用的是 `page.mouse`（浏览器合成事件）**，而点击却必须用 `tapElement`（真实 adb 事件）——**两者策略不一致**。如果小程序对滑动也要求真实触摸，这个函数就会失效
  - 更可靠的做法是用 `input swipe x1 y1 x2 y2 duration` 走 adb
- 312 行：滑完等 500 毫秒

---

## 第 11 节：返回上一页（575-592 行）

```js
326: async function goBack(page) {
328:     await page.goBack();
```

- `page.goBack()` 是 **Playwright 的浏览器历史后退**（相当于点浏览器的返回按钮）
- ⚠️ **这是本文件里风险最高的函数之一**：
  - 小程序内部**通常不是标准的浏览器历史导航**，而是它自己的路由栈。`goBack()` 大概率**不生效或行为不可预期**
  - 在小程序里"返回"，可靠做法是**点左上角的返回按钮**（真实 tap）或者调小程序的 API，而不是用浏览器后退

---

## 第 12 节：切换 WebView 上下文（593-625 行）

```js
344: async function switchToWxWebview(device, { timeout = 20000 } = {}) {
346:     const webview = await device.webView({ pkg: WX_WEBVIEW_PKG }, { timeout });
347:     const page = await webview.page();
348:     await page.waitForLoadState("domcontentloaded");
350:     let targetPage = page;
351:     let maxCount = -1;
352:     for (const p of page.context().pages()) {
353:       const count = await p.locator("*").count();
354:       if (count > maxCount) {
355:         targetPage = p;
356:         maxCount = count;
357:       }
358:     }
```

这是**另一个"找目标页面"的思路**，和 `getForegroundPage` 的"看动画帧"形成对比。

- 344 行：**第一个参数是 `device` 而不是 `page`** —— 因为这一步还没拿到页面，需要从设备层面找
- 346 行：`device.webView({ pkg: WX_WEBVIEW_PKG })` 按**进程包名**找 WebView
  - 这就是第 1 节那个 `WX_WEBVIEW_PKG` 唯一的用处
- 347 行：`webview.page()` 把 WebView 转成可操作的 `page`
- 348 行：等 DOM 加载完成（`domcontentloaded` 是网页加载的一个阶段）
- 350-358 行：**"元素最多者胜"策略**——遍历所有页面，数每个页面上有多少个元素，选**最多的那个**
  - 351 行：`maxCount = -1` 的用意：保证**第一次比较必定成立**（任何实际数量都 ≥ 0 > -1）
  - 353 行：`locator("*")` 匹配所有元素，`.count()` 数个数
  - 354-357 行：比当前最大值大就更新
- 设计意图（见 349 行注释）：**避免落在空白页上**。空白页元素少，内容页元素多

**三种"找页面"思路对比**（这是理解本文件的关键）：

| 函数 | 判定依据 | 优点 | 风险 |
|---|---|---|---|
| `findPageWith` | 含指定选择器 | 精确，知道要找什么 | 多个页面都有该元素时可能选错 |
| `getForegroundPage` | 是否还在产生动画帧 | 直接判断"谁在前台" | 慢（最坏遍历×500ms） |
| `switchToWxWebview` | 谁的元素最多 | 无需知道具体元素 | 内容是长列表时可能误判 |

⚠️ 第 352-357 行**没有错误处理**：如果某个页面已失效，`.count()` 会抛错导致整个函数失败（对比 `findPageWith` 里加了 `.catch(() => 0)`）

---

## 第 13 节：小程序内按文本点击（626-647 行）【已重构】

```js
373: async function clickWxText(page, { text, timeout = 10000 } = {}) {
375:     const el = page.getByText(text, { exact: false }).first();
376:     await el.waitFor({ state: "visible", timeout });
377:     await el.click({ timeout });
378:     await page.waitForTimeout(500);
```

- **这个函数和 `clickElementByText`（第 10 节）的实现逐行几乎完全一样**
- 唯一区别是日志文案："已点击小程序文本" vs "已点击文本"
- ⚠️ **这是一个"重复函数"**，属于该被合并的技术债。保留两个名字可能是为了让调用方语义更清楚，但实现完全重叠，维护时改一个忘一个就会产生不一致

---

## 第 14 节：输出页面结构（648-683 行）★调试利器

```js
394: async function dumpElements(page, { tag } = {}) {
396:     const selector = !tag ? "body" : (Array.isArray(tag) ? tag : [tag]).join(",");
397:     const html = await page.evaluate((sel) => {
398:       const lines = [];
399:       const walk = (el, depth) => {
400:         const pad = "  ".repeat(depth);
401:         const name = el.tagName.toLowerCase();
402:         const cls = el.getAttribute("class");
403:         const open = `<${name}${cls ? ` class="${cls}"` : ""}>`;
```

**这个函数是写用例时最该先学会的工具**——它能打印出页面的 HTML 结构，告诉你"该用什么定位器"。

- 394 行：参数 `{ tag }` **没有默认值**，不传就是 `undefined`
- 396 行：**三重判断，逐层降级**
  ```
  !tag ?                    → 没传 tag：用 "body"（输出整个页面）
  Array.isArray(tag) ?      → 传了数组：直接用
  : [tag]                   → 传了单个字符串：包成数组
  .join(",")                → 数组拼成逗号分隔的选择器串
  ```
  - 所以 `tag: "wx-text"` 和 `tag: ["wx-text", "wx-view"]` 都支持
- 397 行：`page.evaluate((sel) => {...}, selector)` —— **整个遍历逻辑在页面内部执行**
  - 为什么要这样？因为 `document`、`Node.TEXT_NODE`、`el.children` 这些只有页面里才有，Node.js 里不存在
  - 第二个参数 `selector` 传进去变成 `sel`
- 399 行：`walk` 是一个**递归函数**（自己调用自己），用来遍历 DOM 树
- 400 行：`"  ".repeat(depth)` —— 按层级生成缩进。`repeat` 把字符串重复 N 次（depth=2 就是 4 个空格）
- 401 行：`el.tagName.toLowerCase()` —— 标签名转小写（DOM 里可能返回大写 `DIV`）
- 402 行：取 `class` 属性，取不到就是 `null`
- 403 行：拼出开始标签。**三元表达式**嵌套在模板字符串里：
  ```
  cls ? ` class="${cls}"` : ""
  ↑ 有 class 就拼上   ↑ 没有就拼空字符串
  ```

```js
404:         const kids = Array.from(el.children);
405:         const text = Array.from(el.childNodes)
406:           .filter((n) => n.nodeType === Node.TEXT_NODE)
407:           .map((n) => n.textContent.replace(/\s+/g, " ").trim())
408:           .filter(Boolean)
409:           .join(" ");
```

- 404 行：`Array.from(el.children)` 把子元素集合转成**真正的数组**（这样后面才能用数组方法）
- 405-409 行：**链式调用，四步处理文本**：
  1. `childNodes` 取所有子节点（包括文本节点、注释节点等）
  2. `.filter(n => n.nodeType === Node.TEXT_NODE)` **只保留纯文本节点**（排除元素节点）
  3. `.map(...)` 处理每个文本：`replace(/\s+/g, " ")` 把**连续空白压缩成一个空格**（正则里 `\s` 是空白符，`+` 是一个或多个，`g` 是全局），`trim()` 去掉首尾空白
  4. `.filter(Boolean)` **过滤掉空字符串**（`Boolean("")` 是 `false`）
  5. `.join(" ")` 用空格拼起来
  - **为什么要这么麻烦？** 因为 HTML 源码里有大量缩进换行，直接取 `textContent` 会得到一堆空白，输出无法阅读

```js
410:         if (!kids.length) {
411:           lines.push(`${pad}${open}${text}</${name}>`);
412:           return;
413:         }
414:         lines.push(`${pad}${open}`);
415:         if (text) lines.push(`${pad}  ${text}`);
416:         kids.forEach((k) => walk(k, depth + 1));
417:         lines.push(`${pad}</${name}>`);
```

- 410-413 行：**没有子元素 → 压缩成一行**（`<标签>文本</标签>`），然后 `return` 结束本次递归
  - 这样输出更紧凑，避免每个文字都占三行
- 414-417 行：**有子元素 → 分三部分**
  - 开始标签
  - 自己的文本（如果有）
  - **递归处理所有子元素**（`depth + 1` 让缩进加深一层）
  - 结束标签
- 419 行：**`document.querySelectorAll(sel).forEach(...)`** —— 找到所有匹配的元素，每个都从 depth 0 开始遍历
- 420 行：`lines.join("\n")` 用换行拼成完整字符串。**这个字符串会作为 `evaluate` 的返回值传回 Node.js**
- 422 行：`console.log(html)` 打印到控制台 —— 这就是你在 pytest 输出里能看到页面结构的原因

**怎么用它**：在用例里加一步 `[dumpElements, null]`，跑完就能在输出里看到整个页面的结构，从而决定用哪个选择器。这是**写新用例时的第一步**。

---

## 第 15 节：导出清单（684-700 行）

```js
430: module.exports = {
431:   WX_WEBVIEW_PKG,
432:   getForegroundPage,
433:   login,
434:   clickElementById,
435:   clickElementByText,
436:   inputText,
437:   assertElementExists,
438:   swipeUp,
439:   goBack,
440:   switchToWxWebview,
441:   clickWxText,
442:   switchToUserCenter,
443:   focusSearchInput,
444:   dumpElements,
445: };
```

- `module.exports = { ... }` 定义**这个文件对外提供什么**。只有写在这里面的东西，别的文件 `require` 才拿得到
- 用的是**简写语法**：`getForegroundPage,` 等价于 `getForegroundPage: getForegroundPage,`（键名和变量名相同时可省略）

### ⚠️ 这里有三个重要发现

**发现 1：4 个函数没有导出**

| 函数 | 行号 | 是否导出 |
|---|---|---|
| `getDevice` | 29 | ❌ 未导出 |
| `tapElement` | 46 | ❌ 未导出 |
| `findPageWith` | 63 | ❌ 未导出 |
| `waitImeShown` | 161 | ❌ 未导出 |

**后果**：用例层**无法直接使用真实 tap 能力**。如果你的用例遇到 `wx-view` 点不动，只能自己去 `android.js` 里加新函数，无法在用例内临时调用 `tapElement`。建议后续把 `tapElement` 导出——它是框架最有价值的能力之一。

**发现 2：导入了但没用**

- `getWxWebviewPage`（第 16 行导入）
- `_android: android`（第 17 行导入）—— 在本文件里也没用到，`getDevice` 用的是它，所以**实际有用**，只有 `getWxWebviewPage` 完全没用上

**发现 3：导出了但没人用**

- `WX_WEBVIEW_PKG`：只有 `switchToWxWebview` 用，而它本身也没被用例调用
- `switchToWxWebview` / `goBack` / `clickWxText` / `switchToUserCenter` / `assertElementExists` / `swipeUp` / `inputText`：`test_example.js` 里全部没用

---

## 附：全文 19 个函数速查表（行号已更新至 700 行版本）

| 行号 | 函数 | 参数 | 用途 | 导出 |
|---|---|---|---|---|
| 29 | `getDevice` | 无 | 懒加载设备（取第一个） | ❌ |
| **57** | **`findClickableAncestor`** | locator | **向上找可点击祖先容器**（新增） | ❌ |
| 119 | `tapElement` | device, page, locator | **真实 adb 点击**【已重构】 | ✅ |
| 145 | `findPageWith` | page, selector | 按选择器找页面 | ❌ |
| 171 | `switchToUserCenter` | page, {timeout,retries} | 切到「我的」【幂等+重试】 | ✅ |
| 249 | `getForegroundPage` | page, {timeout} | **探测前台页面** | ✅ |
| 282 | `login` | page | 登录流程【改真实 tap】 | ✅ |
| 322 | `waitImeShown` | device, page, timeout | **等软键盘弹出** | ❌ |
| 341 | `focusSearchInput` | page, {timeout} | 打开搜索并搜索 test | ✅ |
| 384 | `clickElementById` | page, {elementId, timeout} | 按 id 点击【属性选择器】 | ✅ |
| 419 | `clickElementByText` | page, {text, timeout} | 按文本点击【真实 tap】 | ✅ |
| 440 | `inputText` | page, {elementId, text, timeout} | 输入文本【含读回校验】 | ✅ |
| 483 | `assertElementExists` | page, {elementId, timeout} | 断言元素存在【属性选择器】 | ✅ |
| 508 | `swipeUp` | page, {duration,startRatio,endRatio,timeout} | 向上滑动【adb swipe + 位移校验】 | ✅ |
| 575 | `goBack` | page | 浏览器后退（**仍不可用，待修**） | ✅ |
| 593 | `switchToWxWebview` | device, {timeout} | 按包名切 WebView | ✅ |
| 626 | `clickWxText` | page, {text, timeout} | 按文本点击（与 419 重复） | ✅ |
| 648 | `dumpElements` | page, {tag} | **打印页面 HTML（调试点）** | ✅ |
| 684 | `module.exports` | — | 导出清单 | — |

---

## 附：本文件问题清单（状态已更新至 2026/10/10）

> ⚠️ 下表是**读代码时得出的初步清单**。其中多数已在后续排查中修复，
> 完整、权威的版本见 [框架能力与问题账本.md](框架能力与问题账本.md) 第六节。
> 此处保留是为了对照"当时看到的"与"实际是什么"。

### 已修复

| # | 问题 | 原位置 | 状态 |
|---|---|---|---|
| 4 | `tapElement` 等核心工具未导出 | 原 430-445 | ✅ `tapElement` 已导出 |
| 7 | `swipeUp` 用合成鼠标事件 | 原 308-311 | ✅ 改 `adb input swipe` + 位移校验（**实测原来确实完全无效**） |
| 9 | `switchToUserCenter` 缺 `.first()` | 原 78 | ✅ 已修，并顺带修复了更严重的"旧 page 验证"问题 |
| 14 | `inputText` 未传 timeout | 原 267-268 | ✅ 已补 timeout，并新增读回校验防假通过 |

### 仍待修

| # | 问题 | 当前位置 | 影响 |
|---|---|---|---|
| 1 | **关键词硬编码为 `test`**，函数无法参数化 | 341-383 | 想搜别的词必须改代码 |
| 2 | **登录账号 `4148` 硬编码** | 282-321 | 换账号/环境就要改代码 |
| 3 | **完全没有结果断言** | 全局 | 只能证明"流程没报错"，不能证明"功能正确" |
| 5 | **`devices[0]` 未按序列号筛选** | 29-36、199、277 | 多设备时连错机器；无设备时报错难懂 |
| 6 | `goBack` 用浏览器后退 | 575-592 | **实测确认无效**，需改为点左上角返回按钮 |
| 8 | `clickWxText` 与 `clickElementByText` 实现重复 | 419 / 626 | 维护时容易改一个忘一个 |
| 10 | `assertElementExists` 靠超时充当断言失败 | 483-507 | 失败信息无意义，且只支持"存在"一种断言 |
| 11 | `focusSearchInput` 名实不符、职责过载 | 341-383 | 一个函数干 4 件事，失败难定位 |
| 12 | `getWxWebviewPage` 导入未使用 | 16 | 冗余 |
| 13 | `switchToWxWebview` 循环缺错误兜底 | 593-625 | 单页失效导致整体失败 |
| 15 | 注释与实现矛盾 | 注释在 341 附近 | 注释说"关键词由调用方处理"，实际自己输入了 |
| 16 | 双击回车无原因说明 | `focusSearchInput` 内 | 技术债，后人不敢动 |

> 补充：原清单遗漏了两个更严重的问题，是后来实测才发现的 ——
> `#id` 选择器对小程序 id 失效（影响 3 个函数）、
> 以及所有点击都用合成 `.click()`（8 处）。详见账本第五节。
