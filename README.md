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

CodeLens 的目标是**把 AI 生成的代码从黑盒变成可审查对象**：用静态分析重建代码逻辑与结构，用指标与规则量化风险，用证据等级区分「确定的」与「推断的」。

> 产品面向使用 AI 编码的开发者与代码评审者（尤其是刚接手陌生代码的初学者），核心是**理解与审查**。

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
| F8 | SOLID 检查 | S / O / L / I / D 五项静态规则与覆盖缺口 | MVP |
| F9 | AI 代码风险检查 | 重复实现、未处理异常、硬编码、死代码、可疑依赖调用等 | MVP（基础）/ 迭代 2（扩展） |
| F10 | 交互式审查 | 逻辑步骤与代码行联动、图与风险联动、按模块过滤 | 迭代 2 |
| F11 | 报告导出 | Markdown 审查报告 + JSON + Mermaid/PlantUML/SVG | MVP |

## 快速开始

需要 Python 3.11+ 与 Node 18+。后端服务仅使用 Python 标准库；新版界面是独立的 Vite + React 应用。

**一键启动（推荐）**：Windows 双击 `start-codelens.cmd`，macOS/Linux 运行 `sh start-codelens.sh`。脚本会在首次运行时安装前端依赖，同时启动后端 API（18766）与 React 界面（5173），并自动打开浏览器。

手动启动：

```bash
python -B code/backend/server.py          # 终端 1：API，127.0.0.1:18766
cd codelens-prototype && npm install && npm run dev   # 终端 2：界面，localhost:5173
```

新版界面地址是 [http://localhost:5173](http://localhost:5173)。旧版 HTML 界面仍在 `code/frontend/`，由后端 18766 直接提供，仅作保留不推荐使用。若后端端口被占用，用 `--port 18767` 启动并给前端设置 `VITE_API_TARGET=http://127.0.0.1:18767`。

> **双击后看到的还是旧界面？** 基本是下面三种情况之一：
> 1. 打开的是 `http://127.0.0.1:18766`（后端静态页永远是旧版）——请认准 5173；
> 2. 运行的是另一个克隆里的旧 `start-codelens.cmd`（旧脚本只启动 18766，还会 `npm run build`）——确认脚本里有 `codelens-prototype`，或先 `git pull --ff-only` 同步到最新；
> 3. 5173 已被别的 Vite 进程占用——脚本用 `--strictPort` 会直接报错，关掉那个窗口再重试。

在初始化页选择项目文件夹即可导入，支持 Python、C/C++、Java、JavaScript/TypeScript、Go；可在同页配置模型接口，导入时自动完成静态分析与 AI 项目审查（逻辑说明、设计检查、风险评估共享一份结果）。

SOLID 检查覆盖 S（方法数线索）、O（类型分派线索）、L（覆盖方法签名/绑定/同步异步/显式拒绝）、I（多方法继承契约中显式拒绝成员）、D（已解析的具体类构造依赖）。未命中不等于符合原则；外部父类、多继承、自定义装饰器等覆盖缺口会单独展示。详细规则见 [SOLID 分析说明](docs/software/solid-analysis.md)。

当前已提供文件/符号统计、函数复杂度与健康度、WMC/DIT/CBO/LCOM1 类指标、SOLID 五项静态检查、结构重复检测、模块依赖与循环、调用图和类关系图（继承/组合/关联/依赖）。逻辑说明支持跨文件 AI 解读及已校验行号跳转；报告支持 Markdown/JSON/CSV，图支持 SVG。没有预置项目或模拟结果。静态分析不能证明完整运行时行为契约，也不覆盖所有语义等价重复。

静态分析仅在本机服务内存中完成，不执行或导入目标项目。导入时选择的项目源码会分批发送到配置的模型服务用于 AI 项目审查；未配置模型或审查失败时静态结果照常可用，不使用模板替代失败结果。最多 200 个文件、请求体 12 MB；默认排除测试、虚拟环境和构建目录。详细范围与限制见 [工作台说明](docs/software/local-workbench.md)。

AI 项目审查：在初始化页填写兼容 chat/completions 的 Base URL、模型名称和 API Key，选择项目文件夹后自动完成「静态分析 → AI 审查」。审查结果分为逻辑说明、设计检查、风险评估三段并共享同一份阅读记录；审查意外中断后重新生成会从服务端断点续跑。密钥仅保存在当前页面内存，刷新需重填。也可配置服务端 `CODELENS_AI_ENDPOINT`（完整端点）、`CODELENS_AI_MODEL`、`CODELENS_AI_KEY` 环境变量。详细范围见 [AI 逻辑解读说明](docs/software/ai-logic-explanation.md)。

检查命令（前端检查另需 Node.js 22+ 与本机 Chromium/Edge；可用 `CODELENS_BROWSER` 指定浏览器程序）：

```bash
python -B -m unittest discover -s tests -p 'test_*.py' -v
node --check code/frontend/app.js
node tests/integration/test_logic_frontend.cjs
node tests/integration/test_solid_frontend.cjs
node tests/integration/test_frontend.cjs
python -B tests/evaluate_solid.py
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
| [docs/software/local-workbench.md](docs/software/local-workbench.md) | 本地真实分析工作台、接口与限制 |
| [docs/mgmt/project-setup.md](docs/mgmt/project-setup.md) | 看板、标签、里程碑配置 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |

## 许可证

本项目采用 [MIT License](LICENSE)，版权归项目组所有。
