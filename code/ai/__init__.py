"""AI 表达层。

这一层只做一件事：把 `core_engine` 已经算出来的确定性事实，翻译成人能快速读懂的
中文。它不解析源码、不产生 finding、不修改任何 id。

默认可用：不配置模型时由各 skill 的确定性模板产出同样的信封结构；配置了外部模型
也走同一套 `contract.validate_skill_result()` 校验，模板与模型在契约面前没有区别。

模块结构：

- `contract.py`  信封、证据引用校验、三层 schema 校验（与 core_engine 无依赖）
- `provider.py`  表达方：确定性模板 / OpenAI 兼容 HTTP 模型
- `skills/`      四个 skill，各自声明候选目标、切片、模板与 prompt
- `runner.py`    固定 DAG：切片 → 表达 → 校验 → 缓存
"""
