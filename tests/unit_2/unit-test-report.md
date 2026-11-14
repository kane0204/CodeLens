# CodeLens 单元测试报告

- 执行日期为 2026-11-14（UTC+8）。测试对象为基于 `f6fb180` 的本地工作区，包含本轮未提交的 FastAPI、SQLite 和 Agent 层改动。
- 环境为 Windows、Python 3.14.6、Coverage.py 7.17.2、Node.js 24.19.0、npm 12.2.1 和 Vitest 5.1.0。

## 实际执行结果

| 测试 | 通过 | 失败 | 跳过 | 耗时 |
| --- | ---: | ---: | ---: | ---: |
| Python 单元测试 | 282 | 0 | 0 | 10.153 秒 |
| JavaScript / TypeScript 单元测试（8 个文件） | 89 | 0 | 0 | 6.34 秒 |
| 本机 HTTP 集成测试 | 28 | 0 | 0 | 3.645 秒 |

前端类型检查与生产构建通过。项目复杂度回归用例通过，圈复杂度、函数有效行数和嵌套深度分别在 8、50 和 4 的门槛内。

## 覆盖率

| 统计项 | 覆盖数 / 总数 | 覆盖率 |
| --- | ---: | ---: |
| Python 可执行行 | 4,504 / 4,504 | **100.00%** |
| 前端行 | 1,449 / 1,449 | **100%** |
| 前端语句 | 1,637 / 1,681 | 97.38% |
| 前端函数 | 484 / 489 | 98.97% |
| 前端分支 | 961 / 1,134 | 84.74% |

统计范围为 `code/` 下的 Python 生产代码和 `codelens-prototype/src/` 下的 TypeScript / TSX 生产代码。Python 本轮未启用分支覆盖率统计。两个测试套件均通过现有的 100% 行覆盖率命令。

## 关键回归场景

| 模块 | 已验证的场景 |
| --- | --- |
| 静态分析与质量规则 | 多语言导入、Python AST、SOLID、指标、自检复杂度门槛和不可解析输入 |
| FastAPI | 状态接口、OpenAPI、分析与解读路由、本机来源及令牌校验、错误编号、请求大小限制、NDJSON 输出和中断处理 |
| LangGraph | 单批源码直接生成，多批源码先阅读再综合，校验引用；模型失败时保留已完成批次，重试时继续；执行期间关闭在线追踪 |
| LangChain Core | 两条模型调用路径共用消息模板，验证系统和用户消息角色以及源码内花括号的原样保留 |
| SQLite | 模拟存储失败降级、丢弃内存状态后只重做未完成步骤、重启后读取已完成审查 |
| 前端工作台 | 文件导入、接口错误处理、事件流、单文件和文件夹结果恢复、工作台状态、报告导出 |

在临时回环端口启动 FastAPI、Vite 和兼容 OpenAI 接口的模拟模型，实测 Swagger 页面响应、Vite 代理的状态和分析请求、审查流及证据引用。重启 FastAPI 后，前端代理成功读回相同的 SQLite 结果，模拟模型调用次数仍为 1。

## 问题处理与验证边界

- 启动脚本改为检查实际 FastAPI 入口，缺少依赖时使用项目的 `.venv` 安装。浏览器在通过前端代理访问后端就绪接口后打开。验证了 Windows 上的实际服务链路和 Shell 脚本语法。macOS/Linux 实机启动及 Windows 桌面双击流程未验证。
- 首次在受限环境跑 Python 测试时，Windows 回环套接字受限，导致异步测试挂起、HTTP 集成测试无法连接。在允许本机回环访问的环境重新执行后，所有测试通过。
- 模型交互使用 mock 和本机模拟服务。未使用真实模型账号，因此第三方服务的响应质量、延迟和限流不在本轮验证范围内。

## 复现命令

在项目根目录使用已激活的 Python 虚拟环境。

```sh
python -m pip install -r doc/requirements-test.txt
python -B -m coverage run --rcfile=doc/.coveragerc -m unittest discover -s doc/unit -v
python -B -m coverage report --rcfile=doc/.coveragerc --fail-under=100
python -B -m coverage html --rcfile=doc/.coveragerc
python -B -m unittest discover -s tests/integration -v
```

进入 `codelens-prototype` 后执行。

```sh
npm ci
npm run test:coverage:check
npm run build
```

逐文件覆盖率可在本次生成的 [Python HTML 报告](../htmlcov/python/index.html) 和 [前端 HTML 报告](../htmlcov/frontend/index.html) 中查看。HTML 文件由上述命令生成，保存在本机。
