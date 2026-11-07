# Fixtures 验证记录（VERIFICATION.md）

记录 fixtures 与真实引擎的端到端对拍结果。每次引擎升级后重跑并追加一行。

## 2026-10-24 · engine v0.2.0 · 本机服务 127.0.0.1:18766

方式：以 `code/backend/server.py` 启动本机服务，按浏览器相同协议
（根相对路径 + `X-CodeLens-Token` + Origin）POST `/api/analyze`。
指标基线同时经 radon 6.0.1（SRS R4）与 AST 脚本双重验证。

### 端到端结果

| 用例 | 输入 | 结果 |
|---|---|---|
| 完整 shop | ai_generated_shop 全部 8 文件（根相对） | ✅ status=complete，5 条命中，全部符合预期 |
| 循环依赖 | circular_deps 全部 6 文件（根相对） | ✅ CYCLE-01 命中 repository.py:3，cycles=[['repository','services']] |
| 语法错误 | broken.py + good.py + tests/、.venv/ 下文件 | ✅ status=partial，错误隔离，服务端排除 2 个文件 |
| 空项目 | 仅 readme.txt | ✅ status=empty |
| 超限 | 201 个文件 | ✅ HTTP 400「最多分析 200 个 Python 文件」 |
| 鉴权 | 错误 token / 无 Origin | ✅ HTTP 403 |

### 命中明细（与标注逐条核对）

| 规则 | 引擎输出 | 标注预期 | 结论 |
|---|---|---|---|
| CC-01 | reporting.py:11，actual=12 | CC=12（radon 对拍一致） | ✅ |
| LEN-01 | reporting.py:11，actual=63 | >50（AST 语句口径 51，引擎物理行口径 63，均超阈值） | ✅ 口径差异已记入 metrics.md |
| DEPTH-01 | inventory.py:23，actual=5 | 嵌套 5（radon/AST 一致） | ✅ |
| A3-IO | reporting.py:67 | open 无 OSError 捕获 | ✅ |
| A4 | utils.py:3 | 敏感命名变量赋字面量（值已从报告隐藏） | ✅ |
| CYCLE-01 | repository.py:3 | services ⇄ repository，2 节点 SCC | ✅ |
| warning | services.py:26 父类未解析 | Admin(get_base()) 不可解析 | ✅ |
| 继承边 | DiscountedOrder → Order；Vip → User | 同左 | ✅ |
| 调用边 | submit_order → check_stock / calculate_total / reserve / charge | 同左，且 reporting 的「只导入不调用」未误报 | ✅ |
| CC 口径 | 全部函数与 radon 6.0.1 完全一致 | 手算值 | ✅ |

### 已知缺口（引擎 v0.2.0 未实现，标注中对应条目为「预期」）

A1、A2、A5、A6、长参数、大类、SOLID、死代码、CFG/def-use/时序图/健康度
（引擎 `limitations` 字段已如实声明）。这些规则上线后需重跑本表。

### 已知边界（路径形态）

引擎以「上传根目录相对的路径」推导模块名：`from services import X` 只在
`services.py` 位于上传根时解析为内部依赖。若上传的是**父目录**
（如 `tests/fixtures/projects/`，路径变成 `circular_deps/services.py`），
导入目标 `services` 与模块名 `circular_deps.services` 不匹配，
内部依赖与循环依赖会静默漏检。集成测试必须以项目目录为根上传；
如要支持父目录上传，需在引擎增加导入目标的后缀/包相对匹配。
