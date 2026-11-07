# 预期指标（FR-13 / FR-17）

基线验证：radon 6.0.1（SRS R4）对拍 + AST 脚本统计。容差 ±5%。

## 函数级指标

| 函数 | 位置 | CC | 等级 | 函数体语句数 | 参数个数 | 最大嵌套 |
|---|---|---|---|---|---|---|
| `calculate_total` | pricing.py:9-26 | 8 | B | 16 | 4 | 2 |
| `fmt` | pricing.py:29-31 | 1 | A | 1 | 1 | 0 |
| `check_stock` | inventory.py:6-11 | 2 | A | 4 | 3 | 1 |
| `reserve` | inventory.py:14-20 | 2 | A | 5 | 3 | 1 |
| `sync_inventory` | inventory.py:23-32 | 6 | B | 8 | 1 | **5** |
| `charge` | payments.py:6-10 | 1 | A | 3 | 2 | 0 |
| `money` | utils.py:6-8 | 1 | A | 1 | 1 | 0 |
| `unused_helper` | utils.py:11-13 | 1 | A | 1 | 1 | 0 |
| `submit_order` | orders.py:8-18 | 3 | A | 9 | **5** | 1 |
| `generate_report` | reporting.py:11-74 | **12** | C | **51** | 4 | 3 |

等级口径（US-04）：A=1–5，B=6–10，C=11–20，D=21–30，E=31–40，F≥41。
加粗 = 触发阈值（CC>10、嵌套>4、参数>4、语句数>50），对应 `findings.md`。

长度口径说明（2026-10-24 引擎实测）：「函数长度」有两种口径——
AST 语句数（本表，复合语句计 1 次，不含 docstring）与引擎的物理有效代码行
（`generate_report` = 63，`submit_order` = 10，`sync_inventory` = 9）。
两种口径下只有 `generate_report` 超阈值，结论一致；精确口径以算法文档 G 定稿，
定稿后本表与引擎输出须在 ±5% 容差内对齐。

## CC 手算（供算法文档 G 对拍）

- `calculate_total` = 1 + for(1) + if None(1) + if vip(1) + elif svip(1) + if 满减(1)
  + if coupon(1) + `and`(1) = **8**
- `generate_report` = 1 + for×5 + if×4 + elif×1 + `and`×1 = **12**
  （for：L20/L26/L47/L53/L56；if：L22/L28/L40/L58；elif：L24；and：L58）
- `sync_inventory` = 1 + for×2 + if×3 = **6**
- `submit_order` = 1 + if(1) + for(1) = **3**

## 类级指标

| 类 | 位置 | 显式方法数 | WMC | DIT |
|---|---|---|---|---|
| `Product` | models.py:7 | 0 | 0 | 0 |
| `OrderItem` | models.py:17 | 0 | 0 | 0 |
| `Order` | models.py:25 | 0 | 0 | 0 |
| `DiscountedOrder` | models.py:37 | 0 | 0 | 1 |

口径记录：`@dataclass` 生成的 `__init__` 静态不可见，WMC 只计显式方法；
若算法文档选择展开装饰器，须同步更新本表并标注为推断。

## 模块级

| 模块 | 出边数 | 入边数 | 循环依赖 |
|---|---|---|---|
| models | 0 | 1（pricing） | 无 |
| pricing | 1 | 2（orders、reporting） | 无 |
| inventory | 0 | 2（orders、reporting） | 无 |
| payments | 1（外部） | 1（orders） | 无 |
| utils | 0 | 1（reporting） | 无 |
| orders | 3 | 1（reporting） | 无 |
| reporting | 4 | 0 | 无 |

## 健康度（FR-17）预期

- 分档预期：`reporting.py` 落入「需关注」或更低（长函数 + CC=12 + SRP-01 + 2×A3 + 4×A5
  未使用导入叠加扣分）；其余文件「健康」或「良好」。
- 精确分值待 `health-score.md` 权重定稿后回填（backlog Q-01）。
