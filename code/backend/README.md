# 后端（code/backend）

负责项目导入、分析任务调度、图产物存储与导出下载。

## 职责

- 接收项目文件夹（本地 CLI 直接调用引擎）或上传的压缩包（Web 形态）；
- 创建异步分析任务，向前端反馈进度；
- 调用 `core_engine` 完成解析与出图，保存图数据 IR 与导出文件；
- 提供图数据查询、源码片段读取与产物下载接口。

## 约定

- 语言与框架：Python 3.11 + FastAPI；
- 目录建议：`app/api/`、`app/services/`、`app/models/`、`app/workers/`、`config/`；
- 配置通过环境变量注入，禁止硬编码密钥；
- 上传的压缩包需限制大小并防止路径穿越（zip slip）；
- 对外接口以 `docs/software/api-contract.md` 为准。

## 待补充

- 启动方式与依赖安装说明（W3）
- 任务状态机与错误码（W3）
