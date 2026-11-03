# 贡献说明

安装 Node.js 22+，执行 npm install。提交前运行 npm run check。

- 分析器只描述有源码依据的关系；推测和覆盖缺口需显式标注。
- 新语言解析应放在 packages/analyzer 内，并保留统一 Evidence 输出。
- 状态修改集中在 packages/core/store.ts，HTTP 与 MCP 不应各自实现一套任务逻辑。
- 修改任务必须保留原始证据和版本约束，禁止只因地图连线被隐藏就标记完成。
- 验证涉及临时项目，勿使用真实业务代码作为可变测试数据。
- 不提交 node_modules、dist、日志或 .project-map/runtime。

当前版本未接入第三方分析或遥测。新增上传或云端能力时，应提供明确的数据范围说明。
