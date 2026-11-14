"""Deterministic SOLID and supplementary risk rules, shared by both API paths."""
from __future__ import annotations

import ast

from . import solid
from . import levels

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
    *solid.LIMITATIONS,
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
        except (SyntaxError, ValueError, RecursionError):
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


def _type_name_of(second):
    """从 isinstance/type 的第二个参数提取唯一类型名；不是单一 Name 返回 None。"""
    if isinstance(second, ast.Name):
        return second.id
    if isinstance(second, ast.Tuple):
        names = [item.id for item in second.elts if isinstance(item, ast.Name)]
        return names[0] if len(names) == 1 else None
    return None


def _is_named_call(node, name):
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name


def _compared_type(left, right):
    if _is_named_call(left, "type") and left.args:
        return right.id if isinstance(right, ast.Name) else None
    if _is_named_call(right, "type") and right.args and isinstance(left, ast.Name):
        return left.id
    return None


def _is_type_test(node):
    """Recognize isinstance(x, T) and identity comparisons with type(x)."""
    if _is_named_call(node, "isinstance"):
        return _type_name_of(node.args[1]) if len(node.args) >= 2 else None
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Is):
        return _compared_type(node.left, node.comparators[0])
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


def _collect_type_names(methods):
    type_names = set()
    for method in methods:
        for item in _body_walk(method):
            name = _is_type_test(item)
            if name:
                type_names.add(name)
    return type_names


def _is_method_call(call, method_ids):
    return call.get("status") == "resolved" and call.get("source") in method_ids


def _collect_constructed(result, nodes, method_ids):
    classes = result.get("classes") or []
    calls = (result.get("graph") or {}).get("calls") or []
    targets = (call.get("target") for call in calls if _is_method_call(call, method_ids))
    return {target for target in targets if _is_concrete_class(target, classes, nodes)}


def _is_concrete_class(ident, classes, nodes):
    entry = next((cls for cls in classes if cls.get("id") == ident), None)
    if entry is None:
        return False
    return not _is_abstract_class(nodes.get((entry.get("file"), entry.get("line"))))


def _is_abstract_class(node):
    return node is not None and any(
        solid._abstract(item) for item in node.body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
    )


def _evaluate_classes(result, nodes, metrics, add):
    """SRP-01 / OCP-01 / DIP-01：逐类检查。"""
    for cls in result.get("classes") or []:
        path = cls.get("file")
        line = cls.get("line")
        node = nodes.get((path, line))
        if node is None or not isinstance(node, ast.ClassDef):
            continue
        metrics["classes"] += 1
        methods = [item for item in node.body
                   if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))]
        _evaluate_responsibility(cls, methods, add)
        type_names = _collect_type_names(methods)
        constructed = _collect_constructed(result, nodes, set(cls.get("methods") or []))
        metrics["type_branches"] += len(type_names)
        metrics["concrete_deps"] += len(constructed)
        _evaluate_design_dependencies(cls, type_names, constructed, add)


def _evaluate_responsibility(cls, methods, add):
    path, line = cls.get("file"), cls.get("line")
    public = [item for item in methods if not item.name.startswith("_")]
    if len(public) > MAX_METHODS_PER_CLASS:
        add(levels.RULE_SRP, levels.SEVERITY_INFO, path, line,
            "类 {} 定义了 {} 个公开方法，超过口径 {}；方法数多不等于违反单一职责，但值得确认它是否只承担一件事。".format(
                cls.get("name"), len(public), MAX_METHODS_PER_CLASS),
            "按「数据 + 行为」切分：把操作同一组字段的方法聚成一个类，其余迁出。",
            actual=len(public), threshold=MAX_METHODS_PER_CLASS, confidence=levels.CONFIDENCE_MEDIUM)




def _evaluate_design_dependencies(cls, type_names, constructed, add):
    path, line = cls.get("file"), cls.get("line")
    if len(type_names) >= MAX_TYPE_BRANCHES:
        add(levels.RULE_OCP, levels.SEVERITY_INFO, path, line,
            "类 {} 的方法里用 {} 种类型判断（{}）做分派，新增一种类型就要改这里。".format(
                cls.get("name"), len(type_names), "、".join(sorted(type_names)[:6])),
            "如果这些分支的行为彼此独立，考虑把差异下沉到各自类型的多态实现；数量少时条件分派更容易读，不必强改。",
            actual=len(type_names), threshold=MAX_TYPE_BRANCHES, confidence=levels.CONFIDENCE_LOW)
    if len(constructed) >= MAX_CONCRETE_DEPS:
        add(levels.RULE_DIP, levels.SEVERITY_INFO, path, line,
            "类 {} 直接构造了 {} 个本项目内的具体类（{}），依赖写在方法体里而不是构造参数里。".format(
                cls.get("name"), len(constructed), "、".join(sorted(constructed)[:6])),
            "核对这几处构造是否需要可替换：需要就把协作对象改为由调用方传入。无需替换时直接构造是更简单的选择。",
            actual=len(constructed), threshold=MAX_CONCRETE_DEPS, confidence=levels.CONFIDENCE_LOW)

def _call_references(calls):
    called = {call.get("target") for call in calls
              if call.get("status") == "resolved" and call.get("target")}
    # 未解析的调用虽然给不出目标符号，但它的表达式末段仍是"可能有人在调我"的线索。
    hinted = set()
    for call in calls:
        if call.get("status") == "resolved":
            continue
        expression = call.get("expression")
        if isinstance(expression, str) and expression:
            hinted.add(expression.rsplit(".", 1)[-1])
    return called, hinted


def _python_functions(functions):
    for fn in functions:
        ident = fn.get("id")
        name = fn.get("name")
        if not isinstance(ident, str) or not isinstance(name, str):
            continue
        # Non-Python dead code is judged by the language analyzer (private helpers
        # with no inbound call); this rule only understands Python call semantics.
        if not str(fn.get("file") or "").lower().endswith(".py"):
            continue
        yield fn, ident, name


def _is_entry_point(name):
    return name.startswith(("_", "test")) or name in ENTRY_NAMES


def _referenced_names(trees):
    """Collect loaded names and attribute references, including callbacks and properties."""
    return {path: set(_loaded_names(tree)) for path, tree in trees.items()}


def _loaded_names(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            yield node.id
        elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load):
            yield node.attr


def _is_http_handler(ident, name, handler_classes):
    owner = ident.rpartition(".")[0]
    return owner in handler_classes and (name.startswith("do_") or name == "log_message")


def _http_handler_classes(classes):
    handler_bases = {"BaseHTTPRequestHandler", "http.server.BaseHTTPRequestHandler"}
    return {entry["id"] for entry in classes if handler_bases.intersection(entry.get("bases") or ())}


def _has_usage_evidence(ident, name, names, hinted, handler_classes):
    return _is_entry_point(name) or name in names or name in hinted or _is_http_handler(ident, name, handler_classes)


def _evaluate_dead(result, trees, metrics, add):
    """A5-DEAD：未被本次分析内任何已解析调用指向的函数。"""
    calls = (result.get("graph") or {}).get("calls") or []
    called, hinted = _call_references(calls)
    referenced = _referenced_names(trees)
    handler_classes = _http_handler_classes(result.get("classes") or [])
    for fn, ident, name in _python_functions(result.get("functions") or []):
        metrics["functions"] += 1
        names = referenced.get(fn.get("file"), ())
        if ident in called or _has_usage_evidence(ident, name, names, hinted, handler_classes):
            continue
        metrics["dead_functions"] += 1
        add(levels.RULE_A5_DEAD, levels.SEVERITY_INFO, fn.get("file"), fn.get("line"),
            "函数 {} 在本次分析范围内没有任何已解析的调用点。外部调用、反射调用或测试调用都可能漏计，因此这只是一条线索。".format(name),
            "确认它是否由框架、命令行或外部模块调用；确认无人使用后再删除。",
            actual=0, threshold=1, confidence=levels.CONFIDENCE_LOW)


def _evaluate_handlers(trees, metrics, add):
    """A8-DEFENSIVE：吞掉异常的处理分支。"""
    for path, tree in trees.items():
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Try, ast.TryStar)):
                continue
            for handler in node.handlers:
                if not (_handler_is_broad(handler) and _handler_is_silent(handler)):
                    continue
                metrics["silent_handlers"] += 1
                add(levels.RULE_A8_DEFENSIVE, levels.SEVERITY_WARNING, path, handler.lineno,
                    "这里捕获了过宽的异常并且处理体什么都不做，失败会被静默吞掉。",
                    "至少记录日志或缩小捕获类型；确实可忽略时在注释里写明为什么可忽略。",
                    actual="silent-broad-except", threshold=None, confidence=levels.CONFIDENCE_MEDIUM)


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

    def add(rule, severity, file, line, message, suggestion, actual=None, threshold=None, confidence=None):
        if len(findings) >= MAX_EXTRA_FINDINGS:
            return
        findings.append({"rule_id": rule, "severity": severity, "file": file, "line": line,
                         "message": message, "suggestion": suggestion, "evidence_type": levels.EVIDENCE_FACT,
                         "actual": actual, "threshold": threshold, "confidence": confidence})
        if rule in solid.RULE_IDS:
            findings[-1]["evidence_type"] = levels.EVIDENCE_INFERENCE

    _evaluate_classes(result, nodes, metrics, add)

    solid_result = solid.evaluate(result, nodes)
    for item in solid_result["findings"]:
        if len(findings) < MAX_EXTRA_FINDINGS:
            findings.append(item)
    metrics["checked_overrides"] = solid_result["checked_overrides"]

    _evaluate_dead(result, trees, metrics, add)
    _evaluate_handlers(trees, metrics, add)

    return {"findings": findings, "metrics": metrics, "notes": list(NOTES),
            "solid": {"rules": list(solid.RULE_IDS),
                      "checked_overrides": solid_result["checked_overrides"],
                      "coverage_gaps": solid_result["coverage_gaps"],
                      "limitations": solid_result["limitations"],
                      "truncated": len(findings) >= MAX_EXTRA_FINDINGS}}


ORDER = {levels.SEVERITY_CRITICAL: 0, levels.SEVERITY_WARNING: 1, levels.SEVERITY_INFO: 2}


def merge(base, extra):
    """把补充 findings 并入 engine 的 findings，重新排序并统一编号。

    engine 用 `finding-N` 顺序编号，补充规则要接在后面重编，否则 `finding:<id>`
    这个证据引用会指向两条不同的记录——那会让「每条结论都能追溯到事实」失效。

    `base` 可以传 `analyze()` 的整个返回值（此时返回同样形状的浅拷贝，只替换
    findings），也可以只传 findings 列表（此时返回新的列表）；`extra` 同理，可以
    传 `evaluate()` 的返回值或其中的 findings 列表。
    """
    extra_rows = extra.get("findings") if isinstance(extra, dict) else extra
    if not isinstance(base, dict):
        return _sorted_findings(base or [], extra_rows or [])
    combined = _sorted_findings(base.get("findings") or [], extra_rows or [])
    return _with_findings(base, extra, combined)


def _with_findings(base, extra, combined):
    holder = {**base, "findings": combined}
    if isinstance(holder.get("summary"), dict):
        holder["summary"] = {**holder["summary"], "findings": len(combined)}
    if isinstance(extra, dict) and "solid" in extra:
        holder["solid"] = extra["solid"]
    return holder


def _sorted_findings(base_rows, extra_rows):
    combined = [dict(item) for item in base_rows] + [dict(item) for item in extra_rows]
    for item in combined:
        item.pop("id", None)
    combined.sort(key=lambda item: (ORDER.get(item.get("severity"), 9),
                                    item.get("file") or "", item.get("line") or 0,
                                    item.get("rule_id") or ""))
    for index, item in enumerate(combined):
        item["id"] = "finding-" + str(index + 1)
    return combined
