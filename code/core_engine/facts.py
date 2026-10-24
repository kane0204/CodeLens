"""确定性控制流与数据流抽取。只读 AST，不执行源码。

引擎原本只输出"语句轨迹"（按行排列的语句清单），没有结构化的控制流。
AI 表达层要写"这个 if 的 else 分支会走到哪里"，就必须有一份可复算的
分支图作证据，否则它只能靠猜。本模块补上这一层：

- `build_control_flow(node)`：语句级控制流边 + 基本块合并；
- `build_def_use(node)`：函数内变量的定义点/使用点。

两条硬约束：

1. **纯函数**：同一棵 AST 必须得到逐字节相同的结果（节点与边都排序输出）。
2. **可降级**：函数体过大时不输出半截图，而是给 `available: False` 与原因，
   让上层如实说"这里没有 CFG"，而不是把截断结果当成完整事实。

口径写进输出本身的 `notes`，测试直接断言这些口径，避免文档与实现漂移。
"""
from __future__ import annotations

import ast

#: 语句数超过它的函数不做控制流抽取（避免超大函数把结果撑爆）。
MAX_FLOW_STATEMENTS = 150

#: 一个函数最多输出的变量名数量，超出按名称排序截断。
MAX_DEF_USE_NAMES = 120

CONTROL_NODES = (ast.If, ast.IfExp, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.TryStar,
                 ast.With, ast.AsyncWith, ast.Match)
JUMP_NODES = (ast.Break, ast.Continue, ast.Return, ast.Raise)


def own_walk(node):
    """遍历函数/类体，跳过嵌套定义（嵌套函数与类各自独立计算）。"""
    stack = list(reversed(node.body))
    while stack:
        item = stack.pop()
        yield item
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        stack.extend(reversed(list(ast.iter_child_nodes(item))))


def _is_jump(node):
    return isinstance(node, JUMP_NODES)


def _terminates(statements):
    """一个语句块是否必然不落到下一句（用于保守判断 join 点是否可达）。"""
    if not statements:
        return False
    last = statements[-1]
    if isinstance(last, JUMP_NODES):
        return True
    if isinstance(last, ast.If) and last.orelse:
        return _terminates(last.body) and _terminates(last.orelse)
    if isinstance(last, ast.Try):
        blocks = [last.body, last.orelse, last.finalbody] + [h.body for h in last.handlers]
        return all(_terminates(block) for block in blocks if block)
    return False


class _Flow:
    """语句级控制流构建器。节点是"一个语句或一个结构头部"，边带跳转语义。"""

    def __init__(self):
        self.nodes = []
        self.edges = []
        self._seq = 0

    def add(self, line, end_line, kind, text, depth):
        self._seq += 1
        node = {"id": self._seq, "line": line, "end_line": end_line, "kind": kind,
                "label": text, "depth": depth}
        self.nodes.append(node)
        return node["id"]

    def edge(self, source, target, label):
        if source is None or target is None:
            return
        self.edges.append((source, target, label))

    def build(self, statements, entry, depth=0, loop=None, pending_break=None, pending_continue=None):
        """构建一个语句序列，返回退出节点列表（空表示控制流在此终止）。"""
        outs = [entry] if entry is not None else []
        current = outs
        for stmt in statements:
            if not current:
                break  # 前面已经终止，后面的语句在静态上不可达
            node_id, exits = self.statement(stmt, depth, loop, pending_break, pending_continue)
            for source in current:
                self.edge(source, node_id, "seq")
            current = exits
        return current

    def statement(self, stmt, depth, loop, pending_break, pending_continue):
        kind = type(stmt).__name__
        line = getattr(stmt, "lineno", None)
        end_line = getattr(stmt, "end_lineno", line)

        if isinstance(stmt, ast.If):
            header = self.add(line, line, "if", "if", depth)
            body_entry = self.add(getattr(stmt.body[0], "lineno", line), line, "branch", "then", depth + 1) if stmt.body else None
            body_exits = self.build(stmt.body, body_entry, depth + 1, loop, pending_break, pending_continue) if stmt.body else []
            if stmt.orelse:
                else_entry = self.add(getattr(stmt.orelse[0], "lineno", line), line, "branch", "else", depth + 1)
                self.edge(header, else_entry, "false")
                else_exits = self.build(stmt.orelse, else_entry, depth + 1, loop, pending_break, pending_continue)
            else:
                else_exits = [header]
            if body_entry:
                self.edge(header, body_entry, "true")
            return header, body_exits + else_exits

        if isinstance(stmt, (ast.For, ast.AsyncFor)):
            header = self.add(line, line, "loop", "for" if isinstance(stmt, ast.For) else "async for", depth)
            outer_breaks = []
            body_entry = self.add(getattr(stmt.body[0], "lineno", line), line, "branch", "body", depth + 1) if stmt.body else None
            if body_entry:
                self.edge(header, body_entry, "loop")
            body_exits = self.build(stmt.body, body_entry, depth + 1, header, outer_breaks, header) if stmt.body else []
            for exits in (body_exits, outer_breaks):
                for source in exits:
                    self.edge(source, header, "back")
            after_loop = self.add(getattr(stmt.orelse[0], "lineno", line), line, "branch", "for-else", depth + 1) if stmt.orelse else None
            if after_loop:
                self.edge(header, after_loop, "exhausted")
                else_exits = self.build(stmt.orelse, after_loop, depth + 1, loop, pending_break, pending_continue)
            else:
                else_exits = []
            return header, [header] + else_exits

        if isinstance(stmt, ast.While):
            header = self.add(line, line, "loop", "while", depth)
            outer_breaks = []
            body_entry = self.add(getattr(stmt.body[0], "lineno", line), line, "branch", "body", depth + 1) if stmt.body else None
            if body_entry:
                self.edge(header, body_entry, "true")
            body_exits = self.build(stmt.body, body_entry, depth + 1, header, outer_breaks, header) if stmt.body else []
            for source in body_exits:
                self.edge(source, header, "back")
            after_loop = self.add(getattr(stmt.orelse[0], "lineno", line), line, "branch", "while-else", depth + 1) if stmt.orelse else None
            if after_loop:
                self.edge(header, after_loop, "exhausted")
                self.edge(header, after_loop, "false")
                else_exits = self.build(stmt.orelse, after_loop, depth + 1, loop, pending_break, pending_continue)
            else:
                else_exits = []
            return header, [header] + else_exits

        if isinstance(stmt, (ast.Try, ast.TryStar)):
            header = self.add(line, line, "try", "try", depth)
            body_entry = self.add(getattr(stmt.body[0], "lineno", line), line, "branch", "try-body", depth + 1) if stmt.body else None
            if body_entry:
                self.edge(header, body_entry, "seq")
            body_exits = self.build(stmt.body, body_entry, depth + 1, loop, pending_break, pending_continue) if stmt.body else []
            handler_exits = []
            for handler in stmt.handlers:
                entry = self.add(getattr(handler, "lineno", line), getattr(handler, "end_lineno", line),
                                 "except", "except " + _exception_name(handler.type), depth + 1)
                self.edge(header, entry, "except")
                handler_exits.extend(self.build(handler.body, entry, depth + 1, loop,
                                                pending_break, pending_continue))
            if stmt.orelse:
                entry = self.add(getattr(stmt.orelse[0], "lineno", line), line, "branch", "try-else", depth + 1)
                for source in body_exits:
                    self.edge(source, entry, "seq")
                exits = self.build(stmt.orelse, entry, depth + 1, loop, pending_break, pending_continue)
            else:
                exits = body_exits
            exits = exits + handler_exits
            if stmt.finalbody:
                entry = self.add(getattr(stmt.finalbody[0], "lineno", line), line, "finally", "finally", depth + 1)
                for source in list(exits) + [header]:
                    self.edge(source, entry, "finally")
                exits = self.build(stmt.finalbody, entry, depth + 1, loop, pending_break, pending_continue)
            return header, exits

        if isinstance(stmt, (ast.With, ast.AsyncWith)):
            header = self.add(line, end_line, "with", "with", depth)
            body_entry = self.add(getattr(stmt.body[0], "lineno", line), line, "branch", "with-body", depth + 1) if stmt.body else None
            if body_entry:
                self.edge(header, body_entry, "seq")
            exits = self.build(stmt.body, body_entry, depth + 1, loop, pending_break, pending_continue) if stmt.body else [header]
            return header, exits

        if isinstance(stmt, ast.Match):
            header = self.add(line, line, "match", "match", depth)
            exits = []
            for case in stmt.cases:
                entry = self.add(getattr(case, "lineno", line), getattr(case, "end_lineno", line),
                                 "case", "case " + _pattern_name(case.pattern), depth + 1)
                self.edge(header, entry, "case")
                exits.extend(self.build(case.body, entry, depth + 1, loop, pending_break, pending_continue))
            return header, exits or [header]

        if isinstance(stmt, ast.Break):
            node = self.add(line, line, "break", "break", depth)
            if pending_break is not None:
                pending_break.append(node)
            return node, []

        if isinstance(stmt, ast.Continue):
            node = self.add(line, line, "continue", "continue", depth)
            if pending_continue is not None:
                self.edge(node, pending_continue, "back")
            return node, []

        if isinstance(stmt, ast.Return):
            return self.add(line, line, "return", "return", depth), []

        if isinstance(stmt, ast.Raise):
            return self.add(line, line, "raise", "raise", depth), []

        text = ""
        if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            text = "assign"
        elif isinstance(stmt, ast.Expr):
            text = "expr"
        node_id = self.add(line, end_line, "simple", text or kind, depth)
        return node_id, [node_id]

def _exception_name(node):
    if node is None:
        return "(bare)"
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return _exception_name(node.value) + "." + node.attr
    if isinstance(node, ast.Tuple):
        return "|".join(_exception_name(item) for item in node.elts)
    return "?"


def _pattern_name(node):
    if isinstance(node, ast.MatchValue):
        return "value"
    if isinstance(node, ast.MatchSingleton):
        return "singleton"
    if isinstance(node, ast.MatchSequence):
        return "sequence"
    if isinstance(node, ast.MatchMapping):
        return "mapping"
    if isinstance(node, ast.MatchClass):
        return "class"
    if isinstance(node, ast.MatchStar):
        return "star"
    if isinstance(node, ast.MatchAs):
        return "_" if node.pattern is None and node.name is None else "as"
    if isinstance(node, ast.MatchOr):
        return "or"
    return "?"


def _merge_blocks(flow):
    """按经典 leader 规则合并基本块：纯图形操作，不碰 AST。

    leader 判定只有三条：
    1. 第一个节点；
    2. 入边不是 seq（条件跳转、循环回边、异常进入的目标）；
    3. 入度为 1 但前驱有多个出口（分支之后的汇合点），或入度不为 1（join）。
    从每个 leader 沿唯一 seq 边向后吞并，直到遇到下一个 leader 或分支。
    """
    if not flow.nodes:
        return [], []
    by_id = {node["id"]: node for node in flow.nodes}
    outgoing, incoming = {}, {}
    for source, target, label in flow.edges:
        outgoing.setdefault(source, []).append((target, label))
        incoming.setdefault(target, []).append((source, label))

    first_id = flow.nodes[0]["id"]

    def is_leader(node_id):
        if node_id == first_id:
            return True
        # 控制流节点永远开新块：否则 finally 的最后一句会把后面的 if 吞进同一块，
        # 读图的人就分不清"这条边是从 finally 出来的"还是"从 if 出来的"。
        if by_id[node_id]["kind"] != "simple":
            return True
        ins = incoming.get(node_id, [])
        if len(ins) != 1:
            return True
        source, label = ins[0]
        if label != "seq":
            return True
        return len(outgoing.get(source, [])) != 1

    leaders = {node["id"] for node in flow.nodes if is_leader(node["id"])}

    blocks, block_of = [], {}
    for leader in sorted(leaders):
        if leader in block_of:
            continue
        block_id = len(blocks) + 1
        members = [leader]
        block_of[leader] = block_id
        current = leader
        while True:
            outs = outgoing.get(current, [])
            if len(outs) != 1 or outs[0][1] != "seq":
                break
            nxt = outs[0][0]
            if nxt in leaders or nxt in block_of:
                break
            members.append(nxt)
            block_of[nxt] = block_id
            current = nxt
        lines = [by_id[m]["line"] for m in members if by_id[m]["line"] is not None]
        ends = [by_id[m]["end_line"] or by_id[m]["line"] or 0 for m in members]
        blocks.append({
            "id": block_id,
            "line": min(lines) if lines else None,
            "end_line": max(ends) if ends else (min(lines) if lines else None),
            "kinds": sorted({by_id[m]["kind"] for m in members}),
            "labels": [by_id[m]["label"] for m in members if by_id[m]["label"]],
            "size": len(members),
        })

    edges = sorted({(block_of[s], block_of[t], label) for s, t, label in flow.edges
                    if block_of.get(s) is not None and block_of.get(t) is not None and block_of[s] != block_of[t]},
                   key=lambda item: (item[0], item[1], item[2]))
    return blocks, [list(edge) for edge in edges]


def build_control_flow(node):
    """为一个函数/方法构建控制流。返回可直接放进 JSON 的紧凑结构。"""
    statements = [item for item in own_walk(node) if isinstance(item, ast.stmt)]
    if len(statements) > MAX_FLOW_STATEMENTS:
        return {"available": False,
                "reason": "语句数 {} 超过控制流抽取上限 {}".format(len(statements), MAX_FLOW_STATEMENTS),
                "statement_count": len(statements)}
    flow = _Flow()
    entry = flow.add(getattr(node.body[0], "lineno", node.lineno) if node.body else node.lineno,
                     node.lineno, "entry", "entry", 0)
    exits = flow.build(node.body, entry)
    if exits:
        end = flow.add(getattr(node, "end_lineno", node.lineno), getattr(node, "end_lineno", node.lineno),
                       "exit", "exit", 0)
        for source in exits:
            flow.edge(source, end, "seq")
    blocks, edges = _merge_blocks(flow)
    return {
        "available": True,
        "statement_count": len(statements),
        "blocks": blocks,
        "edges": edges,
        "notes": [
            "节点按语句行号对齐；block.kinds 给出块内出现过的语句类型。",
            "边标签：seq 顺序、true/false 条件、loop 进入循环、back 回边、"
            "except 异常进入、finally 收尾、exhausted 循环正常结束、case 分支。",
            "break 汇入循环头的 back 边；continue 直接连回循环头。",
            "只做语句级控制流与顺序链合并，未实现基块内表达式级跳转。",
        ],
    }


def build_def_use(node):
    """函数内变量的定义点与使用点。只统计 `Name`，属性/下标读写不计。"""
    defs, uses = {}, {}

    def add(table, name, line):
        bucket = table.setdefault(name, set())
        if isinstance(line, int) and line > 0:
            bucket.add(line)

    args = list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
    for arg in args:
        add(defs, arg.arg, getattr(arg, "lineno", node.lineno))
    for arg in (node.args.vararg, node.args.kwarg):
        if arg:
            add(defs, arg.arg, getattr(arg, "lineno", node.lineno))

    for item in own_walk(node):
        if isinstance(item, ast.Name):
            if isinstance(item.ctx, ast.Load):
                add(uses, item.id, item.lineno)
            else:
                add(defs, item.id, item.lineno)
        elif isinstance(item, ast.AugAssign) and isinstance(item.target, ast.Name):
            add(uses, item.target.id, item.lineno)  # a += 1 既读又写
        elif isinstance(item, ast.NamedExpr) and isinstance(item.target, ast.Name):
            add(defs, item.target.id, item.lineno)
        elif isinstance(item, ast.ExceptHandler) and item.name:
            add(defs, item.name, item.lineno)
        elif isinstance(item, (ast.Global, ast.Nonlocal)):
            for name in item.names:
                add(defs, name, item.lineno)

    names = sorted(set(defs) | set(uses))
    truncated = len(names) > MAX_DEF_USE_NAMES
    names = names[:MAX_DEF_USE_NAMES]
    entries = []
    for name in names:
        entry = {"name": name, "defs": sorted(defs.get(name, ())), "uses": sorted(uses.get(name, ()))}
        entries.append(entry)
    params = sorted(arg.arg for arg in args) + sorted(
        arg.arg for arg in (node.args.vararg, node.args.kwarg) if arg
    )
    return {
        "available": True,
        "names": entries,
        "truncated": truncated,
        "params": params,
        "notes": [
            "只统计标识符（ast.Name）级定义与使用；a.x 与 a[0] 的属性/下标读写不在其中。",
            "defs 含形参、赋值、循环变量、with/except 绑定与赋值表达式。",
            "同名的全局与局部不做跨作用域区分，需要人工确认。",
        ],
    }
