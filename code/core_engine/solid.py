"""Static LSP/ISP checks. Never import or execute analyzed code.

LSP compares accepted call shapes, binding mode, async mode and explicit refusal.
ISP flags inherited multi-method contracts explicitly refused by implementations.
Unknown bases, decorators and multiple inheritance are reported as coverage gaps.
Behavioral pre/postconditions and arbitrary runtime types require human review.
"""
import ast
import inspect

RULE_IDS = ("SRP-01", "OCP-01", "LSP-01", "ISP-01", "DIP-01")
LIMITATIONS = [
    "SOLID 五项均提供静态检查；未命中不等于符合原则。S/O/D 为设计线索。",
    "L 检查继承方法的调用签名、绑定方式、同步/异步变化和显式拒绝实现；不证明行为契约、前后置条件或类型兼容。",
    "I 检查多方法父类中被子类显式拒绝的成员；不把少调用几个方法直接判为接口过宽。",
    "外部父类、动态继承、多继承 MRO 和自定义装饰器不猜测；覆盖缺口单独列出。",
]


def _name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return _name(node.value) + "." + node.attr
    return ""


def _mode(method):
    names = {_name(d).rsplit(".", 1)[-1] for d in method.decorator_list}
    if names - {"abstractmethod", "staticmethod", "classmethod", "override"}:
        return None
    return "static" if "staticmethod" in names else "class" if "classmethod" in names else "instance"


def _abstract(method):
    return any(_name(d).rsplit(".", 1)[-1] == "abstractmethod" for d in method.decorator_list)


def _refuses(method):
    body = list(method.body)
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body.pop(0)
    if len(body) != 1 or not isinstance(body[0], ast.Raise):
        return False
    exc = body[0].exc
    if isinstance(exc, ast.Call):
        exc = exc.func
    return _name(exc) in {"NotImplementedError", "builtins.NotImplementedError"}


def _signature(method):
    args = method.args
    positional = list(args.posonlyargs) + list(args.args)
    required = len(positional) - len(args.defaults)
    params = []
    for i, arg in enumerate(positional):
        if i == 0 and _mode(method) != "static":
            continue
        kind = inspect.Parameter.POSITIONAL_ONLY if i < len(args.posonlyargs) else inspect.Parameter.POSITIONAL_OR_KEYWORD
        params.append(inspect.Parameter(arg.arg, kind, default=inspect.Parameter.empty if i < required else None))
    if _mode(method) != "static" and not positional:
        return None
    if args.vararg:
        params.append(inspect.Parameter(args.vararg.arg, inspect.Parameter.VAR_POSITIONAL))
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        params.append(inspect.Parameter(arg.arg, inspect.Parameter.KEYWORD_ONLY,
                                        default=inspect.Parameter.empty if default is None else None))
    if args.kwarg:
        params.append(inspect.Parameter(args.kwarg.arg, inspect.Parameter.VAR_KEYWORD))
    try:
        return inspect.Signature(params)
    except ValueError:
        return None


def _narrowed(parent, child):
    """Witness a parent-valid call rejected by the override (values are inert)."""
    p, c = _signature(parent), _signature(child)
    if p is None or c is None:
        return None
    kinds = inspect.Parameter
    positional = [a for a in p.parameters.values() if a.kind in (kinds.POSITIONAL_ONLY, kinds.POSITIONAL_OR_KEYWORD)]
    max_pos = max(len(p.parameters), len(c.parameters)) + 1 if parent.args.vararg else len(positional)
    # Bound work for unusually huge generated signatures; coverage records the gap.
    if max_pos > 128:
        return None
    for n in range(max_pos + 1):
        supplied = {a.name for a in positional[:n]}
        required = {a.name: None for a in p.parameters.values()
                    if a.kind in (kinds.POSITIONAL_OR_KEYWORD, kinds.KEYWORD_ONLY)
                    and a.default is kinds.empty and a.name not in supplied}
        optional = {a.name for a in p.parameters.values()
                    if a.kind in (kinds.POSITIONAL_OR_KEYWORD, kinds.KEYWORD_ONLY) and a.name not in supplied}
        if parent.args.kwarg:
            optional |= set(c.parameters) - set(p.parameters)
            optional.add("_codelens_extra_keyword")
        variants = [required, {**dict.fromkeys(optional), **required}]
        variants.extend({**required, key: None} for key in sorted(optional))
        for keywords in variants:
            try:
                p.bind(*([None] * n), **keywords)
            except TypeError:
                continue
            try:
                c.bind(*([None] * n), **keywords)
            except TypeError:
                return {"positional": n, "keywords": sorted(keywords)}
    return False


def evaluate(result, nodes):
    classes = {c["id"]: c for c in result.get("classes", [])}
    parents = {}
    for edge in result.get("graph", {}).get("inheritance", []):
        parents.setdefault(edge["source"], []).append(edge["target"])
    methods = {}
    marker_bases = {}
    for record in result.get("files", []):
        aliases = {}
        try:
            tree = ast.parse(record.get("source", ""), feature_version=(3, 11))
        except (SyntaxError, ValueError, RecursionError):
            continue
        for statement in tree.body:
            if isinstance(statement, ast.ImportFrom) and statement.module in {"abc", "typing", "typing_extensions"}:
                for alias in statement.names:
                    aliases[alias.asname or alias.name] = statement.module + "." + alias.name
            elif isinstance(statement, ast.Import):
                for alias in statement.names:
                    aliases[alias.asname or alias.name] = alias.name
        for cls in classes.values():
            if cls["file"] != record.get("path"):
                continue
            marker_bases[cls["id"]] = set()
            for base in cls.get("bases") or []:
                head, _, tail = base.partition(".")
                qualified = aliases.get(head, head) + ("." + tail if tail else "")
                if qualified in {"abc.ABC", "typing.Protocol", "typing_extensions.Protocol"}:
                    marker_bases[cls["id"]].add(base)
    for ident, cls in classes.items():
        node = nodes.get((cls["file"], cls["line"]))
        methods[ident] = {m.name: m for m in getattr(node, "body", [])
                          if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}
    findings, gaps = [], []
    checked = 0

    def inherited(ident, seen):
        if ident in seen:
            return None
        cls = classes[ident]
        bases = [b for b in cls.get("bases") or [] if b not in marker_bases.get(ident, set())]
        if not bases:
            return {}
        if len(bases) != 1 or len(parents.get(ident, [])) != 1:
            return None
        base_id = parents[ident][0]
        ancestors = inherited(base_id, seen | {ident})
        if ancestors is None:
            return None
        return {**ancestors, **{name: (base_id, m) for name, m in methods[base_id].items()}}

    def add(rule, cls, method, base_id, message, actual):
        findings.append({"rule_id": rule, "severity": "warning", "file": cls["file"],
                         "line": method.lineno, "message": message,
                         "suggestion": "核对父类契约与调用方；保持可替换的签名和行为，或拆分接口并使用组合。",
                         "evidence_type": "inference", "confidence": "medium",
                         "actual": actual, "threshold": None,
                         "related": [{"file": classes[base_id]["file"],
                                      "line": methods[base_id][method.name].lineno}]})

    for ident, cls in sorted(classes.items()):
        inherited_methods = inherited(ident, set())
        if inherited_methods is None:
            gaps.append({"class": ident, "file": cls["file"], "line": cls["line"],
                         "reason": "父类未解析、继承有环或存在多继承，未推断 MRO"})
            continue
        public_contract = {name for name in inherited_methods if not name.startswith("_")}
        for name, child in sorted(methods[ident].items()):
            if name not in inherited_methods or name in {"__init__", "__new__"}:
                continue
            base_id, parent = inherited_methods[name]
            if _mode(parent) is None or _mode(child) is None or _signature(parent) is None or _signature(child) is None:
                gaps.append({"class": ident, "file": cls["file"], "line": child.lineno,
                             "reason": name + " 的装饰器或绑定签名无法静态检查"})
                continue
            witness = _narrowed(parent, child)
            if witness is None:
                gaps.append({"class": ident, "file": cls["file"], "line": child.lineno,
                             "reason": name + " 的签名超出静态检查范围"})
                continue
            checked += 1
            reasons = []
            if _mode(parent) != _mode(child):
                reasons.append("改变了实例/类/静态方法绑定方式")
            if isinstance(parent, ast.AsyncFunctionDef) != isinstance(child, ast.AsyncFunctionDef):
                reasons.append("改变了同步/异步调用契约")
            if witness:
                reasons.append("拒绝父方法接受的调用形状（{} 个位置参数，关键字 {}）".format(witness["positional"], ", ".join(witness["keywords"]) or "无"))
            refused = _refuses(child) and not _abstract(child)
            if refused and not _abstract(parent) and not _refuses(parent):
                reasons.append("用 NotImplementedError 拒绝父类已实现的方法")
            if reasons:
                add("LSP-01", cls, child, base_id,
                    "{}.{} 覆盖 {}.{} 时{}；请复核可替换性。".format(ident, name, base_id, name, "；".join(reasons)), reasons)
            if refused and name in public_contract and len(public_contract) >= 2:
                add("ISP-01", cls, child, base_id,
                    "{} 继承的公开契约有 {} 个方法，但 {} 显式抛出 NotImplementedError，可能被迫依赖不需要的成员。".format(ident, len(public_contract), name),
                    {"contract_methods": sorted(public_contract), "refused": name})
    return {"findings": findings, "checked_overrides": checked, "coverage_gaps": gaps,
            "limitations": list(LIMITATIONS)}
