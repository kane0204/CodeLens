"""时序图数据（静态调用序列）。

口径必须说清楚，避免把静态顺序当成运行时顺序：
- 只使用引擎已产出的 graph.calls（含未解析调用），不新增解析。
- 画面按「调用点在源码中的行号」排序，表示阅读顺序，不是运行时执行顺序。
- 未解析的调用同样列出，标记为未解析；这比隐藏它们更有用。
- 每个文件最多保留 MAX_STEPS_PER_FILE 条，超出后标 truncated。
"""

MAX_STEPS_PER_FILE = 40

NOTES = (
    "顺序依据调用点在源码中的行号，表示阅读顺序，不代表运行时执行顺序。",
    "未解析的调用保留在序列中并标注「未解析」，不会绘制目标参与者。",
    "时序图只覆盖函数体内的调用表达式；装饰器、类体与模块级表达式的调用不在其中。",
)


def _enclosing(functions, line):
    """找出包含该行的最内层函数。"""
    best = None
    best_span = None
    for function in functions:
        start, end = function.get("line"), function.get("end_line")
        if not isinstance(start, int) or not isinstance(end, int):
            continue
        if start <= line <= end:
            span = end - start
            if best_span is None or span < best_span:
                best, best_span = function.get("id"), span
    return best


def _participant_of(target, module):
    """把被调目标归到一个参与者：解析到时取目标所属模块，否则归到当前模块。"""
    if not isinstance(target, str) or not target:
        return module
    head = target.split(".")[0]
    return head or module


def build(result, max_steps=MAX_STEPS_PER_FILE):
    """从引擎结果生成按文件分组的调用序列。"""
    graph = result.get("graph") if isinstance(result, dict) else None
    calls = graph.get("calls") if isinstance(graph, dict) else None
    if not isinstance(calls, list) or not calls:
        return {
            "available": False,
            "reason": "引擎未产出调用关系，无法生成时序图",
            "files": [],
            "notes": list(NOTES),
        }
    modules = {}
    for file in result.get("files") or []:
        if isinstance(file, dict):
            modules[file.get("path")] = file.get("module")
    functions_by_file = {}
    for function in result.get("functions") or []:
        if isinstance(function, dict):
            functions_by_file.setdefault(function.get("file"), []).append(function)
    grouped = {}
    for call in calls:
        if not isinstance(call, dict):
            continue
        path = call.get("file")
        line = call.get("line")
        if not isinstance(path, str) or not isinstance(line, int):
            continue
        grouped.setdefault(path, []).append(call)
    files = []
    for path in sorted(grouped):
        module = modules.get(path) or ""
        ordered = sorted(grouped[path], key=lambda c: (c.get("line"), str(c.get("expression"))))
        steps = []
        for call in ordered[:max_steps]:
            steps.append(
                {
                    "line": call.get("line"),
                    "expression": call.get("expression"),
                    "target": call.get("target"),
                    "status": call.get("status"),
                    "evidence_type": call.get("evidence_type"),
                    "enclosing": _enclosing(functions_by_file.get(path, []), call.get("line")),
                    "participant": _participant_of(call.get("target"), module),
                }
            )
        files.append(
            {
                "file": path,
                "module": module,
                "steps": steps,
                "total": len(ordered),
                "truncated": len(ordered) > len(steps),
            }
        )
    participants = []
    for entry in files:
        for name in [entry["module"]] + [s["participant"] for s in entry["steps"]]:
            if name and name not in participants:
                participants.append(name)
    return {
        "available": True,
        "files": files,
        "participants": participants,
        "resolved": sum(1 for f in files for s in f["steps"] if s["status"] == "resolved"),
        "unresolved": sum(1 for f in files for s in f["steps"] if s["status"] != "resolved"),
        "max_steps_per_file": max_steps,
        "notes": list(NOTES),
    }
