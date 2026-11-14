"""Static LSP/ISP checks. Never import or execute analyzed code.

LSP compares accepted call shapes, binding mode, async mode and explicit refusal.
ISP flags inherited multi-method contracts explicitly refused by implementations.
Unknown bases, decorators and multiple inheritance are reported as coverage gaps.
Behavioral pre/postconditions and arbitrary runtime types require human review.
"""
import ast
import inspect

from . import levels

RULE_IDS = (levels.RULE_SRP, levels.RULE_OCP, levels.RULE_LSP, levels.RULE_ISP, levels.RULE_DIP)
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


def _positional_parameters(args, skip_receiver):
    positional = args.posonlyargs + args.args
    required = len(positional) - len(args.defaults)
    params = []
    for index, arg in enumerate(positional):
        if index < skip_receiver:
            continue
        kind = inspect.Parameter.POSITIONAL_ONLY if index < len(args.posonlyargs) else inspect.Parameter.POSITIONAL_OR_KEYWORD
        default = inspect.Parameter.empty if index < required else None
        params.append(inspect.Parameter(arg.arg, kind, default=default))
    return params


def _keyword_and_variadic_parameters(args):
    if args.vararg:
        yield inspect.Parameter(args.vararg.arg, inspect.Parameter.VAR_POSITIONAL)
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        yield inspect.Parameter(arg.arg, inspect.Parameter.KEYWORD_ONLY,
                                        default=inspect.Parameter.empty if default is None else None)
    if args.kwarg:
        yield inspect.Parameter(args.kwarg.arg, inspect.Parameter.VAR_KEYWORD)


def _signature(method):
    args = method.args
    skip_receiver = _mode(method) != "static"
    if skip_receiver and not (args.posonlyargs or args.args):
        return None
    params = _positional_parameters(args, skip_receiver)
    params.extend(_keyword_and_variadic_parameters(args))
    try:
        return inspect.Signature(params)
    except ValueError:
        return None


def _keyword_variants(parameters, supplied, extra_keywords):
    remaining = {parameter.name: parameter for parameter in parameters if parameter.name not in supplied}
    required = {name: None for name, parameter in remaining.items() if parameter.default is inspect.Parameter.empty}
    optional = set(remaining) | extra_keywords
    yield required
    yield {**dict.fromkeys(optional), **required}
    for key in sorted(optional):
        yield {**required, key: None}


def _call_variants(signature, positional, max_pos, extra_keywords):
    kinds = inspect.Parameter
    keyword_parameters = [parameter for parameter in signature.parameters.values()
                          if parameter.kind in (kinds.POSITIONAL_OR_KEYWORD, kinds.KEYWORD_ONLY)]
    for count in range(max_pos + 1):
        args = [None] * count
        supplied = {parameter.name for parameter in positional[:count]}
        for keywords in _keyword_variants(keyword_parameters, supplied, extra_keywords):
            yield args, keywords


def _rejected_call(parent, child, variants):
    for args, keywords in variants:
        try:
            parent.bind(*args, **keywords)
        except TypeError:
            continue
        try:
            child.bind(*args, **keywords)
        except TypeError:
            return {"positional": len(args), "keywords": sorted(keywords)}
    return False


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
    extra_keywords = set()
    if parent.args.kwarg:
        extra_keywords = (set(c.parameters) - set(p.parameters)) | {"_codelens_extra_keyword"}
    return _rejected_call(p, c, _call_variants(p, positional, max_pos, extra_keywords))


def _non_marker_bases(cls, markers):
    return [base for base in cls.get("bases") or [] if base not in markers]


def _inherited(ident, seen, classes, parents, marker_bases, methods):
    if ident in seen:
        return None
    bases = _non_marker_bases(classes[ident], marker_bases.get(ident, set()))
    if not bases:
        return {}
    if len(bases) != 1 or len(parents.get(ident, [])) != 1:
        return None
    base_id = parents[ident][0]
    ancestors = _inherited(base_id, seen | {ident}, classes, parents, marker_bases, methods)
    if ancestors is None:
        return None
    return {**ancestors, **{name: (base_id, m) for name, m in methods[base_id].items()}}


def _implements_method(method):
    return not _abstract(method) and not _refuses(method)


def _lsp_reasons(parent, child, witness):
    reasons = []
    if _mode(parent) != _mode(child):
        reasons.append("改变了实例/类/静态方法绑定方式")
    if isinstance(parent, ast.AsyncFunctionDef) != isinstance(child, ast.AsyncFunctionDef):
        reasons.append("改变了同步/异步调用契约")
    if witness:
        reasons.append("拒绝父方法接受的调用形状（{} 个位置参数，关键字 {}）".format(witness["positional"], ", ".join(witness["keywords"]) or "无"))
    refused = _refuses(child) and not _abstract(child)
    if refused and _implements_method(parent):
        reasons.append("用 NotImplementedError 拒绝父类已实现的方法")
    return reasons, refused


def _evaluate_overrides(classes, parents, methods, marker_bases, gaps, add):
    checked = 0
    for ident, cls in sorted(classes.items()):
        inherited_methods = _inherited(ident, set(), classes, parents, marker_bases, methods)
        if inherited_methods is None:
            gaps.append({"class": ident, "file": cls["file"], "line": cls["line"],
                         "reason": "父类未解析、继承有环或存在多继承，未推断 MRO"})
            continue
        checked += _check_class_overrides(ident, cls, methods[ident], inherited_methods, gaps, add)
    return checked


def _check_class_overrides(ident, cls, methods, inherited_methods, gaps, add):
    checked = 0
    public_contract = {name for name in inherited_methods if not name.startswith("_")}
    for name, child in sorted(methods.items()):
        if name not in inherited_methods or name in {"__init__", "__new__"}:
            continue
        base_id, parent = inherited_methods[name]
        checked += _check_override(ident, cls, name, child, base_id, parent, public_contract, gaps, add)
    return checked


def _has_static_signatures(parent, child):
    if _mode(parent) is None or _mode(child) is None:
        return False
    return _signature(parent) is not None and _signature(child) is not None


def _check_override(ident, cls, name, child, base_id, parent, public_contract, gaps, add):
    if not _has_static_signatures(parent, child):
        gaps.append({"class": ident, "file": cls["file"], "line": child.lineno,
                     "reason": name + " 的装饰器或绑定签名无法静态检查"})
        return 0
    witness = _narrowed(parent, child)
    if witness is None:
        gaps.append({"class": ident, "file": cls["file"], "line": child.lineno,
                     "reason": name + " 的签名超出静态检查范围"})
        return 0
    reasons, refused = _lsp_reasons(parent, child, witness)
    if reasons:
        add(levels.RULE_LSP, cls, child, base_id,
            "{}.{} 覆盖 {}.{} 时{}；请复核可替换性。".format(ident, name, base_id, name, "；".join(reasons)), reasons)
    if refused and name in public_contract and len(public_contract) >= 2:
        add(levels.RULE_ISP, cls, child, base_id,
            "{} 继承的公开契约有 {} 个方法，但 {} 显式抛出 NotImplementedError，可能被迫依赖不需要的成员。".format(ident, len(public_contract), name),
            {"contract_methods": sorted(public_contract), "refused": name})
    return 1


def _build_marker_bases(result, classes):
    marker_bases = {}
    for record in result.get("files", []):
        tree = _parse_tree(record)
        if tree is None:
            continue
        aliases = _marker_aliases(tree)
        for cls in classes.values():
            if cls["file"] != record.get("path"):
                continue
            marker_bases[cls["id"]] = {
                base for base in cls.get("bases") or []
                if _qualified(aliases, base) in {"abc.ABC", "typing.Protocol", "typing_extensions.Protocol"}
            }
    return marker_bases


def _marker_aliases(tree):
    aliases = {}
    for statement in tree.body:
        aliases.update(_marker_imports(statement))
    return aliases


def _marker_imports(statement):
    if isinstance(statement, ast.ImportFrom) and statement.module in {"abc", "typing", "typing_extensions"}:
        return ((alias.asname or alias.name, statement.module + "." + alias.name) for alias in statement.names)
    if isinstance(statement, ast.Import):
        return ((alias.asname or alias.name, alias.name) for alias in statement.names)
    return ()


def _parse_tree(record):
    try:
        return ast.parse(record.get("source", ""), feature_version=(3, 11))
    except (SyntaxError, ValueError, RecursionError):
        return None


def _qualified(aliases, base):
    head, _, tail = base.partition(".")
    return aliases.get(head, head) + ("." + tail if tail else "")


def evaluate(result, nodes):
    classes = {c["id"]: c for c in result.get("classes", [])}
    parents = {}
    for edge in result.get("graph", {}).get("inheritance", []):
        parents.setdefault(edge["source"], []).append(edge["target"])
    marker_bases = _build_marker_bases(result, classes)
    methods = {}
    for ident, cls in classes.items():
        node = nodes.get((cls["file"], cls["line"]))
        methods[ident] = {m.name: m for m in getattr(node, "body", [])
                          if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}
    findings, gaps = [], []

    def add(rule, cls, method, base_id, message, actual):
        findings.append({"rule_id": rule, "severity": levels.SEVERITY_WARNING, "file": cls["file"],
                         "line": method.lineno, "message": message,
                         "suggestion": "核对父类契约与调用方；保持可替换的签名和行为，或拆分接口并使用组合。",
                         "evidence_type": levels.EVIDENCE_INFERENCE, "confidence": levels.CONFIDENCE_MEDIUM,
                         "actual": actual, "threshold": None,
                         "related": [{"file": classes[base_id]["file"],
                                      "line": methods[base_id][method.name].lineno}]})

    checked = _evaluate_overrides(classes, parents, methods, marker_bases, gaps, add)
    return {"findings": findings, "checked_overrides": checked, "coverage_gaps": gaps,
            "limitations": list(LIMITATIONS)}
