/*
 * 诊断（不以 test_ 开头，pytest 不收集）：从**首页 banner** 找案例库入口。
 *
 * 背景（两条已被证伪的猜想，记下来免得重复踩）：
 *   ① 用户中心里的「仿真案例」不是入口 —— 实测它是"收藏"下面的**类型筛选单选按钮**
 *      （class=nut-radio，父级 favorites-type），点了不跳转是正确行为；
 *   ② 首页有张 banner 写着「教你玩转 仿真案例库」（早先的首页截图里见过）—— 这条待验。
 *
 * 本探针：回到首页 -> 找出所有含「案例库」的元素及其层级 -> 点它 -> 看落到哪一页。
 * 只读：只点这一处入口 + 读文字。
 * 运行：node test_case/diagnostic/probe_case_from_home.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;

const WORDS = ["案例库", "仿真案例", "全部评论", "全部回答", "分类", "复制"];

async function dumpWords(page, label, limit = 220) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n[%s] 元素=%d", label, await base.countOf(fg, "*"));
  WORDS.forEach((w) => console.log("   %s: %s", w, text.includes(w) ? "有" : "无"));
  console.log("   文字开头: %s", JSON.stringify(text.slice(0, limit)));
  return text;
}

async function probe(page) {
  page = await qa.ensureOnHomeFeed(page);
  const fg = await base.foreground(page);

  const hits = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const t = norm(el.innerText);
      if (t.includes("\u6848\u4f8b\u5e93") && t.length <= 30) {
        const r = el.getBoundingClientRect();
        const cls = String(el.getAttribute("class") || "");
        out.push({
          tag: el.tagName.toLowerCase(),
          cls,
          text: t,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
        if (out.length >= 8) break;
      }
    }
    return out;
  });

  console.log("\n[首页里含「案例库」的元素]");
  if (!hits.length) console.log("   （没有）—— 首页上可能没有这个 banner");
  hits.forEach((h) => console.log("   <%s class=%s> %s rect=%s", h.tag, h.cls, JSON.stringify(h.text), JSON.stringify(h.rect)));

  const hit = hits.find((h) => h.text.includes("案例库"));
  if (hit) {
    await base.tapText(await base.foreground(page), hit.text, "banner「" + hit.text + "」");
    await base.sleep(3000);
    await dumpWords(page, "点 banner 之后", 260);
  }

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "首页 banner 是否是案例库入口" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
