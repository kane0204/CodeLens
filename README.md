# CodeLens · 项目结构可视化工具

[![CI](https://github.com/kane0204/CodeLens/actions/workflows/ci.yml/badge.svg)](https://github.com/kane0204/CodeLens/actions/workflows/ci.yml)
![阶段](https://img.shields.io/badge/%E9%98%B6%E6%AE%B5-Week--01%20%E9%9C%80%E6%B1%82%E5%AE%9A%E4%B9%89-blue)
![许可证](https://img.shields.io/badge/License-MIT-green)

> **一句话简介**：输入一个项目文件夹，CodeLens 输出**它到底在做什么**（代码逻辑）、**结构长什么样**（类图/时序图）、**哪里不可信**（复杂度、坏味、SOLID、AI 特有风险），让黑盒变成可审查的代码。

## 目录

- [要解决的问题](#要解决的问题)
- [输出物](#输出物)
- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [文档索引](#文档索引)

## 要解决的问题

AI 编码工具让代码产量成倍上升，但**代码的可理解性与可信度没有同步上升**。一个模块「能跑」，不代表团队知道它做了什么、为什么这么做、在什么条件下会出错。典型的黑盒表现有四种：

| 黑盒表现 | 具体症状 |
|---|---|
| **逻辑不透明** | 函数能运行，但没人能说清输入经过哪些步骤、在哪些分支会走哪条路、有哪些副作用 |
| **结构不可见** | 模块、类、调用链散落在大量文件中，评审时只能逐个文件读 |
| **质量不可量** | 复杂度、重复实现、God Class、循环依赖没有统一度量，问题靠感觉 |
| **风险不可查** | 隐含假设（非空、网络可用、类型正确）、未处理的异常、可疑的依赖调用被忽略 |

CodeLens 的目标是**把 AI 生成的代码从黑盒变成可审查对象**：用静态分析重建代码逻辑与结构，用指标与规则量化风险，用证据等级区分「确定的」与「推断的」。**全流程不调用大模型**——同样的输入与配置，永远得到同样的输出。

> 产品面向使用 AI 编码的开发者与代码评审者（尤其是刚接手陌生代码的初学者），核心是**理解与审查**，不是替人写代码，也不是替人改代码。

## 输出物

| 类别 | 输出 | 回答的问题 |
|---|---|---|
| **代码逻辑** | 语句级轨迹（AST 类型 + 目标）、控制流图（CFG）、def-use 数据流、副作用、隐含假设 | 这段代码到底在做什么？ |
| **结构视图** | 类图、时序图、模块依赖图、调用图 | 它由哪些部分组成、怎么串起来？ |
| **质量体检** | 圈复杂度、认知复杂度、函数长度、嵌套、WMC/DIT/CBO/LCOM、坏味清单 | 哪里最难维护？ |
| **设计检查** | SOLID 规则 | 哪里违反了设计原则？ |
| **风险清单** | AI 代码特有风险：重复实现、未处理异常、硬编码、死代码、可疑依赖 | 哪里最可能出问题？ |
| **审查报告** | 证据等级 + 代码位置 + 建议复核点，可导出 Markdown / JSON | 我该重点看哪里？ |


## 核心功能

| 编号 | 功能 | 说明 | 阶段 |
|---|---|---|---|
| F1 | 项目扫描与多文件解析 | 递归扫描文件夹，识别语言、源文件、包/模块结构，构建符号表 | MVP |
| F2 | **逻辑抽取** | 为函数/模块构建逻辑模型：语句轨迹、CFG、def-use、分支、异常、副作用、前置假设 | MVP |
| F3 | **逻辑说明生成** | 用模板把逻辑模型转成文字，逐条引用代码位置；不调用模型，输出确定可复现 | MVP |
| F4 | 类图生成 | 类、属性、方法及继承/实现/组合/关联/依赖 | MVP |
| F5 | 时序图生成 | 从入口或指定函数出发的跨文件调用链与消息顺序 | MVP |
| F6 | 模块依赖图 / 调用图 | 依赖方向、循环依赖、函数级调用 | MVP |
| F7 | 复杂度与坏味 | 函数/类/模块三级指标 + 10 类坏味 + 健康度评分 | MVP |
| F8 | SOLID 检查 | 首期 SRP / OCP / DIP 三条规则 | MVP |
| F9 | AI 代码风险检查 | 重复实现、未处理异常、硬编码、死代码、可疑依赖调用等 | MVP（基础）/ 迭代 2（扩展） |
| F10 | 交互式审查 | 逻辑步骤与代码行联动、图与风险联动、按模块过滤 | 迭代 2 |
| F11 | 报告导出 | Markdown 审查报告 + JSON + Mermaid/PlantUML/SVG | MVP |

## 快速开始

目标形态（W3 起提供，当前尚未实现代码）：

```bash
git clone https://github.com/kane0204/CodeLens.git
cd CodeLens
git checkout develop

codelens analyze ./examples/ai-generated-shop \
  --out ./out \
  --format mermaid \
  --report markdown

# 产出（示意）
# out/logic.json            逻辑模型（语句/CFG/def-use/假设）
# out/logic.md              逻辑说明
# out/class-diagram.mmd
# out/sequence/*.mmd
# out/metrics.json          复杂度与规模指标
# out/findings.json         坏味、SOLID、AI 风险
# out/report.md             审查报告
```

## 项目结构

```text
CodeLens/
├── docs/
│   ├── requirements/     # 需求工程：问题定义、5W1H、用户故事、用例
│   ├── algorithm/        # 算法设计：解析、逻辑抽取、图构建、度量、规则
│   ├── software/         # 软件设计：架构、接口、数据模型、测试方案
│   ├── mgmt/             # 项目管理：看板说明、迭代计划、Backlog、协作规范
│   └── retrospection/    # 阶段复盘与经验教训
├── code/
│   ├── backend/          # 服务端 API、任务调度、报告生成
│   ├── frontend/         # Web 前端：逻辑浏览、图查看、风险定位
│   └── core_engine/      # 核心引擎：解析、逻辑建模、图、指标、规则
├── tests/
│   ├── unit/             # 单元测试（解析、逻辑模型、指标、规则）
│   └── integration/      # 集成测试（样例项目端到端）
└── .github/
    ├── workflows/
    └── ISSUE_TEMPLATE/
```

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/requirements/problem_definition.md](docs/requirements/problem_definition.md) | 问题定义：5W1H 与产品描述 |
| [docs/mgmt/backlog.md](docs/mgmt/backlog.md) | 迭代 Backlog 与验收标准 |
| [docs/algorithm/README.md](docs/algorithm/README.md) | 算法文档规划（逻辑抽取、图、指标、规则） |
| [docs/software/README.md](docs/software/README.md) | 软件设计文档规划 |
| [docs/mgmt/project-setup.md](docs/mgmt/project-setup.md) | 看板、标签、里程碑配置 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |

## 许可证

本项目采用 [MIT License](LICENSE)，版权归项目组所有。
