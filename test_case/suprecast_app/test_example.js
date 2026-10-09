/*
 * @author: weiyue.zhang
 * @project_name: UITest
 * @cur_file: test_example.js
 * @create_date: 2026/10/8
 *
 * 小程序JS测试脚本-搜索功能测试。
 * 由 pytest 通过同目录 conftest.py 中的 pytest_collect_file 钩子直接调用 node 执行。
 */

const path = require("path");
const { appTest } = require("../../common/app_common");
const { focusSearchInput } = require("../../app_sub_function/suprecast_app/android");

(async () => {
  // 截图目录：项目根目录/report/photo_app
  const photosPath = path.join(__dirname, "..", "..", "report", "photo_app");
  const funcList = [
    // 点击搜索栏跳转到搜索页并聚焦输入框；关键词输入由调用方自行处理
    [focusSearchInput, null],
     ];
  await appTest(funcList, { photosPath });
  console.log("test_example.js 执行完成");
})().catch((e) => {
  console.error(e);
  process.exit(1);
}); 
