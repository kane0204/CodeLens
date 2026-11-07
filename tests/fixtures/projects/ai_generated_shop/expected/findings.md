# 预期规则命中（FR-14 ~ FR-16）

> **引擎实测状态（2026-10-24，engine v0.2.0，见 `tests/fixtures/VERIFICATION.md`）**：
> 已实现规则 CC-01 / LEN-01 / DEPTH-01 / A4 / A3-IO / CYCLE-01，本项目实测命中 5 条，
> 与下表 #1/#2/#3/#9/#10 完全一致；其余规则（A1/A2/A5/A6/长参数/SRP）尚未实现，
> 对应条目为**规则上线后的预期**，当前不计入误报统计。
> 引擎暂不发出「未解析导入/调用」warning（仅有 `graph.calls` 的 unresolved 记录与
> 基类解析 warning），下方 warning 表的 A1 同源行为预期，非当前行为。

规则 ID 为 provisional，以 `docs/algorithm/rules-engine.md` 定稿为准。
字段口径对齐 SRS FR-18：`rule_id` / `severity` / `evidence_type` / `file` / `line` /
`actual` / `threshold` / `confidence` / `message` / `suggestion`。

## 预期命中（19 条）

| # | rule_id | severity | evidence | 位置 | actual | threshold | confidence | 说明 |
|---|---|---|---|---|---|---|---|---|
| 1 | LONG-FUNC-01 | warning | fact | reporting.py:11 | 51 | 50 | — | 长函数 |
| 2 | CC-01 | warning | fact | reporting.py:11 | 12 | 10 | — | 圈复杂度超阈值 |
| 3 | DEEP-NEST-01 | warning | fact | inventory.py:23 | 5 | 4 | — | 深层嵌套 |
| 4 | LONG-PARAMS-01 | warning | fact | orders.py:8 | 5 | 4 | — | 长参数列表 |
| 5 | A1 | warning | inference | payments.py:3 | — | — | high | 导入 `thirdparty_gateway` 不可解析 |
| 6 | A1 | warning | inference | reporting.py:73 | — | — | medium | 调用 `send_email` 不可解析（未导入） |
| 7 | A2 | info | fact | pricing.py:29 ↔ utils.py:6 | 1.00 | 0.90 | — | `fmt` 与 `money` 函数体逐字符相同 |
| 8 | A3 | warning | inference | payments.py:9 | — | — | medium | 第三方支付调用无异常处理 |
| 9 | A3 | warning | inference | reporting.py:67 | — | — | medium | 文件写无异常处理 |
| 10 | A4 | critical | fact | utils.py:3 | — | — | — | 硬编码密钥（`sk-live-` 模式） |
| 11 | A5 | info | fact | utils.py:11 | — | — | — | `unused_helper` 无任何引用 |
| 12 | A5 | info | fact | reporting.py:5 | — | — | — | 未使用导入 `check_stock` |
| 13 | A5 | info | fact | reporting.py:6 | — | — | — | 未使用导入 `submit_order` |
| 14 | A5 | info | fact | reporting.py:7 | — | — | — | 未使用导入 `calculate_total` |
| 15 | A5 | info | fact | reporting.py:8 | — | — | — | 未使用导入 `API_KEY` |
| 16 | A5 | info | fact | pricing.py:3 | — | — | — | 未使用导入 `Order`、`Product` |
| 17 | A6 | warning | inference | orders.py:10 | — | — | medium | `order.items[0]` 无空列表检查 |
| 18 | A6 | warning | inference | payments.py:10 | — | — | medium | `result["transaction_id"]` 无键存在性检查 |
| 19 | SRP-01 | warning | inference | reporting.py:11 | 4 | 2 | medium | 职责簇：聚合/渲染/持久化/通知 |

## 预期 warning（非 finding，FR-03 口径）

| warning | 位置 | 原因 |
|---|---|---|
| unresolved import | payments.py:3 | 与 A1 #5 同源，允许合并为一条 finding + 一条 warning |
| unresolved call | reporting.py:73 | 与 A1 #6 同源 |
| 内置方法解析口径 | catalog.get 各调用点 | `dict.get` 等可标 unresolved 或解析到 builtins，二选一，算法文档 B 定稿后回填 |

## 预期不命中（误报检查，反例）

| 检查点 | 预期 |
|---|---|
| `calculate_total` CC=8 | 不触发 CC-01（阈值 >10），不得借「B 级」造 warning |
| `models` 四个类 | 不触发 BIG-CLASS-01（显式方法 0，规模小） |
| `money`/`fmt` 之外的函数 | 不触发 DUP-CODE-01 |
| `check_stock`/`reserve` CC=2 | 无任何复杂度命中 |
| `reserve` 的 `raise KeyError` | **不**触发 A3：异常是有意抛出的参数校验，不是未处理的外部调用失败 |
| `catalog.get` 各调用点 | **不**触发 A3：本地数据结构方法，不算外部 IO/网络/DB 调用（口径待算法文档 I 确认） |
| `DiscountedOrder` | 无循环依赖、无坏味 |
| `submit_order` 的 5 参数 | 触发 LONG-PARAMS-01 但**不**触发任何坏味复合规则 |
| 全项目 | 不出现「无 rule_id / 无位置 / 无证据等级」的 finding（FR-18 字段完整性） |

## 审查报告预期（F11）

- 风险排序：critical（A4 #10）→ warning（CC-01、LONG-FUNC-01、DEEP-NEST-01、
  LONG-PARAMS-01、A1×2、A3×2、A6×2、SRP-01）→ info（A2、A5×6）。
- 同级内按 `file`、`line`、`rule_id` 排序（US-05）。
- 报告须包含「已知不一致」条目：`calculate_total` 跳过未知 sku vs `reserve` 抛 KeyError
  （logic.md 第 4 节），作为人工复核点。
