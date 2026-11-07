# ai_generated_shop · 样例项目说明

模拟一个「AI 一把生成、没人逐行读过」的电商项目：能跑，但逻辑、结构与风险都不透明。
它是 CodeLens 的**主力端到端样例**，对应 README 快速开始中的 `examples/ai-generated-shop`。

## 设计覆盖点

| 功能 | 覆盖位置 |
|---|---|
| F1 扫描 | 8 个 `.py` 文件、单包结构、`__init__.py` |
| F2 逻辑抽取 | `calculate_total`（多分支+循环）、`submit_order`（编排+副作用）、`charge`（外部调用）、`reserve`（异常路径）、`generate_report`（51 步长函数） |
| F3 逻辑说明 | 每条步骤可回溯到 `expected/logic.md` 的行号 |
| F4 类图 | `DiscountedOrder --|> Order` 继承边；裸 `list` 注解不产生关联边（边界案例） |
| F5 时序图 | 入口 `submit_order` 的 8 条消息链（含循环与条件分支） |
| F6 调用/依赖图 | 模块依赖 4 条边；「导入 ≠ 调用」对拍点 |
| F7 复杂度与坏味 | CC=8 / CC=12 / 长函数 51 步 / 嵌套 5 层 / 5 参数 |
| F8 SOLID | `generate_report` 为 SRP-01 正例（聚合+渲染+持久化+通知） |
| F9 AI 风险 | A1/A2/A3/A4/A5/A6 各有正例，`expected/findings.md` 列全 |
| F11 报告 | findings 覆盖 fact / inference 两种证据等级 |

## 使用约束

- **不得执行本目录任何代码**（SRS C-01）：`reporting.py` 调用未导入的 `send_email`，
  `payments.py` 导入不存在的 `thirdparty_gateway`，import 即失败——这是刻意保留的 AI 代码特征。
- 集成测试只做静态分析与 golden 对比；指标基线由 radon 6.0.1（SRS R4）与 AST 脚本双重验证。
- 期望文件在 `expected/`，口径以 SRS v1.0 与 `docs/algorithm/` 定稿为准；算法文档修订后
  须回头核对本文档。
