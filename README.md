# CodeLens · AI 生成代码的可解释性与可信度分析

[![CI](https://github.com/kane0204/CodeLens/actions/workflows/ci.yml/badge.svg)](https://github.com/kane0204/CodeLens/actions/workflows/ci.yml)
![阶段](https://img.shields.io/badge/%E9%98%B6%E6%AE%B5-Week--01%20%E9%9C%80%E6%B1%82%E5%AE%9A%E4%B9%89-blue)
![许可证](https://img.shields.io/badge/License-MIT-green)

> **一句话简介**：输入一个由 AI 生成（或 AI 辅助）的项目文件夹，CodeLens 输出**它到底在做什么**（代码逻辑）、**结构长什么样**（类图/时序图）、**哪里不可信**（复杂度、坏味、SOLID、AI 特有风险），让黑盒变成可审查的代码。

## 目录

- [要解决的问题](#要解决的问题)
- [输出物](#输出物)
- [核心功能](#核心功能)
- [逻辑输出长什么样](#逻辑输出长什么样)
- [证据分级](#证据分级)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [分支与提交规范](#分支与提交规范)
- [协作流程](#协作流程)
- [迭代计划](#迭代计划)
- [团队与分工](#团队与分工)
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
| **设计检查** | SOLID 的 S/O/D 三条规则命中 | 哪里违反了设计原则？ |
| **风险清单** | AI 代码特有风险：重复实现、未处理异常、硬编码、死代码、可疑依赖 | 哪里最可能出问题？ |
| **审查报告** | 证据等级 + 代码位置 + 建议复核点，可导出 Markdown / JSON | 我该重点看哪里？ |

所有结论都携带 `文件:行号`，可点击回到源码。

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

## 逻辑输出长什么样

以一段 AI 生成的代码为例：

```python
def process_orders(orders, repo, pay):
    total = 0
    for o in orders:
        if o.status == "paid":
            total += o.amount
    if total > 1000:
        pay.charge(total * 0.9)
    return total
```

CodeLens 输出（示意）：

```text
低层逻辑  process_orders(orders, repo, pay)   service/order.py:1-8

语句轨迹
  :2  total = 0                      assign   target=total
  :3  for o in orders:               loop     iter=orders
  :4    if o.status == "paid":       branch   cond=(Compare: o.status == "paid")
  :5      total += o.amount          assign   target=total  value=(BinOp: total + o.amount)
  :6  if total > 1000:               branch   cond=(Compare: total > 1000)
  :7    pay.charge(total * 0.9)      call     callee=pay.charge  args=[total * 0.9]
  :8  return total                   return   value=total

控制流（CFG）
  :2 → :3 → :4 --true--> :5 → :3
             └--false--------------→ :3 → (exit) → :6 → :7 → :8

数据流（def-use）
  orders → o（迭代） → o.status / o.amount → total → total → return
  定义：:2 total，:5 total（重定义）
  使用：:4 o，:5 o.amount，:6 total，:7 total，:8 total

副作用
  :7 call → 目标解析失败（属性调用、类型未知）→ 推断为外部调用

假设与风险
  :4 直接访问 o.status，未判空
  :7 调用未包裹异常处理
  [推断] 重复执行会重复扣款（无幂等判断）
  [事实] 金额使用浮点运算（:5）
```

这类输出直接回答三个问题：**每一步做了什么、数据怎么流动、哪里可能出事**。描述由模板从 AST/CFG/def-use 生成，措辞固定、可逐行核对。

## 证据分级

报告中的每条结论都标注来源，避免把推测当成事实：

| 等级 | 含义 | 示例 |
|---|---|---|
| **事实** | 由语法/符号/调用图直接得到，可精确复现 | 「第 7 行调用了 `pay.charge`」 |
| **推断** | 由启发式规则推断，可能有例外 | 「该调用可能触发外部支付请求」 |

> 所有文字描述都由模板从事实生成；不引入模型，也不存在「模型编造结构」的风险。推断类结论单独标注。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 解析与建模 | Python 3.11 + 标准库 `ast`（首期）+ networkx | 多文件 AST、符号表、控制流/数据流、关系图 |
| 度量与规则 | 自研指标计算 + 规则引擎（阈值可配置） | 复杂度、坏味、SOLID S/O/D、AI 代码风险 |
| 逻辑说明 | 纯模板生成（无模型） | 从 AST/CFG/def-use 逐条生成文字，输出确定、可复现 |
| 图生成 | Mermaid / PlantUML 生成器 + Graphviz（可选） | 类图、时序图、依赖图 |
| 后端 | Python（FastAPI）+ 任务队列 | 分析任务调度、结果存储、报告生成 |
| 前端 | TypeScript + React + 图渲染库 | 逻辑步骤浏览、图查看、风险定位 |
| 测试 | pytest + 样例项目集 + Playwright | 指标对拍、规则正反例、端到端 |

**首期范围**：Python 3.11（标准库 `ast`）；SOLID 实现 SRP / OCP / DIP；LSP / ISP 列入后续迭代；全流程不使用大模型。

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

## 分支与提交规范

- `main`：生产/交付分支，只接受来自 `develop` 或 `release/*` 的 PR；
- `develop`：开发主分支；
- `feature/<name>`、`fix/<name>`、`docs/<name>`：从 `develop` 切出，完成后 PR 回 `develop`；
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，须关联 Issue 编号。

完整规则见 [docs/mgmt/branching-and-commit.md](docs/mgmt/branching-and-commit.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 协作流程

| 看板 | 用途 | 链接 |
|---|---|---|
| Team planning | 迭代规划与容量管理 | https://github.com/users/kane0204/projects/1 |
| Kanban | 日常任务流转 | https://github.com/users/kane0204/projects/2 |
| Bug tracker | 缺陷跟踪 | https://github.com/users/kane0204/projects/3 |

流程：Issue 描述任务 → 看板认领 → 功能分支开发 → PR（`Closes #编号`）→ 至少 1 人 Review → 合并 → 关闭 Issue。

## 迭代计划

| 周次 | 目标 | 交付物 | 检查点 |
|---|---|---|---|
| W1 | 立项与问题定义 | 仓库结构、README、5W1H 与产品描述、三个看板 | 提交仓库链接，获得第一轮反馈 |
| W2 | 需求与算法设计 | 逻辑模型定义、指标与规则、Python 样例项目 | 需求与规则评审 |
| W3 | 架构与骨架 | 解析 → 逻辑模型 JSON → 类图 + 指标骨架 | 设计评审 |
| W4–W6 | MVP | 逻辑说明 + 类图/时序图 + 复杂度/坏味 + SOLID S/O/D + AI 风险 + 审查报告 | 迭代演示 |

## 团队与分工

| 角色 | 成员 | 职责 |
|---|---|---|
| 组长 / 项目管理 | TBD | 排期、看板维护、对外提交检查点 |
| 需求与规则设计 | TBD | 需求文档、逻辑模型定义、指标与规则 |
| 核心引擎 | TBD | 解析、逻辑抽取、图构建、度量与规则 |
| 前端 / 后端 | TBD | 逻辑浏览与审查界面、API 与报告 |
| 测试与质量 | TBD | 样例项目、准确率与误报率回归、CI |

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
