"""统一中间表示（IR）的只读索引与证据引用解析。

引擎（`core_engine.engine`）产出一份扁平的结果 dict；本模块把它索引成
"可被引用、可被校验、可被切片"的形态。AI 表达层只能通过 ref 指向这里的事实，
不能反过来构造事实——这是整个设计里唯一的事实出口。

## 引用语法

统一为 `kind:payload`，payload 内部再用固定分隔符：

| ref | 指向 | 例子 |
|---|---|---|
| `summary:project` | 本次分析的整体摘要 | `summary:project` |
| `file:pkg/a.py` | 一个被分析的文件 | `file:pkg/a.py` |
| `module:pkg.a` | 一个模块 | `module:pkg.a` |
| `def:pkg.a.f` | 函数或类定义（两者共用） | `def:pkg.a.C.m` |
| `function:pkg.a.f` | 仅函数 | `function:pkg.a.f` |
| `class:pkg.a.C` | 仅类 | `class:pkg.a.C` |
| `line:pkg/a.py#12` | 精确到行 | `line:pkg/a.py#12` |
| `stmt:pkg.a.f#12` | 某函数体内的一条语句 | `stmt:pkg.a.f#12` |
| `finding:finding-3` | 一条 finding | `finding:finding-3` |
| `dep:pkg.a->pkg.b` | 一条内部模块依赖 | `dep:pkg.a->pkg.b` |
| `call:pkg/a.py#12` | 一条（已解析或未解析的）调用 | `call:pkg/a.py#12` |
| `inherit:pkg.a.C->pkg.b.B` | 一条继承关系 | `inherit:pkg.a.C->pkg.b.B` |
| `cycle:0` | 一个循环依赖组 | `cycle:0` |

`resolve(ref)` 只回三种结果：能解析、格式非法、目标不存在。三者对调用方的含义不同，
所以错误信息里带上原因，便于 dropped 记录可读。
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict


def _canonical(value):
    """稳定序列化。IR 层自带一份，避免与 AI 表达层互相依赖。"""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

#: 一个函数切片里最多带的语句条数。超过就截断并标注，避免把整份源码塞进上下文。
MAX_STATEMENTS_PER_FUNCTION = 60
MAX_CALLS_PER_FUNCTION = 40


def _parts(ref):
    if not isinstance(ref, str) or not ref or len(ref) > 512:
        return None, None, "引用格式非法"
    kind, sep, payload = ref.partition(":")
    if not sep or not kind or not payload:
        return None, None, "引用必须形如 kind:payload"
    if ":" in payload:
        return None, None, "引用中不得出现第二个冒号"
    return kind, payload, None


def _split(payload, sep, count):
    parts = payload.split(sep)
    if len(parts) != count:
        return None
    return parts


class Index:
    """对一次 `analyze()` 结果建立的只读索引。构造后不再修改。"""

    def __init__(self, result):
        if not isinstance(result, dict):
            raise ValueError("IR 需要 analyze() 的结果对象")
        self.result = result
        self.files = {}
        self.modules = {}
        self.defs = {}
        self.functions = {}
        self.classes = {}
        self.statements = {}
        self.findings = {}
        self.calls_by_source = defaultdict(list)
        self.calls_by_file_line = defaultdict(list)
        self.findings_by_file = defaultdict(list)
        self.deps = set()
        self.cycles = []
        self.inheritance = []
        self.unaddressable = []

        for record in result.get("files") or []:
            path = record.get("path")
            if not isinstance(path, str):
                continue
            self.files[path] = record
            module = record.get("module")
            if isinstance(module, str):
                self.modules[module] = path
            if "#" in path or "->" in path:
                self.unaddressable.append(path)

        for entry in (result.get("functions") or []) + (result.get("classes") or []):
            ident = entry.get("id")
            if not isinstance(ident, str):
                continue
            self.defs[ident] = entry
            if entry.get("kind") == "class":
                self.classes[ident] = entry
            else:
                self.functions[ident] = entry
            for stmt in entry.get("statements") or []:
                line = stmt.get("line")
                if isinstance(line, int):
                    self.statements[(ident, line)] = stmt

        for finding in result.get("findings") or []:
            ident = finding.get("id")
            if isinstance(ident, str):
                self.findings[ident] = finding
            path = finding.get("file")
            if isinstance(path, str):
                self.findings_by_file[path].append(finding)

        graph = result.get("graph") or {}
        for call in graph.get("calls") or []:
            source = call.get("source")
            if isinstance(source, str):
                self.calls_by_source[source].append(call)
            path, line = call.get("file"), call.get("line")
            if isinstance(path, str) and isinstance(line, int):
                self.calls_by_file_line[(path, line)].append(call)
        for edge in graph.get("dependencies") or []:
            if edge.get("internal"):
                self.deps.add((edge.get("source"), edge.get("target")))
        for edge in graph.get("inheritance") or []:
            self.inheritance.append(edge)
        self.cycles = list(graph.get("cycles") or [])

        for bucket in (self.calls_by_source, self.calls_by_file_line, self.findings_by_file):
            for key in bucket:
                bucket[key].sort(key=_call_key)

    # ---- 基础查询 -----------------------------------------------------

    @property
    def status(self):
        return self.result.get("status")

    def module_of(self, path):
        record = self.files.get(path)
        return record.get("module") if record else None

    def functions_of_file(self, path):
        return sorted((f for f in self.functions.values() if f.get("file") == path),
                      key=lambda f: (f.get("line") or 0, f.get("id")))

    def classes_of_file(self, path):
        return sorted((c for c in self.classes.values() if c.get("file") == path),
                      key=lambda c: (c.get("line") or 0, c.get("id")))

    def symbols(self):
        """可被 AI 引用的全部符号 id（排序后，确定性）。"""
        return sorted(self.defs)

    def rule_ids(self):
        return sorted({f.get("rule_id") for f in self.findings.values() if f.get("rule_id")})

    def fingerprint(self, scope="all"):
        """输入指纹：只取被这次任务实际看到的事实，用于缓存 key。

        不用整份结果 hash —— 那会让"改了一个无关文件的空格"也击穿缓存；
        也不只取 ref 字符串——那会让"同名文件内容变了"复用陈旧结论。
        """
        payload = {
            "scope": scope,
            "engine_version": self.result.get("engine_version"),
            "schema_version": self.result.get("schema_version"),
            "status": self.result.get("status"),
        }
        if scope == "all":
            payload["files"] = sorted(
                (path, record.get("sha256"), record.get("status")) for path, record in self.files.items()
            )
            payload["defs"] = sorted(
                (ident, entry.get("line"), entry.get("end_line")) for ident, entry in self.defs.items()
            )
        elif scope in self.defs:
            entry = self.defs[scope]
            payload["def"] = [scope, entry.get("line"), entry.get("end_line")]
            payload["statements"] = sorted(
                (line, stmt.get("ast_type")) for (ident, line), stmt in self.statements.items() if ident == scope
            )
            payload["calls"] = sorted(
                (call.get("line"), call.get("expression"), call.get("status"))
                for call in self.calls_by_source.get(scope, [])
            )
            payload["file"] = self.files.get(entry.get("file"), {}).get("sha256")
        return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()[:16]

    # ---- 切片 ---------------------------------------------------------

    def slice_function(self, ident):
        """一个函数的完整表达层输入：元数据 + 语句 + 调用 + 命中规则 + 所在类。"""
        entry = self.functions.get(ident) or self.classes.get(ident)
        if not entry:
            return None
        statements = sorted(
            (stmt for (owner, _), stmt in self.statements.items() if owner == ident),
            key=lambda s: (s.get("line") or 0, s.get("end_line") or 0),
        )
        truncated = len(statements) > MAX_STATEMENTS_PER_FUNCTION
        calls = self.calls_by_source.get(ident, [])[:MAX_CALLS_PER_FUNCTION]
        findings = self.findings_in(entry.get("file"), entry.get("line") or 0, entry.get("end_line") or 0)
        owner = None
        if entry.get("kind") == "function":
            for cls in self.classes.values():
                if ident in (cls.get("methods") or []):
                    owner = cls
                    break
        return {
            "id": ident,
            "name": entry.get("name"),
            "kind": entry.get("kind"),
            "file": entry.get("file"),
            "module": self.module_of(entry.get("file")),
            "line": entry.get("line"),
            "end_line": entry.get("end_line"),
            "func": {key: entry.get(key) for key in ("cc", "rank", "nesting", "length", "params")
                     if key in entry},
            "statements": statements[:MAX_STATEMENTS_PER_FUNCTION],
            "statements_truncated": truncated,
            "calls": calls,
            "findings": findings,
            "owner_class": {"id": owner.get("id"), "name": owner.get("name"),
                            "bases": owner.get("bases") or []} if owner else None,
        }

    def slice_module(self, module):
        """一个模块的表达层输入：文件统计 + 顶层符号 + 依赖出边/入边。"""
        path = self.modules.get(module)
        if not path:
            return None
        record = self.files.get(path) or {}
        out_edges = sorted(target for source, target in self.deps if source == module)
        in_edges = sorted(source for source, target in self.deps if target == module)
        symbols = sorted(ident for ident in self.defs if self.defs[ident].get("file") == path)
        return {
            "module": module,
            "path": path,
            "line_count": record.get("line_count"),
            "code_lines": record.get("code_lines"),
            "functions": [ident for ident in symbols if ident in self.functions],
            "classes": [ident for ident in symbols if ident in self.classes],
            "depends_on": out_edges,
            "depended_by": in_edges,
            "findings": [f.get("id") for f in self.findings_by_file.get(path, [])],
        }

    def findings_in(self, path, start, end):
        """落在 [start, end] 行区间内的 finding。A4 不输出原始值，这里也一样。"""
        out = []
        for finding in self.findings_by_file.get(path, []):
            line = finding.get("line")
            if isinstance(line, int) and start <= line <= end:
                out.append({
                    "id": finding.get("id"), "rule_id": finding.get("rule_id"),
                    "severity": finding.get("severity"), "line": line,
                    "message": finding.get("message"), "actual": finding.get("actual"),
                    "threshold": finding.get("threshold"), "confidence": finding.get("confidence"),
                    "evidence_type": finding.get("evidence_type"),
                })
        return out

    def callers_of(self, ident):
        return sorted((call for bucket in self.calls_by_source.values() for call in bucket
                       if call.get("target") == ident), key=_call_key)

    # ---- 解析 ---------------------------------------------------------

    def resolve(self, ref):
        """把 ref 解析成 `{"ok": True, ...}` 或 `{"ok": False, "error": ...}`。"""
        kind, payload, error = _parts(ref)
        if error:
            return {"ok": False, "error": error}

        if kind == "summary":
            if payload != "project":
                return {"ok": False, "error": "summary 引用只支持 summary:project"}
            return {"ok": True, "kind": kind, "payload": payload}

        if kind == "file":
            if payload not in self.files:
                return {"ok": False, "error": "文件不在本次分析范围内：" + payload}
            return {"ok": True, "kind": kind, "path": payload,
                    "sha256": self.files[payload].get("sha256")}

        if kind == "module":
            if payload not in self.modules:
                return {"ok": False, "error": "模块不在本次分析范围内：" + payload}
            return {"ok": True, "kind": kind, "module": payload, "path": self.modules[payload]}

        if kind == "def":
            if payload not in self.defs:
                return {"ok": False, "error": "符号不在本次分析结果中：" + payload}
            return {"ok": True, "kind": kind, "id": payload,
                    "symbol_kind": self.defs[payload].get("kind")}

        if kind in ("function", "class"):
            table = self.functions if kind == "function" else self.classes
            if payload not in table:
                return {"ok": False, "error": "没有这个{}：{}".format("函数" if kind == "function" else "类", payload)}
            return {"ok": True, "kind": kind, "id": payload}

        if kind == "line":
            parts = _split(payload, "#", 2)
            if not parts:
                return {"ok": False, "error": "line 引用必须形如 line:path#行号"}
            path, raw_line = parts
            if path not in self.files:
                return {"ok": False, "error": "文件不在本次分析范围内：" + path}
            line = _line_number(raw_line)
            if line is None:
                return {"ok": False, "error": "行号非法：" + raw_line}
            record = self.files[path]
            if line < 1 or line > (record.get("line_count") or 0):
                return {"ok": False, "error": "行号超出文件范围：{}#{}".format(path, line)}
            return {"ok": True, "kind": kind, "path": path, "line": line}

        if kind == "stmt":
            parts = _split(payload, "#", 2)
            if not parts:
                return {"ok": False, "error": "stmt 引用必须形如 stmt:符号#行号"}
            ident, raw_line = parts
            line = _line_number(raw_line)
            if line is None:
                return {"ok": False, "error": "行号非法：" + raw_line}
            if (ident, line) not in self.statements:
                return {"ok": False, "error": "该函数第 {} 行不是已抽取的语句：{}".format(line, ident)}
            return {"ok": True, "kind": kind, "id": ident, "line": line,
                    "ast_type": self.statements[(ident, line)].get("ast_type")}

        if kind == "finding":
            if payload not in self.findings:
                return {"ok": False, "error": "没有这条 finding：" + payload}
            return {"ok": True, "kind": kind, "id": payload,
                    "rule_id": self.findings[payload].get("rule_id")}

        if kind == "dep":
            parts = _split(payload, "->", 2)
            if not parts:
                return {"ok": False, "error": "dep 引用必须形如 dep:源->目标"}
            if tuple(parts) not in self.deps:
                return {"ok": False, "error": "没有这条内部依赖：" + payload}
            return {"ok": True, "kind": kind, "source": parts[0], "target": parts[1]}

        if kind == "call":
            parts = _split(payload, "#", 2)
            if not parts:
                return {"ok": False, "error": "call 引用必须形如 call:path#行号"}
            path, raw_line = parts
            line = _line_number(raw_line)
            if line is None:
                return {"ok": False, "error": "行号非法：" + raw_line}
            if (path, line) not in self.calls_by_file_line:
                return {"ok": False, "error": "该位置没有已记录的调用：{}#{}".format(path, line)}
            return {"ok": True, "kind": kind, "path": path, "line": line}

        if kind == "inherit":
            parts = _split(payload, "->", 2)
            if not parts:
                return {"ok": False, "error": "inherit 引用必须形如 inherit:子类->父类"}
            for edge in self.inheritance:
                if edge.get("source") == parts[0] and edge.get("target") == parts[1]:
                    return {"ok": True, "kind": kind, "source": parts[0], "target": parts[1]}
            return {"ok": False, "error": "没有这条继承关系：" + payload}

        if kind == "cycle":
            index = _line_number(payload)
            if index is None or index < 0 or index >= len(self.cycles):
                return {"ok": False, "error": "没有这个循环依赖组：" + payload}
            return {"ok": True, "kind": kind, "index": index, "modules": list(self.cycles[index])}

        return {"ok": False, "error": "未知的引用类型：" + kind[:24]}

    def check(self, refs):
        """批量解析，返回 (保留的 refs, 失败原因列表)。"""
        kept, errors = [], []
        for ref in refs:
            outcome = self.resolve(ref)
            if outcome.get("ok"):
                kept.append(ref)
            else:
                errors.append({"ref": ref, "error": outcome.get("error")})
        return kept, errors


def _line_number(raw):
    try:
        value = int(raw, 10)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _call_key(call):
    return (call.get("file") or "", call.get("line") or 0, call.get("expression") or "")


def build_index(result):
    return Index(result)
