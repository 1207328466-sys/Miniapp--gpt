/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**"这个元素渲染了几行"怎么量、拿什么当样本？**
 *
 * 【为什么问】缺陷 713587136 要的判据是「案例描述应该显示 1 行，实际显示了两行」——
 * 也就是说框架需要"量元素行数"的能力。量法：**渲染高度 ÷ 行高**（四舍五入）。
 * 但这个量法要先用真机上的"已知几行"的元素校准，否则很容易量错
 *（例如行高是 `1.5` 这种比值、或者元素带 margin/padding）。
 *
 * 候选样本（都在案例库里，源码口径明确）：
 *   · `.case-list-card-title` —— 源码 `numberOfLines={2}`（最多两行，长标题就是两行）
 *   · `.case-list-card-username` / `.case-list-card-viewcount` —— 短文本，应当 1 行
 *
 * 只读：打开案例库 + 量元素，不改数据。
 * 运行：node test_case/diagnostic/probe_element_lines.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

/** 量一批元素的行数（跟 base_page.elementLines 同一套算法，这里顺便把明细打出来） */
async function measure(fg, selector) {
  return fg.evaluate((sel) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll(sel)).slice(0, 12).map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 0;
      return {
        i,
        text: norm(el.innerText).slice(0, 22),
        height: Math.round(r.height),
        lineHeight: Math.round(lh),
        lines: lh ? Math.round((r.height / lh) * 10) / 10 : null,
        whiteSpace: cs.whiteSpace,
      };
    });
  }, selector);
}

async function probe(page) {
  page = await caseLibrary.ensureOn(page);
  const fg = await base.foreground(page);
  for (const sel of [".case-list-card-title", ".case-list-card-username", ".case-list-card-viewcount"]) {
    const rows = await measure(fg, sel);
    console.log(`\n===== ${sel}（${rows.length} 个）=====`);
    rows.slice(0, 6).forEach((r) => {
      console.log(
        `  ${String(r.i).padStart(2)}. 高=${String(r.height).padStart(3)} 行高=${String(r.lineHeight).padStart(3)} ` +
          `=> **${r.lines} 行**  white-space=${r.whiteSpace}  文字=${JSON.stringify(r.text)}`
      );
    });
  }

  /*
   * 再找"确实是多行"的样本：**在案例库这页上扫一遍**（不用跳页），
   * 看哪些 wx-text 用 Range 数出来 ≥ 2 行 —— 拿它们校准"多行怎么量"。
   */
  const multi = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    document.querySelectorAll("wx-text, wx-view").forEach((el) => {
      const text = norm(el.innerText);
      if (text.length < 6) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter((x) => x.height > 0);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (rects.length >= 2) {
        out.push({
          cls: String(el.getAttribute("class") || "").slice(0, 40),
          lines: rects.length,
          height: Math.round(r.height),
          lineHeight: cs.lineHeight,
          byHeight: parseFloat(cs.lineHeight) ? Math.round((r.height / parseFloat(cs.lineHeight)) * 10) / 10 : null,
          text: text.slice(0, 26),
        });
      }
    });
    return out.slice(0, 10);
  });
  console.log(`\n===== 案例库这页上"用 Range 数出 ≥2 行"的元素（${multi.length} 个）=====`);
  multi.forEach((r) => {
    console.log(
      `  cls=${JSON.stringify(r.cls)} 高=${r.height} line-height=${r.lineHeight} => **${r.lines} 行**` +
        `（按高度算 ${r.byHeight}）  文字=${JSON.stringify(r.text)}`
    );
  });
  return fg;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "行数", title: "元素渲染了几行怎么量" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
