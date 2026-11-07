# 软件设计文档（docs/software）

本目录存放架构、接口、数据与测试相关的设计文档。实现以 `code/` 与 `codelens-prototype/` 为准；文档与代码不一致时，以代码为准并更新文档。

## 当前实现概览

| 层次 | 现状 |
|---|---|
| 界面 | `codelens-prototype/`：Vite + React 18 + TypeScript + Tailwind v4，`localhost:5173` |
| 本机服务 | `code/backend/server.py`：Python 标准库 ThreadingHTTPServer，`127.0.0.1:18766`，仅提供 JSON API 与 NDJSON 进度流，不托管静态页面 |
| 分析引擎 | `code/core_engine/`：Python 走 AST；C/C++、Java、JavaScript/TypeScript、Go 走词法与花括号分析 |
| AI 审查 | `code/ai/`：兼容 OpenAI `chat/completions`，导入时按批次读取全项目源码，产出逻辑说明、设计检查、风险评估三段 |
| 启动 | 仓库根 `start-codelens.cmd` / `start-codelens.sh` 同时拉起两端 |

## 已有文档

| 文件 | 内容 |
|---|---|
| `local-workbench.md` | 当前工作台：页面、接口、规则口径、限制与验证 |
| `frontend-redesign.md` | 当前前端：技术栈、初始化页、导航、设计 token、状态与验收 |
| `ai-logic-explanation.md` | AI 项目审查：批量读取、断点续跑、引用校验与安全边界 |
| `solid-analysis.md` | SOLID 五项静态规则的判读方式与覆盖缺口 |
| `quality-evaluation.md` | 评估集、指标回归基准与验收方式 |
| `ddd/README.md` | DDD 设计实践与可运行示例（演进设计稿，未接入生产分析接口） |
| `pyan-uml-analysis.md` | 调用图方案调研 |

## 规划中的文档（尚未产出，不代表已实现）

| 文件名 | 内容 | 负责人 | 计划周次 |
|---|---|---|---|
| `diagram-ir.md` | 图数据 IR：节点/边/位置/置信度字段定义与版本演进 | 引擎负责人 | W3 |
| `logic-schema.md` | 逻辑模型结构：语句轨迹、CFG 节点/边、def-use、分支、异常、副作用、假设 | 引擎负责人 | W3 |
| `metrics-schema.md` | 指标 JSON：函数/类/模块三级指标字段、单位与阈值来源 | 引擎负责人 | W3 |
| `findings-schema.md` | 问题 JSON：规则 ID、严重度、位置、实际值、阈值、建议、置信度 | 引擎负责人 | W3 |
| `report-schema.md` | 审查报告结构：逻辑说明、项目/模块/文件得分、Top 风险、证据等级 | 后端负责人 | W3 |
| `rules-config.md` | 规则与阈值配置：默认值、项目级覆盖、配置版本与报告标注 | 引擎负责人 | W3 |
| `api-contract.md` | REST 接口：创建分析、查询进度、获取图/指标/问题/报告、下载导出 | 后端负责人 | W3 |
| `data-model.md` | 数据模型：分析任务、图产物、指标结果、发现记录、导出记录 | 后端负责人 | W3 |
| `test-plan.md` | 测试方案：单元/集成/渲染/E2E 与准确率、误报率门槛 | 测试负责人 | W3 |
| `deployment.md` | 运行环境、依赖、配置与密钥管理 | 后端负责人 | W5 |

总体架构与数据流见 `local-workbench.md`、`frontend-redesign.md`；本目录不再单独维护总体架构文档。

## 写作要求

1. 设计与需求对应关系须显式标注（引用 `docs/requirements/problem_definition.md` 的功能编号 F1–F9）；
2. 图 IR、逻辑模型、指标、问题四类数据结构是跨模块契约，变更必须先改文档再改代码；
3. 报告中必须保留规则版本与阈值配置，保证历史结果可复核；
4. 所有结论必须携带证据等级（事实/推断）与代码位置，缺失则视为缺陷；
5. 确定性静态分析不依赖模型服务；AI 审查须由用户显式配置且失败时不生成替代结论，相同静态输入与配置的输出必须可逐字节复现；
6. 架构图使用 Mermaid，便于版本对比。
