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

- 选择项目文件夹；填写兼容 `chat/completions` 的 Base URL、模型名称、API Key，也支持服务端环境变量 `CODELENS_AI_ENDPOINT` / `CODELENS_AI_MODEL` / `CODELENS_AI_KEY`。
- 导入后自动完成「静态分析 → AI 项目审查」，不需再逐页点击生成。
- 分阶段进度条与预计剩余时间；AI 请求不设页面或前端超时，避免长项目被提前掐断。
- 审查意外中断后重新生成会从服务端断点续跑（项目与模型指纹相同的未完成任务可 attach）。
- 密钥仅保存在当前页面内存，刷新需重填；不写入项目文件、报告或浏览器持久存储。

## 3. 导航与页面

`src/components/Topbar.tsx` 共六项：总览 / 项目结构 / 逻辑说明 / 质量体检 / 设计检查 / 风险评估。

| 页面 | 内容 |
|---|---|
| 总览 | 文件与符号统计、复杂度与健康度、实际分析范围；已移除 Top 10 排行榜与解析异常汇总 |
| 项目结构 | 文件树、模块依赖、符号与源码定位；不再单独列出解析异常 |
| 逻辑说明 | 全项目 AI 审查产出的逻辑解读，跨文件互为说明，引用行号可核对源码 |
| 质量体检 | 高复杂度、高嵌套与坏味说明，附类指标（WMC/DIT/CBO/LCOM1）与结构重复 |
| 设计检查 | SOLID 五项静态规则 + AI 审查的设计结论，未命中不表示符合原则 |
| 风险评估 | 仅展示有严重危害的风险，附规则、证据等级与源码位置 |

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
- 导出默认剔除源码，可选择是否包含 AI 结果；文本经转义后渲染，不执行模型返回的 HTML。

## 6. 验收

```sh
python -B -m unittest discover -s tests -p 'test_*.py' -v   # 单元 + 集成
cd codelens-prototype && npm ci && npm run build                # 前端构建（CI 同样执行）
```

视觉验收在桌面与移动端逐页核对（截图仅在验收时生成，不纳入仓库），检查项包括：无整页滚动、卡片不溢出、导航可达、进度与 ETA 可见、空结果呈现为空状态而非「通过」。
