# 本地分析工作台（当前实现）

Python 3.11+，运行服务只使用标准库。在项目根目录执行 `python -B code/backend/server.py`，打开终端显示的地址（默认 18766）。Windows 可双击 start-codelens.cmd。修改后端后需停止旧进程并重启；前端依据 API revision 与能力清单识别不兼容后台。

## 架构与数据流

`engine.analyze` 负责 Python AST 基础事实；`rules` 补充 SOLID 五项及风险规则；`quality` 补充类指标、重复和类关系；`health` 与 `sequence` 补充评分及静态调用序列。`server.enrich` 组装工作台结果。

页面仅加载 app.js 与 styles.css，无 npm/CDN 运行依赖。lib/layout.js 的确定性布局仍有独立回归测试；其他 lib/views/features 文件是旧版实现，不是当前页面的加载依赖。当前页面路由、导入、展示和导出在 app.js 中。

## 当前页面

- 总览：真实文件和符号统计、复杂度与健康度。
- 项目结构：文件树、包依赖、符号与解析错误。
- 逻辑说明：按文件或函数调用模型，自然语言解释实现，补充两层已解析调用上下文；引用按实际发送范围验证，支持点击查看高亮源码。
- 关系图谱：函数调用、模块依赖、类关系（继承/组合/关联/依赖）和静态调用链；支持搜索、布局切换、SVG 导出。调用链是可能的源码调用顺序，不是运行时追踪。
- 质量体检：函数复杂度、长度、嵌套、健康度；类级 WMC/DIT/CBO/LCOM1；结构重复组。
- 设计检查：S/O/L/I/D 五项静态规则、覆盖方法数、覆盖缺口，未命中不表示符合原则。
- 风险清单：严重度/规则/证据/文件筛选、源码定位、CSV/JSON。
- 导出报告：Markdown/JSON/CSV。Markdown 包括健康度、类指标、重复、类关系、风险、边界和可选 AI 解读。JSON 默认剔除源码，可显式包含；不包含模型密钥。

## 接口

| 接口 | 用途 |
|---|---|
| GET /api/status | 令牌、引擎版本、api_revision、capabilities |
| POST /api/analyze | 静态分析及派生质量数据 |
| GET /api/ai/status | 旧结构化 AI skill 能力列表 |
| POST /api/ai | 规则表达层，支持模板基线 |
| POST /api/explain | 新版自然语言源码解读，仅使用真实模型，不回退模板 |

POST 使用本机 Host、Origin 和 X-CodeLens-Token 校验。请求体上限 12 MB。最多 200 个 Python 文件、单文件 1 MB、总计 8 MB。默认排除 tests、虚拟环境、构建及依赖目录；导入不会执行或导入目标代码。

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
