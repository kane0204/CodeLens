# 分支策略与提交规范

## 1. 分支模型

```text
main        ──●──────────────●────────────●──►  生产/交付分支（可发布）
                ╲            ╱            ╱
develop     ─────●───●───●──●────●───●──●─────►  开发主分支（集成）
                    ╲   ╱        ╲   ╱
feature/*            ●─●          ●─●           功能分支（短生命周期）
```

| 分支 | 从哪来 | 合并到哪 | 命名 | 说明 |
|---|---|---|---|---|
| `main` | — | — | `main` | 只接受 `develop`（或 `release/*`）的 PR；每次合并打标签 |
| `develop` | `main` | `main` | `develop` | 日常集成分支，功能完成即合入 |
| 功能分支 | `develop` | `develop` | `feature/<短描述>` | 例：`feature/ast-chunking` |
| 缺陷分支 | `develop` | `develop` | `fix/<短描述>` | 例：`fix/crash-on-empty-input` |
| 文档分支 | `develop` | `develop` | `docs/<短描述>` | 例：`docs/week1-problem-definition` |
| 紧急修复 | `main` | `main` + `develop` | `hotfix/<短描述>` | 仅用于 `main` 上的演示阻塞问题 |

命名要求：全小写，单词用连字符分隔，不含中文与空格。

## 2. 提交信息规范

格式：

```text
<type>(<scope>): <简述> (#<Issue 编号>)
```

示例：

```text
feat(core_engine): 支持 Python AST 语义分块 (#12)
fix(backend): 修复空输入导致的 500 错误 (#27)
docs(requirements): 补充 5W1H 中的 Who 一节 (#3)
```

| type | 含义 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `docs` | 文档变更 |
| `test` | 测试相关 |
| `refactor` | 重构（不改变外部行为） |
| `perf` | 性能优化 |
| `chore` | 构建、依赖、配置等杂项 |

约束：

- 主题行不超过 50 个字符，使用祈使语气，结尾不加句号；
- 一次提交只做一件事；正文（可选）说明「为什么改」；
- 必须包含关联 Issue 编号，便于追溯。

## 3. PR 规范

1. 标题与提交信息同格式；
2. 描述中使用 `Closes #<Issue>` 关联任务；
3. 说明验证方式（命令、步骤、结果）；
4. 至少 1 名成员 Review 通过后由作者之外的成员合并；
5. 合并策略：功能分支使用 **Squash merge**（保持 `develop` 历史清晰），`develop → main` 使用 **Merge commit**。

## 4. 分支保护（仓库 Settings → Branches）

对 `main` 与 `develop` 开启：

- 禁止直接 push，必须通过 PR；
- 至少 1 个 approving review；
- 要求 CI（`仓库结构与文档检查`）通过；
- 要求分支与最新代码同步后再合并；
- 禁止强制推送。

## 5. 常见问题

| 情况 | 处理方式 |
|---|---|
| 分支落后于 `develop` | `git fetch origin && git rebase origin/develop`（不要用 merge 造成历史交叉） |
| 提交信息写错但未推送 | `git commit --amend` 修改 |
| 误把无关文件加入提交 | 拆分为两次提交或 `git restore --staged <file>` 后重新提交 |
| 需要紧急修复 `main` | 建 `hotfix/*`，修复后同时合并回 `main` 与 `develop` |
