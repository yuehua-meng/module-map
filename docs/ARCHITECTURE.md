# 架构设计与第一版边界

## 系统分层

```text
React 浏览器画布
        │ 本地 HTTP + 会话令牌
        ▼
apps/local-server ───── packages/core ───── packages/analyzer
                            ▲                     │
                            │                     ▼
                       packages/mcp          用户项目源码
                            ▲
                            │ stdio
                        AI 编程工具
```

`packages/cli` 负责 serve / scan / mcp 三个入口。所有组件处于一个 npm 包中，通过目录划分模块，避免第一版引入发布、跨包构建和版本管理成本。

## 数据模型

- CodeFile：项目相对路径、声明符号、行数。
- Evidence：引用文件、行号、specifier、目标文件和引用类型。
- Feature：稳定 ID、名称、说明、文件集合、归类来源。
- Relation：两个功能间的有向依赖，附带一组源码证据。
- Graph：代码层与功能层快照、版本指纹、覆盖提示。
- ChangeTask：修改意图、基线版本、原始证据、状态、执行方检查记录。

功能与文件允许多对多。功能层关系从文件依赖聚合生成，不允许人工直接伪造“已存在”的代码关系。分组的业务含义可人工调整或由 MCP 客户端归纳。

## 分析流程

遍历目录 → 应用忽略规则 → TypeScript AST 提取引用 → 模块解析 → 记录文件级证据 → 功能聚合 → 内容指纹。

配置包括最近的 tsconfig.json / jsconfig.json，支持常见路径别名。动态表达式无法解析时提示；外部包和未解析非相对引用不画为内部功能。

第一版只提取命名声明，不构建函数调用图。框架约定、依赖注入、运行时插件注册、数据库关系、网络调用和跨语言关系尚不覆盖。

## 同步与一致性

当前采用 3 秒轮询，避免平台文件监听差异和 Git 切换造成事件遗漏。语义分析结果按内容缓存，文件列表或解析选项变化时重新解析。大项目后续可增加文件事件队列和后台工作线程。

版本由源码内容、配置与功能映射生成。创建任务、领取任务、保存分组时检查基线。浏览器有刷新提示；独立 MCP 进程每次读取磁盘最新元数据。

写入使用项目级独占锁，JSON 使用临时文件加原子替换。冲突返回明确错误，不进行静默覆盖。

## 修改任务状态

```text
pending → in-progress → verified
                    ↘ needs-review → verified
pending / in-progress / needs-review → cancelled
```

领取阶段拒绝过期任务。结果阶段重新扫描，不只检查功能连线，也检查任务中原始文件对的引用，防止重分组绕过验证。任何检查失败、未运行或缺少检查记录，均进入 needs-review。

verified 的定义仅为“静态依赖移除 + 执行方回填检查通过”。界面明确说明检查来源，不将其宣传为工具独立证明。

## MCP 工具

`get_project_graph`、`get_feature`、`read_source`、`save_features`、
`list_change_tasks`、`create_change_task`、`claim_change_task`、
`report_change_result`、`cancel_change_task`。

每个 stdio 进程绑定一个项目。浏览器切换项目不会改变已有 MCP 进程的项目绑定。

## 下一阶段

1. 按语言适配器扩展 Python 等语言。
2. 文件/符号级展开，依赖类型筛选及大图布局。
3. 完善框架别名、workspace 包和特殊构建配置解析。
4. 独立验证执行器：白名单检查、结果绑定代码版本。
5. AI 执行适配器：从画布启动任务并展示进度。
6. 测试覆盖与变更影响分析，分支比较。

这些是规划项，不属于第一版已实现能力。
