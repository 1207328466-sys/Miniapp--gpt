/*
 * 诊断（不以 test_ 开头，pytest 不收集）：缺陷 713587136「案例介绍卡片中案例描述显示的行数错误」
 * —— 案例库「压铸护航服务」tab 里那批**案例介绍卡片**的描述，到底渲染了几行？
 *
 * 【缺陷原文】「应该按照UI显示1行案例描述内容，实际显示了两行」。
 * 【源码口径】`src/pages/cases/components/escort/CaseIntro.tsx` + `escort.less`：
 *     <Text className="escort-case-desc">{c.description}</Text>
 *     .escort-case-desc { font-size: 28px; line-height: 1.5; overflow: hidden;
 *                         text-overflow: ellipsis; white-space: nowrap; }
 *   → `white-space: nowrap` + 省略号 = **正好一行**（这就是那条修复）。
 * 【怎么量"几行"】拿元素**渲染高度**除以**行高**（28 × 1.5 = 42px）：
 *   一行 ≈ 42（实测会取整到 42~43），两行 ≈ 84。
 *
 * 只读：切 tab + 读元素，不改数据。
 * 运行：node test_case/diagnostic/probe_escort_case_desc.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

async function probe(page) {
  page = await caseLibrary.ensureOn(page);
  // 案例库顶部有两个 tab：「仿真案例库」/「压铸护航服务」；护航那片里有「行业案例」卡片
  const hasTab = await base.countOfText(page, "压铸护航服务");
  console.log(`案例库顶部有「压铸护航服务」吗：${hasTab > 0 ? "有" : "没有"}`);
  if (hasTab > 0) {
    await base.tapText(page, "压铸护航服务", "顶部 tab「压铸护航服务」");
    await base.sleep(2500);
  }

  const info = await base.foreground(page).then((fg) =>
    fg.evaluate(() => {
      const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const out = [];
      document.querySelectorAll(".escort-case-card").forEach((card) => {
        const desc = card.querySelector(".escort-case-desc");
        const title = card.querySelector(".escort-case-title");
        if (!desc) {
          out.push({ title: norm(title ? title.innerText : ""), desc: "(没有 .escort-case-desc)" });
          return;
        }
        const r = desc.getBoundingClientRect();
        const cs = getComputedStyle(desc);
        const lh = parseFloat(cs.lineHeight) || 0;
        out.push({
          title: norm(title ? title.innerText : ""),
          text: norm(desc.innerText),
          height: Math.round(r.height),
          lineHeight: Math.round(lh),
          lines: lh ? Math.round((r.height / lh) * 10) / 10 : null,
          whiteSpace: cs.whiteSpace,
          textOverflow: cs.textOverflow,
          overflow: cs.overflow,
        });
      });
      return { cards: out, cardCount: document.querySelectorAll(".escort-case-card").length };
    })
  );

  console.log(`页面上 .escort-case-card 有 ${info.cardCount} 个；.escort-case-desc 的情况：`);
  info.cards.slice(0, 8).forEach((c, i) => {
    if (c.desc) {
      console.log(`  ${i + 1}. 标题=${JSON.stringify(c.title)} ${c.desc}`);
    } else {
      console.log(
        `  ${i + 1}. 标题=${JSON.stringify(c.title)} 描述=${JSON.stringify(c.text)} ` +
          `高=${c.height} 行高=${c.lineHeight} => **${c.lines} 行**；white-space=${c.whiteSpace} ` +
          `text-overflow=${c.textOverflow} overflow=${c.overflow}`
      );
    }
  });
  return base.foreground(page);
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "案例库", title: "护航案例卡片的描述渲染了几行" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
