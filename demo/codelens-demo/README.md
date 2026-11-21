# CodeLens 演示项目

这是一个刻意包含常见质量问题的迷你商店项目。

导入整个 `codelens-demo` 文件夹后，可以演示：

- 项目总览和文件树
- 函数、类、调用与模块依赖
- 复杂度、SOLID 和健康度
- 重复代码、死代码、敏感信息和异常风险
- 文件逻辑解读与 AI 审查
- 历史记录、断点恢复和报告导出

建议优先查看：

1. `mini_shop/orders.py` 中的 `OrderService.place_order`
2. `mini_shop/legacy.py`
3. `mini_shop/reporting.py`
4. `web/dashboard.js`

代码仅用于静态分析演示，不建议用于真实交易。
