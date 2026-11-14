"""Brace/lexer based analysis for non-Python sources.

Design constraints:
- Never executes or imports analysed code.
- Produces the same record shape as the Python AST path so the workbench can
  render both without branching on language.
- Metrics are approximations and are labelled as such in ``LIMITATIONS``.
"""
from __future__ import annotations

import re
from bisect import bisect_left
from itertools import islice
from pathlib import PurePosixPath

from . import levels

LANGUAGES = {
    ".c": "C",
    ".h": "C/C++ header",
    ".cc": "C++",
    ".cpp": "C++",
    ".cxx": "C++",
    ".hpp": "C++",
    ".java": "Java",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".go": "Go",
}

SUPPORTED = {".py"} | set(LANGUAGES)

LIMITATIONS = [
    "非 Python 文件使用词法与花括号配对近似解析，不构建完整语法树；重载、模板与宏可能影响边界识别。",
    "非 Python 的圈复杂度按分支关键字计数（if/for/while/case/catch/&&/||/?:），与 Python 的 AST 口径不完全等价。",
    "非 Python 不计算 SOLID、类级指标、结构重复与调用序列；相关维度显示为未覆盖。",
    "非 Python 的调用解析仅按唯一函数名匹配，动态分发、同名重载与跨语言调用不作确定还原。",
]

KEYWORDS = {
    "if", "for", "while", "switch", "catch", "else", "do", "try", "return",
    "sizeof", "new", "delete", "throw", "case", "default", "using", "namespace",
    "class", "struct", "interface", "enum", "function", "typeof", "await", "in",
    "of", "with", "assert", "super", "this", "defined", "static_assert",
}
CONTROL_WORDS = {"if", "for", "while", "switch", "catch", "else", "do", "try"}

HEADER_RE = re.compile(r"([A-Za-z_~][\w:~]*)\s*\(")
ARROW_RE = re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*(?::[^=]+)?=>")
GO_FUNC_RE = re.compile(r"\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(")
CLASS_RE = re.compile(r"\b(class|struct|interface|enum)\s+([A-Za-z_]\w*)")
SECRET_RE = re.compile(
    r"(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*[\"']([^\"'\n]{8,})[\"']",
    re.I,
)
PLACEHOLDER_RE = re.compile(r"demo|example|sample|test|placeholder|changeme|your[_ -]|dummy|xxx|not[_ -]a[_ -]real", re.I)
COMMENT_MARKER_RE = re.compile(r"//|[#*]")


TODO_RE = re.compile(r"(?:\btodo\b|\bfixme\b|\bhack\b|\bxxx\b|待实现|临时方案|未完成)", re.I)
EMPTY_CATCH_RE = re.compile(r"catch\s*\([^)]*\)\s*\{\s*\}")
BROAD_CATCH_RE = re.compile(r"catch\s*\(\s*(?:Exception|Throwable|\.\.\.)\b")
CALL_RE = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
CC_TOKEN_RE = re.compile(r"\b(?:if|for|foreach|while|case|catch)\b|&&|\|\||\?\?|\?(?![.:?])")
MAX_CALLS_PER_FILE = 4000


class _LineIndex:
    """Precomputed newline offsets: O(log n) line lookups instead of O(n) scans."""

    __slots__ = ("offsets",)

    def __init__(self, source):
        self.offsets = [index for index, ch in enumerate(source) if ch == "\n"]

    def line_at(self, index):
        return bisect_left(self.offsets, index) + 1


def language_of(path):
    return LANGUAGES.get(PurePosixPath(path).suffix.lower(), "")


def code_line_count(source):
    """Non-blank lines that are not pure comment lines."""
    total = 0
    for line in source.splitlines():
        text = line.strip()
        if not text or text.startswith(("//", "/*", "*", "*/")):
            continue
        total += 1
    return total


def _blank_range(source, chars, start, end):
    for index in range(start, end):
        if source[index] != "\n":
            chars[index] = " "
    return end


def _blank_string(source, chars, start):
    quote = source[start]
    chars[start] = " "
    index = start + 1
    while index < len(source):
        char = source[index]
        if char == "\\":
            chars[index:index + 2] = " " * min(2, len(source) - index)
            index += 2
            continue
        if char != "\n":
            chars[index] = " "
        index += 1
        if char == quote:
            break
    return index


def _sanitize(source):
    """Blank out comments and string bodies while preserving offsets/newlines."""
    chars = list(source)
    index = 0
    while index < len(source):
        if source.startswith("/*", index):
            closing = source.find("*/", index + 2)
            end = len(source) if closing < 0 else closing + 2
            index = _blank_range(source, chars, index, end)
        elif source.startswith("//", index):
            closing = source.find("\n", index)
            end = len(source) if closing < 0 else closing
            index = _blank_range(source, chars, index, end)
        elif source[index] in "\"'\x60":
            index = _blank_string(source, chars, index)
        else:
            index += 1
    return "".join(chars)


def _brace_pairs(clean):
    pairs, stack = {}, []
    for index, ch in enumerate(clean):
        if ch == "{":
            stack.append(index)
        elif ch == "}" and stack:
            pairs[stack.pop()] = index
    return pairs


def _segment_before(clean, index, limit=400):
    start = max(0, index - limit)
    for mark in ";{}":
        pos = clean.rfind(mark, start, index)
        if pos >= 0:
            start = max(start, pos + 1)
    return clean[start:index]


def _is_control_brace(segment):
    return bool(re.search(r"\b(?:if|for|while|switch|catch|else|do|try)\b", segment))


def _control_before(clean, index):
    """Look back to the previous brace only: `for (a; b; c)` keeps its semicolons."""
    start = max(0, index - 400, clean.rfind("{", 0, index), clean.rfind("}", 0, index))
    return _is_control_brace(clean[start:index])


def _params_of(header):
    open_at = header.find("(")
    if open_at < 0:
        return 0
    text = header[open_at + 1:header.find(")", open_at)]
    if text.strip() in {"", "void"}:
        return 0
    return _count_parameters(header[open_at + 1:])


def _count_parameters(parameters):
    count, has_value = 0, False
    for char in _top_level_parameter_chars(parameters):
        if char == ",":
            count += 1
        elif not char.isspace():
            has_value = True
    return count + 1 if has_value else 0


_PAREN_DEPTH = {"(": 1, ")": -1}


def _top_level_parameter_chars(parameters):
    depth = 1
    for char in parameters:
        if char in _PAREN_DEPTH:
            depth += _PAREN_DEPTH[char]
            if depth == 0:
                break
        elif depth == 1:
            yield char


def _effective_lines(source, start_line, end_line):
    total = 0
    lines = source.splitlines()
    for number in range(start_line, min(end_line, len(lines)) + 1):
        text = lines[number - 1].strip()
        if not text:
            continue
        if text.startswith(("//", "/*", "*", "*/", "#")):
            continue
        total += 1
    return total


def _function_header(clean, brace):
    segment = _segment_before(clean, brace)
    text = segment.strip()
    if not text or "#" in text:
        return None
    arrow = ARROW_RE.search(text)
    if arrow:
        return arrow.group(1), text
    go = GO_FUNC_RE.search(text)
    if go:
        return go.group(1), text
    name = _c_style_function_name(text)
    return (name, text) if name is not None else None


def _c_style_function_name(text):
    if "(" not in text or ")" not in text:
        return None
    head = text.split("(")[0].strip()
    if not CONTROL_WORDS.isdisjoint(head.split()):
        return None
    words = head.replace("*", " ").replace("&", " ").split()
    if not words:
        return None
    name = words[-1]
    if name in KEYWORDS:
        return None
    if not re.fullmatch(r"[A-Za-z_~][\w:~]*", name):
        return None
    return name.split("::")[-1].lstrip("~")


def _class_bases(text):
    match = re.search(r"\b(?:extends|implements)\s+([^{]+)", text)
    names = []
    if match:
        names = [item.strip().split("<")[0] for item in re.split(r",|\band\b", match.group(1)) if item.strip()]
    names.extend(_colon_bases(text))
    return [name for name in names if name and name not in {"public", "private", "protected"}]


def _colon_bases(text):
    colon = re.search(r":\s*([^{]+)", text)
    if not colon:
        return
    for item in colon.group(1).split(","):
        cleaned = re.sub(r"\b(public|private|protected|virtual)\b", "", item).strip().split("<")[0]
        if cleaned and re.fullmatch(r"[\w:.]+", cleaned):
            yield cleaned.split("::")[-1]


def _resolve_include(current_path, target, known):
    base = PurePosixPath(current_path).parent
    candidate = str((base / target).as_posix())
    parts = [part for part in candidate.split("/") if part not in ("", ".", "..")]
    candidate = "/".join(parts)
    normalized = {item.lower(): item for item in known}
    if candidate in known:
        return candidate
    suffix = target.lower()
    for lowered, original in normalized.items():
        if lowered.endswith(suffix):
            return original
    return None


def _inner_spans(spans):
    """Map each function span to the spans strictly nested inside it."""
    ordered = sorted(spans)
    inner = {span: [] for span in ordered}
    for outer_start, outer_end in ordered:
        for start, end in ordered:
            if outer_start < start and end < outer_end:
                inner[(outer_start, outer_end)].append((start, end))
    return inner


def _kept_ranges(start, end, inner):
    """Body ranges with nested-function bodies removed (they are separate units)."""
    kept, cursor = [], start
    for span_start, span_end in sorted(inner):
        if span_start <= start or span_end >= end:
            continue
        if span_start > cursor:
            kept.append((cursor, span_start))
        cursor = max(cursor, span_end)
    if cursor < end:
        kept.append((cursor, end))
    return kept


def _scan_classes(clean, pairs, module, path, lines):
    classes = []
    for match in CLASS_RE.finditer(clean):
        brace = clean.find("{", match.end())
        if brace < 0 or brace not in pairs:
            continue
        header = clean[match.end():brace]
        name = match.group(2)
        entry = {
            "id": f"{module}.{name}",
            "name": name,
            "file": path,
            "line": lines.line_at(match.start()),
            "end_line": lines.line_at(pairs[brace]),
            "kind": "class",
            "methods": [],
            "bases": _class_bases(header),
        }
        if any(item["id"] == entry["id"] for item in classes):
            entry["id"] += "@" + str(entry["line"])
        classes.append(entry)
        classes[-1]["_span"] = (brace, pairs[brace])
    return classes


_EXPRESSION_ARROW = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?"
    r"(\([^()\n]*\)|[A-Za-z_$][\w$]*)[ \t]*=>"
)


def _expression_arrows(clean, source):
    for match in _EXPRESSION_ARROW.finditer(clean):
        body = match.end()
        end = clean.find("\n", body)
        end = len(clean) if end < 0 else end
        first = source[body:end].lstrip()
        if not first or first.startswith(("{", "//", "/*")):
            continue
        stop = clean.find(";", body, end)
        yield match.group(1), match.group(2), match.start(), body - 1, end if stop < 0 else stop


def _add_expression_arrows(functions, clean, source, module, path, lines):
    used_ids = {item["id"] for item in functions}
    for name, header, offset, start, end in _expression_arrows(clean, source):
        line = lines.line_at(offset)
        ident = f"{module}.{name}"
        if ident in used_ids:
            ident += f"@{line}-{offset}"
        used_ids.add(ident)
        functions.append({
            "id": ident, "name": name, "file": path, "line": line,
            "end_line": lines.line_at(end), "kind": "function",
            "_span": (start, end), "_text": header if header.startswith("(") else f"({header})",
            "_owner": None,
        })


def _scan_functions(clean, pairs, classes, module, path, lines):
    """Locate function spans and identities; metrics are applied afterwards."""
    functions = []
    seen_ids = set()
    for brace in sorted(pairs):
        header = _function_header(clean, brace)
        if header is None:
            continue
        name, text = header
        end = pairs[brace]
        start_line = lines.line_at(brace - len(text))
        end_line = lines.line_at(end)
        owner = next((item for item in classes if item["_span"][0] < brace < item["_span"][1]), None)
        ident = f"{module}.{owner['name']}.{name}" if owner else f"{module}.{name}"
        if ident in seen_ids:
            ident += "@" + str(start_line)
        if ident in seen_ids:
            ident += "-" + str(brace)
        seen_ids.add(ident)
        functions.append({
            "id": ident,
            "name": name,
            "file": path,
            "line": start_line,
            "end_line": end_line,
            "kind": "function",
            "_span": (brace, end),
            "_text": text,
            "_owner": owner,
        })
    return functions


def _apply_metrics(functions, clean, source, lines):
    """CC / nesting / length / params, excluding nested-function bodies (the Python
    AST path counts nested definitions separately; this keeps both aligned)."""
    spans = {tuple(item["_span"]) for item in functions}
    inner = _inner_spans(spans)
    for item in functions:
        span = tuple(item["_span"])
        start, end = span
        ranges = _kept_ranges(start + 1, end, inner.get(span) or [])
        item["cc"] = 1 + sum(len(CC_TOKEN_RE.findall(clean[a:b])) for a, b in ranges)
        item["nesting"] = _control_depth(clean, ranges)
        item["length"] = _effective_lines(source, item["line"], item["end_line"])
        item["params"] = _params_of(item["_text"])
        item["statements"] = []
        item["_ranges"] = ranges


def _control_depth(clean, ranges):
    depth = maximum = 0
    stack = []
    positions = (index for start, end in ranges for index in range(start, end))
    for index in positions:
        char = clean[index]
        if char == "{":
            control = _control_before(clean, index)
            stack.append(control)
            depth += control
            maximum = max(maximum, depth)
        elif char == "}" and stack:
            depth -= stack.pop()
    return maximum


def _threshold_findings(functions, path):
    findings = []
    for item in functions:
        if item["cc"] > 10:
            findings.append(_finding(levels.RULE_CC, levels.SEVERITY_CRITICAL if item["cc"] > 20 else levels.SEVERITY_WARNING, path, item["line"],
                                     f"{item['id']} 的圈复杂度为 {item['cc']}，超过阈值 10。",
                                     "检查复杂路径与职责边界，考虑拆分独立逻辑。", actual=item["cc"], threshold=10))
        if item["length"] > 50:
            findings.append(_finding(levels.RULE_LEN, levels.SEVERITY_WARNING, path, item["line"],
                                     f"{item['id']} 的有效代码行数为 {item['length']}，超过阈值 50。",
                                     "拆分过长函数，或提取可复用的独立步骤。", actual=item["length"], threshold=50))
        if item["nesting"] > 4:
            findings.append(_finding(levels.RULE_DEPTH, levels.SEVERITY_WARNING, path, item["line"],
                                     f"{item['id']} 的控制结构嵌套深度为 {item['nesting']}，超过阈值 4。",
                                     "优先用提前返回或拆分函数降低嵌套。", actual=item["nesting"], threshold=4))
    return findings


def _line_findings(source, path):
    findings = []
    for number, line in enumerate(source.splitlines(), 1):
        secret = SECRET_RE.search(line)
        if secret and not PLACEHOLDER_RE.search(secret.group(2)):
            findings.append(_finding(levels.RULE_A4, levels.SEVERITY_WARNING, path, number,
                                     "敏感命名变量被直接赋予非占位字符串字面量；值已从报告隐藏。",
                                     "确认是否为真实凭据，改用环境变量或密钥管理服务；未验证凭据有效性。"))
        catch = _catch_finding(line, path, number)
        if catch is not None:
            findings.append(catch)
        if TODO_RE.search(line) and COMMENT_MARKER_RE.search(line):
            findings.append(_finding(levels.RULE_CMT, levels.SEVERITY_INFO, path, number,
                                     "存在未完成、临时或占位注释，实现可能与注释描述不一致。",
                                     "核对注释与当前实现，补齐未完成部分或删除过期注释。",
                                     evidence=levels.EVIDENCE_INFERENCE, confidence=levels.CONFIDENCE_LOW))
    return findings


def _catch_finding(line, path, number):
    if EMPTY_CATCH_RE.search(line):
        return _finding(levels.RULE_A8_DEFENSIVE, levels.SEVERITY_WARNING, path, number,
                                     "异常捕获块为空，异常被静默吞掉。",
                                     "至少记录异常并给出恢复路径或向上抛出。", evidence=levels.EVIDENCE_INFERENCE, confidence=levels.CONFIDENCE_MEDIUM)
    if BROAD_CATCH_RE.search(line):
        return _finding(levels.RULE_A8_DEFENSIVE, levels.SEVERITY_INFO, path, number,
                                     "捕获范围过宽（Exception/Throwable/...），可能掩盖非预期错误。",
                                     "缩小捕获类型，只处理可恢复的异常。", evidence=levels.EVIDENCE_INFERENCE, confidence=levels.CONFIDENCE_LOW)


def _build_calls(functions, clean, path, lines):
    by_name = {}
    for item in functions:
        by_name.setdefault(item["name"], []).append(item["id"])
    calls = (_call_edge(item, match, offset, by_name, path, lines)
             for item in functions for offset, match in _call_matches(item, clean))
    return list(islice(calls, MAX_CALLS_PER_FILE))


def _call_matches(item, clean):
    for start, end in item["_ranges"]:
        for match in CALL_RE.finditer(clean[start:end]):
            if match.group(1) not in KEYWORDS:
                yield start, match


def _call_edge(item, match, offset, by_name, path, lines):
    name = match.group(1)
    ids = by_name.get(name, ())
    resolved = len(ids) == 1
    return {"source": item["id"], "target": ids[0] if resolved else None,
            "expression": name, "file": path, "line": lines.line_at(offset + match.start()),
            "status": "resolved" if resolved else "unresolved",
            "evidence_type": levels.EVIDENCE_FACT if resolved else levels.EVIDENCE_INFERENCE}


def _dead_code_findings(functions, calls, path):
    """Conservative dead-code signal: private/underscored helpers with no inbound use."""
    inbound = {edge["target"] for edge in calls if edge["status"] == "resolved"}
    findings = []
    for item in functions:
        private = item["name"].startswith("_") or re.search(r"\bprivate\b", item["_text"])
        if private and item["id"] not in inbound and item["name"] not in {"main", "constructor"}:
            findings.append(_finding(levels.RULE_A5_DEAD, levels.SEVERITY_INFO, path, item["line"],
                                     f"{item['id']} 在本次分析范围内没有发现调用方。",
                                     "确认是否被外部、反射或回调使用；确认后再决定删除。",
                                     evidence=levels.EVIDENCE_INFERENCE, confidence=levels.CONFIDENCE_LOW))
    return findings


def analyze_record(record, known_paths):
    """Return functions/classes/findings/edges for one non-Python record."""
    source = record["source"]
    path = record["path"]
    module = record["module"]
    clean = _sanitize(source)
    pairs = _brace_pairs(clean)
    lines = _LineIndex(source)

    classes = _scan_classes(clean, pairs, module, path, lines)
    functions = _scan_functions(clean, pairs, classes, module, path, lines)
    if PurePosixPath(path).suffix.lower() in {".js", ".jsx", ".ts", ".tsx"}:
        _add_expression_arrows(functions, clean, source, module, path, lines)
        functions.sort(key=lambda item: item["_span"])
    for item in functions:
        owner = item["_owner"]
        if owner is not None:
            owner["methods"].append(item["id"])
    _apply_metrics(functions, clean, source, lines)
    calls = _build_calls(functions, clean, path, lines)
    findings = _threshold_findings(functions, path)
    findings.extend(_line_findings(source, path))
    findings.extend(_dead_code_findings(functions, calls, path))
    dependencies = _dependencies(record, known_paths)

    for entry in classes:
        entry.pop("_span", None)
    for item in functions:
        for key in ("_span", "_text", "_owner", "_ranges"):
            item.pop(key, None)
    return {"functions": functions, "classes": classes, "findings": findings,
            "calls": calls, "dependencies": dependencies}


def _finding(rule, severity, path, line, message, suggestion, evidence=levels.EVIDENCE_FACT, actual=None,
             threshold=None, confidence=None):
    return {"rule_id": rule, "severity": severity, "file": path, "line": line,
            "message": message, "suggestion": suggestion, "evidence_type": evidence,
            "actual": actual, "threshold": threshold, "confidence": confidence}


def _c_cpp_edges(source, path, known, push):
    for number, line in enumerate(source.splitlines(), 1):
        match = re.match(r"\s*#\s*include\s+([\"<])([^\">]+)[\">]", line)
        if not match:
            continue
        target = match.group(2)
        push(target, number, _resolve_include(path, target, known))


def _java_edges(source, path, known, push):
    for number, line in enumerate(source.splitlines(), 1):
        match = re.match(r"\s*import\s+(?:static\s+)?([\w.]+)\s*;", line)
        if not match:
            continue
        target = match.group(1)
        guess = target.replace(".", "/") + ".java"
        push(target, number, next((item for item in known if item.endswith(guess)), None))


def _js_edges(source, path, known, push):
    pattern = re.compile(r"(?:from\s+|require\s*\(\s*)['\"]([^'\"]+)['\"]")
    for number, line in enumerate(source.splitlines(), 1):
        for match in pattern.finditer(line):
            target = match.group(1)
            push(target, number, _resolve_js_import(path, target, known))


def _relative_import_stem(raw):
    parts = []
    for part in raw.split("/"):
        if part == "..":
            if parts:
                parts.pop()
        elif part not in ("", "."):
            parts.append(part)
    return "/".join(parts)


def _resolve_js_import(path, target, known):
    if not target.startswith("."):
        return None
    raw = (PurePosixPath(path).parent / target).as_posix()
    stem = _relative_import_stem(raw)
    extensions = (".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js")
    candidates = {stem, *(stem + extension for extension in extensions)}
    return next((item for item in known if item in candidates), None)


def _go_edges(source, path, known, push):
    for number, target in _go_imports(source):
        internal = next((item for item in known if item.rsplit(".", 1)[0].endswith(target)), None)
        push(target, number, internal)


def _go_imports(source):
    in_block = False
    for number, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("import ("):
            in_block = True
            continue
        if in_block and stripped.startswith(")"):
            in_block = False
            continue
        if not (in_block or stripped.startswith("import")):
            continue
        match = re.search(r"\"([^\"]+)\"", stripped)
        if match:
            yield number, match.group(1)


_EDGE_BUILDERS = {
    ".c": _c_cpp_edges, ".h": _c_cpp_edges, ".cc": _c_cpp_edges, ".cpp": _c_cpp_edges,
    ".cxx": _c_cpp_edges, ".hpp": _c_cpp_edges,
    ".java": _java_edges,
    ".js": _js_edges, ".jsx": _js_edges, ".ts": _js_edges, ".tsx": _js_edges,
    ".go": _go_edges,
}


def _dependencies(record, known_paths):
    source = record["source"]
    path = record["path"]
    module = record["module"]
    suffix = PurePosixPath(path).suffix.lower()
    edges = []
    known = {item.replace("\\", "/") for item in known_paths}

    def push(target, line, internal_path=None):
        edges.append({
            "source": module,
            "target": internal_path or target,
            "file": path,
            "line": line,
            "internal": bool(internal_path),
            "evidence_type": levels.EVIDENCE_FACT,
        })

    builder = _EDGE_BUILDERS.get(suffix)
    if builder is not None:
        builder(source, path, known, push)
    return edges
