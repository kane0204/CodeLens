# circular_deps · 样例项目说明

专测**结构视图**的小项目：循环依赖、跨模块同名类、静态不可解析的基类。
对应 US-03（类与继承）与 FR-12（循环依赖 100% 检出）。

## 设计覆盖点

| 能力 | 覆盖位置 |
|---|---|
| FR-12 循环依赖 | `services` ⇄ `repository` 双向导入，构成 2 节点强连通分量 |
| FR-04 同名消歧 | `models.User` 与 `services.User` 同名不同模块，节点不得合并 |
| FR-03 继承/super | `services.Vip(User)` + `super().__init__` 按 MRO 解析 |
| US-03 未知父类 | `Admin(get_base())` 基类为运行时表达式 → warning + 不画边 |
| F4 类图 | 继承边、组合边（`self.repo` / `self.notifier`）、同名双节点 |
| F5 时序图 | 入口 `UserService.register` 的 3 条消息 |
| F6 调用图 | 导入边 ≠ 调用边；`plugins.get_base` 的返回值类型推断 |
| C-01 不执行代码 | 本项目 import 即 `ImportError`（循环导入），静态分析不得运行它 |

## 结构

```text
circular_deps/
├── models.py         # User（领域实体）
├── services.py       # User（同名 DTO）、Vip、Admin、UserService
├── repository.py     # UserRepository，反向导入 services（成环）
├── notifications.py  # Notifier
├── plugins.py        # get_base() 动态基类
└── expected/         # 人工标注
```

## 使用约束

- **不得 import 本项目任何模块**（SRS C-01）：`services` 与 `repository`
  在导入期互相依赖，运行必然失败。这是刻意保留的 AI 代码特征，
  集成测试只做静态分析。
