# 代码变更日志（Changelog）

记录 CodeLens 仓库内**实际落地**的代码与设计文档变更，按日期倒序，每条附 commit、改动范围与验证结论。
本地排障、备份文件与协作过程不计入本文件；当前代码状态以 `main` 为准。

当前形态：分析引擎 v0.4.0（`code/`，Python）+ 本机 JSON API（`127.0.0.1:18766`）
\+ 独立前端工作台（`codelens-prototype/`，Vite + React 18 / TypeScript / Tailwind v4，`localhost:5173`）。

---

## 2026-11-07

### 重构：核心引擎复杂度与正确性治理 — `314e170`

13 个 `code/` 文件，1600+ 行改写。目标是降低圈复杂度、消除 `if/else` 堆叠，同时保持 `analyze()` 输出**逐字节不变**。

**正确性修复**
- `generic.py`：非 Python 内层函数的 CC / 嵌套深度不再重复计入外层（两轮扫描 + `_inner_spans` / `_kept_ranges` 剔除）；样例 `outer` 的 CC 由 5 修正为 2。
- `generic.py`：`calls` 的 4000 条上限原先 `break` 只跳出内层循环，改为 `exhausted` 贯穿三层循环。

**结构拆分**
- `engine.py`：约 380 行的 `analyze()` 拆为 `_AnalysisContext` 状态对象 + 六阶段流水线
  （`_load_records` → `_parse_sources` → `_parse_nonpython` / `_score_python` → `_resolve_relations` → `_run_rule_checks` → `_assemble_report`）；
  闭包 `bind` / `collect` / `resolve_name` / `resolve_expr` / `handled_io` 收进上下文对象。
- 表驱动分发表替代长条件链：`_STATEMENT_HANDLERS`（`facts.py`）、`Index._resolvers`（`ir.py`）、
  `_EDGE_BUILDERS`（`generic.py`，按语言后缀分发）、规则与 SOLID 判定分支、`render` / `build` 类入口。
- 逐模块提取 helper：`quality.py`（8 个）、`rules.py`（5 个）、`solid.py`（6 个）、`ir.py`（4 个）、
  `sequence.py`、`special.py`、`ai/contract.py`、`ai/explanation.py`、`ai/skills/logic_summary.py`、
  `backend/server.py` 的 `ai_analyze` / `_validate_ai_payload`。手法为提取子函数、guard clause 提前返回、三目嵌套改纯函数。

**性能与安全**
- `bisect` 区间计数替代 O(函数 × 行数) 的有效行扫描；`generic.py` 的 `_LineIndex` 用二分查行号。
- 敏感词 / 占位正则预编译；`explain` 与 `review` 的分批阅读合并为 `_read_batches`，去除重复实现。
- 模型请求增加 `_CHAT_TIMEOUT = 1800` 秒连接级兜底，避免端点无响应时线程永久挂起；前端不设 AI 等待上限。

**效果**：全项目 CC>20 的函数由 24 个降到 4 个（均为 21 的边缘值），最高 CC 101 → 21，引擎自身 `max_cc` 30 → 19。
遗留 `context_for` / `_class_metrics` / `_evaluate_dead` / `_narrowed` 四个 CC=21，属嵌套循环 + 过滤性质，进一步拆分收益递减。

### 前端工作台重写与收敛 — `190c98d`、`2795d15`、`4ed8457`

- 新建 `codelens-prototype/`：Vite + React + TS + Tailwind v4，暖棕设计 token（`#faf7f2` / `#8b5e34`），
  1440×900 每页无整页滚动，移动端单列排布。
- 初始化页：标语 `make code visible`，项目导入与 AI 模型配置同页，导入后自动执行「静态分析 → AI 项目审查」，
  分阶段进度条 + 按已完成批次估算 ETA；健康度说明改为 portal 弹层（视口碰撞、移出 / 失焦 / Esc 关闭）。
- 导航最终收敛为六项：总览 / 项目结构 / 逻辑说明 / 质量体检 / 设计检查 / 风险评估；
  移除关系图谱页（`GraphsView`、`GraphCanvas`、`lib/graph.ts`）、Top 10 排行榜、解析异常汇总与独立导出预览页。
- 导出并入顶栏按钮，支持 Markdown / JSON / CSV；AI 文本统一由 `ReviewMarkdown` 排版；
  风险页只展示严重危害，未覆盖维度显示「未覆盖」及原因，不生成推断条目。
- `4ed8457` 删除旧 `code/frontend/`（14 个文件）及 4 个只测旧 `app.js` 的集成测试；
  `backend/server.py` 移除静态资源路由，GET 只保留 `/api/status`、`/api/ai/status`，其余 404，成为纯 JSON API。

### 多语言分析引擎 v0.4.0 — `190c98d`、`2795d15`

- 新增 `generic.py`（词法清洗 + 花括号配对）与 `special.py`（8 类专项风险）；
  `engine.py` 按扩展名分发：`.py` 走 Python AST，其余走词法路径。
- 支持 `py` / `c` `h` `cc` `cpp` `cxx` `hpp` / `java` / `js` `jsx` `ts` `tsx` / `go`；
  `summary.languages` 与 `config.languages` 输出语言分布；非 Python 模块 id 使用根相对路径。
- 修正花括号控制结构判定与嵌套误判；`rules.py` 的 `A5-DEAD` 限定 `.py`，避免与非 Python 结果重复。
- `server.py` 的 `enrich` 注入 `special_risks`，`capabilities` 增加 multi-language / special-risks。

### AI 项目审查与断点续跑 — `2795d15`、`93244b2`

- 新增 `POST /api/review`：`application/x-ndjson` 流式返回 `progress` / `result` / `error`；
  分批读取全部导入源码（单文件 ≤ 60000 字符、每批 ≤ 40000 字符），汇总为
  `logic` / `design` / `risks` 三段，由逻辑说明、设计检查、风险评估三页共享。
- `93244b2` 增加服务端内存任务表：以「项目内容 + 模型配置」SHA-256 指纹标识任务，
  每批阅读结果即 checkpoint；中断后同指纹重试从断点续跑，`running` 并发请求 attach，
  `done` 直接返回缓存；客户端断开时 `stream_review` 吞掉 `BrokenPipe`，后台任务继续跑完。
- 引用 `[路径:L起始行-L结束行]` 经 `citations_for` 校验落在本次实际发送范围，越界不生成可点击跳转；
  模型返回文本转义后渲染，不执行 HTML。

### SOLID 与质量评估 — `d491d7e`、`33f7569`

- 引入 SOLID 五项静态规则、WMC/DIT/CBO/LCOM1 类指标、结构重复检测与类关系证据；
  引入 `quality-evaluation` 基准与 `solid_labels.json` 标注集。

### 启动、CI 与协作处理 — `bea3a4b`、`549e020`、`a6f7d3b`、`efac70c`

- 启动脚本改为一键拉起后端 18766 与前端 5173，首跑自动装依赖，Vite 用 `--strictPort`，
  README 增加「打开的是旧界面」排查清单；界面唯一正确地址为 `http://localhost:5173`。
- CI 前端步骤改为 `codelens-prototype` 的 `npm ci && npm run build`，`required_dirs` 同步替换 `code/frontend`。
- `a6f7d3b` 用 `merge -s ours` 合并远端并行实现，内容树以本地为准、保留远端历史。
- `efac70c` 以 `git revert -m 2` 撤销协作者未经评审直接推送到 main 的 `b95cdb5` / `40d370f`，
  内容精确恢复至 `4ed8457`，不重写历史；原版本保留在 `backup/collaborator-complexity-20261107`。

### 文档 — `a3d8517`

- `docs/software/README.md` 改为当前架构概览 + 已有/规划文档清单；
  `frontend-redesign.md`、`local-workbench.md`、`ai-logic-explanation.md` 重写为当前实现；
  `quality-evaluation.md`、`solid-analysis.md`、`ddd/README.md`、根 `README.md` 修正过时表述。
- 删除重复的 `user_stories.md`、审查报告与候选代码镜像、验收截图等过程产物（均为未跟踪文件，
  已移至仓库外备份，不进入 Git）；全仓 Markdown 本地链接校验通过。

---

## 验证结论汇总

| 阶段 | 结果 |
|---|---|
| 多语言引擎落地后 | Python `unittest discover` 112 项全过 |
| 旧前端清理后 | 112 项全过（2.97s）；`npm ci` 85 包 0 漏洞；`npm run build` 48 modules 通过 |
| 圈复杂度重构后 | unit 92 + integration 20 全过；`analyze()` 输出与基线 `sort_keys` JSON 逐字节一致；`npm run build` 通过 |
| 集成细节 | `AI_RESULT` citations 268 resolved、coverage 1.0；`REAL_SOURCE_RESULT` 的 `max_cc` 30 → 19 属被分析对象自身源码变化，预期内 |
| 视觉验收 | 桌面七页 + 移动端初始化页截图核对，`scrollHeight = 900` 无整页滚动、无重叠截断 |

## 已知限制与后续

- `engine.py` 的 `_load_records` / `_resolve_nonpython_inheritance` 仍是较长函数，可再拆；
  `origin/refactor-sonar`（`8cecd95`）中协作者的 5 个函数拆分可摘取复用，但**不建议整分支合并**
  （基点 `40d370f` 是已回退的合并点，三路合并必然冲突）。当前决策：保持现状，不合并。
- AI 审查 checkpoint 仅存服务端内存，后端进程重启即失效，跨进程持久化未实现。
- 前端 `AppState` 仍是较大的 Context，全树重渲染问题只有方案、未落地。
- 建议为 GitHub `main` 增加分支保护 / PR 评审，避免再次被直接推送。

---

## 2026-10-24

- 需求工程与算法文档、fixtures 对拍基线（radon 6.0.1）、`docs/software/ddd` 设计示例落地；
  详见 `docs/requirements/`、`docs/algorithm/` 与 `tests/fixtures/VERIFICATION.md`。
