# 预期扫描结果（FR-01）

扫描根：`tests/fixtures/projects/circular_deps`。

## 纳入清单（6 个文件）

| 文件 | LOC | 说明 |
|---|---|---|
| `__init__.py` | 0 | 空 |
| `models.py` | 14 | `User` 类 |
| `notifications.py` | 10 | `Notifier` 类 |
| `plugins.py` | 9 | `get_base` |
| `repository.py` | 12 | `UserRepository` |
| `services.py` | 43 | 4 个类（User/Vip/Admin/UserService） |
| **合计** | **88** | 语法错误文件数 0 |

## 模块结构

- 单包 `circular_deps`；`analyze_sources` 口径下 `__init__` 模块名为
  `circular_deps.__init__`。
- 6 个模块：`__init__`、`models`、`notifications`、`plugins`、`repository`、`services`。

## 符号表要点

- 7 个类：`models.User`、`services.User`、`services.Vip`、`services.Admin`、
  `services.UserService`、`repository.UserRepository`、`notifications.Notifier`。
- 8 个方法：`models.User.__init__`、`models.User.display_name`、
  `notifications.Notifier.send_welcome`、`repository.UserRepository.save`、
  `services.User.__init__`、`services.Vip.__init__`、`services.UserService.__init__`、
  `services.UserService.register`；1 个顶层函数 `plugins.get_base`。
- **同名类不得合并**：`models.User` 与 `services.User` 是两个节点（FR-04）。
