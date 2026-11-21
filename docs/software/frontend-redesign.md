# 前端现状说明（Vite + React 工作台）

本文件描述当前界面实现。旧版 `code/frontend/`（原生 HTML/CSS/JS、无构建、`CL` 命名空间）及其重写规格已于 2026-11-07 删除，不再作为接口或验收依据。

## 1. 技术栈与运行

| 层次 | 现状 |
|---|---|
| 框架 | Vite + React 18 + TypeScript，Tailwind CSS v4 |
| 目录 | `codelens-prototype/`，独立于后端的 `code/backend/` |
| 界面地址 | `http://localhost:5173`；`18766` 只提供 JSON API，直接打开返回 404 |
| 启动 | 仓库根 `start-codelens.cmd` / `start-codelens.sh` 一键拉起后端与前端；手动启动见根 README |
| 状态 | `src/state/AppState.tsx` 统一持有导入、分析结果、路由、AI 审查与导出状态 |
| 接口 | `src/api/client.ts`：`fetchStatus` / `analyzeProject` / `reviewProject`（NDJSON 流式进度） |

支持导入 Python、C/C++、Java、JavaScript/TypeScript、Go。上传以项目目录为根，路径保持根相对，否则模块名与导入目标无法对齐。

## 2. 初始化页

`src/components/UploadView.tsx`，标语 `make code visible`。导入与 AI 模型配置放在同一页：

- 首页只负责选择项目和本机静态分析，不展示 API 字段，也不会自动调用模型。
- 模型在结果页顶部「模型设置」中按需配置；「导出报告」展开的预览面板直接展示逻辑说明、设计检查和风险评估。
- 「一键解读所有文件」从第一个文件开始，最多并行 3 项；全部完成后自动生成项目级设计检查和风险评估。静态问题只在质量体检中完整展示；风险评估页只显示 AI 严重危害评估，避免重复。
- 每次分析独立保存为一条历史记录；历史页不提供项目选择器或版本序列，点击记录直接恢复当时结果。
- 导入后自动完成「静态分析 → AI 项目审查」，不需再逐页点击生成。
- 分阶段进度条与预计剩余时间；AI 请求不设页面或前端超时，避免长项目被提前掐断。
- 审查意外中断后重新生成会从服务端断点续跑（项目与模型指纹相同的未完成任务可 attach）。
- 密钥写入操作系统凭据库（Windows Credential Manager、macOS Keychain 或 Linux Secret Service），不写入项目文件、报告或浏览器持久存储；设置页可清除已保存密钥。

## 3. 导航与页面

`src/components/Topbar.tsx` 共六项：总览 / 项目结构 / 逻辑说明 / 质量体检 / 设计检查 / 风险评估。

| 页面 | 内容 |
|---|---|
| 总览 | 文件与符号统计、复杂度与健康度、实际分析范围；已移除 Top 10 排行榜与解析异常汇总 |
| 项目结构 | 文件树、模块依赖、符号与源码定位；不再单独列出解析异常 |
| 逻辑说明 | 全项目 AI 审查产出的逻辑解读，跨文件互为说明，引用行号可核对源码 |
| 质量体检 | 高复杂度、高嵌套与坏味说明，附类指标（WMC/DIT/CBO/LCOM1）与结构重复 |
| 设计检查 | SOLID 五项静态规则 + AI 审查的设计结论，未命中不表示符合原则 |
| 风险评估 | 展示逻辑解读完成后自动生成的 AI 严重危害评估 |

逻辑说明、设计检查、风险评估共享同一份 `/api/review` 结果，避免三次调用产生互相矛盾的结论。关系图谱页（`GraphsView`）已删除；导出并入顶栏按钮，提供 Markdown / JSON / CSV，不再有独立导出预览页。

## 4. 视觉与响应式

- 暖棕设计 token：底色 `#faf7f2`、主色 `#8b5e34`；卡片、边框、等宽数字与统一圆角刻度。
- 1440×900 桌面视口下每页不产生整页滚动，由页面内部容器承担局部滚动；移动端改为单列纵向排布。
- 健康度说明使用 portal 弹层，含视口碰撞处理与鼠标移开 / 失焦 / Esc 关闭。
- AI 文本由 `ReviewMarkdown.tsx` 统一排版；未覆盖的维度显示「未覆盖」及原因，**不生成推断条目顶替缺失数据**。

## 5. 状态与安全边界

- 后端只绑定回环地址，POST 请求校验 Host、Origin 与 `X-CodeLens-Token`；请求体上限 12 MB，服务端最多 200 个文件。
- 静态分析只在本机内存完成，不执行、不导入目标项目源码；导入即意味着源码会分批发送到用户配置的模型服务。
- 未配置模型或审查失败时，静态结果照常可用，且不使用模板伪装成 AI 结论。
- 导出默认剔除源码，并可分别选择逻辑说明、设计检查与风险评估；Markdown、JSON 和预览只包含勾选章节。文本经转义后渲染，不执行模型返回的 HTML。

## 6. 验收

```sh
python -B -m unittest discover -s tests/unit_1 -v            # Python 边界单元测试
python -B -m unittest discover -s tests/unit_2 -v            # Python 核心单元测试
python -B -m unittest discover -s tests/integration -v       # 集成测试
cd codelens-prototype && npm ci && npm run build                # 前端构建（CI 同样执行）
```

视觉验收在桌面与移动端逐页核对（截图仅在验收时生成，不纳入仓库），检查项包括：无整页滚动、卡片不溢出、导航可达、进度与 ETA 可见、空结果呈现为空状态而非「通过」。
