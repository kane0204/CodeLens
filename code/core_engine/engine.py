"""CodeLens local, deterministic AST analysis. Never imports or executes input code."""
from __future__ import annotations

import ast
import base64
import hashlib
import io
import json
import re
import tokenize
from pathlib import PurePosixPath

VERSION = "0.2.0"
EXCLUDED = {".git", ".venv", "venv", "__pycache__", "node_modules", "build", "dist", "tests"}
MAX_FILES = 200
MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024
RULES = ["CC-01", "LEN-01", "DEPTH-01", "A4", "A3-IO", "CYCLE-01"]
LIMITATIONS = [
    "仅解析 Python 3.11 语法；不执行、不导入被分析源码。",
    "调用解析仅覆盖唯一绑定的函数、类与显式导入；动态调用、实例类型、多态及 super 不作确定还原。",
    "CC 使用已公开的 AST 判定计数口径，尚未完成与 radon 的全量对拍。",
    "A3-IO 仅检查内置 open 的局部 OSError 捕获；上层异常处理需人工复核。",
    "A4 仅检查敏感变量名与非占位字符串赋值；不验证凭据有效性，不能覆盖所有敏感信息。",
    "未实现完整 CFG、def-use、时序图、SOLID、重复代码、死代码及综合健康度评分。",
]


def normalized_path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError("无效的文件路径")
    value = value.replace("\\", "/")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or ":" in value or "\x00" in value:
        raise ValueError("文件路径必须为项目内的相对路径")
    return str(path)


def module_name(path):
    value = path[:-3].replace("/", ".")
    return value[:-9] if value.endswith(".__init__") else value


def own_walk(node):
    """Walk a function body, excluding nested definitions (separate metrics)."""
    stack = list(reversed(node.body))
    while stack:
        item = stack.pop()
        yield item
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        stack.extend(reversed(list(ast.iter_child_nodes(item))))


def complexity(node):
    count = 1
    for item in own_walk(node):
        if isinstance(item, (ast.If, ast.IfExp, ast.Assert)):
            count += 1
        elif isinstance(item, (ast.For, ast.AsyncFor, ast.While)):
            count += 1 + bool(item.orelse)
        elif isinstance(item, (ast.Try, ast.TryStar)):
            count += len(item.handlers) + bool(item.orelse)
        elif isinstance(item, ast.BoolOp):
            count += len(item.values) - 1
        elif isinstance(item, ast.comprehension):
            count += 1 + len(item.ifs)
        elif isinstance(item, ast.Match):
            count += sum(not (isinstance(c.pattern, ast.MatchAs) and c.pattern.pattern is None)
                         for c in item.cases)
    return count


def nesting(node):
    def walk(item, depth):
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            return depth
        extra = isinstance(item, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.TryStar,
                                  ast.With, ast.AsyncWith, ast.Match))
        return max([depth + extra] + [walk(c, depth + extra) for c in ast.iter_child_nodes(item)])
    return max([0] + [walk(n, 0) for n in node.body])


def rank(cc):
    return next((name for bound, name in [(5, "A"), (10, "B"), (20, "C"), (30, "D"), (40, "E")]
                 if cc <= bound), "F")


def code_line_numbers(source):
    """Physical code lines, excluding blank/comment/docstring-only lines."""
    lines = set()
    try:
        for t in tokenize.generate_tokens(io.StringIO(source).readline):
            if t.type not in {tokenize.ENCODING, tokenize.ENDMARKER, tokenize.NL, tokenize.NEWLINE,
                              tokenize.INDENT, tokenize.DEDENT, tokenize.COMMENT}:
                lines.update(range(t.start[0], t.end[0] + 1))
    except (tokenize.TokenError, IndentationError):
        pass
    return lines


def target_name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return target_name(node.value) + "." + node.attr
    if isinstance(node, (ast.Tuple, ast.List)):
        return ", ".join(target_name(n) for n in node.elts)
    return "表达式"


def statement_description(node):
    # No string values in summaries or exported reports.
    if isinstance(node, ast.Assign):
        return "赋值：" + ", ".join(target_name(n) for n in node.targets)
    if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        return "更新变量：" + target_name(node.target)
    if isinstance(node, ast.Return):
        return "返回结果" if node.value is not None else "返回 None"
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        return "调用：" + target_name(node.value.func)
    return {"If": "判断条件并选择分支", "For": "遍历并执行循环体", "AsyncFor": "异步遍历",
            "While": "条件循环", "Try": "进入异常处理区域", "TryStar": "进入异常组处理区域",
            "With": "进入资源管理区域", "AsyncWith": "进入异步资源管理区域",
            "Raise": "抛出异常", "Break": "退出当前循环", "Continue": "进入下一次循环",
            "Import": "导入模块（静态记录，不实际导入）", "ImportFrom": "从模块导入符号",
            "FunctionDef": "定义内层函数：" + getattr(node, "name", ""),
            "AsyncFunctionDef": "定义内层异步函数：" + getattr(node, "name", ""),
            "ClassDef": "定义内层类：" + getattr(node, "name", ""),
            "Assert": "验证断言", "Pass": "空操作", "Delete": "删除绑定",
            "Match": "匹配模式分支", "Global": "声明全局名称", "Nonlocal": "声明外层名称"
            }.get(type(node).__name__, "执行 " + type(node).__name__ + " 语句")


def cycles_of(nodes, edges):
    graph = {n: set() for n in nodes}
    for a, b in edges:
        graph[a].add(b)
    index, low, stack, active, result = {}, {}, [], set(), []
    def visit(v):
        index[v] = low[v] = len(index)
        stack.append(v)
        active.add(v)
        for w in sorted(graph[v]):
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in active:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            group = []
            while True:
                w = stack.pop()
                active.remove(w)
                group.append(w)
                if w == v:
                    break
            if len(group) > 1 or v in graph[v]:
                result.append(sorted(group))
    for n in sorted(nodes):
        if n not in index:
            visit(n)
    return sorted(result)


def analyze(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("files"), list):
        raise ValueError("请求必须包含 files 列表")
    if len(payload["files"]) > MAX_FILES:
        raise ValueError(f"最多分析 {MAX_FILES} 个 Python 文件，请缩小目录范围")
    project = str(payload.get("project", "Python 项目"))[:120]
    records, total, seen, excluded_count = [], 0, set(), 0
    for item in payload["files"]:
        if not isinstance(item, dict):
            raise ValueError("文件记录无效")
        path = normalized_path(item.get("path"))
        if not path.endswith(".py") or any(p in EXCLUDED for p in PurePosixPath(path).parts[:-1]):
            excluded_count += 1
            continue
        if path in seen:
            raise ValueError("存在重复的文件路径")
        seen.add(path)
        record = {"path": path, "module": module_name(path), "source": "", "status": "error",
                  "functions": [], "classes": [], "line_count": 0, "code_lines": 0}
        try:
            if "content_base64" in item:
                raw = base64.b64decode(item["content_base64"], validate=True)
            elif isinstance(item.get("content"), str):
                raw = item["content"].encode("utf-8")
            else:
                raise ValueError("文件缺少源码内容")
            if len(raw) > MAX_FILE_BYTES:
                raise ValueError("文件超过 1 MB")
            total += len(raw)
            record["sha256"] = hashlib.sha256(raw).hexdigest()
            encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
            record["source"] = raw.decode(encoding)
            record["line_count"] = len(record["source"].splitlines())
        except (ValueError, UnicodeError, SyntaxError, LookupError) as exc:
            record["error"] = {"file": path, "line": None, "type": type(exc).__name__,
                               "message": "读取或编码失败；请检查文件编码及大小"}
        records.append(record)
    if total > MAX_TOTAL_BYTES:
        raise ValueError("源码总量超过 8 MB，请缩小目录范围")
    records.sort(key=lambda r: r["path"])
    trees, definitions, bindings, scope_parent, imports = {}, {}, {}, {}, []
    definition_nodes, owner_scope, parents = {}, {}, {}
    findings, warnings = [], []
    module_paths = {}
    for r in records:
        if r["module"] in module_paths:
            raise ValueError("同时存在同名模块文件和包目录，无法唯一识别，请缩小分析范围")
        module_paths[r["module"]] = r["path"]

    def finding(rule, severity, file, line, message, suggestion, evidence="fact", actual=None,
                threshold=None, confidence=None):
        findings.append(dict(rule_id=rule, severity=severity, file=file, line=line,
                             message=message, suggestion=suggestion, evidence_type=evidence,
                             actual=actual, threshold=threshold, confidence=confidence))

    def bind(scope, name, value):
        # Multiple bindings are conservatively ambiguous, even if one shadows an import later.
        table = bindings.setdefault(scope, {})
        table[name] = value if name not in table else None

    def import_base(n, record):
        if not isinstance(n, ast.ImportFrom):
            return ""
        if not n.level:
            return n.module or ""
        # A selected package root is represented without a synthetic directory prefix.
        if "__init__.py" in seen and "/" not in record["path"] and n.level == 1:
            return n.module or ""
        package = record["module"].split(".")
        if not record["path"].endswith("/__init__.py"):
            package = package[:-1]
        if n.level > len(package):
            return "<unresolved-relative>"
        parts = package[:len(package) - n.level + 1]
        if n.module:
            parts.extend(n.module.split("."))
        return ".".join(parts)

    def collect(n, scope, record):
        owner_scope[id(n)] = scope
        for c in ast.iter_child_nodes(n):
            parents[id(c)] = n
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            fqn = scope + "." + n.name
            bind(scope, n.name, fqn)
            # Repeated names cannot become uniquely resolved call targets.
            if fqn in definitions:
                warnings.append({"file":record["path"], "line":n.lineno,
                                 "message":"重复定义名称；调用解析将保守处理：" + fqn})
                fqn += "@" + str(n.lineno)
            is_class = isinstance(n, ast.ClassDef)
            entry = {"id":fqn,"name":n.name,"file":record["path"],"line":n.lineno,
                     "end_line":n.end_lineno,"kind":"class" if is_class else "function"}
            definitions[fqn] = entry
            definition_nodes[fqn] = n
            scope_parent[fqn] = scope
            bindings[fqn] = {}
            if is_class:
                record["classes"].append(entry)
            else:
                record["functions"].append(entry)
                for arg in n.args.posonlyargs + n.args.args + n.args.kwonlyargs:
                    bind(fqn, arg.arg, None)
                for arg in (n.args.vararg, n.args.kwarg):
                    if arg:
                        bind(fqn, arg.arg, None)
            # Definition decorators, defaults, annotations are not counted as body calls.
            for stmt in n.body:
                collect(stmt, fqn, record)
            return
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            base = import_base(n, record)
            for alias in n.names:
                if isinstance(n, ast.Import):
                    local = alias.asname or alias.name.split(".")[0]
                    target = alias.name if alias.asname else alias.name.split(".")[0]
                    dependency = alias.name
                else:
                    local = alias.asname or alias.name
                    target = (base + "." + alias.name).strip(".")
                    dependency = target if target in module_paths else base
                if local != "*":
                    bind(scope, local, target)
                else:
                    bind(scope, "*", None)
                    warnings.append({"file":record["path"], "line":n.lineno,
                                     "message":"星号导入不参与确定的符号绑定"})
                imports.append({"source":record["module"], "target":dependency,
                                "file":record["path"],"line":n.lineno})
        if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            bind(scope, n.id, None)
        if isinstance(n, (ast.Global, ast.Nonlocal)):
            for name in n.names:
                bind(scope, name, None)
        if isinstance(n, ast.ExceptHandler) and n.name:
            bind(scope, n.name, None)
        if isinstance(n, (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            # Keep comprehension/lambda locals from contaminating surrounding resolution.
            sub = scope + ".<expression:" + str(n.lineno) + ":" + str(n.col_offset) + ">"
            scope_parent[sub] = scope
            bindings[sub] = {}
            if isinstance(n, ast.Lambda):
                for arg in n.args.posonlyargs + n.args.args + n.args.kwonlyargs:
                    bind(sub, arg.arg, None)
                for arg in (n.args.vararg, n.args.kwarg):
                    if arg: bind(sub, arg.arg, None)
            for child in ast.iter_child_nodes(n):
                collect(child, sub, record)
            return
        for c in ast.iter_child_nodes(n):
            collect(c, scope, record)

    for record in records:
        if "error" in record:
            continue
        try:
            tree = ast.parse(record["source"], filename=record["path"], feature_version=(3,11))
            if sum(1 for _ in ast.walk(tree)) > 100000:
                raise ValueError("AST 节点超过 100000 个")
            trees[record["path"]] = tree
            record["status"] = "ok"
            bindings.setdefault(record["module"], {})
            scope_parent[record["module"]] = None
            collect(tree, record["module"], record)
            active_lines = code_line_numbers(record["source"])
            for item in ast.walk(tree):
                if isinstance(item, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    if item.body and isinstance(item.body[0], ast.Expr) and isinstance(item.body[0].value, ast.Constant) and isinstance(item.body[0].value.value, str):
                        doc = item.body[0]
                        active_lines.difference_update(range(doc.lineno, doc.end_lineno + 1))
            record["code_lines"] = len(active_lines)
            for f in record["functions"]:
                n = definition_nodes[f["id"]]
                cc = complexity(n)
                f.update(cc=cc, rank=rank(cc), nesting=nesting(n),
                         length=sum(n.lineno <= line <= n.end_lineno for line in active_lines),
                         params=len(n.args.posonlyargs+n.args.args+n.args.kwonlyargs)+bool(n.args.vararg)+bool(n.args.kwarg))
                statements = sorted((s for s in own_walk(n) if isinstance(s, ast.stmt)),
                                    key=lambda s:(s.lineno,s.col_offset))
                f["statements"] = [{"line":s.lineno,"end_line":s.end_lineno,"ast_type":type(s).__name__,
                                    "description":statement_description(s),"evidence_type":"fact"}
                                   for s in statements]
                for rule, value, threshold, label in [("CC-01",cc,10,"圈复杂度"),
                                                      ("LEN-01",f["length"],50,"有效代码行数"),
                                                      ("DEPTH-01",f["nesting"],4,"控制结构嵌套深度")]:
                    if value > threshold:
                        finding(rule,"critical" if rule=="CC-01" and value>20 else "warning",
                                f["file"],f["line"],f"{f['id']} 的{label}为 {value}，超过阈值 {threshold}。",
                                "检查复杂路径与职责边界，考虑拆分独立逻辑。",actual=value,threshold=threshold)
        except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
            record["status"] = "error"
            record["functions"] = []
            record["classes"] = []
            trees.pop(record["path"], None)
            record["error"] = {"file":record["path"], "line":getattr(exc,"lineno",None),
                               "type":type(exc).__name__, "message":getattr(exc,"msg", "解析失败或文件结构过于复杂")}

    def resolve_name(name, scope):
        visited = set()
        while scope is not None and scope not in visited:
            visited.add(scope)
            if name in bindings.get(scope, {}):
                return bindings[scope][name], True
            if "*" in bindings.get(scope, {}):
                return None, True
            parent = scope_parent.get(scope)
            # A class body is not a lexical environment for its methods.
            if definitions.get(scope, {}).get("kind") == "function" and definitions.get(parent, {}).get("kind") == "class":
                parent = scope_parent.get(parent)
            scope = parent
        return None, False

    def resolve_expr(expr, scope):
        if isinstance(expr, ast.Name):
            return resolve_name(expr.id, scope)[0]
        if isinstance(expr, ast.Attribute):
            base = resolve_expr(expr.value, scope)
            if base and (base in module_paths or any(m.startswith(base + ".") for m in module_paths)):
                return base + "." + expr.attr
        return None

    calls, inheritance = [], []
    valid_defs = {key:entry for key,entry in definitions.items() if entry["file"] in trees}
    def handled_io(call):
        current = call
        child = call
        while id(current) in parents:
            child = current
            current = parents[id(current)]
            if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                break
            if isinstance(current, (ast.Try, ast.TryStar)) and child in current.body:
                for handler in current.handlers:
                    types = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
                    if handler.type is None:
                        return True
                    for t in types:
                        if isinstance(t, ast.Name) and t.id in {"OSError","IOError","Exception","BaseException"}:
                            _, bound = resolve_name(t.id, owner_scope.get(id(current)))
                            if not bound:
                                return True
        return False

    for record in records:
        tree = trees.get(record["path"])
        if tree is None:
            continue
        for item in ast.walk(tree):
            scope = owner_scope.get(id(item), record["module"])
            if isinstance(item, ast.Call):
                target = resolve_expr(item.func, scope)
                resolved = target in valid_defs
                calls.append({"source":scope,"target":target if resolved else None,
                              "expression":target_name(item.func),"file":record["path"],"line":item.lineno,
                              "status":"resolved" if resolved else "unresolved", "evidence_type":"fact" if resolved else "inference"})
                if isinstance(item.func, ast.Name) and item.func.id == "open":
                    _, shadowed = resolve_name("open", scope)
                    if not shadowed and not handled_io(item):
                        finding("A3-IO","warning",record["path"],item.lineno,
                                "内置 open 调用所在局部路径未发现匹配的 OSError 捕获。with 仅管理资源，不等于异常处理。",
                                "核查上层是否统一处理 IO 失败；该推断不能证明程序必然出错。",
                                evidence="inference", confidence="medium")
            if isinstance(item, (ast.Assign, ast.AnnAssign)) and isinstance(item.value, ast.Constant) and isinstance(item.value.value, str):
                targets = item.targets if isinstance(item, ast.Assign) else [item.target]
                value = item.value.value
                names = [target_name(t) for t in targets]
                sensitive = any(re.search(r"(?:^|[._])(password|passwd|secret|token|api_?key|access_?key)(?:$|_)", name, re.I) for name in names)
                placeholder = re.search(r"demo|example|sample|test|placeholder|changeme|your[_ -]|not[_ -]a[_ -]real|dummy|xxx",value,re.I)
                if sensitive and len(value)>=8 and not placeholder and value.strip("* ._-<>"):
                    finding("A4","warning",record["path"],item.lineno,
                            "敏感命名变量被直接赋予非占位字符串字面量；值已从报告隐藏。",
                            "确认是否为真实凭据，并检查配置或环境变量读取方式；未验证凭据有效性。")
        for cls in record["classes"]:
            n = definition_nodes[cls["id"]]
            cls["methods"] = [entry["id"] for entry in record["functions"] if scope_parent.get(entry["id"])==cls["id"]]
            cls["bases"] = [target_name(b) for b in n.bases]
            for base in n.bases:
                target = resolve_expr(base, scope_parent[cls["id"]])
                if valid_defs.get(target,{}).get("kind")=="class":
                    inheritance.append({"source":cls["id"],"target":target,"file":record["path"],"line":n.lineno,"evidence_type":"fact"})
                else:
                    warnings.append({"file":record["path"],"line":n.lineno,"message":"父类未解析："+target_name(base)})

    dependencies = []
    for edge in imports:
        if edge["file"] not in trees:
            continue
        target = edge["target"]
        # import pkg.sub can refer to an internal package parent.
        while target not in module_paths and "." in target:
            target = target.rsplit(".",1)[0]
        edge = dict(edge)
        edge["internal"] = target in module_paths
        if edge["internal"]:
            edge["target"] = target
        edge["evidence_type"] = "fact"
        dependencies.append(edge)
    unique_edges = sorted({(d["source"],d["target"]) for d in dependencies if d["internal"]})
    cycles = cycles_of(module_paths,unique_edges)
    for group in cycles:
        evidence = next(d for d in dependencies if d["source"] in group and d["target"] in group)
        finding("CYCLE-01","warning",evidence["file"],evidence["line"],
                "模块循环依赖组：" + " ↔ ".join(group), "沿导入位置复核耦合，评估提取公共接口。")
    errors = [r["error"] for r in records if "error" in r]
    functions = [f for r in records if r["status"]=="ok" for f in r["functions"]]
    classes = [c for r in records if r["status"]=="ok" for c in r["classes"]]
    order = {"critical":0,"warning":1,"info":2}
    findings = sorted(findings,key=lambda f:(order[f["severity"]],f["file"],f["line"],f["rule_id"]))
    for i, f in enumerate(findings):
        f["id"] = "finding-" + str(i+1)
    status = "empty" if not records else "failed" if len(errors)==len(records) else "partial" if errors else "complete"
    return {"schema_version":"1.0","engine_version":VERSION,"project":project,"status":status,
            "config":{"language":"Python 3.11","excluded":sorted(EXCLUDED),"rules":RULES,
                      "thresholds":{"cc":10,"length":50,"nesting":4},
                      "length_definition":"物理有效代码行，排除空行、纯注释及独立文档字符串；包含定义行与内层定义。",
                      "cc_definition":"初始1；if/三元/assert +1；循环 +1（else再+1）；try按except数（else再+1）；布尔n项+n-1；推导式+1及if数；match非通配case+1。内层函数/类/lambda不计入外层。"},
            "summary":{"files":len(records),"parsed":len(records)-len(errors),"failed":len(errors),
                       "excluded":excluded_count,"functions":len(functions),"classes":len(classes),
                       "code_lines":sum(r["code_lines"] for r in records if r["status"]=="ok"),
                       "findings":len(findings),"average_cc":round(sum(f["cc"] for f in functions)/len(functions),2) if functions else None,
                       "max_cc":max((f["cc"] for f in functions),default=None)},
            "files":records,"functions":functions,"classes":classes,"findings":findings,
            "graph":{"dependencies":sorted(dependencies,key=lambda e:(e["file"],e["line"],e["target"])),
                     "calls":sorted(calls,key=lambda c:(c["file"],c["line"],c["expression"])),
                     "inheritance":sorted(inheritance,key=lambda e:(e["source"],e["target"])),"cycles":cycles},
            "errors":errors,"warnings":sorted(warnings,key=lambda e:(e["file"],e["line"],e["message"])),
            "limitations":LIMITATIONS}
