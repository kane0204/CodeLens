# CodeLens · 智能代码学习平台

[![CI](https://github.com/kane0204/CodeLens/actions/workflows/ci.yml/badge.svg)](https://github.com/kane0204/CodeLens/actions/workflows/ci.yml)
![阶段](https://img.shields.io/badge/%E9%98%B6%E6%AE%B5-Week--01%20%E9%9C%80%E6%B1%82%E5%AE%9A%E4%B9%89-blue)
![许可证](https://img.shields.io/badge/License-MIT-green)

> **一句话简介**：CodeLens 把「看不懂的代码」变成「能讲清楚的老师」——面向编程初学者的代码解读、调试引导与练习生成平台。

## 目录

- [项目简介](#项目简介)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [分支与提交规范](#分支与提交规范)
- [协作流程](#协作流程)
- [迭代计划](#迭代计划)
- [团队与分工](#团队与分工)
- [文档索引](#文档索引)

## 项目简介

编程初学者会反复卡在同一个环节：面对一段陌生代码，**不知道它做了什么、为什么这么写、错在哪里、下一步该练什么**。现有工具要么只给「最终答案」（复制即可交作业，学不到东西），要么要求用户自己把问题描述清楚（而初学者的困难恰恰是「不知道该问什么」）。

CodeLens 的定位是**引导式**的代码学习助手：

1. 用户粘贴或上传一段代码，系统给出**结构化解读**（整体意图、关键行、算法与数据结构、复杂度）；
2. 当代码出错时，系统先给**分层提示**（定位 → 现象 → 原因 → 修复方向），用户主动展开才看到完整答案；
3. 系统基于用户卡点**自动生成针对性练习**，并形成个人学习档案与复习计划。

本项目为课程小组协作开发项目，按「需求 → 算法 → 软件 → 管理 → 复盘」五个阶段推进，全过程在 GitHub 上以 Issue / Kanban / PR 的方式协作与留痕。

## 核心功能

| 编号 | 功能 | 说明 | 阶段 |
|---|---|---|---|
| F1 | 代码结构化解读 | 解析代码为语义块，生成「整体意图 + 逐块说明 + 关键数据结构与复杂度」 | MVP |
| F2 | 调试引导（分层提示） | 报错信息 + 代码上下文 → 定位提示 → 原因解释 → 修复方向，答案需显式展开 | MVP |
| F3 | 练习生成与校验 | 依据用户薄弱知识点生成同类小题，附测试用例自动判分 | MVP |
| F4 | 学习档案与复习 | 记录卡点、错题、知识点掌握度，生成每周复习清单 | 迭代 2 |
| F5 | 班级/助教视图 | 教师查看班级共性卡点，用于课堂讲评 | 迭代 3 |

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | TypeScript + React（Web）+ 代码编辑器组件 | 提供粘贴/上传、行级高亮、提示渐进展开 |
| 核心引擎 | Python 3.11 + tree-sitter / AST 解析 + 大模型调用编排 | 代码解析、分块、提示分层策略、练习生成 |
| 后端 | Python（FastAPI）+ SQLite/PostgreSQL | 任务队列、用户与学习档案、调用配额 |
| 测试 | pytest（单元/集成）、Playwright（前端 E2E） | `tests/unit`、`tests/integration` |
| CI/CD | GitHub Actions | 结构检查 → 单元测试 → 静态检查 |

> 选型为第 1 周初步方案，随 [docs/software](docs/software) 中的设计文档迭代更新。

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/kane0204/CodeLens.git
cd CodeLens

# 2. 切换到开发分支（所有开发都从 develop 开始）
git checkout develop

# 3. 创建自己的功能分支
git checkout -b feature/<简短描述>
```

环境依赖与启动方式将在核心引擎与前端首个可运行版本合入后补充到本节（预计第 3 周）。

## 项目结构

```text
CodeLens/
├── docs/
│   ├── requirements/     # 需求工程：问题定义、5W1H、用户故事、用例
│   ├── algorithm/        # 算法设计：代码解析、复杂度分析、提示分层策略
│   ├── software/         # 软件设计：架构、接口、数据库、测试方案
│   ├── mgmt/             # 项目管理：看板说明、迭代计划、Backlog、协作规范
│   └── retrospection/    # 阶段复盘与经验教训
├── code/
│   ├── backend/          # 服务端 API、任务调度、数据存储
│   ├── frontend/         # Web 前端
│   └── core_engine/      # 代码解析与提示生成核心引擎
├── tests/
│   ├── unit/             # 单元测试
│   └── integration/      # 集成测试
└── .github/
    ├── workflows/        # CI 流水线
    └── ISSUE_TEMPLATE/   # 任务 / 缺陷 / 需求 / 检查点模板
```

## 分支与提交规范

- `main`：生产/交付分支，始终保持可发布状态，只接受来自 `develop` 或 `release/*` 的 PR；
- `develop`：开发主分支，集成所有已完成的功能；
- `feature/<name>`、`fix/<name>`、`docs/<name>`：日常开发分支，从 `develop` 切出，完成后 PR 回 `develop`；
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，须关联 Issue 编号。

完整规则见 [docs/mgmt/branching-and-commit.md](docs/mgmt/branching-and-commit.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 协作流程

项目在 GitHub 上建立三个看板（Projects）：

| 看板 | 用途 | 主要内容 |
|---|---|---|
| **Team planning** | 迭代规划与容量管理 | 按周排期、成员认领、优先级排序 |
| **Kanban** | 日常任务流转 | Backlog → Ready → In progress → Review → Done |
| **Bug tracker** | 缺陷跟踪 | 缺陷提交、复现、修复、回归验证 |

看板入口：<https://github.com/kane0204/CodeLens/projects>（创建后请 Pin 到仓库侧边栏）

流程约定：先在 Issue 中描述任务或缺陷，由负责人在看板上认领并移动状态，通过分支与 PR 提交代码，至少 1 人 Review 后合并，最后关闭 Issue。标签与看板配置见 [docs/mgmt/project-setup.md](docs/mgmt/project-setup.md)。

## 迭代计划

| 周次 | 目标 | 交付物 | 检查点 |
|---|---|---|---|
| W1 | 立项与问题定义 | 仓库结构、README、5W1H 与产品描述、三个看板 | 提交仓库链接，通过 Issue 获得第一轮反馈 |
| W2 | 需求与算法设计 | 用户故事、用例、算法方案（解析/分块/提示分层） | 需求评审 |
| W3 | 架构与骨架 | 架构设计、接口定义、可运行的最小链路 | 设计评审 |
| W4–W6 | MVP 实现 | F1–F3 功能闭环 + 单元/集成测试 | 迭代演示 |

详细排期与任务分解见 [docs/mgmt/backlog.md](docs/mgmt/backlog.md)。

## 团队与分工

| 角色 | 成员 | 职责 |
|---|---|---|
| 组长 / 项目管理 | TBD | 排期、看板维护、对外提交检查点 |
| 需求与算法 | TBD | 需求文档、算法设计与验证 |
| 核心引擎 / 后端 | TBD | 代码解析、提示生成、API |
| 前端 | TBD | 交互界面、编辑器集成 |
| 测试与质量 | TBD | 测试用例、CI、缺陷跟踪 |

> 成员与分工确定后请更新本表，并在 `docs/mgmt/` 中同步任务认领。

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/requirements/problem_definition.md](docs/requirements/problem_definition.md) | 问题定义：5W1H 报告与产品描述（第 1 周交付物） |
| [docs/mgmt/project-setup.md](docs/mgmt/project-setup.md) | GitHub 看板、标签、里程碑配置 |
| [docs/mgmt/backlog.md](docs/mgmt/backlog.md) | 迭代 Backlog 与验收标准 |
| [docs/mgmt/branching-and-commit.md](docs/mgmt/branching-and-commit.md) | 分支策略与提交规范 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南（新成员从这里开始） |

## 许可证

本项目采用 [MIT License](LICENSE)，版权归项目组所有。
