/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**现在就停在付费案例的"确认复制案例"弹框上**时，
 * 把这个弹框的结构与两个按钮（取消 / 确定）的选择器采出来。
 *
 * 为什么单独写：上一个探针想采它，但被"弹框盖住返回按钮"挡住了（命中测试拦下，这是对的）。
 * 这个探针**不做任何导航**，直接读当前屏幕，然后点「取消」收尾（不扣积分）。
 *
 * 只读：读 DOM + 点取消。
 * 运行：node test_case/diagnostic/probe_dialog_now.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;

async function probe(page) {
  const fg = await base.foreground(page);
  const text = await base.pageText(fg);
  console.log("\n=== 当前页面文字（前 200 字）===");
  console.log(text.slice(0, 200));

  const info = await fg.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const dialogish = [];
    const buttons = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const c = String(el.getAttribute("class") || "");
      const r = el.getBoundingClientRect();
      if (/nut-dialog|nut-overlay/i.test(c) && r.width > 40 && r.height > 20) {
        dialogish.push({
          cls: c.slice(0, 80),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          text: norm(el.innerText).slice(0, 40),
        });
      }
      const t = norm(el.innerText);
      if ((t === "取消" || t === "确定") && r.width > 20 && r.height > 10) {
        buttons.push({
          text: t,
          tag: el.tagName.toLowerCase(),
          cls: c.slice(0, 80),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
      }
    }
    return { dialogish: dialogish.slice(0, 12), buttons: buttons.slice(0, 8) };
  });

  console.log("\n=== 弹框相关元素（class 含 nut-dialog / nut-overlay）===");
  info.dialogish.forEach((d) => console.log("  <%s> 位置=%s 文字=%s", d.cls, JSON.stringify(d.rect), JSON.stringify(d.text)));
  console.log("\n=== 文字正好是「取消」/「确定」的元素 ===");
  info.buttons.forEach((b) => console.log("  %s <%s.%s> 位置=%s", JSON.stringify(b.text), b.tag, b.cls, JSON.stringify(b.rect)));

  // 收尾：点「取消」（不扣积分）。
  // ⚠️ 选择器要**精确到弹框 footer 里那个**：`.h5-button` 这种宽泛选择器会命中页面上第一个
  //    h5-button（实测是右上角「复制案例」），于是点了个空 —— 用弹框自己的结构定位。
  if (text.includes("确认复制案例")) {
    console.log("\n=== 点弹框 footer 里的「取消」收尾 ===");
    await base.tapSelector(await base.foreground(page), ".nut-dialog-footer .nut-button-default", "弹框的「取消」");
    await base.sleep(1200);
    console.log("  点完后的页面文字（前 80 字）：%s", JSON.stringify((await base.pageText(await base.foreground(page))).slice(0, 80)));
  } else {
    console.log("\n  [提示] 没找到「取消」按钮（可能弹框已经不在了）");
  }
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "把当前的确认框结构采下来" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
