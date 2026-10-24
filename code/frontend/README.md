# CodeLens 本地工作台

index.html、styles.css、app.js 为无构建依赖的前端。在仓库根目录运行 `python -B code/backend/server.py`，通过终端显示的本机地址访问，直接打开 HTML 无法调用分析引擎。

## 已接入流程

1. 选择 Python 项目目录，展示排除后的实际文件清单。
2. 向本机提交实际源码并等待 AST 分析，没有预置项目或模拟结果。
3. 查看真实统计、逻辑步骤、源码定位、模块依赖、继承及可确定的调用。
4. 筛选风险并查看规则、证据、阈值与复核建议。
5. 导出真实 Markdown、JSON、Mermaid 结果，下载中不包含原始源码。

结果仅存在页面内存中。图形最多绘制 60 节点，完整关系保留在清单及 JSON 中。完整 CFG、时序图、SOLID、健康度等仍未实现，也不会生成占位结果。

详见 [工作台说明](../../docs/software/local-workbench.md)。

## 检查

在仓库根目录运行：

```bash
node --check code/frontend/app.js
node tests/integration/test_frontend.cjs
```

控制逻辑测试使用轻量 DOM 桩，并调用真实 Python 引擎，不替代浏览器与目录选择验证。
