/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**源码里的类名，运行时的 DOM 里到底有没有？**
 *
 * 【为什么问这个】owner 2026/10/15 把小程序前端源码（`eco-microapp/src`）给了我们。
 * 源码里到处都是**业务类名**：`eco-tab-item`、`case-list-card`、`overlay-mask`……
 * 这些是从 TSX 的 `className` 直接来的，比 `fs-28 text-_h3D3D3D_` 这种**原子类**（编译出来的样式名）
 * 稳定得多，也**看得懂** —— 但对定位有用没用，取决于**运行时 DOM 里它们还在不在**。
 * 这个探针就是去量这一件事，顺便把"文字重名时怎么圈范围"的写法验证一遍。
 *
 * 三件事：
 *   ① 某个文字的**祖先链**上都挂着什么 class（看业务类名在不在）；
 *   ② `[class*="eco-tab-item"]` 之类的**部分匹配**能命中几个；
 *   ③ **范围内按文字定位**（`page.locator(范围).getByText(文字)`）是不是仍然只给最内层。
 *
 * 只读：不点、不写。运行（手机停在你那一页）：
 *     node test_case/diagnostic/probe_anchors.js
 *     node test_case/diagnostic/probe_anchors.js --text 推荐 --scope .eco-tabs-bar
 */

const { appTest, resolveForegroundPage } = require("../../common/app_common");

const argv = process.argv.slice(2);
function arg(name, def = "") {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
}
const TEXT = arg("text", "推荐");
const SCOPE = arg("scope", ".eco-tab-bar-container");

async function probe(page) {
  const fg = await resolveForegroundPage(page);

  // ① 祖先链：从最内层的文字节点往上走，看每一层挂的 class
  console.log(`\n===== 「${TEXT}」的祖先链（从文字那层往上） =====`);
  const chain = await fg.getByText(TEXT).first().evaluate((el) => {
    const out = [];
    let cur = el;
    for (let i = 0; cur && i < 10; i++) {
      const r = cur.getBoundingClientRect();
      out.push({
        tag: cur.tagName.toLowerCase(),
        cls: String(cur.getAttribute("class") || ""),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","),
      });
      cur = cur.parentElement;
    }
    return out;
  });
  chain.forEach((c, i) => {
    console.log(`  ${"↑".repeat(0)}${i === 0 ? "文字层" : `上 ${i} 层`}: <${c.tag}> class=${JSON.stringify(c.cls)} rect=${c.rect}`);
  });

  // ② 部分匹配：业务类名带不带 hash 后缀？（带了就得用 [class*=...] 而不是 .名字）
  console.log(`\n===== 业务类名的部分匹配 =====`);
  for (const probeCls of ["eco-tab-item", "eco-tab-bar-container", "tab-item", "case-list-card", "overlay-mask"]) {
    const n = await fg.locator(`[class*="${probeCls}"]`).count();
    const exact = await fg.locator(`.${probeCls}`).count();
    console.log(`  [class*="${probeCls}"] -> ${n} 个；.${probeCls} -> ${exact} 个`);
  }

  // ③ 范围内按文字定位：范围写对了吗？答应的"只给最内层"还成立吗？
  console.log(`\n===== 范围内按文字定位：范围=${SCOPE} 文字=${TEXT} =====`);
  const scopeCount = await fg.locator(SCOPE).count();
  console.log(`  范围本身命中 ${scopeCount} 个元素`);
  const scoped = fg.locator(SCOPE).getByText(TEXT);
  const n = await scoped.count();
  console.log(`  page.locator(${SCOPE}).getByText(${TEXT}) -> ${n} 个`);
  for (let i = 0; i < n; i++) {
    const info = await scoped.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return `<${el.tagName.toLowerCase()}> class=${JSON.stringify(String(el.getAttribute("class") || ""))} rect=${[
        Math.round(r.x),
        Math.round(r.y),
        Math.round(r.width),
        Math.round(r.height),
      ].join(",")}`;
    });
    console.log(`    ${i + 1}. ${info}`);
  }

  // 对照：不在范围里找，会命中几个？
  const global = await fg.getByText(TEXT).count();
  console.log(`  对照：整页 page.getByText(${TEXT}) -> ${global} 个`);

  // ④ 「某个 tab 是选中的」怎么写断言？（源码：选中项 class 里多 `active eco-tab-item-active`）
  console.log(`\n===== 选中态断言写法 =====`);
  const active = await fg.locator(".eco-tab-item-active").count();
  const activeText = active ? (await fg.locator(".eco-tab-item-active").first().innerText()).replace(/\s+/g, " ").trim() : "";
  console.log(`  .eco-tab-item-active -> ${active} 个；它的文字是 ${JSON.stringify(activeText)}`);
  for (const t of ["最新提问", "推荐"]) {
    const n = await fg.locator(`.eco-tab-item-active:has-text("${t}")`).count();
    const viaScope = await fg.locator(".eco-tab-bar-container").locator(`.eco-tab-item-active:has-text("${t}")`).count();
    console.log(`  .eco-tab-item-active:has-text("${t}") -> ${n} 个（再套一层范围 -> ${viaScope} 个）`);
  }

  // ⑤ 底部 tab 栏能不能当"范围"用？
  // 为什么问：首页上同时存在「我的」（底部 tab）和「我的关注」（筛选 tab），
  // 按文字整页找会命中 2 个 —— 跟「推荐」是同一类撞名（框架现在靠"取第 1 个"顶着，
  // 也就是靠 DOM 顺序，不是靠确定性）。源码里底部 tab 栏是 Taro 的 `custom-tab-bar`。
  console.log(`\n===== 底部 tab 栏（range 候选） =====`);
  const BAR = '[class*="custom-tab-bar"]';
  for (const sel of [BAR, ".custom-tab-bar", "wx-view.custom-tab-bar"]) {
    console.log(`  ${sel} -> ${await fg.locator(sel).count()} 个`);
  }
  if (await fg.locator(BAR).count()) {
    const cls = await fg.locator(BAR).first().evaluate((el) => String(el.getAttribute("class") || ""));
    console.log(`  容器的 class = ${JSON.stringify(cls)}`);
  }
  const whole = await fg.getByText("我的").count();
  const inBar = await fg.locator(BAR).getByText("我的").count();
  console.log(`  「我的」：整页 -> ${whole} 个；圈进 tab 栏 -> ${inBar} 个`);
  for (const t of ["有问必答", "学习中心", "设计专区", "我的"]) {
    console.log(`    范围里「${t}」 -> ${await fg.locator(BAR).getByText(t).count()} 个`);
  }
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "定位口径", title: "源码类名在运行时 DOM 里吗" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
