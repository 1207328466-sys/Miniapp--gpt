/*
 * 诊断（不以 test_ 开头，pytest 不收集）：案例库列表卡片上显示的**复制数**，跟库里对得上吗？
 *
 * 【为什么问】缺陷 713453275「复制数的查看无数据返回」。源码里是 `copyCount ?? 0`
 * （`src/components/case-list/index.tsx`）—— **永远有个数字**，所以"卡片上有数字"会假绿。
 * 这条探针把"界面上显示的"打出来（`tools/case_copy_counts.py` 打印库里的），两边一比就知道
 * 该拿什么当断言口径、以及**是不是同一个数**。
 *
 * 只读：打开案例库 + 读列表，不改任何数据。
 * 运行：node test_case/diagnostic/probe_case_copy_counts.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const caseLibrary = pages.caseLibrary;
const userCenter = pages.userCenter;

/** 读前几张卡的标题+复制数（一行一张，方便跟库里的数对照） */
async function readTop(page, n = 4) {
  page = await caseLibrary.ensureOn(page);
  const cards = await caseLibrary.readList(page);
  const top = cards.slice(0, n);
  console.log(`  列表前 ${top.length} 张：${top.map((c) => `${c.title}=${c.count}`).join("，")}`);
  return { page, cards, top };
}

async function probe(page) {
  const first = await readTop(page);
  page = first.page;

  // `--reenter`：真切一次底部 tab（我的 → 设计专区），看列表会不会重新取数。
  // 为什么用这个而不是下拉：2026/10/16 实测**案例库这页的下拉刷新手势喂不进去**
  // （在顶部、scrollTop=0，但下拉不触发 refresher），而"真切 tab"是坑 49 验过的老办法。
  if (process.argv.includes("--reenter")) {
    page = await userCenter.switchTo(page);
    console.log("  已切到用户中心（真切了一次 tab）");
    const second = await readTop(page);
    page = second.page;
    console.log(
      `  对照：切走再回来，前 ${first.top.length} 张里有 ` +
        `${first.top.filter((a, i) => second.top[i] && a.count !== second.top[i].count).length} 张的数变了`
    );
  }

  const cards = first.cards;
  console.log(`列表里读到 ${cards.length} 张卡片：`);
  cards.forEach((c) => {
    console.log(
      `  ${String(c.index + 1).padStart(2)}. 复制数=${JSON.stringify(c.count)}  ` +
        `图标=${JSON.stringify(c.iconClass)}  标题=${JSON.stringify(c.title)}`
    );
  });
  const titles = cards.map((c) => c.title).filter(Boolean);
  console.log(`\n拿去跟库里对账（把这行贴给工具）：--titles ${titles.join(",")}`);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "调试工具", story: "案例库", title: "列表里的复制数跟库对不对得上" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
