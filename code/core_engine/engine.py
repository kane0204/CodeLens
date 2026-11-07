"""CodeLens local, deterministic AST analysis. Never imports or executes input code."""
from __future__ import annotations

import ast
import base64
import hashlib
import io
import re
import tokenize
from pathlib import PurePosixPath

from . import generic

VERSION = "0.4.0"
EXCLUDED = {".git", ".venv", "venv", "__pycache__", "node_modules", "build", "dist", "tests"}
MAX_FILES = 200
MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024
RULES = ["CC-01", "LEN-01", "DEPTH-01", "A4", "A3-IO", "CYCLE-01"]
LIMITATIONS = [
    "Python 使用 3.11 AST 解析；C/C++/Java/JavaScript/TypeScript/Go 使用词法与花括号配对近似解析；均不执行、不导入被分析源码。",
    *generic.LIMITATIONS,
    "调用解析仅覆盖唯一绑定的函数、类与显式导入；动态调用、实例类型、多态及 super 不作确定还原。",
    "CC 使用已公开的 AST 判定计数口径，尚未完成与 radon 的全量对拍。",
    "A3-IO 仅检查内置 open 的局部 OSError 捕获；上层异常处理需人工复核。",
    "A4 仅检查敏感变量名与非占位字符串赋值；不验证凭据有效性，不能覆盖所有敏感信息。",
    "facts.py 提供基本块 CFG 与 def-use；静态调用序列不代表运行时执行顺序。",
    "analyze() 返回基础事实；工作台由 rules/quality/health/sequence 补充 SOLID 五项、类指标、结构重复、健康度及静态调用序列。",
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
    finder = _SccFinder(graph)
    for n in sorted(nodes):
        finder.run(n)
    return sorted(finder.result)


class _SccFinder:
    """Tarjan strongly-connected-components, decomposed into small methods."""

    def __init__(self, graph):
        self.graph = graph
        self.index = {}
        self.low = {}
        self.stack = []
        self.active = set()
        self.result = []

    def run(self, node):
        if node not in self.index:
            self._visit(node)

    def _visit(self, node):
        self.index[node] = self.low[node] = len(self.index)
        self.stack.append(node)
        self.active.add(node)
        for neighbor in sorted(self.graph[node]):
            self._relax(node, neighbor)
        self._unwind(node)

    def _relax(self, node, neighbor):
        if neighbor not in self.index:
            self._visit(neighbor)
            self.low[node] = min(self.low[node], self.low[neighbor])
        elif neighbor in self.active:
            self.low[node] = min(self.low[node], self.index[neighbor])

    def _unwind(self, node):
        if self.low[node] != self.index[node]:
            return
        group = []
        while True:
            member = self.stack.pop()
            self.active.remove(member)
            group.append(member)
            if member == node:
                break
        if len(group) > 1 or node in self.graph[node]:
            self.result.append(sorted(group))


class _Context:
    """Mutable state shared by one analysis run (Context Object pattern).

    The closures that previously lived inside analyze() now live here so each
    pipeline stage is a small, single-purpose function or method.
    """

    def __init__(self, seen, module_paths):
        self.seen = seen
        self.module_paths = module_paths
        self.trees = {}
        self.definitions = {}
        self.definition_nodes = {}
        self.bindings = {}
        self.scope_parent = {}
        self.owner_scope = {}
        self.parents = {}
        self.imports = []
        self.findings = []
        self.warnings = []
        self.generic_calls = []
        self.generic_dependencies = []
        self.calls = []
        self.inheritance = []

    def finding(self, rule, severity, file, line, message, suggestion,
                evidence="fact", actual=None, threshold=None, confidence=None):
        self.findings.append({"rule_id": rule, "severity": severity, "file": file, "line": line,
                              "message": message, "suggestion": suggestion, "evidence_type": evidence,
                              "actual": actual, "threshold": threshold, "confidence": confidence})

    def bind(self, scope, name, value):
        # Multiple bindings are conservatively ambiguous, even if one shadows an import later.
        table = self.bindings.setdefault(scope, {})
        table[name] = value if name not in table else None

    def import_base(self, node, record):
        if not isinstance(node, ast.ImportFrom):
            return ""
        if not node.level:
            return node.module or ""
        # A selected package root is represented without a synthetic directory prefix.
        if "__init__.py" in self.seen and "/" not in record["path"] and node.level == 1:
            return node.module or ""
        package = record["module"].split(".")
        if not record["path"].endswith("/__init__.py"):
            package = package[:-1]
        if node.level > len(package):
            return "<unresolved-relative>"
        parts = package[:len(package) - node.level + 1]
        if node.module:
            parts.extend(node.module.split("."))
        return ".".join(parts)

    def collect(self, node, scope, record):
        self.owner_scope[id(node)] = scope
        for child in ast.iter_child_nodes(node):
            self.parents[id(child)] = node
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            self._collect_definition(node, scope, record)
            return
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            self._collect_import(node, scope, record)
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            self.bind(scope, node.id, None)
        if isinstance(node, (ast.Global, ast.Nonlocal)):
            for name in node.names:
                self.bind(scope, name, None)
        if isinstance(node, ast.ExceptHandler) and node.name:
            self.bind(scope, node.name, None)
        if isinstance(node, (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            self._collect_expression(node, scope, record)
            return
        for child in ast.iter_child_nodes(node):
            self.collect(child, scope, record)

    def _collect_definition(self, node, scope, record):
        fqn = scope + "." + node.name
        self.bind(scope, node.name, fqn)
        # Repeated names cannot become uniquely resolved call targets.
        if fqn in self.definitions:
            self.warnings.append({"file": record["path"], "line": node.lineno,
                                  "message": "重复定义名称；调用解析将保守处理：" + fqn})
            fqn += "@" + str(node.lineno)
        is_class = isinstance(node, ast.ClassDef)
        entry = {"id": fqn, "name": node.name, "file": record["path"], "line": node.lineno,
                 "end_line": node.end_lineno, "kind": "class" if is_class else "function"}
        self.definitions[fqn] = entry
        self.definition_nodes[fqn] = node
        self.scope_parent[fqn] = scope
        self.bindings[fqn] = {}
        if is_class:
            record["classes"].append(entry)
        else:
            record["functions"].append(entry)
            for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                self.bind(fqn, arg.arg, None)
            for arg in (node.args.vararg, node.args.kwarg):
                if arg:
                    self.bind(fqn, arg.arg, None)
        # Definition decorators, defaults, annotations are not counted as body calls.
        for stmt in node.body:
            self.collect(stmt, fqn, record)

    def _collect_import(self, node, scope, record):
        base = self.import_base(node, record)
        for alias in node.names:
            if isinstance(node, ast.Import):
                local = alias.asname or alias.name.split(".")[0]
                target = alias.name if alias.asname else alias.name.split(".")[0]
                dependency = alias.name
            else:
                local = alias.asname or alias.name
                target = (base + "." + alias.name).strip(".")
                dependency = target if target in self.module_paths else base
            if local != "*":
                self.bind(scope, local, target)
            else:
                self.bind(scope, "*", None)
                self.warnings.append({"file": record["path"], "line": node.lineno,
                                      "message": "星号导入不参与确定的符号绑定"})
            self.imports.append({"source": record["module"], "target": dependency,
                                 "file": record["path"], "line": node.lineno})

    def _collect_expression(self, node, scope, record):
        # Keep comprehension/lambda locals from contaminating surrounding resolution.
        sub = scope + ".<expression:" + str(node.lineno) + ":" + str(node.col_offset) + ">"
        self.scope_parent[sub] = scope
        self.bindings[sub] = {}
        if isinstance(node, ast.Lambda):
            for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                self.bind(sub, arg.arg, None)
            for arg in (node.args.vararg, node.args.kwarg):
                if arg:
                    self.bind(sub, arg.arg, None)
        for child in ast.iter_child_nodes(node):
            self.collect(child, sub, record)

    def resolve_name(self, name, scope):
        visited = set()
        while scope is not None and scope not in visited:
            visited.add(scope)
            if name in self.bindings.get(scope, {}):
                return self.bindings[scope][name], True
            if "*" in self.bindings.get(scope, {}):
                return None, True
            parent = self.scope_parent.get(scope)
            # A class body is not a lexical environment for its methods.
            if self.definitions.get(scope, {}).get("kind") == "function" and \
                    self.definitions.get(parent, {}).get("kind") == "class":
                parent = self.scope_parent.get(parent)
            scope = parent
        return None, False

    def resolve_expr(self, expr, scope):
        if isinstance(expr, ast.Name):
            return self.resolve_name(expr.id, scope)[0]
        if isinstance(expr, ast.Attribute):
            base = self.resolve_expr(expr.value, scope)
            if base and (base in self.module_paths or
                         any(m.startswith(base + ".") for m in self.module_paths)):
                return base + "." + expr.attr
        return None

    def handled_io(self, call):
        current = call
        while id(current) in self.parents:
            child = current
            current = self.parents[id(current)]
            if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                break
            if (isinstance(current, (ast.Try, ast.TryStar)) and child in current.body
                    and any(self._handler_covers_oserror(h, current) for h in current.handlers)):
                return True
        return False

    def _handler_covers_oserror(self, handler, current):
        if handler.type is None:
            return True
        types = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
        for t in types:
            if isinstance(t, ast.Name) and t.id in {"OSError", "IOError", "Exception", "BaseException"}:
                _, bound = self.resolve_name(t.id, self.owner_scope.get(id(current)))
                if not bound:
                    return True
        return False

    def record_call(self, item, scope, record, valid_defs):
        target = self.resolve_expr(item.func, scope)
        resolved = target in valid_defs
        self.calls.append({"source": scope, "target": target if resolved else None,
                           "expression": target_name(item.func), "file": record["path"],
                           "line": item.lineno,
                           "status": "resolved" if resolved else "unresolved",
                           "evidence_type": "fact" if resolved else "inference"})
        if isinstance(item.func, ast.Name) and item.func.id == "open":
            _, shadowed = self.resolve_name("open", scope)
            if not shadowed and not self.handled_io(item):
                self.finding("A3-IO", "warning", record["path"], item.lineno,
                             "内置 open 调用所在局部路径未发现匹配的 OSError 捕获。with 仅管理资源，不等于异常处理。",
                             "核查上层是否统一处理 IO 失败；该推断不能证明程序必然出错。",
                             evidence="inference", confidence="medium")

    def check_secret(self, item, record):
        targets = item.targets if isinstance(item, ast.Assign) else [item.target]
        constant = item.value
        if not (isinstance(constant, ast.Constant) and isinstance(constant.value, str)):
            return
        value = constant.value
        names = [target_name(t) for t in targets]
        sensitive = any(re.search(r"(?:^|[._])(password|passwd|secret|token|api_?key|access_?key)(?:$|_)", name, re.IGNORECASE) for name in names)
        placeholder = re.search(r"demo|example|sample|test|placeholder|changeme|your[_ -]|not[_ -]a[_ -]real|dummy|xxx", value, re.IGNORECASE)
        if sensitive and len(value) >= 8 and not placeholder and value.strip("* ._-<>"):
            self.finding("A4", "warning", record["path"], item.lineno,
                         "敏感命名变量被直接赋予非占位字符串字面量；值已从报告隐藏。",
                         "确认是否为真实凭据，并检查配置或环境变量读取方式；未验证凭据有效性。")

    def link_class_bases(self, cls, record, valid_defs):
        node = self.definition_nodes[cls["id"]]
        cls["methods"] = [entry["id"] for entry in record["functions"]
                          if self.scope_parent.get(entry["id"]) == cls["id"]]
        cls["bases"] = [target_name(b) for b in node.bases]
        for base in node.bases:
            target = self.resolve_expr(base, self.scope_parent[cls["id"]])
            if valid_defs.get(target, {}).get("kind") == "class":
                self.inheritance.append({"source": cls["id"], "target": target,
                                         "file": record["path"], "line": node.lineno,
                                         "evidence_type": "fact"})
            else:
                self.warnings.append({"file": record["path"], "line": node.lineno,
                                      "message": "父类未解析：" + target_name(base)})


def _validated_files(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("files"), list):
        raise ValueError("请求必须包含 files 列表")
    files = payload["files"]
    if len(files) > MAX_FILES:
        raise ValueError(f"最多分析 {MAX_FILES} 个源码文件，请缩小目录范围")
    return files


def _load_records(payload):
    records, total, seen, excluded_count = [], 0, set(), 0
    for item in _validated_files(payload):
        if not isinstance(item, dict):
            raise ValueError("文件记录无效")
        path = normalized_path(item.get("path"))
        suffix = PurePosixPath(path).suffix.lower()
        if suffix not in generic.SUPPORTED or any(p in EXCLUDED for p in PurePosixPath(path).parts[:-1]):
            excluded_count += 1
            continue
        if path in seen:
            raise ValueError("存在重复的文件路径")
        seen.add(path)
        is_python = suffix == ".py"
        record = {"path": path, "module": module_name(path) if is_python else path,
                  "language": "Python 3.11" if is_python else generic.language_of(path),
                  "source": "", "status": "error",
                  "functions": [], "classes": [], "line_count": 0, "code_lines": 0}
        total += _decode_source(item, record, path)
        records.append(record)
    if total > MAX_TOTAL_BYTES:
        raise ValueError("源码总量超过 8 MB，请缩小目录范围")
    records.sort(key=lambda r: r["path"])
    return records, seen, excluded_count


def _raw_bytes(item):
    if "content_base64" in item:
        return base64.b64decode(item["content_base64"], validate=True)
    if isinstance(item.get("content"), str):
        return item["content"].encode("utf-8")
    raise ValueError("文件缺少源码内容")


def _decode_source(item, record, path):
    """Populate ``record`` with decoded source; return the counted byte length."""
    try:
        raw = _raw_bytes(item)
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("文件超过 1 MB")
        record["sha256"] = hashlib.sha256(raw).hexdigest()
        try:
            encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
            record["source"] = raw.decode(encoding)
        except (SyntaxError, LookupError, UnicodeError):
            record["source"] = raw.decode("utf-8", errors="replace")
        record["line_count"] = len(record["source"].splitlines())
        return len(raw)
    except (ValueError, SyntaxError, LookupError) as exc:
        record["error"] = {"file": path, "line": None, "type": type(exc).__name__,
                           "message": "读取或编码失败；请检查文件编码及大小"}
        return 0


def _build_module_paths(records):
    module_paths = {}
    for record in records:
        if not record["path"].endswith(".py"):
            continue
        if record["module"] in module_paths:
            raise ValueError("同时存在同名模块文件和包目录，无法唯一识别，请缩小分析范围")
        module_paths[record["module"]] = record["path"]
    return module_paths


def _parse_and_score(ctx, records):
    for record in records:
        if "error" in record:
            continue
        if record["path"].endswith(".py"):
            _score_python(ctx, record)
        else:
            _score_nonpython(ctx, record, records)


def _score_nonpython(ctx, record, records):
    try:
        info = generic.analyze_record(record, {r["path"] for r in records})
        record["functions"] = info["functions"]
        record["classes"] = info["classes"]
        record["code_lines"] = generic.code_line_count(record["source"])
        record["status"] = "ok"
        ctx.findings.extend(info["findings"])
        ctx.generic_calls.extend(info["calls"])
        ctx.generic_dependencies.extend(info["dependencies"])
    except (ValueError, RecursionError, MemoryError) as exc:
        record["status"] = "error"
        record["functions"] = []
        record["classes"] = []
        record["error"] = {"file": record["path"], "line": None, "type": type(exc).__name__,
                           "message": "非 Python 源码解析失败；请检查文件编码与结构"}


def _score_python(ctx, record):
    try:
        tree = ast.parse(record["source"], filename=record["path"], feature_version=(3, 11))
        if sum(1 for _ in ast.walk(tree)) > 100000:
            raise ValueError("AST 节点超过 100000 个")
        ctx.trees[record["path"]] = tree
        record["status"] = "ok"
        ctx.bindings.setdefault(record["module"], {})
        ctx.scope_parent[record["module"]] = None
        ctx.collect(tree, record["module"], record)
        active_lines = _active_lines(tree, record["source"])
        record["code_lines"] = len(active_lines)
        for f in record["functions"]:
            _score_function(ctx, f, active_lines)
    except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
        record["status"] = "error"
        record["functions"] = []
        record["classes"] = []
        ctx.trees.pop(record["path"], None)
        record["error"] = {"file": record["path"], "line": getattr(exc, "lineno", None),
                           "type": type(exc).__name__,
                           "message": getattr(exc, "msg", "解析失败或文件结构过于复杂")}


def _active_lines(tree, source):
    active_lines = code_line_numbers(source)
    for item in ast.walk(tree):
        if not isinstance(item, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        if (item.body and isinstance(item.body[0], ast.Expr)
                and isinstance(item.body[0].value, ast.Constant)
                and isinstance(item.body[0].value.value, str)):
            doc = item.body[0]
            active_lines.difference_update(range(doc.lineno, doc.end_lineno + 1))
    return active_lines


def _score_function(ctx, f, active_lines):
    node = ctx.definition_nodes[f["id"]]
    cc = complexity(node)
    f.update(cc=cc, rank=rank(cc), nesting=nesting(node),
             length=sum(node.lineno <= line <= node.end_lineno for line in active_lines),
             params=len(node.args.posonlyargs + node.args.args + node.args.kwonlyargs)
                    + bool(node.args.vararg) + bool(node.args.kwarg))
    statements = sorted((s for s in own_walk(node) if isinstance(s, ast.stmt)),
                        key=lambda s: (s.lineno, s.col_offset))
    f["statements"] = [{"line": s.lineno, "end_line": s.end_lineno, "ast_type": type(s).__name__,
                        "description": statement_description(s), "evidence_type": "fact"}
                       for s in statements]
    for rule, value, threshold, label in [("CC-01", cc, 10, "圈复杂度"),
                                          ("LEN-01", f["length"], 50, "有效代码行数"),
                                          ("DEPTH-01", f["nesting"], 4, "控制结构嵌套深度")]:
        if value > threshold:
            ctx.finding(rule, "critical" if rule == "CC-01" and value > 20 else "warning",
                        f["file"], f["line"],
                        f"{f['id']} 的{label}为 {value}，超过阈值 {threshold}。",
                        "检查复杂路径与职责边界，考虑拆分独立逻辑。",
                        actual=value, threshold=threshold)


def _resolve_nonpython_inheritance(ctx, records):
    # Non-Python inheritance is resolved by unique class name across the project.
    class_names = _unique_class_names(records)
    for record in records:
        if record["path"].endswith(".py") or record["status"] != "ok":
            continue
        _link_nonpython_inheritance(ctx, record, class_names)


def _unique_class_names(records):
    class_names = {}
    for record in records:
        for cls in record["classes"]:
            class_names.setdefault(cls["name"], cls["id"])
    return class_names


def _link_nonpython_inheritance(ctx, record, class_names):
    for cls in record["classes"]:
        for base in cls.get("bases") or []:
            target = class_names.get(base.split("::")[-1].strip())
            if target and target != cls["id"]:
                ctx.inheritance.append({"source": cls["id"], "target": target,
                                        "file": record["path"], "line": cls["line"],
                                        "evidence_type": "inference"})


def _resolve_calls_and_secrets(ctx, records):
    ctx.calls = list(ctx.generic_calls)
    valid_defs = {key: entry for key, entry in ctx.definitions.items() if entry["file"] in ctx.trees}
    for record in records:
        tree = ctx.trees.get(record["path"])
        if tree is None:
            continue
        for item in ast.walk(tree):
            scope = ctx.owner_scope.get(id(item), record["module"])
            if isinstance(item, ast.Call):
                ctx.record_call(item, scope, record, valid_defs)
            if isinstance(item, (ast.Assign, ast.AnnAssign)):
                ctx.check_secret(item, record)
        for cls in record["classes"]:
            ctx.link_class_bases(cls, record, valid_defs)


def _build_dependencies(ctx, records):
    dependencies = []
    for edge in ctx.imports:
        if edge["file"] not in ctx.trees:
            continue
        target = edge["target"]
        # import pkg.sub can refer to an internal package parent.
        while target not in ctx.module_paths and "." in target:
            target = target.rsplit(".", 1)[0]
        edge = dict(edge)
        edge["internal"] = target in ctx.module_paths
        if edge["internal"]:
            edge["target"] = target
        edge["evidence_type"] = "fact"
        dependencies.append(edge)
    dependencies.extend(ctx.generic_dependencies)
    unique_edges = sorted({(d["source"], d["target"]) for d in dependencies if d["internal"]})
    graph_nodes = set(ctx.module_paths) | {r["module"] for r in records
                                           if r["status"] == "ok" and not r["path"].endswith(".py")}
    cycles = cycles_of(graph_nodes, unique_edges)
    for group in cycles:
        evidence = next(d for d in dependencies if d["source"] in group and d["target"] in group)
        ctx.finding("CYCLE-01", "warning", evidence["file"], evidence["line"],
                    "模块循环依赖组：" + " ↔ ".join(group),
                    "沿导入位置复核耦合，评估提取公共接口。")
    return dependencies, cycles


def _overall_status(records, errors):
    if not records:
        return "empty"
    if len(errors) == len(records):
        return "failed"
    if errors:
        return "partial"
    return "complete"


def _assemble_report(ctx, records, project, excluded_count, dependencies, cycles):
    errors = [r["error"] for r in records if "error" in r]
    functions = [f for r in records if r["status"] == "ok" for f in r["functions"]]
    classes = [c for r in records if r["status"] == "ok" for c in r["classes"]]
    order = {"critical": 0, "warning": 1, "info": 2}
    findings = sorted(ctx.findings, key=lambda f: (order[f["severity"]], f["file"], f["line"], f["rule_id"]))
    for i, f in enumerate(findings):
        f["id"] = "finding-" + str(i + 1)
    status = _overall_status(records, errors)
    language_counts = {}
    for record in records:
        language_counts[record["language"]] = language_counts.get(record["language"], 0) + 1
    languages = [name for name in language_counts if name]
    language_label = " / ".join(sorted(languages)) if languages else "未知"
    return {"schema_version": "1.0", "engine_version": VERSION, "project": project, "status": status,
            "config": {"language": language_label, "languages": sorted(languages), "excluded": sorted(EXCLUDED),
                       "rules": RULES, "thresholds": {"cc": 10, "length": 50, "nesting": 4},
                       "length_definition": "物理有效代码行，排除空行、纯注释及独立文档字符串；包含定义行与内层定义。非 Python 文件排除空行与纯注释行。",
                       "cc_definition": "Python：初始1；if/三元/assert +1；循环 +1（else再+1）；try按except数（else再+1）；布尔n项+n-1；推导式+1及if数；match非通配case+1。非 Python：初始1，按 if/for/while/case/catch/&&/||/?: 关键字计数。内层函数/类/lambda不计入外层。"},
            "summary": {"files": len(records), "parsed": len(records) - len(errors), "failed": len(errors),
                        "excluded": excluded_count, "functions": len(functions), "classes": len(classes),
                        "languages": language_counts,
                        "code_lines": sum(r["code_lines"] for r in records if r["status"] == "ok"),
                        "findings": len(findings),
                        "average_cc": round(sum(f["cc"] for f in functions) / len(functions), 2) if functions else None,
                        "max_cc": max((f["cc"] for f in functions), default=None)},
            "files": records, "functions": functions, "classes": classes, "findings": findings,
            "graph": {"dependencies": sorted(dependencies, key=lambda e: (e["file"], e["line"], e["target"])),
                      "calls": sorted(ctx.calls, key=lambda c: (c["file"], c["line"], c["expression"])),
                      "inheritance": sorted(ctx.inheritance, key=lambda e: (e["source"], e["target"])),
                      "cycles": cycles},
            "errors": errors, "warnings": sorted(ctx.warnings, key=lambda e: (e["file"], e["line"], e["message"])),
            "limitations": LIMITATIONS}


def analyze(payload):
    records, seen, excluded_count = _load_records(payload)
    project = str(payload.get("project", "代码项目"))[:120]
    ctx = _Context(seen, _build_module_paths(records))
    _parse_and_score(ctx, records)
    _resolve_nonpython_inheritance(ctx, records)
    _resolve_calls_and_secrets(ctx, records)
    dependencies, cycles = _build_dependencies(ctx, records)
    return _assemble_report(ctx, records, project, excluded_count, dependencies, cycles)
