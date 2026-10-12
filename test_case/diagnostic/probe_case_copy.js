/*
 * 诊断（不以 test_ 开头，pytest 不收集）：点「复制案例」会发生什么？（**这是写操作**）
 *
 * 需求 713381608 原文：「案例复制完成后，弹出提示复制成功，提示
 *   『使用手机号登录智铸超云，即可查看案例详情』」「**免费和付费案例都提示**」
 *
 * ⚠️ 这个探针**会真的复制一次**（写 `simulation_copy_record`、可能扣积分 / 加复制数）。
 *    owner 2026/10/12 明确说过：「可以修改关于此用户的所有数据」，所以允许；
 *    但**跑完必须复位** —— 复位脚本与判据见 tools/case_copy_reset.py（配套）。
 *
 * 做法：打开案例库第一张卡片（免费案例）→ 读下与"复制前"有关的页面文字 →
 *       点「复制案例」→ 连采样页面文字（提示可能只闪现几秒）→ 打印出来。
 *
 * 运行：node test_case/diagnostic/probe_case_copy.js
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const caseLibrary = pages.caseLibrary;

async function probe(page) {
  page = await caseLibrary.openFirstCase(page);
  const fg = await base.foreground(page);

  const before = await base.pageText(fg);
  console.log("\n=== 复制前的页面文字（前 200 字）===");
  console.log(before.slice(0, 200));
  console.log("\n含「复制案例」按钮：%s", before.includes("复制案例") ? "有" : "无");

  // 点「复制案例」按钮（按文字点，真实 adb 事件）
  await base.tapText(fg, "复制案例", "详情页的「复制案例」按钮");

  // 提示可能只闪现几秒：连采样 6 次，每次把"新出现的那行"打出来
  console.log("\n=== 点完之后连续采样（找提示文案）===");
  for (let i = 1; i <= 6; i++) {
    await base.sleep(700);
    const now = await base.pageText(await base.foreground(page));
    const hit = ["复制成功", "使用手机号登录", "积分不足", "已复制"].filter((w) => now.includes(w));
    console.log("  第 %d 次（+%ds）：%s", i, (i * 0.7).toFixed(1), hit.length ? `**命中：${hit.join(" / ")}**` : "没看到提示关键词");
    if (hit.length) {
      const idx = now.indexOf(hit[0]);
      console.log("      上下文: %s", JSON.stringify(now.slice(Math.max(0, idx - 40), idx + 60)));
      break;
    }
  }

  const after = await base.pageText(await base.foreground(page));
  console.log("\n=== 复制后的页面文字（前 200 字）===");
  console.log(after.slice(0, 200));

  page = await pages.qaPage.ensureOnHomeFeed(page);
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "案例库", title: "点复制案例会发生什么（写操作）" },
  });
})().catch((e) => {
  console.error("诊断失败: " + e.message);
  process.exit(1);
});
