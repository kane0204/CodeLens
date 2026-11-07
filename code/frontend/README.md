# CodeLens 前端

前端使用 Vite + React。`src/main.jsx` 负责挂载应用，`src/App.jsx`
提供全局页面骨架、弹窗、文件输入和运行时生命周期；原有静态分析视图通过
`app.js` 导出的 `mountLegacyWorkbench()` 接入，保留图谱、AI 解读、
专项风险评估与报告导出的既有行为。Python 使用 AST 深度分析；
C/C++、Java、JavaScript、TypeScript、C#、Go、Rust 等使用确定性启发式分析。

视觉系统位于 `src/styles.css`，采用冷灰蓝画布、深青主色和橙色信号点。
Manrope 与 JetBrains Mono 会随应用本地打包，不依赖 CDN。

“质量体检”内按规则分组展示命中项，默认收起；“风险清单”展示八类代码专项
评估。报告不提供独立页面或预览，直接从顶部导出菜单选择 Markdown、JSON 或 CSV。

## 开发

先启动 Python 分析服务：

```powershell
python -B code/backend/server.py
```

再在另一个终端启动 Vite：

```powershell
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 会把 `/api` 代理到默认的
`http://127.0.0.1:18766`；后端端口不同时，用 `CODELENS_API_URL`
指定代理地址。

## 生产构建

```powershell
npm run build
python -B code/backend/server.py
```

Python 服务会直接托管 `code/frontend/dist`。Windows 的
`start-codelens.cmd` 和 Unix 的 `start-codelens.sh` 会在 `dist` 缺失时
自动执行构建。

## 验证

```powershell
npm run build
node --check code/frontend/app.js
node tests/integration/test_logic_frontend.cjs
node tests/integration/test_solid_frontend.cjs
node tests/integration/test_frontend.cjs
```

真实浏览器测试需要 Node.js 22+ 与本机 Chromium/Edge，可通过
`CODELENS_BROWSER` 指定浏览器可执行文件。
