# CodeLens 前端重写规格（v1）

本文件是前端重写期间唯一的接口契约与验收标准。所有并行开发一律以本文件为准。

## 0. 范围与硬约束

- 允许改动：`code/frontend/**`、`code/backend/server.py` 的静态资源路由、`tests/integration/test_frontend.cjs`、`code/frontend/README.md`、`docs/software/local-workbench.md`、本文件。
- 禁止修改 `code/core_engine/engine.py` 的分析口径与返回结构；前端只消费现有字段。
- **禁止占位/模拟数据、假指标、假风险**。页面上每个数字必须来自本次真实分析结果；空结果必须显示为空状态，不得显示为“通过”。
- 禁止外部依赖、CDN、网络字体、构建步骤。纯静态 HTML/CSS/JS，无构建。
- 保持安全语义：源码只发给本机 127.0.0.1 服务；导出不含原始源码与硬编码字符串值。
- 视觉：Office 风为主（克制、清晰、留白、表格化），科技感为辅（深墨蓝侧栏、极淡网格、等宽数字、少量青色高光）。
- 全部 UI 文案中文；代码标识符、路径、命令行保持原样。

## 1. 三个问题的根因（必须逐条消除）

### 1.1 没有拖动导入

现状：只有 `<input type="file" webkitdirectory>`，无 dragover/drop 处理。

要求：

- 窗口任意位置拖入**文件夹**或**多个 .py 文件**都能导入。
- 拖入时显示全屏遮罩（虚线框 + 文案），离开/放下消失；用 dragenter/dragleave 计数防闪烁。
- 优先 `DataTransferItem.webkitGetAsEntry()` 递归读目录（readEntries 必须循环到返回空数组）；失败回退 `dataTransfer.files`。
- 拖入散文件时项目名取公共父目录名，取不到用“拖入的 N 个文件”。
- 拖拽与 `<input>` 归一到同一个 `selection` 结构（见 §4），复用同一套校验与分析流程。
- 拖拽期间 `document.body` 加 `.is-dragging`；`dragover` 必须 preventDefault。
- 遮罩默认 `pointer-events:none`，不拦截页面正常交互。

### 1.2 结构视图显示不全 / 滚不到顶 / 箭头混乱且被节点遮挡

现状根因（旧 `app.js` 的 `graphSvg()`、`styles.css` 的 `.actual-graph`）：

1. `.actual-graph{max-height:650px;overflow:auto}` 与 svg 的 `width:100%;min-width:720px` 冲突；SVG 高度用内联 `style="height:Npx"` 写死，容器 flex 居中，滚动到顶失效。
2. 固定 3 列 `x=35+(i%3)*290`、`y=25+floor(i/3)*125`，节点 230×58，列间距仅 60px；画布尺寸只按节点数推导，边不参与。
3. 边端点写死 `M(a.x+110,a.y+56) Q(a.x+110,b.y-18) (b.x+110,b.y)`：同列起终点重合、路径塌陷；跨列从矩形中间穿过。
4. **边先画、节点后画**，箭头 marker 落在目标矩形内部，被后画的 rect 盖住 —— 这就是“箭头被节点覆盖”。
5. 自环 `M(a.x+190,a.y+10)...` 起点仍在 230 宽节点内，整段被遮。
6. `slice(0,60)` 静默截断；`data-node` 用数组下标，切模式后错位。

要求：

- 结构视图改为 **transform 视口**：容器 `overflow:hidden`，SVG 全铺，内部 `<g class="viewport">` 承载平移缩放；不再用 CSS 滚动条承载大图，从根本上消除“滚不到顶/显示不全”。
- 初始 fit-to-screen（全部节点与边在可视区内，内边距 32px），且左上角节点完整可见。
- 滚轮以指针为锚缩放（0.35–2.0）、空白处拖拽平移、`0` 键或按钮复位适配、双击节点定位源码。
- 层级：`edges` → `nodes` → `labels`（边 chip 在最上层）。
- marker 用 `markerUnits="userSpaceOnUse"`，三角不随缩放变形；箭头尖端落在目标节点的入端口圆点外侧，不与矩形重叠。
- 同层边（源层 == 目标层）走右侧外环正交折线；自环走右侧外弧，均不穿节点。
- 边 chip 画在路径中点，浮于节点之上不被遮挡。
- `data-node` 用节点 id，不用下标；截断时提示“仅绘制 N/M 个节点，完整关系见关系清单与 JSON 导出”。
- 布局是确定性纯函数（同输入同输出），可在 Node 中无 DOM 单测。

### 1.3 排版逻辑不清

现状根因：单页 innerHTML 拼串、每页各自写标题区、CSS 里 `!important` 与内联 height 撑版式、多个滚动容器高度互相打架、密度无统一刻度。

要求：按 §3 App Shell、§5 视图规格重写；主区只有一个滚动容器；统一间距/字号/卡片刻度。

## 2. 设计 token

```css
:root{
  --bg:#f4f6f9; --surface:#fff; --surface-2:#f8fafc; --surface-3:#eef2f7;
  --line:#e3e8ef; --line-strong:#cfd8e3;
  --ink:#0f172a; --ink-2:#334155; --muted:#64748b; --faint:#94a3b8;
  --brand:#0f766e; --brand-600:#0d9488; --brand-50:#ecfdf7; --brand-line:#99f6e4;
  --tech:#0891b2;
  --danger:#dc2626; --danger-bg:#fef2f2;
  --warn:#d97706;   --warn-bg:#fffbeb;
  --info:#2563eb;   --info-bg:#eff6ff;
  --ok:#059669;     --ok-bg:#ecfdf5;
  --nav-bg:#0b1220; --nav-bg-2:#111c30; --nav-ink:#c8d4e4; --nav-muted:#7c8aa0;
  --r-sm:6px; --r:10px; --r-lg:14px;
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px;
  --shadow-1:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.04);
  --shadow-2:0 8px 24px rgba(15,23,42,.08);
  --font-ui:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;
  --font-mono:"Cascadia Mono",Consolas,"Courier New",monospace;
}
```

字号刻度：11（eyebrow/tag）、12（次要）、13（正文）、14（强调）、16（小标题）、20（h1）、30（关键数字，等宽）。
圆角 6/10/14；阴影仅两档；动效 ≤180ms ease-out，支持 `prefers-reduced-motion`。
数字/行号/路径一律 `--font-mono`。自定义细滚动条（8px，圆角，hover 加深）。

## 3. App Shell

```html
<body>
  <div class="app">
    <aside class="sidebar" id="sidebar">…244px 固定…</aside>
    <div class="shell">
      <header class="topbar">…56px…</header>
      <main id="main" class="main" tabindex="-1"></main>
      <footer class="statusbar">…28px…</footer>
    </div>
  </div>
  <div class="drop-overlay" id="drop-overlay" aria-hidden="true">…</div>
  <dialog id="import-dialog"></dialog>
  <dialog id="detail-dialog"></dialog>
  <div id="toast" role="status" aria-live="polite"></div>
</body>
```

- `.app{display:grid;grid-template-columns:244px 1fr;height:100vh}`
- `.shell{display:grid;grid-template-rows:auto 1fr auto;min-width:0;height:100vh}`
- `.main{overflow:auto;min-height:0}`
- 除 `.main` 与栅格面板内部列表，不允许别的滚动容器。

侧栏（深墨蓝）：品牌 → 工作空间卡片（项目名/状态/切换）→ 主导航（概览/逻辑浏览/结构视图/风险审查/导出）→ 底部引擎状态点 + 版本。
选中项：左侧 3px 青绿条 + `rgba(45,212,191,.10)` 背景 + 文字变亮。

顶栏：左侧面包屑；右侧连接徽标 + 主按钮“导入项目”。徽标三态：连接中 / 已连接（绿点+版本）/ 离线（红点+可点重连）。

状态栏：左侧“本机 AST 分析 · 源码不执行不外部传输”，右侧本次分析文件数与时间。

## 4. 状态与接口契约

### 4.1 命名空间与加载顺序

无构建、经典脚本，每个文件一个 IIFE，只写一个全局 `CL`：

```js
(function(root){ 'use strict'; var CL = root.CL = root.CL || {}; /* … */ })(typeof globalThis!=='undefined'?globalThis:window);
```

所有增强 API 必须特性检测（ResizeObserver、requestAnimationFrame 等）；渲染函数不做布局测量；测量只在 `mount()` 内并用 try/catch 兜底 —— 这样 Node + 轻量 DOM 桩的集成测试可跑通。

加载顺序（index.html 末尾，普通 script，按序同步执行）：
`lib/dom.js` → `lib/api.js` → `lib/layout.js` → `lib/graph-svg.js` → `views/overview.js` → `views/logic.js` → `views/structure.js` → `views/risks.js` → `views/export.js` → `features/import.js` → `app.js`

### 4.2 模块契约

```js
// lib/dom.js
CL.dom = { $, $$, esc, tag(text,color), toast(msg,kind), fmtInt, clip, debounce, empty(title,desc,actionHtml) }

// lib/api.js
CL.api = { connected:false, token:null, version:null,
  connect():Promise<boolean>,                        // GET /api/status, 5s 超时
  analyze(selection, onProgress):Promise<object> }   // POST /api/analyze, 120s 超时

// lib/layout.js   纯函数，无 DOM，可在 Node 中直接调用
CL.layout = {
  buildGraph(mode, result, limit):{nodes,edges,stats},   // mode: modules|classes|calls
  layoutGraph(graph):{width,height,nodes,edges},
  fitTransform(bounds, viewport, padding):{k,tx,ty} }

// lib/graph-svg.js
CL.graphSvg = { render(layout, opts):string, mount(container, layout, ctx):Function }

// views
CL.views.overview  = { render(state, ctx):string }
CL.views.logic     = { render(state, ctx):string, mount?(root,state,ctx) }
CL.views.structure = { render(state, ctx):string, mount(root,state,ctx):Function }
CL.views.risks     = { render(state, ctx):string }
CL.views.export    = { render(state, ctx):string }

// features/import.js
CL.features.import = { open(), close(), accept(selection),
  readDrop(dataTransfer):Promise<selection>, fromFileList(fileList):selection }
```

ctx（由 app.js 构造）：

```js
{ result, state, patch(partial), navigate(page), locate(file,line), openFinding(id),
  download(ext), openImport(), closeImport(), toast(msg,kind), rerender() }
```

state：

```js
{ page:'overview', file:'', fn:'', step:0, line:null, graph:'modules',
  query:'', severity:'all', evidence:'all', module:'all', selectedNode:null }
```

selection（导入结果，拖拽与选择共用）：

```js
{ project:string, files:[{path:string, file:File}], error:string }
```

`path` 为项目内相对路径（去掉根目录名）；`error` 非空时禁用分析按钮。

测试注入接口（必须保留）：

```js
CL.app = { get state(), get result(), get selection(), set selection(v),
  runAnalysis(), locate(file,line), download(ext), connect(), navigate(page), openImport() }
```

### 4.3 事件委托（全站唯一一套）

document 上单次 click 委托，按 data-* 分派：

| 属性 | 行为 |
|---|---|
| `data-nav="overview\|logic\|structure\|risks\|export"` | 切页 |
| `data-action="import" / "reconnect" / "analyze" / "reanalyze" / "close-dialog" / "reset-filters"` | 对应动作 |
| `data-action="graph-mode" data-mode="modules\|classes\|calls"` | 切换结构图模式 |
| `data-action="graph-fit"` / `data-action="graph-zoom" data-dir="in\|out"` | 适配 / 缩放 |
| `data-open-file="0"` | 打开文件到逻辑浏览 |
| `data-step="i"` | 选中语句步骤 |
| `data-node="nodeId"` | 选中图节点 |
| `data-location="file" data-line="n"` | 定位源码 |
| `data-finding="id"` | 打开风险详情 |
| `data-download="md\|json\|mmd"` | 导出 |

键盘：Enter/Space 触发 role=button 非按钮元素；Esc 关弹窗/取消选中；图内 `0` 适配、`+/−` 缩放、方向键平移。

## 5. 视图规格

统一页面骨架：`<div class="page">`（`padding:24px 32px`，`max-width:1440px`，居中）；页头：

```html
<header class="page-head">
  <div><p class="eyebrow">PROJECT OVERVIEW</p><h1>项目概览</h1><p class="page-sub">数据来源与边界一句话</p></div>
  <div class="page-actions">…</div>
</header>
```

### 5.1 概览

- 状态条：状态胶囊 + 成功/失败文件数 + 引擎版本。
- 4 指标卡：源文件、函数与方法、待复核发现（含严重/警告/提示分布）、平均圈复杂度（附最高）。
- 两列：左“实际分析文件”列表（路径 / 函数数·行数 / 状态标签，点行跳逻辑浏览）；右“优先复核”最多 5 条。
- 空项目显示空状态卡 + 重新导入，不显示 0 分成功态。

### 5.2 逻辑浏览（三栏）

`grid-template-columns:240px minmax(280px,340px) 1fr;gap:16px`，三栏独立滚动，高度 `calc(100vh - 顶点高)`，`min-height:480px`。

- 左：文件列表（解析失败红标）。
- 中：函数选择器 + 指标行（CC/等级/行数/嵌套）+ 语句步骤列表（步骤号 + 描述 + `L起–止 · AST类型`）。
- 右：源码面板（粘性表头），行号列 + 代码列，选中行高亮并 `scrollIntoView({block:"nearest"})`；代码行 `content-visibility:auto` 优化大文件。
- 无函数文件：中栏空状态，右栏仍看源码。

### 5.3 结构视图（重点）

工具栏（面板顶部 44px）：分段控件 [模块依赖 | 类与继承 | 已解析调用] + 右“节点/关系”计数 + [−] 100% [+] 适配 + 箭头语义说明（随模式变化：模块=指向被依赖模块；类=指向父类；调用=指向被调用者）。

画布：

- `.graph-stage{position:relative;height:clamp(420px,calc(100vh - 300px),760px);overflow:hidden}`，SVG 绝对定位 `inset:0`，尺寸随容器（ResizeObserver，无则 clientWidth/Height 兜底）。
- 层级：edges（路径+箭头）、nodes（矩形+文字）、labels（边 chip 最上）。
- 节点 200×56 圆角 8；左侧 3px 文件色条（按路径哈希取 8 色）；标题单行截断（显示宽度 > 18 加省略号，中文按 2 计）；副标题 11px 等宽 `文件名:L行号`。选中：2px 品牌色描边 + 外发光。
- 边：三次贝塞尔；源底边中心 → 目标顶边中心（反向边用源顶→目标底）；箭头尖端在目标端口外侧 2px；同层走右侧外环正交；自环右侧外弧。
- 边 chip：路径中点圆角矩形，10px 等宽，文本“源简名 → 目标简名”，≤40 条时全显，超出只显 hover/选中。
- 交互：滚轮锚点缩放、拖空白平移、点节点选中并高亮相关边、双击跳源码、`0` 适配。
- 右下角小地图（120×80，节点 >80 不显示）。
- 顶部提示条：节点超限时“仅绘制前 N 个节点（共 M 个）…”；有循环依赖时显示警告条。
- 下方：关系依据清单（可点定位源码，>200 条提示仅列前 200）；“未解析调用”独立卡片（仅调用模式）。
- 空状态：画布区居中空状态，不画空 SVG。

### 5.4 风险审查

工具栏：搜索 + 严重度/证据/文件筛选 + 计数。
表头 sticky；列：级别、问题与位置、规则、证据、置信度；行 hover，点击开详情。级别用左侧 3px 色条 + 标签，不整行染色。
详情弹窗：规则/级别/证据/位置/实际值阈值/命中依据/复核建议 + “定位原始源码”。
底部事实性提示：事实不等于已确认缺陷。

### 5.5 导出

三个格式卡（MD/JSON/Mermaid）+ 右侧报告预览（等宽 12px，可滚动）。

## 6. 导入弹窗

最大宽 560px：标题区 → 拖放区（虚线 2px 圆角 12px，dragenter 高亮）→ 结果摘要（项目名/文件数/总大小/前 60 路径，可折叠；错误红字）→ 排除说明 → 安全说明 + 取消/开始分析 → 分析中按钮禁用并显示进度。

## 7. 文件分工（写作用域互斥）

| 角色 | 文件 |
|---|---|
| Lead | `code/frontend/index.html`、`styles.css`、`app.js`、`lib/dom.js`、`lib/api.js`、`code/backend/server.py`、`docs/**` |
| app 队友 | `views/overview.js`、`views/logic.js`、`views/risks.js`、`views/export.js`、`features/import.js` |
| graph 队友 | `lib/layout.js`、`lib/graph-svg.js`、`views/structure.js` |
| qa 队友 | `tests/integration/test_frontend.cjs`、`code/frontend/README.md` |

## 8. 验收

1. 每个 js 过 `node --check`；`node tests/integration/test_frontend.cjs` 通过；`python -B -m unittest discover -s tests -p "test_*.py"` 通过。
2. 拖拽文件夹导入可用（遮罩/计数/递归读取/校验/衔接分析）。
3. 结构视图三模式都能 fit、左上节点可见、箭头落在端口不被遮挡、自环不重叠、chip 可读、缩放平移复位正常。
4. 逻辑浏览三栏在 1280×800 与 1920×1080 下都不裁切、能滚到底。
5. 无占位数据；空 / 全失败 / 部分完成 三态文案明确。
6. 无 `!important` 滥用、无内联样式撑版式（SVG 坐标除外）、主区单一滚动条。

## 9. 附录 A：engine 返回结构（只读契约，前端不得假设更多字段）

`POST /api/analyze` 成功返回的 `result`：

```json
{
  "schema_version": 1, "engine_version": "0.2.0",
  "project": "local-project",
  "status": "complete | partial | failed | empty",
  "config": { "max_cc": 10, "max_length": 50, "max_nesting": 4, "max_files": 200,
              "excluded_dirs": ["..."] },
  "summary": { "files": 1, "parsed": 1, "failed": 0, "excluded": 3, "functions": 4,
               "classes": 1, "code_lines": 99, "findings": 2, "average_cc": 3.5, "max_cc": 12 },
  "files": [ { "path": "server.py", "module": "server", "source": "<原始源码字符串>",
               "status": "parsed | failed", "line_count": 99, "code_lines": 88,
               "sha256": "…", "error": null,
               "functions": ["<function id>…"], "classes": ["<class id>…"] } ],
  "functions": [ { "id": "server.py::main", "name": "main", "file": "server.py",
                   "line": 10, "end_line": 40, "kind": "function | method | async",
                   "cc": 3, "rank": "A | B | C | D | E", "nesting": 2, "length": 30,
                   "params": 1,
                   "statements": [ { "line": 11, "end_line": 12,
                                     "ast_type": "If", "description": "…",
                                     "evidence_type": "fact" } ] } ],
  "classes": [ { "id": "…", "name": "Cls", "file": "server.py", "line": 1, "end_line": 9,
                 "kind": "class", "methods": ["<function id>…"], "bases": ["Base"] } ],
  "findings": [ { "id": "…", "rule_id": "CC-01",
                  "severity": "critical | warning | info", "file": "server.py", "line": 10,
                  "message": "…", "suggestion": "…",
                  "evidence_type": "fact | inference",
                  "actual": 12, "threshold": 10, "confidence": 0.9 } ],
  "graph": {
    "dependencies": [ { "source": "a", "target": "b", "file": "a.py", "line": 3,
                        "internal": true, "evidence_type": "fact" } ],
    "calls": [ { "source": "f1", "target": "f2", "expression": "f2()", "file": "a.py",
                 "line": 7, "status": "resolved | unresolved", "evidence_type": "fact" } ],
    "inheritance": [ { "source": "C", "target": "Base", "file": "a.py", "line": 2,
                       "evidence_type": "fact" } ],
    "cycles": [ ["a", "b"] ]
  },
  "errors": [], "warnings": [], "limitations": []
}
```

注意：

- `files[].source` 只存在于内存结果中，**导出时必须剔除**（见附录 B）。
- `graph.cycles` 是“模块名数组”的数组。
- `functions[].rank` 直接来自引擎，前端不要自算。
- 所有数组都可能是空数组；所有数值字段可能为 0。
- 初始态 `result` 为 `null`（尚未分析）。

## 10. 附录 B：导出格式（不得破坏）

- `download("json")`：深拷贝后 **剔除每个 `files[i].source`**；其余原样 `JSON.stringify`。
- `download("md")`：必须包含小节标题“实际分析范围”，列出文件 / 函数 / 类 / 风险 / 限制。
- `download("mmd")`：必须包含 `flowchart TD`（Mermaid）。
- 导出用 `Blob` + `URL.createObjectURL` + `<a download>`，完成后 `URL.revokeObjectURL`。

## 11. 附录 C：必须保留的遗留契约（集成测试断言）

`tests/integration/test_frontend.cjs` 用 Node + `vm` + 轻量 DOM 桩加载前端，必须满足：

1. 初始化后 `#main` 的 innerHTML 含“分析引擎已就绪”，且不含 `ai-shop-demo`。
2. 注入 `CL.app.selection`（1 个 File）后调 `CL.app.runAnalysis()`：真实发出 1 次 `POST /api/analyze`，body 中 base64 内容等于 `code/backend/server.py` 原文。
3. `CL.app.result.summary.files === 1` 且 `summary.functions > 0`。
4. `#main` 含 HTML 转义后的 `&lt;local-project&gt;`（即源码里的 `<local-project>` 被转义）。
5. `CL.app.locate("server.py", 10)` 后 `#main` 含 `id="source-line-10"`。
6. `CL.app.download("json")`：导出对象中 `files[0].source` 不存在，且含 `name === "main"` 的函数。
7. `CL.app.download("md")` 文本含“实际分析范围”。
8. `CL.app.download("mmd")` 文本含“flowchart TD”。
9. 分析请求失败时：保留旧 `result`，且 `#import-notice` 元素文本含“没有生成替代结果”。

因此：**页面必须存在 `id="import-notice"` 容器**，用于显示导入/分析状态与错误信息（初始可为就绪文案或空）。

## 12. 附录 D：DOM 桩环境（QA 与所有模块必须兼容）

测试环境的 `document` 只有：`querySelector`、`querySelectorAll`（返回 `[]`）、`createElement`（返回带 `style`/`setAttribute`/`appendChild`/`innerHTML` 的桩）、`addEventListener`（记录但不触发）、`body`。

`window` 上有：`URL.createObjectURL`/`revokeObjectURL`、`btoa`、`requestAnimationFrame`（同步调用回调）、`fetch`。

**硬性要求**：

1. 任何模块在顶层执行时不得访问 `document.body.innerHTML`、`localStorage`、`ResizeObserver`、`matchMedia`、`getComputedStyle` 等可能不存在的对象；必须先用 `typeof` 或 `in` 判断。
2. 渲染函数（`render`）必须是纯字符串拼接，只依赖 `state` / `ctx` / `result`，不查 DOM。
3. `mount()` 内的所有测量（`clientWidth`、`getBoundingClientRect`）必须包在 `try{}catch{}` 里，失败时退回默认视口 `{width:1200,height:560}`。
4. 导出函数（`download`）在无 `document.createElement("a").click` 环境下也要能返回文本；实际下载失败不抛异常。
