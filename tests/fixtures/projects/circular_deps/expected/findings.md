# 预期规则命中（FR-14 ~ FR-16）

> **引擎实测状态（2026-10-24，engine v0.2.0，见 `tests/fixtures/VERIFICATION.md`）**：
> CYCLE-01 已实测命中——以项目目录为根上传时 `cycles=[['repository','services']]`，
> finding 落在 `repository.py:3`，与下表 #1 一致。
> 注意上传路径形态：若上传父目录（路径含 `circular_deps/` 前缀），模块名与导入目标
> 不匹配，循环依赖会静默漏检；集成测试必须以项目目录为根。
> A1 规则尚未实现；`Admin` 基类问题当前以 warning（services.py:26 父类未解析）呈现，
> 与下表 #2 位置一致、形态为 warning 而非 finding。

规则 ID 为 provisional，以 `docs/algorithm/rules-engine.md` 定稿为准。

## 预期命中（2 条）

| # | rule_id | severity | evidence | 位置 | actual | confidence | 说明 |
|---|---|---|---|---|---|---|---|
| 1 | CIRC-01 | critical | fact | repository.py:3（+services.py:5） | 2 节点 SCC | — | 循环依赖 services ⇄ repository，100% 检出（FR-12 验收） |
| 2 | A1 | warning | inference | services.py:26 | — | medium | `Admin` 基类 `get_base()` 静态不可解析，warning 附带位置 |

## 预期 warning（非 finding）

| warning | 位置 | 原因 |
|---|---|---|
| unresolved base class | services.py:26 | `Admin(get_base())` 基类为运行时表达式（US-03 场景 2） |
| 循环导入（运行期必然失败） | repository.py:3 / services.py:5 | 与 CIRC-01 同源；允许合并 |

## 预期不命中（误报检查，反例）

| 检查点 | 预期 |
|---|---|
| `models`/`notifications`/`plugins` | 无任何循环依赖 finding |
| `repository.py:3` 的导入 | **不**触发 A5：`DEFAULT_SOURCE` 在 repository.py:11 被使用 |
| `services` 的全部导入 | **不**触发 A5：Notifier/get_base/UserRepository 均有使用 |
| `models.User` 与 `services.User` | 不得因「同名」合并或互相连线；类图必须有两个独立 User 节点 |
| `register` 内的 `User(...)` | 必须解析到 `services.User`，连到 `models.User` 即错误 |
| `Admin` | 不得画出继承边；若画边必须标 inference 且报告显著区分 |
| 全部函数 | 无 CC / 长函数 / 坏味命中（CC 全为 1） |
| 全项目 | 无 A2/A3/A4 命中（无重复对、无外部 IO 调用、无硬编码） |

## 审查报告预期

- CIRC-01 应为全项目最高优先级 finding（critical），报告首屏出现；
- 附带人工复核建议：解除循环的两个方向（repository 不再导入 services，
  或将 `DEFAULT_SOURCE` 下沉到独立模块）——建议文字由规则模板给出，不生成代码。
