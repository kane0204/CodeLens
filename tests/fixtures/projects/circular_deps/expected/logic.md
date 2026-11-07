# 预期逻辑模型（FR-05 ~ FR-08）

本项目函数均为小函数，标注从简；重点是 `register` 的调用编排与 `Vip.__init__` 的 super 解析。

## 1. `services.UserService.register`（services.py:37-42）— 核心校验对象

### 语句轨迹（4 步）

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 39 | `user = User(name, email)` | Assign | user / services.User.__init__ |
| 2 | 40 | `saved = self.repo.save(user)` | Assign | saved / UserRepository.save |
| 3 | 41 | `self.notifier.send_welcome(email)` | Expr | Notifier.send_welcome |
| 4 | 42 | `return saved` | Return | — |

### 数据流

`name`/`email` → `User.__init__` → `user` → `UserRepository.save` → `saved` → return；
`email` → `Notifier.send_welcome`。

### 副作用

写属性 `self.repo` / `self.notifier` 发生在 `__init__`（33-35），`register` 内无直接副作用；
`UserRepository.save` 内部仅字符串拼接，无 IO（边界：名为 save 但无持久化，观察项）。

### 隐含假设

`self.repo`/`self.notifier` 已由 `__init__` 初始化（39-41 直接属性访问）；
`name`/`email` 为非空字符串（未校验）。

## 2. `services.Vip.__init__`（services.py:21-23）— super 解析校验

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 22 | `super().__init__(name, email)` | Expr | super().__init__ → services.User.__init__ |
| 2 | 23 | `self.level = level` | Assign | self.level |

验收：`super()` 按 MRO 解析到 `services.User.__init__`（**不是** `models.User.__init__`），
调用图须画出该边（fact）。

## 3. 其余函数（简注）

| 函数 | 位置 | 要点 |
|---|---|---|
| `models.User.__init__` | models.py:7-9 | 写 `self.name`/`self.email` |
| `models.User.display_name` | models.py:11-13 | 返回 `self.name`，无副作用 |
| `plugins.get_base` | plugins.py:6-8 | 返回类对象 `models.User`（返回类型推断素材） |
| `notifications.Notifier.send_welcome` | notifications.py:7-9 | 返回 f-string，无 IO |
| `repository.UserRepository.save` | repository.py:9-11 | 用模块常量 `DEFAULT_SOURCE` 拼串；无 IO |
| `services.User.__init__` | services.py:13-15 | 写 `self.name`/`self.email` |
| `services.UserService.__init__` | services.py:33-35 | 组合 `UserRepository` 与 `Notifier`（类图 associates 边依据） |
