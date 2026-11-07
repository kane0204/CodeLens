"""Brace/lexer based analysis for non-Python sources.

Design constraints:
- Never executes or imports analysed code.
- Produces the same record shape as the Python AST path so the workbench can
  render both without branching on language.
- Metrics are approximations and are labelled as such in ``LIMITATIONS``.
"""
from __future__ import annotations

import re
from pathlib import PurePosixPath

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
TODO_RE = re.compile(r"(?:\btodo\b|\bfixme\b|\bhack\b|\bxxx\b|待实现|临时方案|未完成)", re.I)
EMPTY_CATCH_RE = re.compile(r"catch\s*\([^)]*\)\s*\{\s*\}")
BROAD_CATCH_RE = re.compile(r"catch\s*\(\s*(?:Exception|Throwable|\.\.\.)\b")


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


def _sanitize(source):
    """Blank out comments and string bodies while preserving offsets/newlines."""
    chars = list(source)
    i, n = 0, len(source)
    in_block = False
    while i < n:
        c = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
        if in_block:
            if c == "*" and nxt == "/":
                chars[i] = chars[i + 1] = " "
                in_block = False
                i += 2
                continue
            if c != "\n":
                chars[i] = " "
            i += 1
            continue
        if c == "/" and nxt == "*":
            chars[i] = chars[i + 1] = " "
            in_block = True
            i += 2
            continue
        if c == "/" and nxt == "/":
            while i < n and source[i] != "\n":
                chars[i] = " "
                i += 1
            continue
        if c in "\"'`":
            quote = c
            chars[i] = " "
            i += 1
            while i < n:
                if source[i] == "\\":
                    chars[i] = " "
                    if i + 1 < n:
                        chars[i + 1] = " "
                    i += 2
                    continue
                if source[i] == quote:
                    chars[i] = " "
                    i += 1
                    break
                if source[i] != "\n":
                    chars[i] = " "
                i += 1
            continue
        i += 1
    return "".join(chars)


def _brace_pairs(clean):
    pairs, stack = {}, []
    for index, ch in enumerate(clean):
        if ch == "{":
            stack.append(index)
        elif ch == "}" and stack:
            pairs[stack.pop()] = index
    return pairs


def _line_at(source, index):
    return source.count("\n", 0, index) + 1


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
    depth, count, has_value = 0, 0, False
    for ch in header[open_at:]:
        if ch == "(":
            depth += 1
            if depth == 1:
                continue
        elif ch == ")":
            depth -= 1
            if depth == 0:
                break
        elif depth == 1 and ch == ",":
            count += 1
        elif depth == 1 and not ch.isspace():
            has_value = True
    if not has_value:
        return 0
    text = header[open_at + 1: header.find(")", open_at)]
    if text.strip() in {"", "void"}:
        return 0
    return count + 1


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
    if "(" not in text or ")" not in text:
        return None
    head = text.split("(")[0].strip()
    if not head or any(word in head.split() for word in CONTROL_WORDS):
        return None
    words = head.replace("*", " ").replace("&", " ").split()
    if not words:
        return None
    name = words[-1]
    if name in KEYWORDS:
        return None
    if not re.fullmatch(r"[A-Za-z_~][\w:~]*", name):
        return None
    # C/C++ declarations such as `int x` must not be treated as functions.
    if text.rstrip().endswith(";") and "{" not in text:
        return None
    return name.split("::")[-1].lstrip("~"), text


def _class_bases(text):
    match = re.search(r"\b(?:extends|implements)\s+([^{]+)", text)
    names = []
    if match:
        names = [item.strip().split("<")[0] for item in re.split(r",|\band\b", match.group(1)) if item.strip()]
    colon = re.search(r":\s*([^{]+)", text)
    if colon:
        for item in colon.group(1).split(","):
            cleaned = re.sub(r"\b(public|private|protected|virtual)\b", "", item).strip().split("<")[0]
            if cleaned and re.fullmatch(r"[\w:.]+", cleaned):
                names.append(cleaned.split("::")[-1])
    return [name for name in names if name and name not in {"public", "private", "protected"}]


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


def analyze_record(record, known_paths):
    """Return functions/classes/findings/edges for one non-Python record."""
    source = record["source"]
    path = record["path"]
    module = record["module"]
    clean = _sanitize(source)
    pairs = _brace_pairs(clean)
    functions, classes = [], []
    class_entries = []

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
            "line": _line_at(source, match.start()),
            "end_line": _line_at(source, pairs[brace]),
            "kind": "class",
            "methods": [],
            "bases": _class_bases(header),
        }
        if any(item["id"] == entry["id"] for item in class_entries):
            entry["id"] += "@" + str(entry["line"])
        class_entries.append(entry)
        class_entries[-1]["_span"] = (brace, pairs[brace])

    seen_ids = set()
    for brace in sorted(pairs):
        header = _function_header(clean, brace)
        if header is None:
            continue
        name, text = header
        end = pairs[brace]
        start_line = _line_at(source, brace - len(text))
        end_line = _line_at(source, end)
        if end_line < start_line:
            continue
        body = clean[brace + 1:end]
        owner = next((item for item in class_entries if item["_span"][0] < brace < item["_span"][1]), None)
        ident = f"{module}.{owner['name']}.{name}" if owner else f"{module}.{name}"
        if ident in seen_ids:
            ident += "@" + str(start_line)
        if ident in seen_ids:
            continue
        seen_ids.add(ident)

        cc = 1
        cc += len(re.findall(r"\bif\b", body))
        cc += len(re.findall(r"\bfor\b", body))
        cc += len(re.findall(r"\bforeach\b", body))
        cc += len(re.findall(r"\bwhile\b", body))
        cc += len(re.findall(r"\bcase\b", body))
        cc += len(re.findall(r"\bcatch\b", body))
        cc += len(re.findall(r"&&", body))
        cc += len(re.findall(r"\|\|", body))
        cc += len(re.findall(r"\?(?![.:])", body))

        depth = maximum = 0
        stack = []
        for index, ch in enumerate(body):
            if ch == "{":
                control = _control_before(body, index)
                stack.append(control)
                if control:
                    depth += 1
                    maximum = max(maximum, depth)
            elif ch == "}" and stack:
                if stack.pop():
                    depth -= 1

        functions.append({
            "id": ident,
            "name": name,
            "file": path,
            "line": start_line,
            "end_line": end_line,
            "kind": "function",
            "cc": cc,
            "nesting": maximum,
            "length": _effective_lines(source, start_line, end_line),
            "params": _params_of(text),
            "statements": [],
            "_body": (brace + 1, end),
            "_text": text,
        })
        if owner:
            owner["methods"].append(ident)

    for entry in class_entries:
        entry.pop("_span", None)
        classes.append(entry)

    findings = []
    for item in functions:
        if item["cc"] > 10:
            findings.append(_finding("CC-01", "critical" if item["cc"] > 20 else "warning", path, item["line"],
                                     f"{item['id']} 的圈复杂度为 {item['cc']}，超过阈值 10。",
                                     "检查复杂路径与职责边界，考虑拆分独立逻辑。", actual=item["cc"], threshold=10))
        if item["length"] > 50:
            findings.append(_finding("LEN-01", "warning", path, item["line"],
                                     f"{item['id']} 的有效代码行数为 {item['length']}，超过阈值 50。",
                                     "拆分过长函数，或提取可复用的独立步骤。", actual=item["length"], threshold=50))
        if item["nesting"] > 4:
            findings.append(_finding("DEPTH-01", "warning", path, item["line"],
                                     f"{item['id']} 的控制结构嵌套深度为 {item['nesting']}，超过阈值 4。",
                                     "优先用提前返回或拆分函数降低嵌套。", actual=item["nesting"], threshold=4))

    for number, line in enumerate(source.splitlines(), 1):
        secret = SECRET_RE.search(line)
        if secret and not PLACEHOLDER_RE.search(secret.group(2)):
            findings.append(_finding("A4", "warning", path, number,
                                     "敏感命名变量被直接赋予非占位字符串字面量；值已从报告隐藏。",
                                     "确认是否为真实凭据，改用环境变量或密钥管理服务；未验证凭据有效性。"))
        if EMPTY_CATCH_RE.search(line):
            findings.append(_finding("A8-DEFENSIVE", "warning", path, number,
                                     "异常捕获块为空，异常被静默吞掉。",
                                     "至少记录异常并给出恢复路径或向上抛出。", evidence="inference", confidence="medium"))
        elif BROAD_CATCH_RE.search(line):
            findings.append(_finding("A8-DEFENSIVE", "info", path, number,
                                     "捕获范围过宽（Exception/Throwable/...），可能掩盖非预期错误。",
                                     "缩小捕获类型，只处理可恢复的异常。", evidence="inference", confidence="low"))
        if TODO_RE.search(line) and ("//" in line or "#" in line or "/*" in line or "*" in line):
            findings.append(_finding("CMT-01", "info", path, number,
                                     "存在未完成、临时或占位注释，实现可能与注释描述不一致。",
                                     "核对注释与当前实现，补齐未完成部分或删除过期注释。",
                                     evidence="inference", confidence="low"))

    unknown = {item["name"]: item["id"] for item in functions}
    calls = []
    for item in functions:
        start, end = item["_body"]
        body = clean[start:end]
        for match in re.finditer(r"\b([A-Za-z_]\w*)\s*\(", body):
            name = match.group(1)
            if name in KEYWORDS:
                continue
            target = unknown.get(name)
            resolved = bool(target) and sum(1 for other in functions if other["name"] == name) == 1
            if len(calls) >= 4000:
                break
            calls.append({
                "source": item["id"],
                "target": target if resolved else None,
                "expression": name,
                "file": path,
                "line": _line_at(source, start + match.start()),
                "status": "resolved" if resolved else "unresolved",
                "evidence_type": "fact" if resolved else "inference",
            })

    # Conservative dead-code signal: private/underscored helpers with no inbound use.
    inbound = {edge["target"] for edge in calls if edge["status"] == "resolved"}
    for item in functions:
        private = item["name"].startswith("_") or re.search(r"\bprivate\b", item["_text"])
        if private and item["id"] not in inbound and item["name"] not in {"main", "constructor"}:
            findings.append(_finding("A5-DEAD", "info", path, item["line"],
                                     f"{item['id']} 在本次分析范围内没有发现调用方。",
                                     "确认是否被外部、反射或回调使用；确认后再决定删除。",
                                     evidence="inference", confidence="low"))

    dependencies = _dependencies(record, known_paths)
    for item in functions:
        item.pop("_body", None)
        item.pop("_text", None)
    return {"functions": functions, "classes": classes, "findings": findings,
            "calls": calls, "dependencies": dependencies}


def _finding(rule, severity, path, line, message, suggestion, evidence="fact", actual=None,
             threshold=None, confidence=None):
    return {"rule_id": rule, "severity": severity, "file": path, "line": line,
            "message": message, "suggestion": suggestion, "evidence_type": evidence,
            "actual": actual, "threshold": threshold, "confidence": confidence}


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
            "evidence_type": "fact",
        })

    if suffix in {".c", ".h", ".cc", ".cpp", ".cxx", ".hpp"}:
        for number, line in enumerate(source.splitlines(), 1):
            match = re.match(r"\s*#\s*include\s+([\"<])([^\">]+)[\">]", line)
            if not match:
                continue
            target = match.group(2)
            internal = _resolve_include(path, target, known)
            push(target, number, internal)
    elif suffix == ".java":
        for number, line in enumerate(source.splitlines(), 1):
            match = re.match(r"\s*import\s+(?:static\s+)?([\w.]+)\s*;", line)
            if not match:
                continue
            target = match.group(1)
            guess = target.replace(".", "/") + ".java"
            internal = next((item for item in known if item.endswith(guess)), None)
            push(target, number, internal)
    elif suffix in {".js", ".jsx", ".ts", ".tsx"}:
        pattern = re.compile(r"(?:from\s+|require\s*\(\s*)['\"]([^'\"]+)['\"]")
        for number, line in enumerate(source.splitlines(), 1):
            for match in pattern.finditer(line):
                target = match.group(1)
                internal = None
                if target.startswith("."):
                    base = PurePosixPath(path).parent
                    raw = str((base / target).as_posix())
                    parts = []
                    for part in raw.split("/"):
                        if part == "..":
                            if parts:
                                parts.pop()
                        elif part not in ("", "."):
                            parts.append(part)
                    stem = "/".join(parts)
                    candidates = [stem] + [f"{stem}{ext}" for ext in (".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js")]
                    internal = next((item for item in known if item in candidates), None)
                push(target, number, internal)
    elif suffix == ".go":
        in_block = False
        for number, line in enumerate(source.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("import ("):
                in_block = True
                continue
            if in_block and stripped.startswith(")"):
                in_block = False
                continue
            match = re.search(r"\"([^\"]+)\"", stripped) if (in_block or stripped.startswith("import")) else None
            if not match:
                continue
            target = match.group(1)
            internal = next((item for item in known if item.rsplit(".", 1)[0].endswith(target)), None)
            push(target, number, internal)
    return edges
