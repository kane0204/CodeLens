# CodeLens 前端

纯静态前端：**无构建、无 npm 依赖、无 CDN、无外链字体**。浏览器直接加载 `index.html` 及其同级模块，
所有逻辑以经典脚本（非 ES Module）顺序执行。源码只发给本机 `127.0.0.1` 服务，不执行、不外传。

## 启动

在仓库根目录运行：

```bash
python -B code/backend/server.py
```

终端会打印形如 `http://127.0.0.1:8777` 的本机地址，用它打开页面。
**直接双击 index.html 不行**：`file://` 下取不到令牌，也调不到 `/api/analyze`。

## 加载顺序（不可乱）

`index.html` 末尾按固定顺序同步加载，每个文件一个 IIFE，只写一个全局 `CL`：

```
lib/dom.js  → lib/api.js → lib/layout.js → lib/graph-svg.js
→ views/overview.js → views/logic.js → views/structure.js
→ views/risks.js → views/export.js → features/import.js → app.js
```

后加载的模块通过 `CL.xxx` 使用先加载的模块；`app.js` 最后启动，负责渲染与事件委托。

## 模块契约

| 命名空间 | 职责 | 关键导出 |
| --- | --- | --- |
| `CL.dom` | 查询、转义、格式化、提示 | `$`、`$$`、`esc`、`fmtInt`、`fmtNum`、`fmtBytes`、`clip`、`basename`、`dirname`、`debounce`、`toast`、`tag`、`empty`、`pct` |
| `CL.api` | 与本机服务通讯 | `connected`、`token`、`version`、`connect()`、`analyze(selection,onProgress)`、`toBase64()` |
| `CL.layout` | 结构图布局，**纯函数、无 DOM** | `buildGraph(mode,result,limit)`、`layoutGraph(graph)`、`fitTransform(bounds,viewport,padding)`、`placeInViewport()` |
| `CL.graphSvg` | 结构图 SVG 渲染与交互 | `render(layout,opts)`、`mount(container,layout,ctx)`（`mount()` 返回清理函数，函数上挂 `fit`/`zoomIn`/`zoomOut`/`select`/`transform`/`setView`/`resize`/`size`） |
| `CL.views` | 五个页面视图，`render()` 只拼字符串 | `overview`、`logic`、`structure`、`risks`、`export`；其中 `logic`/`structure`/`risks` 另有 `mount()`，`export` 另有 `buildDraft(result)` |
| `CL.features.import` | 导入弹窗与拖拽读取 | `open()`、`close()`、`accept(selection)`、`readDrop(dataTransfer)`、`fromFileList(fileList)`、`refresh()` |
| `CL.app` | 应用外壳（状态、路由、委托、分析、导出） | `state`、`result`(存取器)、`selection`(存取器)、`runAnalysis()`、`locate(file,line)`、`download(ext)`、`navigate(page)`、`openImport()`、`connect()`、`getResult()`、`getSelection()`、`setSelection()` |

`state`：`{ page, file, fn, step, line, graph, query, severity, evidence, module, focusNode }`。
`selection`（拖拽与目录选择共用）：`{ project, files:[{ path, file }], error }`，`path` 是**去掉根目录名**的项目内相对路径。

`CL.app.result` 与 `CL.app.selection` 是**存取器**（`get` 读当前值、`set` 写入同一份状态），
与全局 `window.result` / `window.selection` 指向同一份数据，不存在两套真相；
供控制台调试与集成测试注入。

## 数据来源

页面上的每个数字都来自本次 `POST /api/analyze` 的真实返回（引擎 `code/core_engine/engine.py`）：

- `status`：`complete | partial | failed | empty`，四态各有独立文案，空结果不显示成“通过”。
- `summary`：`files / parsed / failed / excluded / functions / classes / code_lines / findings / average_cc / max_cc`。
- `files / functions / classes / findings / graph` 全部由引擎产出，前端不自算评分、不补占位数据。

没有预置示例项目、历史记录或模拟风险。未分析时显示空状态而不是全 0 指标。

## 拖拽导入

- 窗口任意位置拖入**文件夹**或**多个 .py 文件**；拖拽期间全屏虚线遮罩 + `body.is-dragging`。
- `dragenter`/`dragleave` 用计数器判断，鼠标在子元素间移动不会闪烁；`dragover` 一律 `preventDefault`。
- 优先 `DataTransferItem.webkitGetAsEntry()` 递归读目录，`readEntries` 循环到返回空数组为止；失败回退 `dataTransfer.files`。
- 拖入散文件时项目名取公共父目录名，取不到用“拖入的 N 个文件”。
- 拖拽与 `<input type="file" webkitdirectory>` 归一到同一个 `selection`，复用同一套校验与分析流程。

排除与上限（与引擎一致，前端只做提前提示，最终以引擎为准）：

| 项 | 值 |
| --- | --- |
| 默认排除目录 | `.git`、`.venv`、`venv`、`__pycache__`、`node_modules`、`build`、`dist`、`tests` |
| 文件数上限 | 200 个 `.py` |
| 单文件上限 | 1 MB |
| 总大小上限 | 8 MB（请求体 12 MB） |
| 结构图节点 | 最多 60 个（截断时提示，完整关系见清单与 JSON） |

## 结构视图

用 `<g class="viewport">` 的 `transform` 承载平移缩放，容器 `overflow:hidden`，**不用 CSS 滚动条承载大图**，
因此不存在“拖不到最上面 / 显示不全”。图层固定为 `edges → nodes → labels`，箭头不会被节点盖住；
marker 用 `markerUnits="userSpaceOnUse"`，箭头尖端落在目标端口的入圆点外侧。

| 操作 | 效果 |
| --- | --- |
| 滚轮 | 以指针为锚缩放（0.35–2.0） |
| 拖空白 | 平移画布 |
| 单点节点 | 选中并高亮相关边 |
| 双击节点 | 跳源码定位 |
| `0` / 适配按钮 | 复位为 fit-to-screen（内边距 32px） |
| `+` / `-` / 方向键 | 缩放 / 平移 |

同层边与自环走右侧外环，不穿节点；边 chip 画在路径中点、浮于节点之上。

## 导出

三种格式，均从当前内存结果生成，**不含原始源码**（`files[i].source` 会被剔除）：

- `JSON`：深拷贝后剔除每个 `files[i].source`，其余原样输出。
- `Markdown`：含“实际分析范围”小节，列文件 / 函数 / 类 / 风险 / 限制。
- `Mermaid`：含 `flowchart TD`。

下载用 `Blob` + `URL.createObjectURL` + `<a download>`，用完 `revokeObjectURL`。

## 检查

在仓库根目录运行：

```bash
node --check code/frontend/app.js          # 每个 js 都可用同样方式检查
node tests/integration/test_frontend.cjs   # 前端集成测试
python -B -m unittest discover -s tests -p "test_*.py"
```

集成测试用 Node + `vm` + 轻量 DOM 桩，按上表顺序加载全部模块，并调用**真实 Python 引擎**，
覆盖遗留契约、拖拽导入、布局不变量与导出格式。它不替代浏览器与真实目录选择的人工验证。

## 兼容性

模块顶层不访问 `document.body.innerHTML`、`localStorage`、`ResizeObserver`、`matchMedia`、`getComputedStyle`
等可能缺失的对象；`ResizeObserver` / `requestAnimationFrame` 全部特性检测。
渲染函数是纯字符串拼接，不测量布局；测量只在 `mount()` 内并用 `try/catch` 兜底为 1200×560 视口。
因此同一套代码既能在浏览器跑，也能在 Node 无 DOM 环境下被测试加载。

详见：[前端重写规格](../../docs/software/frontend-redesign.md) · [本地工作台说明](../../docs/software/local-workbench.md)
