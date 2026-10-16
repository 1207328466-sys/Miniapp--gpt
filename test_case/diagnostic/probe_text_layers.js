/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**按文字定位时，命中的到底是哪几层？**
 *
 * 【为什么要问这个】owner 2026/10/13 贴过一段现场日志：首页 4 个筛选 tab，
 * 每个都「命中 3 个元素」—— 也就是说 `getByText("最新提问")` 返回的**不是一个元素，是三层**。
 * 那件事有个直接后果：表格动作「点文字」的**参数2「第几个」**是按"命中列表"数的，
 * 如果一层重复三次，填「第 2 个」拿到的其实是**同一个 tab 的第二层**，不是"页面上的第二处文字"。
 * 同理「检查文字出现次数」数出来的也不是"页面上看到几处"。
 *
 * 这个小探针把命中列表**原样打出来**（标签名 / class / 尺寸 / 谁套着谁），
 * 用来定"该取哪一层"的口径。只读，不改任何数据、不点任何东西。
 *
 * 运行（手机停在你想看的那一页）：
 *     node test_case/diagnostic/probe_text_layers.js
 *     node test_case/diagnostic/probe_text_layers.js --text 最新提问 --text 我的关注
 */

const { appTest } = require("../../common/app_common");

const argv = process.argv.slice(2);
const texts = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--text" && argv[i + 1]) texts.push(argv[i + 1]);
}
if (!texts.length) texts.push("最新提问", "推荐", "精选问答", "我的关注", "有问必答");

/**
 * 把某个文本的命中列表原样读出来 —— **用框架自己那套 API**（`page.getByText`），
 * 不另写一份"我觉得它应该怎么匹配"的实现：那样量出来的就不是框架的真实行为了。
 * 每一项都带上：标签、class、rect、以及"它内部还套着几个同文本命中"（用来判层）。
 */
async function layers(page, text) {
  const loc = page.getByText(text);
  const n = await loc.count();
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      await loc.nth(i).evaluate((el) => {
        const r = el.getBoundingClientRect();
        // 判"谁套着谁"：直接问 DOM（只在同页元素之间比，别用 Playwright 的 locator 关系）
        const deeper = Array.from(el.querySelectorAll("*")).length;
        let depth = 0;
        let p = el;
        while ((p = p.parentElement)) depth++;
        // 子元素里有没有"文字归一化后也等于自己的文本"的 —— 有就说明还有更内层的同文本节点
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const inner = Array.from(el.querySelectorAll("*")).filter(
          (o) => norm(o.textContent) === norm(el.textContent) && o.getClientRects().length > 0
        ).length;
        return {
          tag: el.tagName.toLowerCase(),
          cls: String(el.getAttribute("class") || ""),
          depth,
          childCount: deeper,
          innerSameText: inner,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","),
        };
      })
    );
  }
  return rows;
}

async function probe(page) {
  const { resolveForegroundPage } = require("../../common/app_common");
  const fg = await resolveForegroundPage(page);
  console.log(`前台页 url 尾段: ${fg.url().split("/").slice(-2).join("/")}`);

  for (const text of texts) {
    const rows = await layers(fg, text);
    console.log(`\n===== 「${text}」命中 ${rows.length} 个 =====`);
    rows.forEach((r, i) => {
      console.log(
        `  ${i + 1}. <${r.tag}> class=${JSON.stringify(r.cls)} 深=${r.depth} 子元素=${r.childCount} rect=${r.rect}` +
          (r.innerSameText ? `  ⚠️ 里面还有 ${r.innerSameText} 个同文本的更内层` : "  ← 最内层（真正放文字的那层）")
      );
    });
    const innermost = rows.filter((r) => !r.innerSameText).length;
    console.log(`  —— 其中"最内层"有 ${innermost} 个（这才是"页面上有几处这个文字"）`);
  }
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "定位口径", title: "按文字定位命中了几层" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
