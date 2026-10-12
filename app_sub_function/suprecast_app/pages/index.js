/*
 * 页面对象统一入口
 *
 * 用例里的用法：
 *   const pages = require("../../app_sub_function/suprecast_app/pages");
 *   const funcList = [
 *     [pages.learnCenter.ensureOnColumnList, null],
 *     [pages.learnCenter.switchToColumnTab, null],
 *     [pages.learnCenter.openFirstColumn, null],
 *   ];
 *
 * 注意每个函数都是"纯函数 + page 作第一个参数"，没有 this，
 * 所以直接取出引用当步骤用即可（runAppSteps 靠 func.name 打日志、命名截图，
 * 包装成闭包或改成对象方法都会让名字失去意义）。
 */

module.exports = {
  base: require("./base_page"),
  learnCenter: require("./learn_center_page"),
  columnDetail: require("./column_detail_page"),
  userCenter: require("./user_center_page"),
  qaPage: require("./qa_page"),
  quizPage: require("./quiz_activity_page"),
  pointsMall: require("./points_mall_page"),
  postDetail: require("./post_detail_page"),
  caseLibrary: require("./simulation_case_page"),
  courseDetail: require("./course_detail_page"),
};
