/*
 * 诊断（不以 test_ 开头，pytest 不收集）：用户中心里「仿真案例」这个入口为什么点不动。
 *
 * 线索：上一轮探针点它（adb tap(899,1295)，目标=self）之后页面没变（还是用户中心）。
 * 怀疑：文字标签自己有尺寸，于是 `findClickableAncestor` 判定"起点尺寸正常"、直接点了标签；
 *       而真正的点击处理器挂在**祖先容器**上。
 *
 * 这次做两件事（只读：点入口 + 读文字）：
 *   ① 把「仿真案例」这条元素往上 4 层的 tag/class/尺寸打出来，看清楚哪一层像"可点容器"
 *   ② 直接按坐标点"第 2 层祖先"的中心，看页面有没有跳转
 *
 * 运行：node test_case/diagnostic/probe_case_entry.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");
const { getDevice } = require("../../app_sub_function/suprecast_app/android");

const base = pages.base;
const qa = pages.qaPage;
const userCenter = pages.userCenter;

const ENTRY = "仿真案例";

async function probe(page) {
  page = await userCenter.switchTo(page);
  const fg = await base.foreground(page);

  const info = await fg.evaluate((entry) => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const el = Array.from(document.querySelectorAll("*")).find((e) => norm(e.innerText) === entry);
    if (!el) return null;
    const dpr = window.devicePixelRatio || 1;
    const chain = [];
    let cur = el;
    for (let i = 0; i < 5 && cur; i++) {
      const r = cur.getBoundingClientRect();
      const cls = String(cur.getAttribute("class") || "");
      chain.push({
        level: i,
        tag: cur.tagName.toLowerCase(),
        cls,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        area: Math.round(r.width * r.height),
        centerPx: [Math.round((r.x + r.width / 2) * dpr), Math.round((r.y + r.height / 2) * dpr)],
      });
      cur = cur.parentElement;
    }
    return chain;
  }, ENTRY);

  if (!info) {
    console.log("用户中心里找不到文本「%s」", ENTRY);
    page = await qa.ensureOnHomeFeed(page);
    return page;
  }

  console.log("\n[「%s」往上 5 层]：", ENTRY);
  info.forEach((c) =>
    console.log(
      "   L%d <%s class=%s> rect=%s area=%d 中心(px)=%s",
      c.level, c.tag, c.cls, JSON.stringify(c.rect), c.area, JSON.stringify(c.centerPx)
    )
  );

  const startArea = info[0].area;
  const limit = Math.max(startArea * 8, 10000);
  console.log("\n  findClickableAncestor 的判据：起点面积=%d，上限=%d —— 起点>400 就会直接点自己", startArea, limit);

  // 直接点第 2 层祖先的中心，看会不会跳转
  const target = info[2] || info[info.length - 1];
  console.log("\n直接按坐标点 L%d 的中心 %s ...", target.level, JSON.stringify(target.centerPx));
  const device = await getDevice();
  await device.shell(`input tap ${target.centerPx[0]} ${target.centerPx[1]}`);
  await base.sleep(3000);

  const after = await base.foreground(page);
  const text = await base.pageText(after);
  console.log("点完之后：元素=%d 文字开头: %s", await base.countOf(after, "*"), JSON.stringify(text.slice(0, 140)));
  console.log("仍然停在用户中心吗（含「编辑资料」）：%s", text.includes("编辑资料") ? "是（没跳转）" : "否（跳走了）");

  page = await qa.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "「仿真案例」入口的点击层级" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
