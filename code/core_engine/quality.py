"""Reproducible class metrics, exact AST clones and evidenced class relations."""
import ast
import hashlib
from itertools import combinations
from .engine import own_walk

NOTES = [
    "WMC 为直接定义方法的圈复杂度之和；DIT 为已解析继承图的最长路径（外部父类深度未知）。",
    "CBO 为已解析的继承、构造、注解关系涉及的其他类数；动态类型依赖不计入。",
    "LCOM1=max(0,不共享实例字段的方法对数−共享字段的方法对数)，排除静态/类方法；属于结构指标。",
    "重复检测为至少 4 条 AST 语句的函数体结构完全相同（忽略位置、函数签名与文档字符串，保留变量名/字面量）；不覆盖语义等价实现。",
    "组合仅指构造器中 self 字段直接接收已解析类的构造结果；注解字段视为关联，其他构造/方法注解视为依赖。关系均需设计复核。",
]


def _annotation_targets(annotation, aliases, classes):
    """Resolve a type annotation to class ids it references in this project."""
    if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
        try:
            annotation = ast.parse(annotation.value, mode="eval").body
        except SyntaxError:
            return set()
    found = set()
    for part in ast.walk(annotation):
        if not isinstance(part, (ast.Name, ast.Attribute)):
            continue
        name = ast.unparse(part)
        head, _, tail = name.partition(".")
        target = aliases.get(head, head) + ("." + tail if tail else "")
        if target in classes:
            found.add(target)
    return found


def _import_aliases(item, aliases):
    """`import x.y[ as z]`：短名（asname 或首段）-> 完整名或首段。"""
    for a in item.names:
        aliases[a.asname or a.name.split(".")[0]] = a.name if a.asname else a.name.split(".")[0]


def _from_package(record, item):
    """`from` 导入的基准前缀：相对导入按所在包回退，绝对导入为 module 或空。"""
    if not item.level:
        return item.module or ""
    package = record["module"].split(".") if record["path"].endswith("/__init__.py") else record["module"].split(".")[:-1]
    remove = item.level - 1
    package = package[:len(package) - remove] if remove <= len(package) else []
    return ".".join(package + ([item.module] if item.module else []))


def _import_from_aliases(item, record, aliases):
    prefix = _from_package(record, item)
    for a in item.names:
        aliases[a.asname or a.name] = prefix + "." + a.name


def _collect_aliases(result, trees, cls):
    """Build a short-name -> qualified-name map for one class's module imports."""
    aliases = {}
    record = next(r for r in result["files"] if r["path"] == cls["file"])
    for item in trees[cls["file"]].body:
        if isinstance(item, ast.Import):
            _import_aliases(item, aliases)
        elif isinstance(item, ast.ImportFrom):
            _import_from_aliases(item, record, aliases)
    return aliases


def _constructor_key(call):
    return (call.lineno, ast.unparse(call.func))


def _self_targeted(targets):
    return any(isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self"
               for t in targets)


def _emit_init_composition(cls, item, constructors, relation):
    """`__init__` 中 self 字段直接接收已解析类构造结果 -> 组合。"""
    value = item.value
    if not isinstance(value, ast.Call):
        return
    key = _constructor_key(value)
    if key not in constructors:
        return
    targets = item.targets if isinstance(item, ast.Assign) else [item.target]
    if _self_targeted(targets):
        relation(cls["id"], constructors[key], "composition", cls["file"], item.lineno)


def _emit_method_relations(cls, method, constructors, relation):
    """一个方法体内：构造调用 -> 依赖；`__init__` 赋值 -> 组合。"""
    ident = cls["id"]
    for item in own_walk(method):
        if isinstance(item, ast.Call) and _constructor_key(item) in constructors:
            relation(ident, constructors[_constructor_key(item)], "dependency", cls["file"], item.lineno)
        if method.name == "__init__" and isinstance(item, (ast.Assign, ast.AnnAssign)):
            _emit_init_composition(cls, item, constructors, relation)


def _emit_call_relations(cls, node, constructors, relation):
    """Emit dependency/composition edges from method bodies."""
    for method in (m for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))):
        _emit_method_relations(cls, method, constructors, relation)


def _annotation_scopes(node):
    """类体节点加上各方法体内部节点，作为注解的扫描范围。"""
    scopes = list(node.body)
    for m in node.body:
        if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
            scopes.extend(own_walk(m))
    return scopes


def _function_annotations(item):
    annotations = [a.annotation for a in item.args.posonlyargs + item.args.args + item.args.kwonlyargs if a.annotation]
    if item.returns:
        annotations.append(item.returns)
    return annotations


def _emit_annotation_relations(cls, node, methods, aliases, classes, relation):
    """Emit association/dependency edges from type annotations."""
    ident = cls["id"]
    for item in _annotation_scopes(node):
        if isinstance(item, ast.AnnAssign):
            for target in _annotation_targets(item.annotation, aliases, classes):
                relation(ident, target, "association", cls["file"], item.lineno)
        elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.lineno in methods:
            for annotation in _function_annotations(item):
                for target in _annotation_targets(annotation, aliases, classes):
                    relation(ident, target, "dependency", cls["file"], item.lineno)


def _collect_class_relations(result, cls, classes, functions, nodes, trees, graph, relation):
    """Emit dependency/composition/association edges for one class."""
    node = nodes.get((cls["file"], cls["line"]))
    if not node:
        return
    methods = {functions[m]["line"]: m for m in cls.get("methods", []) if m in functions}
    constructors = {(c["line"], c.get("expression")): c["target"] for c in graph.get("calls", [])
                    if c.get("source") in methods.values() and c.get("target") in classes and c.get("status") == "resolved"}
    _emit_call_relations(cls, node, constructors, relation)

    aliases = _collect_aliases(result, trees, cls)
    for other in classes.values():
        if other["file"] == cls["file"]:
            aliases.setdefault(other["name"], other["id"])
    _emit_annotation_relations(cls, node, methods, aliases, classes, relation)


def _depth(ident, visited, classes, parents):
    """已解析继承图的最长路径；基类信息不全（外部父类）返回 None。"""
    if ident in visited:
        return None
    cls = classes[ident]
    if len(cls.get("bases") or []) != len(parents.get(ident, set())):
        return None
    values = [_depth(p, visited | {ident}, classes, parents) for p in parents.get(ident, set())]
    if any(v is None for v in values):
        return None
    if not values:
        return 0
    return 1 + max(values)


def _is_plain_method(method):
    return not any(isinstance(d, ast.Name) and d.id in {"staticmethod", "classmethod"}
                   for d in method.decorator_list)


def _method_fields(method, receiver, method_names):
    """一个非静态方法引用的 self 字段集合（排除与同名方法重名的属性）。"""
    return {n.attr for n in own_walk(method)
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)
            and n.value.id == receiver and n.attr not in method_names}


def _instance_fields(cls, method_ids, functions, nodes):
    fields = []
    method_names = {functions[mid]["name"] for mid in method_ids}
    for mid in method_ids:
        method = nodes.get((cls["file"], functions[mid]["line"]))
        if not method or not _is_plain_method(method):
            continue
        args = method.args.posonlyargs + method.args.args
        receiver = args[0].arg if args else None
        fields.append(_method_fields(method, receiver, method_names))
    return fields


def _coupled_classes(ident, relations):
    return ({e["target"] for e in relations if e["source"] == ident} |
            {e["source"] for e in relations if e["target"] == ident})


def _class_metrics(ident, cls, functions, nodes, relations):
    method_ids = [m for m in cls.get("methods", []) if m in functions]
    fields = _instance_fields(cls, method_ids, functions, nodes)
    shared = sum(bool(a & b) for a, b in combinations(fields, 2))
    pairs = len(fields) * (len(fields) - 1) // 2
    return {"id": ident, "file": cls["file"], "line": cls["line"],
            "wmc": sum(functions[m].get("cc", 1) for m in method_ids),
            "cbo": len(_coupled_classes(ident, relations) - {ident}),
            "lcom": max(0, pairs - 2 * shared)}


def _clone_body(node):
    """函数体去掉首行文档字符串（与 Python 路径的口径一致）。"""
    body = list(node.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body.pop(0)
    return body


def _body_digest(body):
    return hashlib.sha256("\n".join(ast.dump(n, include_attributes=False) for n in body).encode()).hexdigest()


def _detect_clones(functions, nodes):
    clones = {}
    for ident, fn in sorted(functions.items()):
        node = nodes.get((fn["file"], fn["line"]))
        if node is None:
            continue
        body = _clone_body(node)
        if sum(isinstance(n, ast.stmt) for statement in body for n in ast.walk(statement)) < 4:
            continue
        clones.setdefault(_body_digest(body), []).append(
            {"id": ident, "file": fn["file"], "line": fn["line"], "end_line": fn["end_line"]})
    return [{"fingerprint": key, "occurrences": rows} for key, rows in sorted(clones.items()) if len(rows) > 1]


def _index_nodes(result):
    """重新解析通过校验的源码：返回 (path->tree, (path, lineno)->节点)。"""
    nodes, trees = {}, {}
    for record in result.get("files", []):
        if record.get("status") != "ok":
            continue
        try:
            tree = ast.parse(record["source"], feature_version=(3, 11))
        except (SyntaxError, ValueError, RecursionError):
            continue
        trees[record["path"]] = tree
        for node in ast.walk(tree):
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                nodes[(record["path"], node.lineno)] = node
    return nodes, trees


def _inheritance_parents(graph):
    parents = {}
    for edge in graph.get("inheritance", []):
        parents.setdefault(edge["source"], set()).add(edge["target"])
    return parents


def _duplicate_findings(duplicate_groups):
    findings = []
    for group in duplicate_groups:
        first, *others = group["occurrences"]
        for duplicate in others:
            findings.append({"rule_id": "DUP-01", "severity": "info", "file": duplicate["file"], "line": duplicate["line"],
                             "message": "函数体与 {}:{} 的 AST 结构相同，建议复核是否需要提取复用。".format(first["file"], first["line"]),
                             "suggestion": "核对职责和变化原因；仅在需要同步维护时提取公共实现。",
                             "evidence_type": "fact", "actual": len(group["occurrences"]), "threshold": 1,
                             "confidence": "high", "related": [first]})
    return findings


def _class_metrics_all(classes, functions, nodes, relations, parents):
    metrics = []
    for ident, cls in sorted(classes.items()):
        entry = _class_metrics(ident, cls, functions, nodes, relations)
        entry["dit"] = _depth(ident, set(), classes, parents)
        metrics.append(entry)
    return metrics


def apply(result):
    classes = {c["id"]: c for c in result.get("classes", [])}
    functions = {f["id"]: f for f in result.get("functions", [])}
    nodes, trees = _index_nodes(result)
    graph = dict(result.get("graph") or {})
    parents = _inheritance_parents(graph)
    relations = [{**e, "kind": "inheritance"} for e in graph.get("inheritance", [])]
    relation_keys = {(e["source"], e["target"], e["kind"], e["line"]) for e in relations}

    def relation(source, target, kind, path, line):
        key = (source, target, kind, line)
        if source == target or key in relation_keys:
            return
        relation_keys.add(key)
        relations.append({"source": source, "target": target, "kind": kind,
                          "file": path, "line": line, "evidence_type": "inference"})

    for ident, cls in classes.items():
        _collect_class_relations(result, cls, classes, functions, nodes, trees, graph, relation)

    metrics = _class_metrics_all(classes, functions, nodes, relations, parents)
    duplicate_groups = _detect_clones(functions, nodes)
    findings = [dict(f) for f in result.get("findings", [])] + _duplicate_findings(duplicate_groups)
    for i, finding in enumerate(findings, 1):
        finding["id"] = "finding-" + str(i)
    graph["class_relations"] = sorted(relations, key=lambda e: (e["source"], e["target"], e["kind"], e["line"]))
    return {**result, "graph": graph, "class_metrics": metrics, "duplicates": duplicate_groups,
            "quality_notes": list(NOTES), "findings": findings,
            "summary": {**result["summary"], "findings": len(findings)},
            "config": {**result["config"], "rules": list(result["config"]["rules"]) + ["DUP-01"]}}
