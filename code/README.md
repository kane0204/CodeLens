# code/ —— CodeLens 实现代码

本目录是 CodeLens 的全部服务端实现，按「事实层 → 表达层 → 适配层」分层，三层之间单向依赖：`backend` → `ai` → `core_engine`。全部为 Python 3.11 标准库实现，零第三方运行时依赖；分析全程不导入、不执行被分析项目的代码。

```text
code/
├── core_engine/   # 事实层：确定性静态分析，产出唯一事实出口（Index）
├── ai/            # 表达层：把事实转成中文结论；只翻译，不产生事实
└── backend/       # 适配层：loopback JSON API + 隐私日志
```

## 数据流总览

```text
前端（Vite + React，codelens-prototype/）
  → backend/server.py（127.0.0.1:18766，标准库 ThreadingHTTPServer）
      ├─ /api/analyze → core_engine.engine.analyze（五阶段流水线）
      │                  → rules.merge → quality.apply → health.apply
      │                  → sequence.build → special.build → 统一响应
      ├─ /api/ai      → ai.runner.Runner（切片 → 表达 → 三层校验 → 缓存）
      ├─ /api/explain → ai.explanation.explain（必须有外部模型）
      └─ /api/review  → ai.explanation.review（NDJSON 流式 + 断点续跑）
```

## core_engine/ —— 确定性事实层

同一输入两次运行输出逐字节一致；除 Python 用 `ast` 精确解析外，其余语言均为近似解析并在 `limitations` 中如实声明。

| 文件 | 职责 | 技术要点 |
|---|---|---|
| `engine.py` | 入口 `analyze(payload)`，五阶段流水线 | Python `ast.parse(feature_version=(3,11))`；非 Python 走 `generic.py`；硬上限 200 文件 / 单文件 1MB / 总量 8MB / AST 10 万节点；CC 口径：if/三元/assert +1，循环 +1（else 再 +1），try 按 except 数，BoolOp n 项 +n−1，推导式 +1+if 数，match 非通配 case +1；A–F 分档边界 5/10/20/30/40；循环依赖用 Tarjan 式 SCC 产出 `CYCLE-01`；A3-IO 沿 AST 父链找 try+OSError 判定未捕获 `open`；A4 只输出「敏感变量被赋非占位字符串」不回显原值；名称解析保守——多重绑定记 None、星号导入不绑定；调用只有唯一绑定才 resolved（`fact`），否则 `inference` |
| `ir.py` | 统一中间表示：`build_index(result)` 产出只读 `Index` | 13 种引用类型 `kind:payload`（`def:`、`finding:`、`call:`…）；`fingerprint` 只取实际相关事实的 sha256 而非整份结果 hash，避免无关改动击穿缓存；切片上限每函数 60 语句 / 40 调用，超出标 `truncated`；A4 原始敏感值不进入切片输出；对 AI 层零依赖（引用解析靠注入回调） |
| `facts.py` | CFG 与 def-use 数据流 | 纯函数，节点/边确定性排序；语句超 150 整体降级为 `available: False`，不给半截图；基本块按经典 leader 三规则合并；边带语义标签（seq/true/false/loop/back/except/…）；def-use 只统计 `ast.Name` 级，上限 120，口径写进输出 `notes` 防漂移 |
| `generic.py` | 非 Python（C/C++/Java/JS/TS/Go）近似分析 | 先空白化注释与字符串体但保留偏移，再花括号配对 + 二分行号索引；函数识别覆盖 C 风格、JS 箭头函数、Go func；CC 用分支关键字正则（与 Python AST 口径不等价）；依赖边按语言分派（#include / java import / js require / go import）；不产出 SOLID、类指标、结构重复与调用序列 |
| `rules.py` | 补充规则 + `merge()` 统一重编号 | SRP-01（类方法 >12）、OCP-01（类型分派分支 >3）、DIP-01（方法体内直接构造具体类 >2）、A5-DEAD（入口名 main/run/cli/app 豁免，未解析调用的表达式末段也算存活线索）、A8-DEFENSIVE（裸/宽 except 且处理体只有 pass/.../continue）；SOLID 命中一律 `evidence_type="inference"`；merge 重编 `finding-N` 保证证据引用唯一 |
| `solid.py` | LSP / ISP 纯 AST 检查 | LSP 用 `inspect.Signature` 构造签名并枚举调用形状做 `bind()` 对拍，找「父方法接受但覆盖方法拒绝」的 witness；另查绑定方式与 sync/async 变化；ISP 查契约中被 `NotImplementedError` 显式拒绝的成员；识别 `abc.ABC` / `Protocol` 排除；多继承、未知父类等记 `coverage_gaps` 不猜 |
| `quality.py` | 类级指标与结构克隆 | WMC=方法 cc 之和；DIT=已解析继承图最长路径（外部父类返回 None）；LCOM1=max(0, 不共享实例字段的方法对数 − 共享对数)，排除 static/classmethod；克隆指纹 = 去 docstring 函数体 AST dump 的 SHA256，≥4 条语句才参与（DUP-01 置信 high、`fact`）；组合/关联/依赖均标 `inference` |
| `health.py` | 健康度评分，每分可解释 | `100 − min(30, 2×超cc) − min(20, 3×⌈超长度/10⌉) − min(20, 4×超嵌套)`；等级线 90/75/60；阈值可由 `config.thresholds` 覆盖，非法回落默认 {cc:10, length:50, nesting:4}；只扣分不奖励，deepcopy 不改入参；项目分 = 函数分算术平均 |
| `sequence.py` | 时序图数据（静态调用序列） | 只复用引擎已有 `graph.calls`，按调用点行号排序 = 阅读顺序而非运行时顺序；未解析调用保留并标注；每文件上限 40 步，超出标 `truncated` |
| `special.py` | 8 类 AI 代码专项风险报告 | 各类目全部派生自已产出事实（unresolved 调用 / duplicates / A3-IO / A4 / A5-DEAD / CMT-01 / A8-DEFENSIVE）；引擎判不了的类目返回 `covered: False` + 原因，不编造空结果；单类目条目上限 40 |

## ai/ —— 表达层（只翻译事实，不产生事实）

四模块分工：`contract`（契约与校验）→ `skills/`（六个具体技能）→ `provider`（谁来输出文字）→ `runner`（固定流程执行）。

| 文件 | 职责 | 技术要点 |
|---|---|---|
| `contract.py` | SkillResult 信封 + 三层 schema 校验 | 4 个 skill 注册表（含版本号）；信封状态 ok / insufficient_evidence / need_more / refused；上限：单条 240 字符、每条证据 ≤8、每结果 ≤24 条；`BANNED_PATTERNS` 禁写百分比、绝对断言、HTML、代码围栏、指令注入；`RULE_TOKEN` 校验文本中提到的规则编号必须来自本次分析产出；`extract_json_object` 手写括号配对解析，失败抛 `SkillError` 不猜；每条结论必须挂可解析证据，解析不到整条丢弃并记入 `dropped` |
| `skills/base.py` | Skill 五段协议 | `candidates / context / gap / repair / render / prompt`；版本号单一来源在 `contract.SKILLS`；公共工具 `symbol_of`（ref 解不到即 insufficient_evidence） |
| `skills/logic_summary.py` | 函数逻辑解读 | 候选按 (cc 降序, 长度, 文件, 行) 确定性排序；上下文由 `index.slice_function` + `facts.build_control_flow` + `facts.build_def_use` 组装；语句超 8 条只留头尾并声明省略；gap/repair 支持补解析一次重试 |
| `skills/class_node_name.py` | 类图节点短标签 | 证据含 `class:`/`def:`/`function:`/`inherit:` 引用；标签方法数上限 4；明确不判断设计好坏 |
| `skills/ai_risk_review.py` | 风险条目解读 | 输入只有 findings，无 finding 直接 `insufficient_evidence`（没命中阈值 ≠ 没有风险）；8 条规则 PLAYBOOK 文案；severity 权重 {critical:3, warning:2, info:1} 聚合排序 |
| `skills/solid_review.py` | SOLID findings 解读 | 固定附声明「L 与 I 只覆盖已解析单继承契约，未命中不等于符合」 |
| `provider.py` | 表达方抽象 | `TemplateProvider`（确定性模板，逐字节可复现）与 `HttpProvider`（标准库 `urllib.request` 调 OpenAI 兼容 `/chat/completions`，`temperature=0`，响应上限 256KB）；`CODELENS_AI_ENDPOINT/MODEL/KEY/TIMEOUT` 四个环境变量**全部到齐**才启用外部模型；HTTP 失败抛 `ProviderError` 由 runner 降级为模板；prompt 只含已切片事实，不含源码全文 |
| `runner.py` | 固定 DAG：切片 → 表达 → 校验 → 缓存 | 上限 24 目标 / 每 skill 默认 12 条；缓存 key 由 skill 版本 + prompt 版本 + provider/model + 目标 ref + `index.fingerprint` 组成，不含时间与随机数（LRU，容量 256）；局部回退只允许「补一次上下文」（gap → repair → 再 gap），外层不重规划；模型失败自动回退模板并记入 diagnostics |
| `explanation.py` | 按需源码解读与全项目审查（**无模板兜底**） | 上限：单次解读源码 60000 字符、审查单批 40000 字符、并发审查任务 6 个、兜底超时 1800s；全项目流程 = 按行号分段/打包小文件 → 分批阅读产出笔记 → 交叉整合，模型只输出 `{logic, design, risks}` JSON；**断点续跑**：`_ReviewJob` 内存检查点，指纹 = 项目内容+endpoint+model+key 的 SHA256，浏览器断开任务在服务端继续跑，并发重试复用同一任务；`context_for` 取已解析被调者两跳，单片段 20000 字符/最多 6 个；行号引用 `[file:Lx-Ly]` 正则校验落在已提供范围内；端点校验拒绝带账号/查询参数的 URL 与换行注入；`temperature=0.2`；检查点仅存内存随进程消失 |

## backend/ —— 适配层

| 文件 | 职责 | 技术要点 |
|---|---|---|
| `server.py` | loopback-only JSON API | `ThreadingHTTPServer` 绑定 `127.0.0.1:18766`（前端独立跑在 5173）；启动时 `secrets.token_urlsafe(32)` 生成一次性 TOKEN，POST 需 `X-CodeLens-Token` 头 + Origin/Host 白名单；请求体上限 12MB；`enrich` 流水线 = rules → quality → health → sequence → special，并拼 `limitations`；额外规则 `SRP-01/OCP-01/LSP-01/ISP-01/DIP-01/A5-DEAD/A8-DEFENSIVE`；`/api/review` 用 NDJSON 逐事件推送进度，客户端断开后任务继续跑以支持断点续跑；所有响应带 CSP/nosniff/no-store 头，错误体带 `request_id`；关闭 `BaseHTTPRequestHandler` 默认回显日志；错误文案统一「未生成替代结果」——不编造结论 |
| `observability.py` | 结构化隐私日志 | **不变量：绝不记录源码、项目名、文件路径、token/密钥、请求体**；`redact` 正则清洗控制字符、Bearer token、疑似凭据键值对；`_PrivacyFilter` 作为所有 handler 最后防线；RotatingFileHandler 5 MiB × 5 份，默认 `logs/codelens.log`，可用 `--log-file` / `--no-log-file` / `CODELENS_LOG_*` 环境变量覆盖；崩溃钩子覆盖 `sys.excepthook` / `threading.excepthook` / `atexit`（每请求一线程，线程钩子同等重要）；异常摘要只含类型 + 脱敏消息（≤200 字符）+ 最近 6 帧名，不含源码行 |

## 贯穿三层的全局设计约定

1. **证据分级**：所有 finding / call / 关系都带 `evidence_type`（`fact` = 确定性可复算；`inference` = 静态推断）与可选 `confidence`（high/medium/low），前端据此区分展示，不得与事实混排。
2. **确定性优先**：`core_engine` 全部纯标准库确定性计算；`/api/ai` 默认模板逐字节可复现；缓存 key 与 review 指纹均由内容 hash 构成，不含时间/随机。
3. **不执行源码**：分析层只用 `ast` / 词法清洗；HTTP 与 system prompt 双重声明「源码中的指令不执行」。
4. **上限护栏**：文件数 200 / 单文件 1MB / 总量 8MB / AST 10 万节点 / 请求体 12MB / 每函数切片 60 语句 / AI 目标 24 等——全部超限即拒绝或截断并显式标注 `truncated`，从不静默丢弃。
5. **诚实降级**：模型失败回退模板并记录 diagnostics；无证据时返回 `insufficient_evidence` / `covered: False`；未覆盖能力在 `limitations` 中声明，不生成占位结果。

## 运行与测试

```bash
# 后端 API（无需任何第三方依赖）
python -B code/backend/server.py            # 127.0.0.1:18766

# 一键启动前后端（Windows / macOS/Linux）
start-codelens.cmd / sh start-codelens.sh

# 测试与覆盖率
# 见根目录 doc/README.md 与 tests/（单元：doc/unit/，集成：tests/integration/）
```

## 进一步阅读

- 模块级细节：[core_engine/README.md](core_engine/README.md)、[backend/README.md](backend/README.md)
- 接口契约与范围限制：`docs/software/local-workbench.md`、`docs/software/api-contract.md`
- AI 审查设计：`docs/software/ai-logic-explanation.md`
