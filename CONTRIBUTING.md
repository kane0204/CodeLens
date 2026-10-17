# 贡献指南（Contributing Guide）

欢迎加入 CodeLens 项目组。请在上手前通读本文，它规定了我们「怎么写、怎么提交、怎么评审」的共同约定。

## 1. 准备工作

```bash
git clone https://github.com/kane0204/CodeLens.git
cd CodeLens
git checkout develop          # 开发主分支
git checkout -b feature/x     # 每项任务一个分支
```

请先配置本机身份，避免提交记录出现未知作者：

```bash
git config user.name  "<姓名拼音或英文名>"
git config user.email "<邮箱>"
```

## 2. 三步协作流程

1. **开 Issue**：用仓库模板创建 Issue（任务用「任务」模板，缺陷用「缺陷」模板），写清目标与验收标准；
2. **认领并开发**：Issue 指派给自己，看板状态改为 `In progress`，在功能分支上开发；
3. **提 PR 并评审**：PR 中写 `Closes #<Issue 编号>`，至少 1 名成员 Review 通过后合并，看板状态改为 `Done`。

## 3. 分支与提交

- 分支：`main`（生产）← `develop`（开发）← `feature/*` / `fix/*` / `docs/*`；
- 提交信息：`<type>(<scope>): <简述> (#<Issue>)`，例如 `feat(core_engine): 支持 Python AST 语句轨迹抽取 (#12)`；
- `type` 取值：`feat` `fix` `docs` `test` `refactor` `chore` `perf`；
- 一次提交只做一件事，不要把无关改动混在同一次提交里。

完整说明见 [docs/mgmt/branching-and-commit.md](docs/mgmt/branching-and-commit.md)。

## 4. 提交前自检

- [ ] 代码可编译 / 可运行，本地测试通过；
- [ ] 新增或修改的功能有对应测试（`tests/unit` 或 `tests/integration`）；
- [ ] 文档同步更新（需求变更写入 `docs/requirements`，设计变更写入 `docs/software`）；
- [ ] 未提交密钥、`.env`、大文件与个人临时文件；
- [ ] 提交信息包含 Issue 编号。

## 5. 评审约定

- Reviewer 关注顺序：是否满足 Issue 验收标准 → 可读性 → 边界与异常处理 → 测试覆盖；
- 意见分三级：`[阻塞]` 必须修改、`[建议]` 推荐修改、`[提问]` 仅讨论；
- 作者不自行合并自己的 PR（紧急情况需在 PR 中说明）。

## 6. 文档约定

| 目录 | 写什么 | 主要维护人 |
|---|---|---|
| `docs/requirements/` | 需求、5W1H、用户故事、用例 | 需求负责人 |
| `docs/algorithm/` | 逻辑模型、图算法、指标公式、规则设计、实验数据 | 算法负责人 |
| `docs/software/` | 架构、模块与接口、数据模型、测试方案 | 架构/开发负责人 |
| `docs/mgmt/` | 看板与迭代计划、协作规范、会议记录 | 组长 |
| `docs/retrospection/` | 阶段复盘、经验教训、改进项 | 全员参与 |

文档统一使用 Markdown、中文正文，文件名小写加连字符；图表优先用 Mermaid 内嵌，避免上传二进制图片。
