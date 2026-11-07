# 预期图结构（FR-09 ~ FR-12）

图比较以「节点集合 + 边集合」为准，不比较布局坐标（tests/integration/README.md 约定）。

## 1. 模块依赖图（文件级）

| 边 | 依据行 | 说明 |
|---|---|---|
| `pricing` → `models` | pricing.py:3 | `from models import Order, Product`（Order/Product 未使用 → 同时是 A5 正例） |
| `orders` → `inventory` | orders.py:3 | `from inventory import check_stock, reserve` |
| `orders` → `payments` | orders.py:4 | `from payments import charge` |
| `orders` → `pricing` | orders.py:5 | `from pricing import calculate_total` |
| `reporting` → `inventory` | reporting.py:5 | 仅导入，无调用（见调用图对拍点） |
| `reporting` → `orders` | reporting.py:6 | 仅导入，无调用 |
| `reporting` → `pricing` | reporting.py:7 | 仅导入，无调用 |
| `reporting` → `utils` | reporting.py:8 | 仅导入（API_KEY），无调用 |
| `payments` → `thirdparty_gateway`（外部） | payments.py:3 | 不可解析 → A1 + warning |

强连通分量：**无循环依赖**，每个模块单独成 SCC（反例：本项目不应产出任何循环依赖 finding）。

## 2. 类图（F4）

### 节点

| 节点 | 位置 | 成员 |
|---|---|---|
| `models.Product` | models.py:7 | 字段 sku/name/price/stock（10-13） |
| `models.OrderItem` | models.py:17 | 字段 sku/quantity（20-21） |
| `models.Order` | models.py:25 | 字段 order_id/customer_id/items/status/discount/total（28-33） |
| `models.DiscountedOrder` | models.py:37 | 字段 coupon_code（40） |

### 边

| 边 | 类型 | 位置 | 证据 |
|---|---|---|---|
| `DiscountedOrder` → `Order` | inherits | models.py:37 | fact |

### 边界案例（明确预期「无边」）

| 案例 | 预期 | 原因 |
|---|---|---|
| `Order` — `OrderItem` | **无关联边** | `items: list` 为裸注解，元素类型静态不可判定；若实现推断注解元素类型必须标 inference |
| `OrderItem` — `Product` | **无关联边** | `sku: str` 与 Product 无类型关系；二者只通过 `catalog` 字典间接关联 |
| dataclass 生成方法 | **不作为节点** | `@dataclass` 静态不展开（metrics.md 同口径） |

## 3. 调用图（F5/F6，函数级，`--depth max`）

入口 `orders.submit_order`，direction=down：

| 调用边 | 调用点行 | 备注 |
|---|---|---|
| `submit_order` → `check_stock` | orders.py:11 | fact |
| `submit_order` → `calculate_total` | orders.py:13 | fact |
| `submit_order` → `reserve` | orders.py:15 | fact，循环内（14） |
| `submit_order` → `charge` | orders.py:16 | fact |
| `check_stock` → `catalog.get` | inventory.py:8 | 内置/外部口径待算法文档 B 定稿 |
| `calculate_total` → `catalog.get` | pricing.py:13 | 同上 |
| `reserve` → `catalog.get` | inventory.py:16 | 同上 |
| `charge` → `gateway.pay` | payments.py:9 | unresolved → A1 |
| `generate_report` → `catalog.get` | reporting.py:27、57 | fact |
| `generate_report` → `open` / `sorted` / `json.dumps` | 46、50、67、70 | builtin/stdlib |
| `generate_report` → `send_email` | reporting.py:73 | unresolved → A1 |

**关键对拍点（导入 ≠ 调用）**：`reporting` 模块导入 `submit_order`、`calculate_total`、
`check_stock`，但 `generate_report` 从不调用它们 → 模块依赖图有边，调用图**没有**这些调用边。
工具若把导入当成调用即误报。

**无调用者的函数**：`fmt`、`money`、`unused_helper`（与 A5 互相印证；
`money`/`fmt` 虽无调用者但互为重复实现，按 A2 报告而非全部按 A5 死代码报告——
口径：A5 只覆盖「无引用且非重复对」的函数，重复对优先走 A2，待 rules-engine 定稿）。

## 4. 时序图（F5，入口 `orders.submit_order`，happy path）

参与者：`submit_order`、`check_stock`、`calculate_total`、`reserve`、`charge`、`gateway`。

| # | 消息 | 行 | 标注 |
|---|---|---|---|
| 1 | `submit_order` → `check_stock(catalog, first.sku, first.quantity)` | orders.py:11 | 条件：返回 False 时流程在消息 1 后终止（返回 out_of_stock），不产生后续消息 |
| 2 | `check_stock` → `catalog.get(sku)` | inventory.py:8 | 推断（外部/内置） |
| 3 | `submit_order` → `calculate_total(order, catalog, member_level, coupon)` | orders.py:13 | — |
| 4 | `calculate_total` → `catalog.get(item.sku)` | pricing.py:13 | loop（遍历 order.items） |
| 5 | `submit_order` → `reserve(catalog, item.sku, item.quantity)` | orders.py:15 | loop（遍历 order.items） |
| 6 | `reserve` → `catalog.get(sku)` | inventory.py:16 | — |
| 7 | `submit_order` → `charge(order, card_token)` | orders.py:16 | — |
| 8 | `charge` → `gateway.pay(card_token, amount)` | payments.py:9 | 推断（外部网关） |

要求：消息顺序 1→8 不得重排；4、5 带 loop 标注；1 带条件标注；
导出 Mermaid 可被固定版本渲染器渲染。
