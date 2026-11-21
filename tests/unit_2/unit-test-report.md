# CodeLens 单元测试报告

## 当前测试基线

2026-11-21 在 Windows 上验证了当前 `main` 工作区，包含项目历史、反复问题、AI 历史上下文、后台审查和测试目录迁移。

| 检查 | 通过 | 失败 | 行覆盖率 |
| --- | ---: | ---: | --- |
| Python 单元测试 | 303 | 0 | 100%，4,855 / 4,855 |
| 前端单元测试 | 95 | 0 | 100%，1,560 / 1,560 |
| 本机 HTTP 集成测试 | 28 | 0 | — |

- 项目历史覆盖同名项目隔离、源码版本去重、历史回看、AI 结果归档和删除项目后的数据清理。
- 反复问题覆盖同一规则和符号跨行追踪、连续三个不同版本出现、确认修复后复发，以及规则变更或文件未覆盖时保留待核实状态。
- AI 记忆覆盖按项目和文件范围检索、关闭历史参考、在超长输入时舍弃历史、在综合阶段附上历史来源，以及审查缓存隔离。模型响应使用模拟数据。
- UI 回归覆盖导入时选择已有项目、打开历史和不同分析记录、查看反复问题并定位源码，以及历史服务异常和删除失败。
- CI 回归同时执行 `tests/unit_1` 与 `tests/unit_2`，覆盖新严重等级排序、审查存储恢复/异常降级和缓存路由。
- 新增隐私检测、报告预览和 3 路并行批量解读回归。

第一版保存文件级差异，未保存供逐行比较的旧源码快照。AI 参考本项目的静态问题记忆，历史页可回看归档的项目级 AI 审查。这一轮未用真实模型账号验证解读效果。

## 环境与构建

- 2026-11-21 使用 Windows、Python 3.13、Coverage.py 7.17.2、Node.js 24.11.0、npm 11.6.1 和 Vitest 5.1.0 验证。
- 前端类型检查与生产构建通过。项目复杂度回归用例通过，圈复杂度、函数有效行数和嵌套深度分别在 8、50 和 4 的门槛内。

## 覆盖率

| 统计项 | 覆盖数 / 总数 | 覆盖率 |
| --- | ---: | ---: |
| Python 可执行行 | 4,855 / 4,855 | **100.00%** |
| 前端行 | 1,560 / 1,560 | **100%** |
| 前端语句 | 1,776 / 1,821 | 97.52% |
| 前端函数 | 537 / 542 | 99.07% |
| 前端分支 | 1,062 / 1,255 | 84.62% |

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
python -B -m coverage run --rcfile=doc/.coveragerc -m unittest discover -s tests/unit_1 -v
python -B -m coverage run --append --rcfile=doc/.coveragerc -m unittest discover -s tests/unit_2 -v
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

逐文件覆盖率可在本次生成的 [Python HTML 报告](../../htmlcov/python/index.html) 和 [前端 HTML 报告](../../htmlcov/frontend/index.html) 中查看。HTML 文件由上述命令生成，保存在本机。
