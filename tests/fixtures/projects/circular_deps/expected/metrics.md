# 预期指标（FR-13 / FR-17）

基线：radon 6.0.1 + AST 脚本。全部函数 CC=1 或 2，无任何阈值命中——
本项目的价值在结构图，不在指标。

## 函数级

| 函数 | 位置 | CC | 等级 | 语句数 | 参数 | 嵌套 |
|---|---|---|---|---|---|---|
| `models.User.__init__` | models.py:7-9 | 1 | A | 2 | 3 | 0 |
| `models.User.display_name` | models.py:11-13 | 1 | A | 1 | 1 | 0 |
| `plugins.get_base` | plugins.py:6-8 | 1 | A | 1 | 0 | 0 |
| `notifications.Notifier.send_welcome` | notifications.py:7-9 | 1 | A | 1 | 2 | 0 |
| `repository.UserRepository.save` | repository.py:9-11 | 1 | A | 1 | 2 | 0 |
| `services.User.__init__` | services.py:13-15 | 1 | A | 2 | 3 | 0 |
| `services.Vip.__init__` | services.py:21-23 | 1 | A | 2 | 4 | 0 |
| `services.UserService.__init__` | services.py:33-35 | 1 | A | 2 | 1 | 0 |
| `services.UserService.register` | services.py:37-42 | 1 | A | 4 | 3 | 0 |

## 类级

| 类 | 显式方法数 | WMC | DIT |
|---|---|---|---|
| `models.User` | 2 | 2 | 0 |
| `services.User` | 1 | 1 | 0 |
| `services.Vip` | 1 | 1 | 1 |
| `services.Admin` | 0 | 0 | 不可判定（动态基类） |
| `services.UserService` | 2 | 2 | 0 |
| `repository.UserRepository` | 1 | 1 | 0 |
| `notifications.Notifier` | 1 | 1 | 0 |

## 模块级（关键）

| 模块 | 出度 | 入度 | 所在 SCC |
|---|---|---|---|
| `models` | 0 | 1（plugins） | {models} |
| `notifications` | 0 | 1（services） | {notifications} |
| `plugins` | 1 | 1（services） | {plugins} |
| `repository` | 1（services） | 1（services） | **{repository, services}** |
| `services` | 3 | 1（repository） | **{repository, services}** |

模块不稳定度（instability，I = 出度/(出度+入度)，口径待算法文档 G 定稿）：
`services` = 3/(3+1) = 0.75，`repository` = 1/(1+1) = 0.50，
`models`/`notifications` = 0（纯被依赖），`plugins` = 1/(1+1) = 0.50。
