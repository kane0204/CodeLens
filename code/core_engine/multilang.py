"""Deterministic, non-executing heuristics for common non-Python source files."""
from __future__ import annotations

import base64
import hashlib
import re
from pathlib import PurePosixPath

from .engine import EXCLUDED, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, VERSION, normalized_path

LANGUAGES = {
    ".c": "C", ".h": "C/C++",
    ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".hpp": "C++", ".hh": "C++",
    ".java": "Java", ".cs": "C#", ".kt": "Kotlin", ".kts": "Kotlin",
    ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
    ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
    ".swift": "Swift", ".scala": "Scala", ".vue": "Vue",
}

RULES = ["LANG-CC", "A4", "EXC-01", "VAL-01", "CMT-01", "A5-DEAD",
         "A8-DEFENSIVE", "DUP-01", "DEP-01"]

LIMITATIONS = [
    "非 Python 文件使用确定性的语法与结构启发式检查，不构建编译器级类型系统。",
    "调用关系只展示可静态识别的依赖和高风险调用，跨模块重载与动态分发可能未解析。",
    "复杂度、未校验假设和注释一致性为近似指标，需结合源码人工复核。",
]

_IDENT = r"(?:this\.|self\.|[A-Za-z_]\w*::)*([A-Za-z_]\w*)"
_CALL = re.compile(r"\b" + _IDENT + r"\s*\(")
_NOT_FUNCTIONS = {
    "if", "for", "while", "switch", "catch", "return", "sizeof", "new", "delete",
    "do", "else", "try", "throw", "case", "when", "match", "assert", "synchronized",
}
_RISKY_CALL = re.compile(
    r"\b(?:system|popen|exec|execl|execv|eval|Function|Runtime\.getRuntime|"
    r"ProcessBuilder|child_process|spawn|execFile|Class\.forName|reflect|"
    r"Runtime\.exec|NSProcessInfo|ProcessStartInfo|shell_exec|passthru)\b",
    re.I,
)


def module_name(path):
    value = str(PurePosixPath(path).with_suffix("")).replace("/", ".")
    return value[:-9] if value.endswith(".__init__") else value


def _decode(raw):
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeError:
            continue
    raise UnicodeError("无法识别源码编码")


def _masked(source, hash_comments=True):
    """Blank comments and string content while preserving newlines and offsets."""
    chars = list(source)
    i, n = 0, len(chars)
    state = "code"
    while i < n:
        ch = chars[i]
        nxt = chars[i + 1] if i + 1 < n else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                state = "line"
                chars[i] = chars[i + 1] = " "
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state = "block"
                chars[i] = chars[i + 1] = " "
                i += 2
                continue
            if hash_comments and ch == "#" and (i == 0 or source[i - 1] != "$"):
                state = "line"
                chars[i] = " "
                i += 1
                continue
            if ch in {'"', "'", "`"}:
                state = ch
                i += 1
                continue
        elif state == "line":
            if ch == "\n":
                state = "code"
            else:
                chars[i] = " "
        elif state == "block":
            if ch == "*" and nxt == "/":
                chars[i] = chars[i + 1] = " "
                state = "code"
                i += 2
                continue
            if ch != "\n":
                chars[i] = " "
        else:
            if ch == "\\":
                if i + 1 < n and chars[i + 1] != "\n":
                    chars[i + 1] = " "
                i += 2
                continue
            if ch == state:
                state = "code"
            elif ch != "\n":
                chars[i] = " "
        i += 1
    return "".join(chars)


def _code_lines(source):
    return sum(
        1 for line in _masked(source).splitlines()
        if line.strip() and line.strip() not in {"{", "}", "};", "};"}
    )


def _brace_end(source, opening):
    depth = 0
    state = "code"
    i = opening
    while i < len(source):
        ch = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                state = "line"
                i += 2
                continue
            if ch == "/" and nxt == "*":
                state = "block"
                i += 2
                continue
            if ch in {'"', "'", "`"}:
                state = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i
        elif state == "line":
            if ch == "\n":
                state = "code"
        elif state == "block":
            if ch == "*" and nxt == "/":
                state = "code"
                i += 2
                continue
        else:
            if ch == "\\":
                i += 2
                continue
            if ch == state:
                state = "code"
        i += 1
    return len(source) - 1


def _branch_score(body):
    patterns = (
        r"\bif\b", r"\bfor\b", r"\bwhile\b", r"\bcase\b", r"\bcatch\b",
        r"\bwhen\b", r"\belse\s+if\b", r"\?\s*[^:]+\s*:", r"&&", r"\|\|",
    )
    return 1 + sum(len(re.findall(pattern, body)) for pattern in patterns)


def _nesting(body):
    depth = maximum = 0
    for ch in _masked(body):
        if ch == "{":
            depth += 1
            maximum = max(maximum, depth)
        elif ch == "}":
            depth = max(0, depth - 1)
    return maximum


def _function_matches(masked, language):
    lines = masked.splitlines()
    patterns = [
        re.compile(r"\b(?:function|fun|func|fn)\s+([A-Za-z_]\w*)\s*\("),
        re.compile(r"\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_]\w*\s*=>)"),
        re.compile(r"\b(?:public|private|protected|static|final|abstract|synchronized|native|default|override|virtual|inline|constexpr|extern|unsafe|async|pub)\b[^;\n{}]*?\b([A-Za-z_]\w*)\s*\([^;\n{}]*\)\s*(?:throws[^{]+)?\{"),
        re.compile(r"^\s*(?:[A-Za-z_][\w:<>\[\],*&? ]*\s+)+([A-Za-z_]\w*)\s*\([^;\n{}]*\)\s*(?:const\s*)?\{"),
    ]
    seen = {}
    for line_no, line in enumerate(lines, 1):
        if not line.strip() or line.lstrip().startswith(("#", "//", "/*", "*")):
            continue
        for pattern in patterns:
            match = pattern.search(line)
            if not match:
                continue
            name = match.group(1)
            if name in _NOT_FUNCTIONS:
                continue
            absolute = sum(len(item) + 1 for item in lines[:line_no - 1]) + match.end()
            brace = masked.find("{", absolute, min(len(masked), absolute + 500))
            if brace < 0:
                continue
            end = _brace_end(masked, brace)
            key = (name, line_no)
            if key in seen:
                break
            seen[key] = {
                "name": name,
                "line": line_no,
                "end_line": masked.count("\n", 0, end) + 1,
                "start": brace,
                "end": end,
            }
            break
    return list(seen.values())


def _class_matches(masked):
    rows = []
    pattern = re.compile(
        r"\b(?:class|struct|interface|record|enum|trait|object)\s+([A-Za-z_]\w*)"
        r"(?:\s*(?:extends|implements|:)\s*([A-Za-z_][\w.,<> :]*))?"
    )
    for match in pattern.finditer(masked):
        line = masked.count("\n", 0, match.start()) + 1
        bases = []
        raw = (match.group(2) or "").strip()
        for part in re.split(r",|\bimplements\b|\bextends\b", raw):
            name = re.search(r"[A-Za-z_]\w*", part)
            if name and name.group(0) not in {"extends", "implements"}:
                bases.append(name.group(0))
        rows.append({"name": match.group(1), "line": line, "bases": bases})
    return rows


def _dependencies(masked):
    pattern = re.compile(
        r'(?:#\s*include\s*[<"]([^>"]+)[>"]|'
        r'\b(?:import|from|using|use)\s+([A-Za-z_][\w.:/-]+)|'
        r'\brequire\s*\(\s*["\']([^"\']+)["\']\s*\)|'
        r'\bimport\s+["\']([^"\']+)["\'])'
    )
    rows = []
    for match in pattern.finditer(masked):
        target = next((item for item in match.groups() if item), "")
        if target:
            rows.append((masked.count("\n", 0, match.start()) + 1, target))
    return rows


def _finding(rule, severity, path, line, message, suggestion, evidence="inference", confidence="medium"):
    return {
        "rule_id": rule, "severity": severity, "file": path, "line": line,
        "message": message, "suggestion": suggestion, "evidence_type": evidence,
        "actual": None, "threshold": None, "confidence": confidence,
    }


def analyze(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("files"), list):
        raise ValueError("分析负载必须包含 files 列表")
    if len(payload["files"]) > MAX_FILES:
        raise ValueError(f"最多分析 {MAX_FILES} 个源码文件，请缩小目录范围")
    project = str(payload.get("project", "多语言项目"))[:120]
    records, total, seen, excluded = [], 0, set(), 0
    for item in payload["files"]:
        if not isinstance(item, dict):
            raise ValueError("文件记录无效")
        path = normalized_path(item.get("path"))
        suffix = PurePosixPath(path).suffix.lower()
        if suffix not in LANGUAGES or any(part in EXCLUDED for part in PurePosixPath(path).parts[:-1]):
            excluded += 1
            continue
        if path in seen:
            raise ValueError("存在重复的文件路径")
        seen.add(path)
        record = {
            "path": path, "module": module_name(path), "language": LANGUAGES[suffix],
            "source": "", "status": "error", "functions": [], "classes": [],
            "line_count": 0, "code_lines": 0,
        }
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
            record["source"] = _decode(raw)
            record["line_count"] = len(record["source"].splitlines())
            record["code_lines"] = _code_lines(record["source"])
            record["status"] = "ok"
        except (ValueError, UnicodeError) as exc:
            record["error"] = {
                "file": path, "line": None, "type": type(exc).__name__,
                "message": f"读取或解码失败：{exc}",
            }
        records.append(record)
    if total > MAX_TOTAL_BYTES:
        raise ValueError("源码总量超过 8 MB，请缩小目录范围")
    records.sort(key=lambda item: item["path"])

    findings, calls, inheritance = [], [], []
    dependencies = []
    module_paths = {record["module"]: record["path"] for record in records}
    function_rows = []
    duplicate_map = {}

    for record in records:
        if record["status"] != "ok":
            continue
        path, source = record["path"], record["source"]
        masked = _masked(source)
        functions = _function_matches(masked, record["language"])
        for fn in functions:
            body = source[fn["start"]:fn["end"] + 1]
            ident = f"{record['module']}.{fn['name']}"
            if any(item["id"] == ident for item in record["functions"]):
                ident += f"@{fn['line']}"
            entry = {
                "id": ident, "name": fn["name"], "file": path,
                "line": fn["line"], "end_line": fn["end_line"],
                "kind": "function", "cc": _branch_score(body),
                "nesting": _nesting(body),
                "length": max(1, _code_lines(body)),
                "params": max(0, len(re.findall(r",", fn["name"])) + 1),
                "statements": [],
            }
            record["functions"].append(entry)
            function_rows.append(entry)
            digest = hashlib.sha256(re.sub(r"\s+", "", masked[fn["start"]:fn["end"] + 1]).encode()).hexdigest()
            if entry["length"] >= 4:
                duplicate_map.setdefault(digest, []).append(
                    {"id": ident, "file": path, "line": fn["line"], "end_line": fn["end_line"]}
                )
        for cls in _class_matches(masked):
            ident = f"{record['module']}.{cls['name']}@{cls['line']}"
            record["classes"].append({
                "id": ident, "name": cls["name"], "file": path, "line": cls["line"],
                "end_line": cls["line"], "kind": "class", "methods": [], "bases": cls["bases"],
            })
            for base in cls["bases"]:
                target = next((ident for ident in module_paths if ident.rsplit(".", 1)[-1] == base), None)
                if target:
                    inheritance.append({
                        "source": ident, "target": target, "file": path,
                        "line": cls["line"], "evidence_type": "inference",
                    })

        for line_no, target in _dependencies(_masked(source, hash_comments=False)):
            normalized = target.replace("\\", "/").lstrip("./")
            internal = next(
                (module for module, module_path in module_paths.items()
                 if module_path != path and (
                     module.endswith(normalized.replace("/", "."))
                     or module.endswith(PurePosixPath(normalized).stem)
                 )),
                None,
            )
            dependencies.append({
                "source": record["module"], "target": internal or target,
                "file": path, "line": line_no, "internal": bool(internal),
                "evidence_type": "fact" if internal else "inference",
            })

        try_block = bool(re.search(r"\b(?:try|catch|except|recover|defer)\b", masked))
        for match in _CALL.finditer(masked):
            name = match.group(1)
            if name in _NOT_FUNCTIONS:
                continue
            line_no = masked.count("\n", 0, match.start()) + 1
            expression = match.group(0)[:-1].strip()
            if _RISKY_CALL.search(expression):
                calls.append({
                    "source": record["module"], "target": None, "expression": expression,
                    "file": path, "line": line_no, "status": "unresolved",
                    "evidence_type": "inference",
                })
                if not try_block:
                    findings.append(_finding(
                        "EXC-01", "warning", path, line_no,
                        f"高风险调用 {expression} 附近没有发现异常处理边界。",
                        "确认调用失败时的返回值或异常路径，并记录可恢复策略。",
                    ))
        secret = re.compile(
            r"\b(password|passwd|secret|token|api[_-]?key|access[_-]?key)\b"
            r"\s*[:=]\s*[\"']([^\"']{8,})[\"']",
            re.I,
        )
        for match in secret.finditer(source):
            value = match.group(2)
            if re.search(r"demo|example|sample|test|placeholder|change|dummy|xxxx", value, re.I):
                continue
            findings.append(_finding(
                "A4", "warning", path, masked.count("\n", 0, match.start()) + 1,
                f"敏感字段 {match.group(1)} 直接赋值为字面量，值已从结果中移除。",
                "改用环境变量或密钥服务，并轮换可能已经泄露的凭据。",
            ))
        for match in re.finditer(r"catch\s*\([^)]*\)\s*\{\s*\}", masked):
            findings.append(_finding(
                "A8-DEFENSIVE", "warning", path, masked.count("\n", 0, match.start()) + 1,
                "异常分支被空实现或空 catch 静默忽略。",
                "至少记录上下文、错误类型和恢复策略，或移除无效防御。",
            ))
        comment_lines = set()
        for match in re.finditer(
            r"(?:\bTODO\b|\bFIXME\b|\bHACK\b|not\s+implemented|temporar|未实现|临时|占位)",
            source,
            re.I,
        ):
            line_no = source.count("\n", 0, match.start()) + 1
            if line_no in comment_lines:
                continue
            comment_lines.add(line_no)
            findings.append(_finding(
                "CMT-01", "info", path, line_no,
                "源码中的未完成或临时注释可能表示实现与当前说明不一致。",
                "核对注释后的实现是否已经完成，并更新或删除失效说明。",
                "inference", "low",
            ))
        for fn in record["functions"]:
            body = masked[source.find("{", sum(len(x) + 1 for x in source.splitlines()[:fn["line"] - 1])):
                          source.find("{", sum(len(x) + 1 for x in source.splitlines()[:fn["line"] - 1])) + 2000]
            if re.search(r"\[[^\]]+\]", body) and not re.search(r"\b(?:if|assert|length|size|empty|isNull|isNone)\b", body):
                findings.append(_finding(
                    "VAL-01", "info", path, fn["line"],
                    f"{fn['name']} 存在直接下标访问，未发现明确的边界或存在性校验。",
                    "确认输入可能为空、越界或类型不符，并补充显式校验。",
                    "inference", "low",
                ))

    called_names = {}
    for record in records:
        if record["status"] != "ok":
            continue
        for match in _CALL.finditer(_masked(record["source"])):
            called_names[match.group(1)] = called_names.get(match.group(1), 0) + 1
    for fn in function_rows:
        if fn["name"].startswith("_") or fn["name"] in {"main", "run", "init", "constructor"}:
            continue
        if called_names.get(fn["name"], 0) <= 1:
            findings.append(_finding(
                "A5-DEAD", "info", fn["file"], fn["line"],
                f"函数 {fn['name']} 在当前可见源码中没有发现其他引用。",
                "确认框架、插件或外部调用点；若确实无用则删除。",
                "inference", "low",
            ))

    duplicates = []
    for fingerprint, rows in sorted(duplicate_map.items()):
        if len(rows) > 1:
            duplicates.append({"fingerprint": fingerprint, "occurrences": rows})
            first = rows[0]
            for duplicate in rows[1:]:
                findings.append(_finding(
                    "DUP-01", "info", duplicate["file"], duplicate["line"],
                    f"与 {first['file']}:{first['line']} 存在相同实现。",
                    "核对变化方向；需要同步维护时抽取共享实现。",
                    "inference", "medium",
                ))

    order = {"critical": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda item: (order[item["severity"]], item["file"], item["line"], item["rule_id"]))
    for index, item in enumerate(findings, 1):
        item["id"] = f"finding-{index}"
    errors = [record["error"] for record in records if "error" in record]
    functions = [fn for record in records if record["status"] == "ok" for fn in record["functions"]]
    classes = [cls for record in records if record["status"] == "ok" for cls in record["classes"]]
    status = "empty" if not records else "failed" if len(errors) == len(records) else "partial" if errors else "complete"
    languages = sorted({record["language"] for record in records if record["status"] == "ok"})
    return {
        "schema_version": "1.0", "engine_version": VERSION, "project": project, "status": status,
        "config": {
            "language": " / ".join(languages) or "通用源码",
            "excluded": sorted(EXCLUDED), "rules": list(RULES),
            "thresholds": {"cc": 10, "length": 50, "nesting": 4},
            "analysis_mode": "heuristic",
        },
        "summary": {
            "files": len(records), "parsed": len(records) - len(errors), "failed": len(errors),
            "excluded": excluded, "functions": len(functions), "classes": len(classes),
            "code_lines": sum(record["code_lines"] for record in records if record["status"] == "ok"),
            "findings": len(findings),
            "average_cc": round(sum(fn["cc"] for fn in functions) / len(functions), 2) if functions else None,
            "max_cc": max((fn["cc"] for fn in functions), default=None),
        },
        "files": records, "functions": functions, "classes": classes, "findings": findings,
        "duplicates": duplicates,
        "graph": {
            "dependencies": sorted(dependencies, key=lambda item: (item["file"], item["line"], item["target"])),
            "calls": sorted(calls, key=lambda item: (item["file"], item["line"], item["expression"])),
            "inheritance": sorted(inheritance, key=lambda item: (item["source"], item["target"])),
            "cycles": [],
        },
        "errors": errors, "warnings": [],
        "limitations": list(LIMITATIONS),
        "language_counts": {name: sum(1 for record in records if record["language"] == name) for name in languages},
    }


def merge(python_result, generic_result, project):
    """Merge Python AST facts with deterministic multi-language records."""
    if python_result is None:
        return generic_result
    result = dict(python_result)
    result["project"] = project
    for key in ("files", "functions", "classes", "findings", "errors", "warnings"):
        result[key] = list(result.get(key) or []) + list(generic_result.get(key) or [])
    result["duplicates"] = list(result.get("duplicates") or []) + list(generic_result.get("duplicates") or [])
    graph = dict(result.get("graph") or {})
    for key in ("dependencies", "calls", "inheritance"):
        graph[key] = list(graph.get(key) or []) + list(generic_result.get("graph", {}).get(key) or [])
    graph["cycles"] = list(graph.get("cycles") or []) + list(generic_result.get("graph", {}).get("cycles") or [])
    result["graph"] = graph
    result["limitations"] = list(result.get("limitations") or []) + list(generic_result.get("limitations") or [])
    result["language_counts"] = generic_result.get("language_counts") or {}
    result["language_counts"]["Python"] = len([r for r in python_result.get("files", []) if r.get("status") == "ok"])
    functions = result["functions"]
    findings = structured_findings(result["findings"])
    errors = result["errors"]
    parsed = sum(1 for item in result["files"] if item.get("status") == "ok")
    result["status"] = "failed" if result["files"] and len(errors) == len(result["files"]) else "partial" if errors else "complete"
    result["summary"] = {
        **python_result.get("summary", {}),
        "files": len(result["files"]), "parsed": parsed, "failed": len(errors),
        "excluded": int(python_result.get("summary", {}).get("excluded", 0)) + int(generic_result.get("summary", {}).get("excluded", 0)),
        "functions": len(functions), "classes": len(result["classes"]), "findings": len(findings),
        "code_lines": int(python_result.get("summary", {}).get("code_lines", 0)) + int(generic_result.get("summary", {}).get("code_lines", 0)),
        "average_cc": round(sum(fn.get("cc", 1) for fn in functions) / len(functions), 2) if functions else None,
        "max_cc": max((fn.get("cc", 1) for fn in functions), default=None),
    }
    result["findings"] = findings
    config = dict(result.get("config") or {})
    config["language"] = "Python 3.11 + " + generic_result.get("config", {}).get("language", "通用源码")
    config["rules"] = list(dict.fromkeys(list(config.get("rules") or []) + list(generic_result.get("config", {}).get("rules") or [])))
    config["multi_language"] = True
    result["config"] = config
    return result


def structured_findings(findings):
    order = {"critical": 0, "warning": 1, "info": 2}
    rows = []
    for item in findings:
        row = dict(item)
        row.pop("id", None)
        rows.append(row)
    rows.sort(key=lambda item: (
        order.get(item.get("severity"), 9), item.get("file") or "",
        item.get("line") or 0, item.get("rule_id") or "",
    ))
    for index, row in enumerate(rows, 1):
        row["id"] = f"finding-{index}"
    return rows
