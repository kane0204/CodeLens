# 后端（code/backend）

## 当前可运行入口

在仓库根目录运行 `python -B code/backend/server.py`，本机 `127.0.0.1:18766` 只提供 JSON API。界面是独立的 `codelens-prototype/`（Vite + React，5173），由 `start-codelens.cmd` / `start-codelens.sh` 一并启动。本地适配器使用标准库 ThreadingHTTPServer，调用 `core_engine.engine.analyze`，不需要第三方依赖。

接口与限制见 [工作台说明](../../docs/software/local-workbench.md)。下文 FastAPI、异步任务和持久化为后续正式服务规划。

负责项目导入、分析任务调度、逻辑模型与图/指标/风险结果存储、报告生成与导出下载。

## 职责

- 接收项目文件夹（本地 CLI 直接调用引擎）或上传的压缩包（Web 形态）；
- 创建异步分析任务，向前端反馈进度；
- 调用 `core_engine` 完成解析、逻辑建模、出图、指标计算与规则检查，保存逻辑模型、图数据、指标、问题与评分；
- 生成 Markdown 审查报告（含逻辑说明、评分、风险清单、规则依据、证据等级与代码位置），提供下载；
- 提供逻辑模型、图数据、指标、问题、报告与源码片段的查询接口。

## 约定

- 语言与框架：Python 3.11 + FastAPI；
- 目录建议：`app/api/`、`app/services/`、`app/models/`、`app/workers/`、`config/`；
- 配置通过环境变量注入，禁止硬编码密钥；
- 报告与结果中必须保留规则版本与阈值配置，保证历史结果可复核；
- 逻辑说明与风险结论必须保留 `evidence_type`（事实/推断），前端据此区分展示；
- 上传的压缩包需限制大小并防止路径穿越（zip slip）；
- 对外接口以 `docs/software/api-contract.md` 为准。

## 日志与错误处理

- 统一后端日志：`code/backend/observability.py`。每个请求输出一条结构化记录：`request_id / method / path / status / duration_ms / bytes`；异常额外记录类型、脱敏消息与调用帧名。
- **隐私红线**：日志只含元数据。不记录源码、项目名、文件名、请求体、令牌与 API Key；未知路径统一记为 `<other>`；异常消息脱敏并截断到 200 字符，traceback 只保留帧名，不含源码行。`BaseHTTPRequestHandler` 自带的请求行日志保持关闭。
- **错误关联**：所有 4xx / 5xx 响应体附 `request_id`；`/api/review` 的 NDJSON `error` 事件附 `error_id`。前端 `errorText()` 会展示该编号，可与服务端日志直接对照。
- 异常分层：业务异常（`ExplanationError` / `SkillError` / 参数错误 / 读取超时）→ 4xx 或 502，记 WARNING；未预期异常 → 500，记 ERROR 与帧链；客户端断开 → DEBUG，不伪造 500。
- 运行配置：

  ```bash
  # 级别：--log-level 或 CODELENS_LOG_LEVEL，默认 INFO
  # 文件：--log-file 或 CODELENS_LOG_FILE，1 MiB × 3 轮转；目录不存在时自动降级为仅控制台
  python -B code/backend/server.py --log-level DEBUG --log-file /abs/path/to/codelens.log
  ```

- 前端：`codelens-prototype/src/lib/logger.ts` 为 200 条内存环形缓冲 + 脱敏，可在本页「模型设置 → 下载诊断日志」导出 JSON；`ErrorBoundary` 兜底渲染崩溃并提供同一入口；全局 `error` / `unhandledrejection` 也入日志。日志不上传、不写 localStorage。
- 回归测试：`tests/unit/test_observability.py`、`tests/integration/test_error_handling.py`。

## 待补充

- 启动方式与依赖安装说明（W3）
- 任务状态机与错误码（W3）
