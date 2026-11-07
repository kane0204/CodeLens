# 本地分析工作台（当前实现）

Python 3.11+，后端仅使用标准库；界面是独立的 `codelens-prototype/`（Vite + React，`localhost:5173`）。`127.0.0.1:18766` 只提供 JSON API 与 NDJSON 进度流，不托管任何静态页面。启动方式见仓库根 README；修改后端后需停止旧进程并重启。

## 架构与数据流

`engine.analyze` 产出 Python AST 基础事实与词法分析结果；`rules` 补充 SOLID 五项及风险规则；`quality` 补充类指标、结构重复与类关系；`health` 与 `sequence` 补充评分及静态调用序列；`backend.server.enrich` 组装工作台结果。AI 项目审查由 `ai.explanation.review` 分批读取全部源码，产出逻辑说明、设计检查、风险评估三段，三页共享同一份结果。

## 当前页面

顶栏六项导航，导出报告并入顶栏按钮（Markdown / JSON / CSV），无独立预览页。

- 总览：真实文件和符号统计、复杂度与健康度，不再显示 Top 10 排行榜。
- 项目结构：文件树、包依赖、符号与源码定位，不再单列解析异常。
- 逻辑说明：全项目 AI 解读，跨文件互为说明，引用行号可跳转核对源码。
- 质量体检：高复杂度、高嵌套、坏味说明，附函数指标、类指标与结构重复组。
- 设计检查：SOLID 五项静态规则、覆盖缺口，以及 AI 审查的设计结论。
- 风险评估：只展示有严重危害的风险，附规则、证据等级与源码位置。

未覆盖的维度显示「未覆盖」及原因，不生成推断条目顶替缺失数据。关系图谱页、旧 `CL.app` 前端与旧导出预览页均已移除。

## 接口

| 接口 | 用途 |
|---|---|
| GET `/api/status` | 令牌、引擎版本、`api_revision`、`capabilities` |
| GET `/api/ai/status` | AI 能力状态 |
| POST `/api/analyze` | 静态分析及派生质量数据 |
| POST `/api/review` | AI 项目审查，`application/x-ndjson` 流式返回 `progress` / `result` / `error`，支持断点续跑 |
| POST `/api/explain` | 单文件 / 单函数自然语言解读（兼容保留，当前界面主要使用 `/api/review`） |
| POST `/api/ai` | 旧结构化 AI skill 规则表达层（兼容保留） |

POST 使用本机 Host、Origin 和 `X-CodeLens-Token` 校验。请求体上限 12 MB；服务端最多 200 个文件、单文件 1 MB、总计 8 MB。默认排除 tests、虚拟环境、构建及依赖目录；导入不会执行或导入目标代码。支持扩展名：`py`、`c/h/cc/cpp/cxx/hpp`、`java`、`js/jsx/ts/tsx`、`go`。

## 规则与口径

| 规则 ID | 检查内容 |
|---|---|
| CC-01 | 函数圈复杂度超过阈值 |
| LEN-01 | 函数有效行数超过阈值 |
| DEPTH-01 | 嵌套深度超过阈值 |
| A4 / A3-IO / CYCLE-01 | 参数与 I/O 线索、模块循环依赖 |
| A5-DEAD / A8-DEFENSIVE / CMT-01 | 死代码、 defensive 写法、注释线索（限 Python） |
| DUP-01 | 结构重复函数体 |
| SOLID 五项 | S/O/L/I/D 静态线索，均为 `inference`，附覆盖缺口 |

规则 ID 为 provisional，以算法文档定稿为准。非 Python 语言走词法与花括号路径，口径与 Python AST 路径不完全等价，报告会标注限制。

## 检测口径与边界

圈复杂度初始 1，条件/循环/异常/布尔等节点按 `engine.py` 的公开定义计数；有效代码行排除空行、纯注释和独立文档字符串。函数健康度依据复杂度、长度与嵌套超出阈值的程度扣分，不代表无缺陷证明。

类指标及重复检测的完整公式由响应 `quality_notes` 提供：WMC 为直接方法 CC 之和；DIT 遇未知父类返回 null；CBO 只计算已解析类关系；LCOM1 根据实例字段共享计算。重复检测保留变量名/字面量，仅检测至少四条语句的相同函数体 AST，不宣称覆盖语义重复。

类关系由已解析继承、构造与注解提供证据，动态类型无法完整还原。SOLID 是静态复核线索，不判断完整行为契约；详细范围见 [SOLID 分析](solid-analysis.md)。AI 审查范围与引用见 [AI 项目审查](ai-logic-explanation.md)，评估与验收见 [评估说明](quality-evaluation.md)，前端结构见 [前端现状说明](frontend-redesign.md)。

## 安全与数据

静态分析不连接模型，也不执行目标源码。在初始化页配置模型后，导入会把项目源码分批发送到用户指定的兼容 `chat/completions` 服务；未配置或审查失败时静态结果照常可用，不以模板替代失败结论。密钥仅存当前页面内存，不写入报告或项目文件。导出默认剔除源码，可选择是否包含 AI 结果。

## 验证

```sh
python -B -m unittest discover -s doc/unit -v
python -B -m unittest discover -s tests/integration -v
python -B tests/evaluate_solid.py
cd codelens-prototype && npm ci && npm run build
```
