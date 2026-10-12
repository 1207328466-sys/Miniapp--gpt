/*
 * 诊断（不以 test_ 开头，pytest 不收集）：**付费案例**点「复制案例」弹出的确认框长什么样。
 *
 * 背景（2026/10/12 实测）：付费案例点「复制案例」不会立刻复制，而是弹出
 *   「确认复制案例？ / 花费积分：5 / 兑换成功后，不支持撤回兑换 / 取消 · 确定」
 * 点了「确定」才真的复制（扣积分）。要写断言就得知道这个框的选择器。
 *
 * ⚠️ 本探针**只弹框、不点确定**，最后点「取消」收尾 —— 不扣积分、不写数据。
 * 运行：node test_case/diagnostic/probe_paid_case_copy_dialog.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

async function probe(page) {
  page = await caseLibrary.openByName(page, "填充任务1");
  const fg = await base.foreground(page);

  await base.tapText(fg, "复制案例", "详情页的「复制案例」按钮（付费案例）");
  await base.sleep(2500);

  const after = await base.foreground(page);
  const text = await base.pageText(after);
  console.log("\n=== 点完之后的页面文字（前 200 字）===");
  console.log(text.slice(0, 200));

  const info = await after.evaluate(() => {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const out = { dialogs: [], buttons: [] };
    // 弹框容器：class 里带 dialog / modal / popup 的元素
    for (const el of Array.from(document.querySelectorAll("wx-view, div"))) {
      const c = String(el.getAttribute("class") || "");
      if (!/dialog|modal|popup|confirm/i.test(c)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 100 || r.height < 60) continue;
      out.dialogs.push({ cls: c.slice(0, 70), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: norm(el.innerText).slice(0, 50) });
      if (out.dialogs.length >= 6) break;
    }
    // 「确定」「取消」这两个按钮是谁
    for (const el of Array.from(document.querySelectorAll("wx-view, wx-text, button"))) {
      const t = norm(el.innerText);
      if (t !== "确定" && t !== "取消") continue;
      const r = el.getBoundingClientRect();
      out.buttons.push({ text: t, cls: String(el.getAttribute("class") || "").slice(0, 70), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    }
    return out;
  });

  console.log("\n=== 弹框容器（class 含 dialog/modal/popup/confirm）===");
  info.dialogs.forEach((d) => console.log("  <%s> 位置=%s 文字=%s", d.cls, JSON.stringify(d.rect), JSON.stringify(d.text)));
  console.log("\n=== 页面上文字正好是「确定」/「取消」的元素 ===");
  info.buttons.forEach((b) => console.log("  %s <%s> 位置=%s", JSON.stringify(b.text), b.cls, JSON.stringify(b.rect)));

  // 收尾：点「取消」，不留弹框、不扣分
  console.log("\n=== 点「取消」收尾（不扣积分）===");
  await base.tapText(await base.foreground(page), "取消", "确认框的「取消」");
  await base.sleep(1200);
  console.log("  点完后的页面文字（前 80 字）：%s", JSON.stringify((await base.pageText(await base.foreground(page))).slice(0, 80)));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "付费案例复制的确认框结构" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
