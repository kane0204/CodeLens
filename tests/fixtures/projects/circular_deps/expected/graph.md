# 预期图结构（FR-09 ~ FR-12）— 本项目的核心标注

## 1. 模块依赖图与循环检测（FR-12）

### 依赖边（5 条）

| 边 | 依据行 | 类型 |
|---|---|---|
| `services` → `notifications` | services.py:3 | import |
| `services` → `plugins` | services.py:4 | import |
| `services` → `repository` | services.py:5 | import |
| `repository` → `services` | repository.py:3 | import（反向，成环） |
| `plugins` → `models` | plugins.py:3 | import |

### 强连通分量

| SCC | 成员 | 预期 |
|---|---|---|
| C1 | {services, repository} | **循环依赖，必须检出**（critical/warning） |
| C2 | {models} | 单点，无环 |
| C3 | {notifications} | 单点，无环 |
| C4 | {plugins} | 单点，无环 |

验收口径（FR-12）：构造样例循环依赖 100% 检出并标注位置
（finding 行号取 `repository.py:3` 与 `services.py:5` 两条导入边）。

## 2. 类图（FR-09）

### 节点（7 个，FQN 唯一）

`models.User`、`services.User`、`services.Vip`、`services.Admin`、
`services.UserService`、`repository.UserRepository`、`notifications.Notifier`。

### 边

| 边 | 类型 | 位置 | 证据 |
|---|---|---|---|
| `services.User` → `services.Vip` | inherits | services.py:18 | fact |
| `services.UserService` → `repository.UserRepository` | associates | services.py:34（`self.repo = UserRepository()`） | fact |
| `services.UserService` → `notifications.Notifier` | associates | services.py:35（`self.notifier = Notifier()`） | fact |

### 边界案例（US-03 场景 2：未知父类）

`Admin(get_base())`（services.py:26）：基类是函数调用表达式，静态不可解析。

- 预期：**不画任何继承边**，不猜测连接到 `models.User`；
- 预期：一条带位置 warning（services.py:26），message 说明基类无法静态确定；
- 若推断「`get_base()` 返回 `models.User`」必须标 inference/medium，且与 fact 边区分展示
  （`get_base` 函数体 `return User` 在 plugins.py:8，属跨函数返回类型推断）。

### 同名消歧（US-03 场景 1 / FR-04）

- `models.User` 与 `services.User` 是两个独立节点，FQN 区分，不得合并、不得串线。
- `register` 内的 `User(name, email)`（services.py:39）解析到 **`services.User`**
  （模块内定义），不是 `models.User`。
- `plugins.get_base` 的返回表达式是 `models.User`（plugins.py:8）——推断边，允许标 inference。

## 3. 调用图（函数级）

| 调用边 | 调用点 | 证据 |
|---|---|---|
| `UserService.register` → `services.User.__init__` | services.py:39 | fact |
| `UserService.register` → `UserRepository.save` | services.py:40 | fact |
| `UserService.register` → `Notifier.send_welcome` | services.py:41 | fact |
| `UserService.__init__` → `UserRepository.__init__` | services.py:34 | fact |
| `UserService.__init__` → `Notifier.__init__` | services.py:35 | fact |
| `services.Vip.__init__` → `super().__init__` → `services.User.__init__` | services.py:22 | fact（MRO） |
| `UserRepository.save` → `f-string`（内置） | repository.py:11 | fact |
| `plugins.get_base` → 返回 `models.User` | plugins.py:8 | inference |

**导入 ≠ 调用**：`repository` 导入 `services` 只为使用模块常量 `DEFAULT_SOURCE`
（repository.py:11），调用图中**没有** `UserRepository.save` → `services` 任何函数的边。
工具若把「导入模块」展开成「调用该模块全部函数」即误报。

## 4. 时序图（入口 `services.UserService.register`）

参与者：`register`、`User.__init__`、`UserRepository.save`、`Notifier.send_welcome`。

| # | 消息 | 行 |
|---|---|---|
| 1 | `register` → `User.__init__(name, email)` | services.py:39 |
| 2 | `register` → `UserRepository.save(user)` | services.py:40 |
| 3 | `register` → `Notifier.send_welcome(email)` | services.py:41 |

消息 1 的接收方必须是 `services.User.__init__`（FQN 校验点）。
