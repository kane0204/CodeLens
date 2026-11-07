# 预期逻辑模型（FR-05 ~ FR-08）

函数级人工标注，按源码顺序逐条列出。AST 类型列用于语句轨迹对拍；
「目标/调用」列为赋值目标或调用表达式。行号即源码行，逻辑说明的每条文字必须能回溯到这些行。

## 1. `pricing.calculate_total`（pricing.py:9-26）— 核心校验对象

### 语句轨迹（16 步）

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 11 | `subtotal = 0.0` | Assign | subtotal |
| 2 | 12 | `for item in order.items:` | For | order.items |
| 3 | 13 | `product = catalog.get(item.sku)` | Assign | product / catalog.get |
| 4 | 14 | `if product is None:` | If | Compare |
| 5 | 15 | `continue` | Continue | — |
| 6 | 16 | `subtotal += product.price * item.quantity` | AugAssign | subtotal / BinOp |
| 7 | 17 | `if member_level == "vip":` | If | Compare |
| 8 | 18 | `subtotal = subtotal * 0.9` | Assign | subtotal |
| 9 | 19 | `elif member_level == "svip":` | If | Compare |
| 10 | 20 | `subtotal = subtotal * 0.85` | Assign | subtotal |
| 11 | 21 | `if subtotal > VIP_THRESHOLD:` | If | Compare |
| 12 | 22 | `subtotal = subtotal - 50.0` | Assign | subtotal |
| 13 | 23 | `if coupon is not None and subtotal > 200.0:` | If | BoolOp(And) |
| 14 | 24 | `subtotal = subtotal - coupon` | Assign | subtotal |
| 15 | 25 | `total = subtotal * (1 + TAX_RATE)` | Assign | total |
| 16 | 26 | `return round(total, 2)` | Return | round |

### 分支表

| 条件（行） | 真 → | 假 → |
|---|---|---|
| `product is None`（14） | 15 continue → 回到 12 下一轮 | 16 |
| `member_level == "vip"`（17） | 18 → 21 | 19 |
| `member_level == "svip"`（19） | 20 → 21 | 21 |
| `subtotal > VIP_THRESHOLD`（21） | 22 → 23 | 23 |
| `coupon is not None and subtotal > 200.0`（23） | 24 → 25 | 25 |

循环：12 为 for，回边 16→12，正常出口到 17。

### 数据流（def-use）

`order` → `item` → `item.sku` → `product` → `product.price` / `item.quantity` → `subtotal` → `total` → return。
`coupon` 仅在 23/24 使用；`member_level` 仅在 17/19 使用。

### 副作用

无（纯计算）。`catalog.get` 为外部调用，语义上是查询；若 catalog 为 dict 则无副作用
（口径待算法文档 C 确认，默认标 inferred/low）。

### 隐含假设

| # | 假设 | 依据行 |
|---|---|---|
| A1 | `order.items` 可迭代，元素带 `sku` 属性 | 12、13 直接属性访问 |
| A2 | `catalog` 具有 `get` 方法 | 13 |
| A3 | `product.price`、`item.quantity` 可做算术运算 | 16 |

### 异常路径

无 try/except；`catalog.get` 若不存在会抛 `AttributeError`（推断，不写入 findings，
仅在逻辑说明中标 inferred）。

---

## 2. `orders.submit_order`（orders.py:8-18）— 核心校验对象

### 语句轨迹（9 步）

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 10 | `first = order.items[0]` | Assign | first / Subscript |
| 2 | 11 | `if not check_stock(...)` | If | check_stock / UnaryOp |
| 3 | 12 | `return {"ok": False, ...}` | Return | Dict |
| 4 | 13 | `order.total = calculate_total(...)` | Assign | order.total / calculate_total |
| 5 | 14 | `for item in order.items:` | For | order.items |
| 6 | 15 | `reserve(...)` | Expr | reserve |
| 7 | 16 | `payment = charge(order, card_token)` | Assign | payment / charge |
| 8 | 17 | `order.status = "paid"` | Assign | order.status |
| 9 | 18 | `return {"ok": True, ...}` | Return | Dict |

### 分支表

| 条件（行） | 真 → | 假 → |
|---|---|---|
| `not check_stock(...)`（11） | 12 return，流程终止 | 13 |
| `for`（14） | 15 循环体 | 出口 16 |

### 异常路径（均未捕获）

- `order.items[0]` 空列表 → `IndexError`（10）
- `reserve` 内 `raise KeyError(sku)`（inventory.py:18）向上传播（15）
- `charge` 内第三方支付异常向上传播（16）

### 数据流

`order` → `first` → `first.sku`/`first.quantity` → `check_stock`；
`order`/`catalog`/`member_level`/`coupon` → `calculate_total` → `order.total`；
`catalog`/`item` → `reserve`；`order`/`card_token` → `charge` → `payment` → return。

### 副作用

| 副作用 | 位置 | 证据 |
|---|---|---|
| 写属性 `order.total` | orders.py:13 | fact |
| 写属性 `order.status` | orders.py:17 | fact |
| 写属性 `product.stock`（跨函数，reserve） | inventory.py:19 | fact |
| 第三方网络支付（跨函数，charge） | payments.py:9 | inference |
| 读 `catalog` / `order.items` | 多处 | fact |

### 隐含假设

| # | 假设 | 依据行 |
|---|---|---|
| A1 | `order.items` 非空（下标访问无长度检查） | 10 |
| A2 | `check_stock` 返回值可直接取反 | 11 |
| A3 | `card_token` 非空且有效（未校验） | 16 传入 |
| A4 | `charge` 执行前 `order.total` 已计算 | 13 → 16 |

---

## 3. `payments.charge`（payments.py:6-10）— 核心校验对象

### 语句轨迹（3 步）

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 8 | `amount = order.total` | Assign | amount |
| 2 | 9 | `result = gateway.pay(card_token, amount)` | Assign | result / gateway.pay |
| 3 | 10 | `return result["transaction_id"]` | Return | Subscript |

### 异常路径

- `gateway.pay` 网络/支付异常未包裹 try/except（9）→ A3 正例。
- `result["transaction_id"]` 缺键 → `KeyError` 未捕获（10）→ A6 正例。

### 副作用

网络支付调用 `gateway.pay`（9），inference（第三方模块不可解析，见 A1）。

### 隐含假设

| # | 假设 | 依据行 |
|---|---|---|
| A1 | `order.total` 已由调用方计算 | 8 |
| A2 | 返回 dict 含 `"transaction_id"` 键 | 10 直接下标 |

---

## 4. `inventory.reserve`（inventory.py:14-20）— 核心校验对象

### 语句轨迹（5 步）

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 16 | `product = catalog.get(sku)` | Assign | product / catalog.get |
| 2 | 17 | `if product is None:` | If | Compare |
| 3 | 18 | `raise KeyError(sku)` | Raise | KeyError |
| 4 | 19 | `product.stock -= quantity` | AugAssign | product.stock |
| 5 | 20 | `return True` | Return | — |

### 分支表

| 条件（行） | 真 → | 假 → |
|---|---|---|
| `product is None`（17） | 18 raise（异常出口） | 19 → 20 |

### 副作用

写属性 `product.stock`（19），fact。

### 隐含假设

`quantity` 为正数（未校验；负值会导致库存增加，推断）。

### 与 `calculate_total` 的行为不一致（审查报告素材）

`calculate_total` 对未知 sku 是「跳过」（pricing.py:15 continue），
`reserve` 对未知 sku 是「抛 KeyError」（inventory.py:18）——同一项目两种口径，
审查报告应将其列为人工复核点。

---

## 5. `reporting.generate_report`（reporting.py:11-74）— 核心校验对象（51 步）

### 语句轨迹（51 步）

| # | 行 | 语句 | AST 类型 | 目标 / 调用 |
|---|---|---|---|---|
| 1 | 13 | `lines = []` | Assign | lines |
| 2 | 14 | `total_revenue = 0.0` | Assign | total_revenue |
| 3 | 15 | `total_orders = 0` | Assign | total_orders |
| 4 | 16 | `paid_orders = 0` | Assign | paid_orders |
| 5 | 17 | `cancelled_orders = 0` | Assign | cancelled_orders |
| 6 | 18 | `product_sales = {}` | Assign | product_sales |
| 7 | 19 | `customer_totals = {}` | Assign | customer_totals |
| 8 | 20 | `for order in orders:` | For | orders |
| 9 | 21 | `total_orders += 1` | AugAssign | total_orders |
| 10 | 22 | `if order.status == "paid":` | If | Compare |
| 11 | 23 | `paid_orders += 1` | AugAssign | paid_orders |
| 12 | 24 | `elif order.status == "cancelled":` | If | Compare |
| 13 | 25 | `cancelled_orders += 1` | AugAssign | cancelled_orders |
| 14 | 26 | `for item in order.items:` | For | order.items |
| 15 | 27 | `product = catalog.get(item.sku)` | Assign | product / catalog.get |
| 16 | 28 | `if product is None:` | If | Compare |
| 17 | 29 | `continue` | Continue | — |
| 18 | 30 | `amount = product.price * item.quantity` | Assign | amount / BinOp |
| 19 | 31 | `product_sales[item.sku] = ... + item.quantity` | Assign | Subscript |
| 20 | 32-34 | `customer_totals[order.customer_id] = (...)` | Assign | Subscript（跨行） |
| 21 | 35 | `total_revenue += amount` | AugAssign | total_revenue |
| 22 | 36 | `lines.append(...)` | Expr | lines.append |
| 23 | 37 | `lines.append(...)` | Expr | lines.append |
| 24 | 38 | `lines.append(...)` | Expr | lines.append |
| 25 | 39 | `lines.append(...)` | Expr | lines.append |
| 26 | 40 | `if total_orders > 0:` | If | Compare |
| 27 | 41 | `average = total_revenue / total_orders` | Assign | average |
| 28 | 42 | `lines.append(...)` | Expr | lines.append |
| 29 | 44 | `lines.append("average order: n/a")` | Expr | lines.append（else 分支） |
| 30 | 45 | `lines.append("top products:")` | Expr | lines.append |
| 31 | 46 | `ranked = sorted(...)` | Assign | sorted / lambda |
| 32 | 47 | `for sku, qty in ranked:` | For | ranked |
| 33 | 48 | `lines.append(...)` | Expr | lines.append |
| 34 | 49 | `lines.append("top customers:")` | Expr | lines.append |
| 35 | 50-52 | `ranked_customers = sorted(...)` | Assign | sorted（跨行） |
| 36 | 53 | `for customer_id, amount in ranked_customers:` | For | ranked_customers |
| 37 | 54 | `lines.append(...)` | Expr | lines.append |
| 38 | 55 | `lines.append("low stock:")` | Expr | lines.append |
| 39 | 56 | `for sku, qty in product_sales.items():` | For | product_sales.items |
| 40 | 57 | `product = catalog.get(sku)` | Assign | product / catalog.get |
| 41 | 58 | `if product is not None and product.stock < 10:` | If | BoolOp(And) |
| 42 | 59 | `lines.append(...)` | Expr | lines.append |
| 43 | 60-66 | `summary = {...}` | Assign | Dict（跨行） |
| 44 | 67 | `with open(...) as handle:` | With | open |
| 45 | 68 | `handle.write(...)` | Expr | handle.write |
| 46 | 69 | `handle.write("\n")` | Expr | handle.write |
| 47 | 70 | `handle.write(json.dumps(summary))` | Expr | handle.write / json.dumps |
| 48 | 71 | `subject = "Daily sales report"` | Assign | subject |
| 49 | 72 | `body = "\n".join(lines)` | Assign | body |
| 50 | 73 | `send_email(email_to, subject, body)` | Expr | send_email（未解析） |
| 51 | 74 | `return output_path` | Return | — |

### 分支表

| 条件（行） | 真 → | 假 → |
|---|---|---|
| `status == "paid"`（22） | 23 | 24 |
| `status == "cancelled"`（24） | 25 | 26 |
| `product is None`（28） | 29 continue → 回 26 | 30 |
| `total_orders > 0`（40） | 41-42 → 45 | 44 → 45 |
| `product is not None and stock < 10`（58） | 59 | 回 56 下一轮 |

循环：20（回边 35→20，出口 36）、26（回边 35→26，出口 36）、
47（回边 48→47，出口 49）、53（回边 54→53，出口 55）、56（回边 59→56，出口 60）。

### 异常路径

- `open` 抛 `OSError` 未捕获（67）→ A3 正例。
- `send_email` 未导入，运行即 `NameError`（73）→ A1 正例。
- `json.dumps` 遇不可序列化值抛 `TypeError`（70，推断，不计 finding）。

### 副作用

| 副作用 | 位置 | 证据 |
|---|---|---|
| 写文件（open + 3×write） | 67-70 | fact |
| 网络邮件发送 | 73 | inference |
| 只读 `orders`/`catalog` | 多处 | fact |

### 隐含假设

`orders` 可迭代；`order.items` 元素带 `sku`；`catalog.get` 可用；
`email_to` 为合法地址（未校验）。

### 职责簇（SRP-01 依据）

聚合计算（20-59）／文本渲染（36-66）／文件持久化（67-70）／邮件通知（71-73）
→ 4 个独立变动理由，簇按共享字段聚类为 4 组 → SRP-01 正例（inference/medium）。

---

## 6. 其余函数（简注）

| 函数 | 位置 | 步骤数 | 要点 |
|---|---|---|---|
| `inventory.check_stock` | 6-11 | 4 | `product is None` → return False；纯查询无副作用 |
| `inventory.sync_inventory` | 23-32 | 8 | 嵌套 5 层；只读无副作用；名为 sync 但无持久化（观察项，A7 属 W6） |
| `pricing.fmt` | 29-31 | 1 | 与 `utils.money` 函数体逐字符相同 → A2 正例之一 |
| `utils.money` | 6-8 | 1 | 同上，A2 正例之二 |
| `utils.unused_helper` | 11-13 | 1 | 全项目无引用 → A5 正例 |

## 5 个核心校验函数的抽样口径

集成测试「逻辑建模」步骤固定校验本文件第 1-5 节
（`calculate_total`、`submit_order`、`charge`、`reserve`、`generate_report`）：
语句顺序与行号 100% 匹配；分支去向与上表一致；副作用与假设清单不遗漏。
