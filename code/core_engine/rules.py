"""补充规则：SOLID 的 S/O/D 三条，以及两条 AI 代码风险。

`engine.analyze()` 里的六条规则（CC-01/LEN-01/DEPTH-01/A4/A3-IO/CYCLE-01）是默认
分析路径，每次分析都跑。本模块的五条规则只在"需要 AI 表达层解释这些结论"时才跑，
所以不塞进 engine：

- 它们会让默认报告变长，而默认报告的第一原则是"短且确定"；
- 它们只在 `POST /api/ai` 里被消费，默认路径不跑，就不会改变既有输出与既有测试。

## 为什么规则在这边、文字在那边

SOLID 判断与"有没有循环依赖""是不是裸 except"这类结论属于**事实层**：必须可复算、
可解释、能给出行号。模型擅长的是把这些结论讲成人话、给建议，不擅长也不该负责
"判断这里到底符不符合 SRP"。所以：

- 本模块负责判定，输出与 `engine.findings` 完全同构的记录；
- `code/ai/` 下的 skill 只负责解释，每条解释都挂 `finding:<id>` 作证据。

## 口径

五条规则的口径都偏保守（宁可漏报，不要误报），而且把"为什么可能误报"写进
`finding["confidence"]` 与返回值的 `notes` 里，不做"看起来很准"的判断。

本模块是纯函数：同一份 `analyze()` 结果必须得到逐字节相同的输出。
"""
from __future__ import annotations

import ast

#: SRP-01：一个类的方法数达到多少算"承担了太多事"。
MAX_METHODS_PER_CLASS = 12

#: OCP-01：一个类里出现多少个不同类型判断，算"靠条件分派扩展"。
MAX_TYPE_BRANCHES = 3

#: DIP-01：一个类直接构造多少个本仓库内定义的具体类，算"依赖具体实现"。
MAX_CONCRETE_DEPS = 2

#: 一次补充评估最多输出多少条 finding（防止超大项目把 AI 上下文撑爆）。
MAX_EXTRA_FINDINGS = 120

DUNDER = ("__",)

#: 被当作程序入口、不参与 A5-DEAD 判定的函数名。
ENTRY_NAMES = {"main", "run", "cli", "app"}

NOTES = [
    "SOLID 三条只做 S/O/D，口径是「可复算的计数」，不是规范判定：命中说明值得复核，不说明违反。",
    "A5-DEAD 只看本次分析范围内的调用，外部调用、反射调用与测试调用都可能漏计。",
    "A8-DEFENSIVE 只看 except 处理体是否只有 pass/.../continue，不判断该异常是否真的可忽略。",
]


def _parse_files(result):
    """重新解析源码。engine 的 records 保留了 source，这里不读磁盘、不执行。"""
    trees = {}
    for record in result.get("files") or []:
        if record.get("status") != "ok":
            continue
        source = record.get("source")
        path = record.get("path")
        if not isinstance(source, str) or not isinstance(path, str):
            continue
        try:
            trees[path] = ast.parse(source, feature_version=(3, 11))
        except (SyntaxError, ValueError):
            continue
    return trees


def _definition_nodes(trees):
    """按 (file, line) 索引定义节点，与 engine 的 definitions 对齐。"""
    nodes = {}
    for path, tree in trees.items():
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                nodes.setdefault((path, node.lineno), node)
    return nodes


def _body_walk(node):
    """遍历函数/类体，跳过嵌套定义（嵌套函数与类各自独立评估）。"""
    stack = list(reversed(getattr(node, "body", [])))
    while stack:
        item = stack.pop()
        yield item
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        stack.extend(reversed(list(ast.iter_child_nodes(item))))


def _is_type_test(node):
    """`isinstance(x, T)` 或 `type(x) is T`，返回被判断的类型名。"""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "isinstance":
        if len(node.args) >= 2:
            second = node.args[1]
            if isinstance(second, ast.Name):
                return second.id
            if isinstance(second, ast.Tuple):
                names = [item.id for item in second.elts if isinstance(item, ast.Name)]
                return names[0] if len(names) == 1 else None
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Is):
        left, right = node.left, node.comparators[0]
        if isinstance(left, ast.Call) and isinstance(left.func, ast.Name) and left.func.id == "type" and left.args:
            if isinstance(right, ast.Name):
                return right.id
        if isinstance(right, ast.Call) and isinstance(right.func, ast.Name) and right.func.id == "type" and right.args:
            if isinstance(left, ast.Name):
                return left.id
    return None


def _handler_is_silent(handler):
    """except 处理体是否是"什么都不做"（pass / ... / continue）。"""
    body = handler.body
    if not body:
        return True
    for item in body:
        if isinstance(item, ast.Pass):
            continue
        if isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant) and item.value.value is Ellipsis:
            continue
        if isinstance(item, ast.Continue):
            continue
        return False
    return True


def _handler_is_broad(handler):
    """是否捕获了过宽的异常类型（裸 except / Exception / BaseException）。"""
    if handler.type is None:
        return True
    types = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    for item in types:
        if isinstance(item, ast.Name) and item.id in {"Exception", "BaseException"}:
            return True
    return False


def evaluate(result):
    """对一次 `analyze()` 结果补充评估，返回额外 findings 与口径说明。

    返回 `{"findings": [...], "metrics": {...}, "notes": [...]}`；
    finding 的结构与 `engine.findings` 完全一致（含 rule_id/severity/file/line/
    message/suggestion/evidence_type/actual/threshold/confidence），只是没有 `id`——
    合并时由 `merge()` 统一重编号，保证全文 id 唯一且稳定。
    """
    if not isinstance(result, dict):
        raise ValueError("补充规则需要 analyze() 的结果对象")
    trees = _parse_files(result)
    nodes = _definition_nodes(trees)
    findings = []
    metrics = {"classes": 0, "functions": 0, "type_branches": 0, "concrete_deps": 0,
               "dead_functions": 0, "silent_handlers": 0}

    # 内部定义的具体类名 → 全限定 id，用于 DIP-01 判定"构造的是不是本项目里的类"。
    internal_classes = {}
    for cls in result.get("classes") or []:
        name = cls.get("name")
        ident = cls.get("id")
        if isinstance(name, str) and isinstance(ident, str):
            internal_classes.setdefault(name, []).append(ident)

    def add(rule, severity, file, line, message, suggestion, actual=None, threshold=None, confidence=None):
        if len(findings) >= MAX_EXTRA_FINDINGS:
            return
        findings.append({"rule_id": rule, "severity": severity, "file": file, "line": line,
                         "message": message, "suggestion": suggestion, "evidence_type": "fact",
                         "actual": actual, "threshold": threshold, "confidence": confidence})

    # ---- SRP-01 / OCP-01 / DIP-01：逐类 ---------------------------------
    for cls in result.get("classes") or []:
        ident = cls.get("id")
        path = cls.get("file")
        line = cls.get("line")
        node = nodes.get((path, line))
        if node is None or not isinstance(node, ast.ClassDef):
            continue
        metrics["classes"] += 1
        methods = [item for item in node.body
                   if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))]
        public = [item for item in methods if not item.name.startswith(DUNDER)]
        if len(public) > MAX_METHODS_PER_CLASS:
            add("SRP-01", "info", path, line,
                "类 {} 定义了 {} 个公开方法，超过口径 {}；方法数多不等于违反单一职责，但值得确认它是否只承担一件事。".format(
                    cls.get("name"), len(public), MAX_METHODS_PER_CLASS),
                "按「数据 + 行为」切分：把操作同一组字段的方法聚成一个类，其余迁出。",
                actual=len(public), threshold=MAX_METHODS_PER_CLASS, confidence="medium")

        type_names, constructed = set(), set()
        for method in methods:
            for item in _body_walk(method):
                if isinstance(item, ast.Call) and isinstance(item.func, ast.Name):
                    if item.func.id in internal_classes:
                        constructed.add(item.func.id)
                name = _is_type_test(item)
                if name:
                    type_names.add(name)
        metrics["type_branches"] += len(type_names)
        metrics["concrete_deps"] += len(constructed)
        if len(type_names) >= MAX_TYPE_BRANCHES:
            add("OCP-01", "info", path, line,
                "类 {} 的方法里用 {} 种类型判断（{}）做分派，新增一种类型就要改这里。".format(
                    cls.get("name"), len(type_names), "、".join(sorted(type_names)[:6])),
                "如果这些分支的行为彼此独立，考虑把差异下沉到各自类型的多态实现；数量少时条件分派更容易读，不必强改。",
                actual=len(type_names), threshold=MAX_TYPE_BRANCHES, confidence="low")
        if len(constructed) >= MAX_CONCRETE_DEPS:
            add("DIP-01", "info", path, line,
                "类 {} 直接构造了 {} 个本项目内的具体类（{}），依赖写在方法体里而不是构造参数里。".format(
                    cls.get("name"), len(constructed), "、".join(sorted(constructed)[:6])),
                "核对这几处构造是否需要可替换：需要就把协作对象改为由调用方传入。无需替换时直接构造是更简单的选择。",
                actual=len(constructed), threshold=MAX_CONCRETE_DEPS, confidence="low")

    # ---- A5-DEAD：未被本次分析内任何已解析调用指向的函数 ---------------
    calls = (result.get("graph") or {}).get("calls") or []
    called = {call.get("target") for call in calls
              if call.get("status") == "resolved" and call.get("target")}
    # 未解析的调用虽然给不出目标符号，但它的表达式末段仍是"可能有人在调我"的线索。
    # 这里用它做保守豁免：宁可漏报一条死代码，也不要凭空断言一个函数没人用。
    hinted = set()
    for call in calls:
        if call.get("status") == "resolved":
            continue
        expression = call.get("expression")
        if isinstance(expression, str) and expression:
            hinted.add(expression.rsplit(".", 1)[-1])
    for fn in result.get("functions") or []:
        ident = fn.get("id")
        name = fn.get("name")
        if not isinstance(ident, str) or not isinstance(name, str):
            continue
        metrics["functions"] += 1
        if name.startswith("_") or name in ENTRY_NAMES or name.startswith("test"):
            continue
        if ident in called or name in hinted:
            continue
        metrics["dead_functions"] += 1
        add("A5-DEAD", "info", fn.get("file"), fn.get("line"),
            "函数 {} 在本次分析范围内没有任何已解析的调用点。外部调用、反射调用或测试调用都可能漏计，因此这只是一条线索。".format(name),
            "确认它是否由框架、命令行或外部模块调用；确认无人使用后再删除。",
            actual=0, threshold=1, confidence="low")

    # ---- A8-DEFENSIVE：吞掉异常的处理分支 ------------------------------
    for path, tree in trees.items():
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Try, ast.TryStar)):
                continue
            for handler in node.handlers:
                if not (_handler_is_broad(handler) and _handler_is_silent(handler)):
                    continue
                metrics["silent_handlers"] += 1
                add("A8-DEFENSIVE", "warning", path, handler.lineno,
                    "这里捕获了过宽的异常并且处理体什么都不做，失败会被静默吞掉。",
                    "至少记录日志或缩小捕获类型；确实可忽略时在注释里写明为什么可忽略。",
                    actual="silent-broad-except", threshold=None, confidence="medium")

    return {"findings": findings, "metrics": metrics, "notes": list(NOTES)}


ORDER = {"critical": 0, "warning": 1, "info": 2}


def merge(base, extra):
    """把补充 findings 并入 engine 的 findings，重新排序并统一编号。

    engine 用 `finding-N` 顺序编号，补充规则要接在后面重编，否则 `finding:<id>`
    这个证据引用会指向两条不同的记录——那会让「每条结论都能追溯到事实」失效。

    `base` 可以传 `analyze()` 的整个返回值（此时返回同样形状的浅拷贝，只替换
    findings），也可以只传 findings 列表（此时返回新的列表）；`extra` 同理，可以
    传 `evaluate()` 的返回值或其中的 findings 列表。
    """
    extra_rows = extra.get("findings") if isinstance(extra, dict) else extra
    holder = dict(base) if isinstance(base, dict) else None
    base_rows = (holder.get("findings") if holder is not None else base) or []
    combined = [dict(item) for item in base_rows] + [dict(item) for item in (extra_rows or [])]
    for item in combined:
        item.pop("id", None)
    combined.sort(key=lambda item: (ORDER.get(item.get("severity"), 9),
                                    item.get("file") or "", item.get("line") or 0,
                                    item.get("rule_id") or ""))
    for index, item in enumerate(combined):
        item["id"] = "finding-" + str(index + 1)
    if holder is None:
        return combined
    holder["findings"] = combined
    return holder
