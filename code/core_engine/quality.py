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


def _import_prefix(record, item):
    if not item.level:
        return item.module or ""
    package = record["module"].split(".")
    if not record["path"][:-3].endswith("/__init__"):
        package = package[:-1]
    parts = package[:len(package) - item.level + 1] if item.level <= len(package) + 1 else []
    return ".".join(parts + ([item.module] if item.module else []))


def _module_alias(alias):
    if alias.asname:
        return alias.asname, alias.name
    head = alias.name.split(".")[0]
    return head, head


def _imported_symbols(record, statement):
    prefix = _import_prefix(record, statement)
    return ((alias.asname or alias.name, prefix + "." + alias.name) for alias in statement.names)


def _collect_aliases(result, trees, cls):
    """Build a short-name -> qualified-name map for one class's module imports."""
    aliases = {}
    record = next(r for r in result["files"] if r["path"] == cls["file"])
    for item in trees[cls["file"]].body:
        if isinstance(item, ast.Import):
            aliases.update(_module_alias(alias) for alias in item.names)
        elif isinstance(item, ast.ImportFrom):
            aliases.update(_imported_symbols(record, item))
    return aliases


def _methods_in(node):
    return (item for item in node.body if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)))


def _constructor_of(value, constructors):
    if isinstance(value, ast.Call):
        return constructors.get((value.lineno, ast.unparse(value.func)))
    return None


def _self_field(target):
    return isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == "self"


def _composition_target(item, constructors):
    if not isinstance(item, (ast.Assign, ast.AnnAssign)):
        return None
    target = _constructor_of(item.value, constructors)
    targets = item.targets if isinstance(item, ast.Assign) else [item.target]
    return target if target is not None and any(map(_self_field, targets)) else None


def _emit_call_relations(cls, node, constructors, relation):
    """Emit dependency/composition edges from method bodies."""
    for method in _methods_in(node):
        for item in own_walk(method):
            target = _constructor_of(item, constructors)
            if target is not None:
                relation(cls["id"], target, "dependency", cls["file"], item.lineno)
            if method.name == "__init__":
                target = _composition_target(item, constructors)
                if target is not None:
                    relation(cls["id"], target, "composition", cls["file"], item.lineno)


def _annotations_of(item, methods):
    if isinstance(item, ast.AnnAssign):
        return "association", [item.annotation]
    if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) or item.lineno not in methods:
        return "dependency", ()
    args = item.args.posonlyargs + item.args.args + item.args.kwonlyargs
    annotations = [arg.annotation for arg in args if arg.annotation]
    if item.returns:
        annotations.append(item.returns)
    return "dependency", annotations


def _emit_annotation_relations(cls, node, methods, aliases, classes, relation):
    """Emit association/dependency edges from type annotations."""
    annotation_nodes = list(node.body)
    for method in _methods_in(node):
        annotation_nodes.extend(own_walk(method))
    for item in annotation_nodes:
        kind, annotations = _annotations_of(item, methods)
        for annotation in annotations:
            for target in _annotation_targets(annotation, aliases, classes):
                relation(cls["id"], target, kind, cls["file"], item.lineno)


def _resolved_constructors(graph, methods, classes):
    method_ids = set(methods.values())
    return {(c["line"], c.get("expression")): c["target"] for c in graph.get("calls", [])
                    if c.get("source") in method_ids and c.get("target") in classes and c.get("status") == "resolved"}


def _collect_class_relations(result, cls, classes, functions, nodes, trees, graph, relation):
    """Emit dependency/composition/association edges for one class."""
    node = nodes.get((cls["file"], cls["line"]))
    if not node:
        return
    methods = {functions[m]["line"]: m for m in cls.get("methods", []) if m in functions}
    constructors = _resolved_constructors(graph, methods, classes)
    _emit_call_relations(cls, node, constructors, relation)

    aliases = _collect_aliases(result, trees, cls)
    for other in classes.values():
        if other["file"] == cls["file"]:
            aliases.setdefault(other["name"], other["id"])
    _emit_annotation_relations(cls, node, methods, aliases, classes, relation)


def _depth(ident, visited, classes, parents):
    if ident in visited:
        return None
    cls = classes[ident]
    if len(cls.get("bases") or []) != len(parents.get(ident, set())):
        return None
    values = [_depth(p, visited | {ident}, classes, parents) for p in parents.get(ident, set())]
    return None if any(v is None for v in values) else 1 + max(values) if values else 0


def _instance_fields(method, method_names):
    args = method.args.posonlyargs + method.args.args
    receiver = args[0].arg if args else None
    return {
        node.attr for node in own_walk(method)
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
        and node.value.id == receiver and node.attr not in method_names
    }


def _cohesion(cls, methods, nodes):
    method_names = {method["name"] for method in methods}
    fields = []
    for entry in methods:
        method = nodes.get((cls["file"], entry["line"]))
        if not method or any(isinstance(d, ast.Name) and d.id in {"staticmethod", "classmethod"} for d in method.decorator_list):
            continue
        fields.append(_instance_fields(method, method_names))
    shared = sum(bool(a & b) for a, b in combinations(fields, 2))
    pairs = len(fields) * (len(fields) - 1) // 2
    return max(0, pairs - 2 * shared)


def _coupling(ident, relations):
    coupled = {e["target"] for e in relations if e["source"] == ident} | {e["source"] for e in relations if e["target"] == ident}
    return len(coupled - {ident})


def _class_metrics(ident, cls, functions, nodes, relations):
    methods = [functions[m] for m in cls.get("methods", []) if m in functions]
    return {"id": ident, "file": cls["file"], "line": cls["line"],
            "wmc": sum(method.get("cc", 1) for method in methods),
            "cbo": _coupling(ident, relations), "lcom": _cohesion(cls, methods, nodes)}


def _fingerprint(node):
    body = node.body[1:] if ast.get_docstring(node, clean=False) is not None else node.body
    if sum(isinstance(n, ast.stmt) for statement in body for n in ast.walk(statement)) < 4:
        return None
    return hashlib.sha256("\n".join(ast.dump(n, include_attributes=False) for n in body).encode()).hexdigest()


def _detect_clones(functions, nodes):
    clones = {}
    for ident, fn in sorted(functions.items()):
        node = nodes.get((fn["file"], fn["line"]))
        if node is None:
            continue
        digest = _fingerprint(node)
        if digest is None:
            continue
        clones.setdefault(digest, []).append({"id": ident, "file": fn["file"], "line": fn["line"], "end_line": fn["end_line"]})
    return [{"fingerprint": key, "occurrences": rows} for key, rows in sorted(clones.items()) if len(rows) > 1]


def _index_trees(result):
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


def _project_class_metrics(classes, functions, nodes, relations, parents):
    metrics = []
    for ident, cls in sorted(classes.items()):
        metrics.append(_class_metrics(ident, cls, functions, nodes, relations))
        metrics[-1]["dit"] = _depth(ident, set(), classes, parents)
    return metrics


def apply(result):
    classes = {c["id"]: c for c in result.get("classes", [])}
    functions = {f["id"]: f for f in result.get("functions", [])}
    nodes, trees = _index_trees(result)
    graph = dict(result.get("graph") or {})
    parents = {}
    for edge in graph.get("inheritance", []):
        parents.setdefault(edge["source"], set()).add(edge["target"])
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

    metrics = _project_class_metrics(classes, functions, nodes, relations, parents)
    duplicate_groups = _detect_clones(functions, nodes)
    findings = _clone_findings(result, duplicate_groups)
    graph["class_relations"] = sorted(relations, key=lambda e: (e["source"], e["target"], e["kind"], e["line"]))
    return {**result, "graph": graph, "class_metrics": metrics, "duplicates": duplicate_groups,
            "quality_notes": list(NOTES), "findings": findings,
            "summary": {**result["summary"], "findings": len(findings)},
            "config": {**result["config"], "rules": list(result["config"]["rules"]) + ["DUP-01"]}}


def _clone_findings(result, duplicate_groups):
    findings = [dict(f) for f in result.get("findings", [])]
    for group in duplicate_groups:
        first, *others = group["occurrences"]
        for duplicate in others:
            findings.append({"rule_id": "DUP-01", "severity": "info", "file": duplicate["file"], "line": duplicate["line"],
                             "message": "函数体与 {}:{} 的 AST 结构相同，建议复核是否需要提取复用。".format(first["file"], first["line"]),
                             "suggestion": "核对职责和变化原因；仅在需要同步维护时提取公共实现。",
                             "evidence_type": "fact", "actual": len(group["occurrences"]), "threshold": 1,
                             "confidence": "high", "related": [first]})
    for i, finding in enumerate(findings, 1):
        finding["id"] = "finding-" + str(i)
    return findings
