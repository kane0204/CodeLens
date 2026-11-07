# 本地分析工作台（当前实现）

Python 3.11+，运行服务只使用标准库。在项目根目录执行 `python -B code/backend/server.py`，打开终端显示的地址（默认 18766）。Windows 可双击 start-codelens.cmd。修改后端后需停止旧进程并重启；前端依据 API revision 与能力清单识别不兼容后台。

## 架构与数据流

`engine.analyze` 混合调度 Python AST 分析与 `multilang` 启发式分析；`rules` 补充 SOLID 五项及风险规则；`quality` 补充类指标、重复和类关系；`health`、`sequence` 与 `special_risks` 补充评分、静态调用序列和八类专项风险。`server.enrich` 组装工作台结果。

页面由 Vite 构建、React 挂载；`src/App.jsx` 管理全局骨架和运行时生命周期，现有分析渲染器通过 `app.js` 的 `mountLegacyWorkbench()` 接入。字体随构建本地打包，不依赖 CDN。

## 当前页面

- 总览：真实文件和符号统计、复杂度与健康度。
- 项目结构：文件树、包依赖、符号与解析错误。
- 逻辑说明：按文件或函数调用模型，也可一键解读全部文件；引用按实际发送范围验证，源码在独立的全屏编辑器对话框中查看。
- 质量体检：健康度、类级 WMC/DIT/CBO/LCOM1、结构重复，以及按规则分类并默认收起的命中明细。
- 设计检查：S/O/L/I/D 五项静态规则；无法完整推导的覆盖缺口合并为风险提示。
- 风险清单：可疑依赖调用、重复实现、未处理异常、硬编码敏感信息、死代码、假设未校验、注释与实现不一致、过度防御八类专项评估。
- 导出：顶部“导出报告”菜单直接生成 Markdown/JSON/CSV，不提供独立预览页。JSON 默认剔除源码，可显式包含；不包含模型密钥。

## 接口

| 接口 | 用途 |
|---|---|
| GET /api/status | 令牌、引擎版本、api_revision、capabilities |
| POST /api/analyze | 静态分析及派生质量数据 |
| GET /api/ai/status | 旧结构化 AI skill 能力列表 |
| POST /api/ai | 规则表达层，支持模板基线 |
| POST /api/explain | 新版自然语言源码解读，仅使用真实模型，不回退模板 |

POST 使用本机 Host、Origin 和 X-CodeLens-Token 校验。请求体上限 12 MB。最多 200 个源码文件、单文件 1 MB、总计 8 MB。默认排除 tests、虚拟环境、构建及依赖目录；导入不会执行或导入目标代码。Python 使用 AST；C/C++、Java、JavaScript、TypeScript、C#、Go、Rust 等使用启发式结构分析。

静态分析不连接模型。点击生成解读后，所选源码和有界的相关调用片段发往用户配置的模型服务。地址/模型名称可持久化到本机浏览器，密钥仅存当前页面内存。

## 检测口径与边界

圈复杂度初始 1，条件/循环/异常/布尔等节点按 engine.py 的公开定义计数；有效代码行排除空行、纯注释和独立文档字符串。函数健康度依据复杂度、长度与嵌套超出阈值的程度扣分，不代表无缺陷证明。

类指标及重复检测的完整公式由响应 quality_notes 提供：WMC 为直接方法 CC 之和；DIT 遇未知父类返回 null；CBO 只计算已解析类关系；LCOM1 根据实例字段共享计算。重复检测保留变量名/字面量，仅检测至少四条语句的相同函数体 AST，不宣称覆盖语义重复。

类关系由已解析继承、构造与注解提供证据，动态类型无法完整还原。SOLID 是静态复核线索，不判断完整行为契约；详细范围见 [SOLID 分析](solid-analysis.md)。AI 上下文与引用见 [AI 解读](ai-logic-explanation.md)，评估与验收见 [评估说明](quality-evaluation.md)。

## 验证

```sh
python -B -m unittest discover -s tests -p 'test_*.py' -v
node tests/integration/test_logic_frontend.cjs
node tests/integration/test_solid_frontend.cjs
node tests/integration/test_frontend.cjs
python -B tests/evaluate_solid.py
```

浏览器测试需 Node.js 22+ 和本机 Chromium/Edge，可用 CODELENS_BROWSER 指定可执行路径。测试会启动独立临时服务、假模型与无头浏览器，不调用真实模型、不使用真实密钥，覆盖目录导入、分页拖拽排除、分析、解读、引用、导出、失败/取消及后台不兼容。
