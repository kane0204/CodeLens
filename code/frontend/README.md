# CodeLens 当前前端

纯静态页面，无 npm 运行依赖。index.html 仅加载 app.js 与 styles.css；lib/views/features 下保留旧版模块供参考和布局回归，不能据此要求当前页面使用旧 CL 全局 API。

在项目根目录运行 `python -B code/backend/server.py`，访问终端打印的本机地址（默认 http://127.0.0.1:18766）。不能直接使用 file:// 打开页面。

当前支持总览、项目结构、AI 自然语言逻辑解读、关系图谱、质量体检、SOLID 设计检查、风险筛选与报告导出。详细说明见 [工作台说明](../../docs/software/local-workbench.md)。

普通静态分析在本机进行。只有点击生成 AI 解读后，选中源码和有界调用上下文才发送到配置的模型服务；密钥不持久化、不导出。AI 引用会验证范围，只有有效引用可以打开对应源码。

`node tests/integration/test_frontend.cjs` 运行当前页面真实浏览器主流程与布局不变量；需要 Node 22+ 及 Chromium/Edge。旧 DOM 桩与旧脚本顺序已由当前页面契约替代。
