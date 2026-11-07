# 规则正反例索引（snippets/INDEX.md）

最小代码片段，喂给单元测试的规则验证。命名约定：`positive` = 必须命中，
`negative` = 必须不命中。规则 ID 为 provisional，以 `docs/algorithm/rules-engine.md`
定稿为准；正反例计数按 SRS FR-14/15/16 验收口径（每规则 ≥3 正例、≥3 反例），
最终数据记入 `docs/algorithm/evaluation.md`（W2-12，测试负责人）。

> 引擎实测状态（2026-10-24，engine v0.2.0，见 `../VERIFICATION.md`）：
> 已实现规则 CC-01 / LEN-01 / DEPTH-01 / A4 / A3-IO / CYCLE-01；
> A1 / A2 / A5 / A6 / 长参数 / 大类 / SOLID / 死代码等规则尚未实现，
> 相关正例在规则上线前只作「预期」，不计入误报统计。

## smells.py — 坏味（SRS FR-14 四类规则）

| 规则 | 正例 | 位置 | 关键数据 | 反例 | 位置 | 关键数据 |
|---|---|---|---|---|---|---|
| 长函数（LEN-01 ✅已实现） | `long_function_positive` | L95-155 | 51 步，CC=13 | `short_negative` | L11-13 | 1 步 |
| | `long_function_positive_b` | L252-320 | 56 步，CC=18 | `flat_negative` | L16-21 | 4 步 |
| | `generate_report`（shop） | reporting.py:11-74 | 引擎实测 63 物理有效行 | `calculate_total`（shop） | pricing.py:9-26 | 16 步 |
| 大类 | `GodClassPositive` | L169-211 | 13 方法，WMC=13 | `SmallClassNegative` | L158-166 | 2 方法，WMC=2 |
| | `GodClassPositiveB` | L214-249 | 11 方法，WMC=11 | `models` 四个类（shop） | models.py | 0 显式方法 |
| | （阈值定稿后补第三例） | — | 阈值见算法文档 G | `SrpNegative`（solid.py） | solid.py:32 | 2 方法 |
| 深嵌套（DEPTH-01 ✅已实现） | `deep_nesting_positive` | L34-43 | 深度 5，CC=6 | `flat_negative` | L16-21 | 深度 1 |
| | `deep_nesting_positive_b` | L61-74 | 深度 5，CC=6 | `short_negative` | L11-13 | 深度 0 |
| | `sync_inventory`（shop） | inventory.py:23-32 | 深度 5，引擎实测命中 | shop 多数函数 | — | 深度 ≤3 |
| 长参数 | `long_params_positive` | L46-48 | 6 参数 | `submit_order` 之外全部 | — | ≤4 参数 |
| | `submit_order`（shop） | orders.py:8 | 5 参数（引擎未实现该规则） | — | — | — |
| 重复代码 | `duplicate_positive_a` ↔ `duplicate_positive_b` | L77-83 ↔ L86-92 | token 序列相同 | `distinct_negative_a` ↔ `_b` | L24-26 ↔ L29-31 | list/dict 推导式 |
| | `a2_positive_retry_a` ↔ `_b`（ai_risk.py） | L54-73 | token 序列相同 | `distinct_negative_c` ↔ `_d` | L51-53 ↔ L56-58 | sum/max |
| | `fmt` ↔ `money`（shop） | pricing.py:29 ↔ utils.py:6 | 函数体逐字符相同 | （边界对，见下） | — | — |

**边界对（不计正也不计反，evaluation.md 须记录实际相似度）**：
`inventory.check_stock` 与 `inventory.reserve` 结构高度相似（同 `catalog.get` + 判空），
但 token 序列不同；是否命中取决于相似度阈值，用于阈值校准。

## solid.py — SOLID S/O/D（SRS FR-15）

| 规则 | 正例 | 位置 | 依据 | 反例 | 位置 | 依据 |
|---|---|---|---|---|---|---|
| SRP-01 | `SrpPositive` | L7-29 | 方法按 {x,y} 与 {log_lines} 两簇聚类 | `SrpNegative` | L32-45 | 单簇 {x,y} |
| | `generate_report`（shop） | reporting.py:11 | 四簇：聚合/渲染/持久化/通知 | `SmallClassNegative` | smells.py:158 | 单簇 |
| OCP-01 | `ocp_positive` | L48-56 | 类型分支链 3 处（≥3），CC=4 | `ocp_negative` | L59-63 | 2 处分支，CC=2 |
| DIP-01 | `DipPositive` | L74-82 | `__init__` 直接实例化具体类 `MySqlDatabase` | `DipNegative` | L85-93 | 具体数据库经构造参数注入 |
| | （第三例待补） | — | — | `MySqlDatabase` | L66-71 | 被依赖方本身非违规 |

覆盖缺口（W2-12 前补齐）：SRP/DIP 各缺 1 个正例、OCP 缺 2 个反例
（不同分支长度与依赖形态），已列入 evaluation.md 计划。

## ai_risk.py — AI 代码风险 A1–A5（SRS FR-16）

| 规则 | 正例 | 位置 | 检测思路 | 反例 | 位置 |
|---|---|---|---|---|---|
| A1 可疑依赖 | `a1_positive_unresolved` | L20-22 | `ghost_sdk` 无法解析到已声明依赖或标准库 | `a1_negative_stdlib` | L15-17（`json`） |
| | `payments.charge`（shop） | payments.py:3,9 | `thirdparty_gateway` 不可解析 | `plugins`/`models`（circular_deps） | 均可解析 |
| | `send_email` 调用（shop） | reporting.py:73 | 未导入的名字 | — | — |
| A2 重复实现 | `a2_positive_retry_a` ↔ `_b` | L54-62 ↔ L65-73 | token 序列高度相似 | `distinct_negative_*`（smells.py） | L24-58 |
| | `fmt` ↔ `money`（shop） | pricing.py:29 ↔ utils.py:6 | 函数体逐字符相同 | — | — |
| A3 未处理异常（A3-IO ✅已实现） | `a3_positive_unprotected` | L33-35 | `urlopen` 无 try/except | `a3_negative_protected` | L25-30（try/except OSError） |
| | `generate_report`（shop） | reporting.py:67 | `open` 无 OSError 捕获，**引擎实测命中** | shop 其余函数 | 无外部 IO 调用 |
| A4 硬编码（✅已实现） | `a4_positive_hardcoded` | L43-46（字面量在 L45） | `ghp_` 前缀令牌 | `a4_negative_from_env` | L38-40（环境变量） |
| | `API_KEY`（shop） | utils.py:3 | `sk-live-` 模式，**引擎实测命中** | shop 其余常量 | 非敏感命名 |
| A5 死代码 | `_a5_positive_never_called` | L49-51 | 私有函数无引用 | `a5_negative_used` + `a5_negative_caller` | L76-83 |
| | `unused_helper`（shop） | utils.py:11 | 无引用 | shop 其余函数 | 均有调用者或被导出 |
| | 未使用导入（shop） | reporting.py:5-8、pricing.py:3 | 5 个导入名无使用 | circular_deps 全部导入 | 均有使用 |
| A6 假设未校验（W6-01） | `submit_order`（shop） | orders.py:10 | `order.items[0]` 无空列表检查 | — | — |
| | `charge`（shop） | payments.py:10 | `result["transaction_id"]` 无键检查 | — | — |

## 维护规则

1. 新增正反例必须同步更新本表与 `docs/algorithm/evaluation.md` 的计数；
2. 行号以 `git diff` 后实际文件为准——片段被移动时必须改本索引；
3. 引擎新增规则后，把对应行从「预期」改为「实测」，并在 `VERIFICATION.md` 记录日期与结果；
4. 反例不得依赖「引擎恰好没实现某规则」来通过——规则上线后反例必须仍然不命中。
