/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713381608「案例库详情页操作优化」取证据。
 *
 * 需求里能断言的几条（其余要么走系统分享、要么依赖造数）：
 *   「案例库列表在分类上方展示介绍 banner，点击后进入介绍长图详情页」
 *   「案例详情页取消显示底部的复制数图标、评论数图标」
 *   「评论区标题『全部回答』改为**全部评论**」   ← 最干净的一条：文案断言
 *   「案例复制完成后，弹出提示『使用手机号登录智铸超云，即可查看案例详情』」
 *
 * 要去问：① 案例库从哪进（用户中心里有「仿真案例」字样；首页也见过"教你玩转仿真案例库"）
 * ② 列表页长什么样（分类？banner？） ③ 案例详情页上有没有「全部评论」/「全部回答」/「复制」
 *
 * 只读：只点入口与卡片 / 读文字，不点复制、不点分享，不改任何数据。
 * 运行：node test_case/diagnostic/probe_case_library.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const qa = pages.qaPage;
const userCenter = pages.userCenter;

const WORDS = ["仿真案例", "案例库", "全部评论", "全部回答", "复制", "分类", "推荐"];

async function dumpWords(page, label, limit = 200) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n[%s] 元素=%d", label, await base.countOf(fg, "*"));
  WORDS.forEach((w) => console.log("   %s: %s", w, text.includes(w) ? "有" : "无"));
  console.log("   文字开头: %s", JSON.stringify(text.slice(0, limit)));
  return text;
}

async function probe(page) {
  // ① 用户中心 -> 仿真案例
  page = await userCenter.switchTo(page);
  const uc = await dumpWords(page, "用户中心");
  const entry = ["仿真案例", "案例库"].find((w) => uc.includes(w));
  console.log("\n用户中心里的入口：%s", entry || "（没找到）");
  if (!entry) {
    page = await qa.ensureOnHomeFeed(page);
    return page;
  }

  await base.tapText(await base.foreground(page), entry, "入口「" + entry + "」");
  await base.sleep(3000);
  const listText = await dumpWords(page, "点「" + entry + "」之后", 240);

  // ② 列表页里点第一张卡片（按"看起来像标题"的短文本？先用最简单的方式：
  //    找列表页上的第一个可点卡片 —— 这里用 common 的选择器试探，找不到就如实报）
  const fg = await base.foreground(page);
  const cardCandidates = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const cls = String(el.getAttribute("class") || "");
      if (/case|library|card/i.test(cls) && norm(el.innerText).length > 4) {
        if (out.length < 10) out.push({ tag: el.tagName.toLowerCase(), cls, text: norm(el.innerText).slice(0, 30) });
      }
    }
    return out;
  });
  console.log("\n[列表页里 class 含 case/library/card 的元素]");
  if (!cardCandidates.length) console.log("   （没有）—— 说明卡片用的不是这些类名，需要换个找法");
  cardCandidates.forEach((c) => console.log("   <%s class=%s> %s", c.tag, c.cls, JSON.stringify(c.text)));

  if (cardCandidates.length) {
    const first = cardCandidates[0];
    await base.tapText(await base.foreground(page), first.text, "第一张卡片");
    await base.sleep(2500);
    await dumpWords(page, "点第一张卡片之后（详情页？）", 260);
  }

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "案例库入口 / 列表 / 详情页文案" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
