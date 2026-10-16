/*
 * 诊断（不以 test_ 开头，pytest 不收集）：需求 713495189 里「课程」这一路的真实文案。
 *
 * 需求原文那半句是：「相关页面：…课程（已购用户）…；**未购买课程用户看 0 评论课程时，
 * 文案与原状态保持一致不修改**」。源码里这一路的判据是
 * `src/packageA/pages/course/detail/index.tsx:592`：
 *
 *     <Empty title={isPurchase ? "参与评论获取积分" : "暂无评论"} … />
 *
 * 也就是：**已购** + 0 评价 -> 新文案；**未购** + 0 评价 -> 保持「暂无评论」。
 * 这跟共用 `comment-list` 的帖子 / 案例 / 专栏不是同一条代码路径，所以必须单独实测。
 *
 * 只读：只进课程、点「评价」tab、读文字。不购买、不发评价、不播放视频。
 *
 * 运行：node test_case/diagnostic/probe_course_comment_empty.js
 *       想只跑某一门课时：`$env:UITEST_PROBE_COURSES="717"` 后再跑（默认 test2,717）
 */

const { appTest } = require("../../common/app_common");
const pages = require("../../app_sub_function/suprecast_app/pages");

const base = pages.base;
const courseDetail = pages.courseDetail;

const NEW_TEXT = "参与评论获取积分";
const OLD_TEXT = "期待你的评论";
const KEEP_TEXT = "暂无评论";

/** 打开某门课的「评价」tab，把那一屏的文案读出来 */
async function readCommentTab(page, courseName, { label } = {}) {
  page = await courseDetail.openByName(page, courseName);
  let fg = await base.foreground(page);
  const st = await courseDetail.readState(fg);
  console.log(`\n===== ${label || courseName}：课程名=${JSON.stringify(st.name)} =====`);
  console.log(`  页面上的 tab：${JSON.stringify(st.tabs.map((t) => t.text))}｜当前选中：${JSON.stringify(st.activeTab)}`);

  // 点「评价」tab（文案可能是「评价」或「评价(3)」，所以按前缀找）
  const tabText = (st.tabs.map((t) => t.text) || []).find((t) => String(t).startsWith("评价"));
  if (!tabText) {
    console.log(`  ⚠️ 这门课的页面上找不到「评价」tab —— 只能读当前屏`);
  } else {
    await base.tapText(fg, tabText, `课程「${courseName}」的「${tabText}」tab`);
    await base.sleep(2000);
    fg = await base.foreground(page);
  }

  const text = await base.pageText(fg);
  const out = {
    新文案: text.includes(NEW_TEXT),
    旧文案: text.includes(OLD_TEXT),
    保持原样: text.includes(KEEP_TEXT),
  };
  console.log(`  ${JSON.stringify(out)}`);
  [NEW_TEXT, OLD_TEXT, KEEP_TEXT, "全部评论", "评价"].forEach((w) => {
    const i = text.indexOf(w);
    if (i >= 0) console.log(`    「${w}」附近：${JSON.stringify(text.slice(Math.max(0, i - 40), i + 40))}`);
  });
  // 有没有真实评论项（.comment-item / .info-wrap 之类）；有些课评价 tab 里是 CommentList
  const items = await base.countOf(fg, ".comment-item");
  console.log(`  .comment-item 数量：${items}`);
  return text;
}

async function probe(page) {
  const wanted = String(process.env.UITEST_PROBE_COURSES || "test2,717")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const LABELS = {
    // 未购买 + 0 评价：库里 id=87、评论数 0、我们没买过；课程 tab「课程上新」里有它
    test2: "未购买 + 0 评价（test2）",
    // 已购买：库里 id=83、我们买过
    717: "已购买（717）",
  };
  for (const name of wanted) {
    await readCommentTab(page, name, { label: LABELS[name] || name });
  }

  page = await pages.qaPage.ensureOnHomeFeed(page);
  console.log("\n已回首页（探针归位）");
  return page;
}

(async () => {
  await appTest([[probe, null]], {
    meta: { feature: "诊断", story: "评论文案", title: "需求 713495189：课程评价 tab 的文案" },
  });
})().catch((e) => {
  console.error("探针失败: " + e.message);
  process.exit(1);
});
