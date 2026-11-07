# 预期扫描结果（FR-01）

扫描根：`tests/fixtures/projects/ai_generated_shop`。

## 纳入清单（8 个文件）

| 文件 | LOC | LLOC | SLOC | 注释行 | 空行 |
|---|---|---|---|---|---|
| `__init__.py` | 0 | 0 | 0 | 0 | 0 |
| `models.py` | 40 | 40 | 22 | 5 | 13 |
| `pricing.py` | 31 | 26 | 22 | 3 | 6 |
| `inventory.py` | 32 | 26 | 21 | 4 | 7 |
| `payments.py` | 10 | 7 | 5 | 2 | 3 |
| `utils.py` | 13 | 9 | 5 | 3 | 5 |
| `orders.py` | 18 | 17 | 13 | 2 | 3 |
| `reporting.py` | 74 | 66 | 68 | 2 | 4 |
| **合计** | **218** | **191** | **156** | **21** | **44** |

> LOC/LLOC/SLOC 由 radon 6.0.1 `radon raw` 产出，作为对拍基线；本工具的 metrics.json
> 须在 ±5% 容差内一致（LLOC 口径以算法文档 G 定稿为准）。

## 排除规则

- 默认排除（`.git`、虚拟环境、构建产物、测试目录）在本项目内**无命中对象**：
  项目内不存在上述目录。
- 口径记录：排除规则匹配「根目录内的相对路径」。本项目位于仓库 `tests/` 之下，
  但 `tests/` 是扫描根的祖先而非根内路径，根目录自身不得被「tests」规则排除。
  集成测试直接以项目目录为根扫描即符合该口径。

## 模块结构

- 单包 `ai_generated_shop`（含 `__init__.py`）。
- `analyze_sources` 口径下 `__init__` 模块名为 `ai_generated_shop.__init__`（SRS 5.3）。
- 语法错误文件数：0（全部 8 个文件可被 `ast.parse` 解析）。

## 符号表要点

- 4 个类：`Product`、`OrderItem`、`Order`、`DiscountedOrder`（均在 `models.py`）。
- 10 个顶层函数：`calculate_total`、`fmt`、`check_stock`、`reserve`、
  `sync_inventory`、`charge`、`money`、`unused_helper`、`submit_order`、
  `generate_report`。
- `@dataclass` 装饰器：静态视角下不展开，`__init__` 等生成方法**不可见**
  （边界案例，WMC 按显式方法计，见 `metrics.md`）。
