# 后端（code/backend）

## 当前可运行入口

在项目根目录执行以下命令。

```
python -m pip install -r requirements-backend.txt
python -B code/backend/asgi.py
```

FastAPI 默认监听 `127.0.0.1:18766`。接口文档位于 `/docs`，OpenAPI 描述位于 `/openapi.json`。启动脚本会一并启动 Vite + React 界面。旧入口 `server.py` 使用标准库 ThreadingHTTPServer，用于兼容性测试，和 FastAPI 共用分析与审查逻辑。

当前接口与限制见 [工作台说明](../../docs/software/local-workbench.md)。后续服务规划如下。

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

- **默认落盘**：启动即写 `<repo>/logs/codelens.log`，目录自动创建，5 MiB × 5 轮转（约 30 MiB 上限）。启动横幅与两个启动脚本都会打印该路径；`logs/` 已在 `.gitignore` 中。用 `--no-log-file` 或 `CODELENS_LOG_DISABLE_FILE=1` 可退回仅控制台。
- 后端日志统一使用 `code/backend/observability.py`。请求日志记录 `request_id / method / path / status / duration_ms`。AI 审查另记开始、批次进度、完成或中断。未预期异常记录类型、脱敏消息和调用帧名。
- **崩溃排查**：`install_crash_hooks()` 接管 `sys.excepthook`、`threading.excepthook` 与 `atexit`，未捕获异常、工作线程异常、进程退出都会强制 flush 落盘；`startup` / `stopped` / `process_exit` 事件带 PID。ThreadingHTTPServer 每请求一线程，所以线程钩子与主线程钩子同等重要。
- **隐私红线**：日志只含元数据。不记录源码、项目名、文件名、请求体、令牌与 API Key；未知路径统一记为 `<other>`；异常消息脱敏并截断到 200 字符，traceback 只保留帧名，不含源码行。`BaseHTTPRequestHandler` 自带的请求行日志保持关闭。
- **错误关联**：所有 4xx / 5xx 响应体附 `request_id`；`/api/review` 的 NDJSON `error` 事件附 `error_id`。前端 `errorText()` 会展示该编号，可与服务端日志直接对照。
- 异常分层：业务异常（`ExplanationError` / `SkillError` / 参数错误 / 读取超时）→ 4xx 或 502，记 WARNING；未预期异常 → 500，记 ERROR 与帧链；客户端断开 → DEBUG，不伪造 500。
- 运行配置：

  ```bash
  # 默认：无需任何参数，自动写 logs/codelens.log
  python -B code/backend/asgi.py

  # 覆盖路径 / 级别
  python -B code/backend/asgi.py --log-level DEBUG --log-file /abs/path/to/codelens.log

  # 环境变量等价：CODELENS_LOG_LEVEL / CODELENS_LOG_FILE / CODELENS_LOG_DISABLE_FILE
  ```

- 前端：`codelens-prototype/src/lib/logger.ts` 为 200 条内存环形缓冲 + 脱敏；`info / warn / error` 同步写入本机 `localStorage`（键 `codelens.diag.v1`，上限 100 条），刷新或崩溃后自动恢复，可在「模型设置 → 下载诊断日志」导出含历史记录的 JSON；`ErrorBoundary` 兜底渲染崩溃并提供同一入口；全局 `error` / `unhandledrejection` / `pagehide` 也入日志。日志不上传，不含源码与密钥。
- 回归测试：`doc/unit/test_observability.py`、`tests/integration/test_error_handling.py`。

## 待补充

- 启动方式与依赖安装说明（W3）
- 任务状态机与错误码（W3）
