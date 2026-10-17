# 后端（code/backend）

负责 API 服务、任务编排、调用配额、学习档案存储与沙箱执行调度。

## 约定

- 语言与框架：Python 3.11 + FastAPI；
- 目录建议：`app/api/`（路由）、`app/services/`（业务）、`app/models/`（数据模型）、`config/`（配置）；
- 配置通过环境变量注入，**禁止**在代码中硬编码密钥；
- 对外接口以 `docs/software/api-contract.md` 为准，变更需先改文档。

## 待补充

- 启动方式与依赖安装说明（W3）
- 单元测试运行方式（W3）
