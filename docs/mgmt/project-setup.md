# GitHub 项目配置说明（看板 / 标签 / 里程碑）

本文档记录 CodeLens 在 GitHub 上的协作设施配置，保证「谁在做什么、做到哪一步」对全组可见。

## 1. 仓库基本信息

| 项 | 内容 |
|---|---|
| 仓库地址 | https://github.com/kane0204/CodeLens |
| 主分支 | `main`（生产/交付）、`develop`（开发集成） |
| 协作者 | 全组成员（至少 Write 权限） |
| 分支保护 | `main` 禁止直接推送，须经 PR 且 1 人 Review 通过 |

## 2. 三个 Projects 看板

按课程要求在仓库的 **Projects** 中建立以下三个看板。建议均使用 Board（表格）视图，并在看板中配置「分组按 Status、排序按 Priority」。

### 2.1 Team planning（迭代规划）

用途：按周规划容量、分配任务、对齐迭代目标。

| 列（Status） | 含义 |
|---|---|
| `📋 Planned` | 已进入本次迭代候选池但未排期 |
| `🎯 This Week` | 本周承诺完成 |
| `⏭ Next Week` | 下周计划 |
| `⚠️ At Risk` | 进度落后或阻塞，需在周会上说明 |
| `✅ Done` | 已交付并验证 |

自定义字段：`Week`（W1–W6）、`Owner`、`Estimate`（工时）、`Priority`（P0–P3）。

### 2.2 Kanban（任务流转）

用途：日常任务的实时状态，人人可见、随时更新。

| 列（Status） | 进入条件 |
|---|---|
| `📥 Backlog` | 已建 Issue，尚未细化 |
| `🔍 Ready` | 验收标准明确、可直接开工 |
| `🚧 In progress` | 已认领并正在做（同时进行不超过 2 项/人） |
| `👀 In review` | 已提 PR，等待 Review |
| `✅ Done` | 已合并、已验证、Issue 已关闭 |
| `⛔ Blocked` | 有外部依赖或需他人决策 |

流转规则：一个任务同一时刻只能有 1 名负责人；状态变更需在 Issue 中留一句说明；`Done` 前必须关闭对应 Issue。

### 2.3 Bug tracker（缺陷跟踪）

用途：缺陷从报告到回归验证的闭环。

| 列（Status） | 含义 |
|---|---|
| `🆕 New` | 新报告，待确认 |
| `🔬 Triaged` | 已复现、已定级、已指派 |
| `🛠 Fixing` | 修复中 |
| `🧪 Verifying` | 待回归验证（由报告者验证） |
| `✅ Closed` | 验证通过并关闭 |
| `🚫 Won't fix` | 明确不修复，需写明理由 |

约定：缺陷必须绑定严重程度标签（`priority: P0`–`P3`）；P0 缺陷当日内响应；验证由**非修复者**执行。

## 3. 标签体系（Labels）

| 前缀 | 取值 | 用途 |
|---|---|---|
| `type:` | `feature` `task` `bug` `docs` `test` `checkpoint` | 区分工作类型 |
| `priority:` | `P0` `P1` `P2` `P3` | 优先级与严重程度 |
| `status:` | `awaiting-review` `blocked` `discussion` | 需要关注的特殊状态 |
| `area:` | `core_engine` `backend` `frontend` `docs` `ci` | 影响范围，便于筛选 |
| 无前缀 | `good first issue` `help wanted` | 新人可承接的任务 |

## 4. 里程碑（Milestones）

| 里程碑 | 目标 | 验收 |
|---|---|---|
| `W1 立项与问题定义` | 仓库 + README + 三个看板 + 5W1H 与产品描述 | 提交仓库链接获得第一轮反馈 |
| `W2 需求与算法设计` | 用户故事、用例、算法方案 | 需求评审通过 |
| `W3 架构与骨架` | 架构文档、接口定义、端到端最小链路 | 设计评审通过 |
| `W4–W6 MVP` | F1–F3 功能闭环 + 测试 | 迭代演示通过 |

## 5. 配置方式

### 2 分钟网页创建清单（推荐）

1. 打开 <https://github.com/kane0204/CodeLens/projects/new>，名称填 `Team planning`，模板选 **Board**，创建后按 2.1 节重命名列；
2. 重复上述步骤，分别创建 `Kanban`（按 2.2 节列）与 `Bug tracker`（按 2.3 节列）；
3. 回到仓库首页，把三个看板 **Pin** 到侧边栏，方便组员直达；
4. 在 `Kanban` 看板上点击 `+ Add item`，把已创建的 Issue（#1–#7）加入看板；
5. 把三个看板链接填回 [README.md](../../README.md) 与检查点 Issue #1。

> 为什么不能由脚本一次建完？创建 Projects 需要 GitHub 令牌具备 `project` 范围，而当前本机 Git 凭据（`git-credential-manager`）只有 `gist/repo/workflow`，因此脚本只能创建标签、里程碑与 Issue。

### 方式一：网页操作（推荐给组长）

1. 打开仓库 → **Projects** → **New project** → 选择 Board，分别建立 `Team planning`、`Kanban`、`Bug tracker`；
2. 在 `Kanban` 看板中按 2.2 节创建列；
3. 在 `Team planning` 中新增自定义字段 `Week`、`Owner`、`Estimate`、`Priority`；
4. 仓库 → **Issues** → **Labels**，按第 3 节逐项新建标签（写清颜色）；
5. 仓库 → **Issues** → **Milestones**，按第 4 节新建 4 个里程碑；
6. 把三个看板的链接填回 [README.md](../../README.md) 与检查点 Issue。

### 方式二：脚本批量创建

安装 [GitHub CLI](https://cli.github.com/) 并登录后，在仓库根目录执行：

```bash
bash docs/mgmt/scripts/gh-bootstrap.sh
```

脚本会创建标签、里程碑与初始 Issue（见 `docs/mgmt/backlog.md`）。看板（Projects）需在网页中创建，或使用 `gh project create`。

## 6. 每周节奏

| 时间 | 活动 | 产出 |
|---|---|---|
| 周一 | 组会：确认本周承诺任务，更新 Team planning | 本周任务进入 `This Week` |
| 每日 | 各自更新 Kanban 状态 | 看板反映真实进度 |
| 周四 | 中期检查：`At Risk` 任务是否需要支援 | 调整排期 |
| 周日 | 周复盘：完成情况、经验教训 | 记录到 `docs/retrospection/week-XX.md` |
