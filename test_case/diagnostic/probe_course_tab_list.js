/*
 * 诊断（不以 test_ 开头，pytest 不收集）：学习中心「课程」tab 上**到底能看见哪些课**。
 *
 * 为什么需要它：需求 713495189 里「课程」这一路要验两种情况 ——
 *   ① 已购用户看 0 评论课程 -> 应显示「参与评论获取积分」；
 *   ② 未购用户看 0 评论课程 -> 应保持原样（源码里是「暂无评论」）。
 * 两种都要先有一门**界面上能点进去的、库里有课时的、评论数为 0 的课**。
 * 库里这样的课有一堆（只读查过：`免费课程-测ios1`、`测试封面图`、`5月18日课程`、`test`…），
 * 但**界面上看不看得见是另一回事**（课时数为 0 的课不显示、未上架的不显示、首页只放热门/最新）。
 * 所以这里把「课程 tab 上真实存在哪些课」摊开，避免拿一个点不进去的名字去写用例。
 *
 * 只读：只切 tab、只读文字，不点课程、不购买、不改任何数据。
 *
 * 运行：node test_case/diagnostic/probe_course_tab_list.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const learnCenter = pages.learnCenter;

/** 库里「有课时 + 公开 + 评论数 0」的课程名（只读 SQL 查出来的候选，用于核对界面上有没有） */
const CANDIDATES = [
  "免费课程-测ios1",
  "免费课程-测ios2",
  "免费课程",
  "免费课程1",
  "测试封面图",
  "测试封面图-修改",
  "测试课程版本-v1",
  "测试课程版本-v1-v2",
  "5月18日课程",
  "10-27",
  "无敌贵的课程",
  "设计提升-专项-2分钟",
  "test",
  "test2",
  "新测试课程",
  "7.8课程new",
  "717",
  "12-8新增0元课程",
  "设计提升1-专题课程-付费",
];

async function probe(page) {
  page = await learnCenter.ensureOnColumnList(page);
  page = await learnCenter.switchToTopTab(page, { tab: "课程" });
  await base.sleep(1500);

  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log(`\n课程 tab 整页文字（前 900 字）：\n${JSON.stringify(text.slice(0, 900))}`);

  // 页面上"看起来像课程卡"的容器（页面对象里记的是圆角壳 wx-view[class*=rounded-_32px_]）
  const cards = await fg.evaluate(() =>
    Array.from(document.querySelectorAll('[class*="rounded-_32px_"]')).map((e) =>
      String(e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70)
    )
  );
  console.log(`\n圆角卡片容器 ${cards.length} 个：`);
  cards.forEach((c, i) => console.log(`   ${i + 1}. ${JSON.stringify(c)}`));

  console.log("\n候选课名是否出现在页面上（含「看不见但在 DOM 里」的）：");
  const found = await fg.evaluate((names) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = {};
    for (const n of names) {
      const hits = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        if (norm(el.innerText) !== n) continue; // "整个元素就是这门课的名字"
        const r = el.getBoundingClientRect();
        hits.push({
          cls: String(el.getAttribute("class") || "").slice(0, 50),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
        if (hits.length >= 3) break;
      }
      out[n] = hits;
    }
    return out;
  }, CANDIDATES);
  Object.keys(found).forEach((n) => {
    const hits = found[n];
    if (!hits.length) return;
    console.log(`   有「${n}」：${hits.length} 处 —— ${JSON.stringify(hits)}`);
  });
  const absent = CANDIDATES.filter((n) => !found[n].length);
  console.log(`   页面上找不到的候选（${absent.length} 个）：${JSON.stringify(absent)}`);

  // 列表能不能往下滚（有些课可能在第二屏）
  const { swipeUp } = require("../../app_sub_function/suprecast_app/android");
  for (let i = 1; i <= 3; i++) {
    page = await swipeUp(page);
    await base.sleep(800);
  }
  const after = await base.pageText(await base.foreground(page));
  console.log(`\n向下滑 3 次之后，整页文字（前 600 字）：\n${JSON.stringify(after.slice(0, 600))}`);
  const stillPresent = CANDIDATES.filter((n) => after.includes(n));
  console.log(`   滑动后仍能在文字里找到的候选：${JSON.stringify(stillPresent)}`);

  page = await pages.qaPage.ensureOnHomeFeed(page);
  console.log("已回首页（探针归位）");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "课程", title: "学习中心课程 tab 上能看见哪些课" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
