"""Reproducible class metrics, exact AST clones and evidenced class relations."""
import ast
import hashlib
from itertools import combinations
from .engine import own_walk

NOTES = [
    "WMC 为直接定义方法的圈复杂度之和；DIT 为已解析继承图的最长路径（外部父类深度未知）。",
    "CBO 为已解析的继承、构造、注解关系涉及的其他类数；动态类型依赖不计入。",
    "LCOM1=max(0,不共享实例字段的方法对数−共享字段的方法对数)，排除静态/类方法；属于结构指标。",
    "重复检测为至少 4 条 AST 语句的函数体结构完全相同（忽略位置、函数签名与文档字符串，保留变量名/字面量）；不覆盖语义等价实现。",
    "组合仅指构造器中 self 字段直接接收已解析类的构造结果；注解字段视为关联，其他构造/方法注解视为依赖。关系均需设计复核。",
]


def apply(result):
    classes = {c['id']: c for c in result.get('classes', [])}
    functions = {f['id']: f for f in result.get('functions', [])}
    nodes, trees = {}, {}
    for record in result.get('files', []):
        if record.get('status') != 'ok':
            continue
        try:
            tree = ast.parse(record['source'], feature_version=(3, 11))
        except (SyntaxError, ValueError, RecursionError):
            continue
        trees[record['path']] = tree
        for node in ast.walk(tree):
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                nodes[(record['path'], node.lineno)] = node
    graph = dict(result.get('graph') or {})
    parents = {}
    for edge in graph.get('inheritance', []):
        parents.setdefault(edge['source'], set()).add(edge['target'])
    relations = [{**e, 'kind': 'inheritance'} for e in graph.get('inheritance', [])]
    relation_keys = {(e['source'], e['target'], e['kind'], e['line']) for e in relations}

    def relation(source, target, kind, path, line):
        key = (source, target, kind, line)
        if source == target or key in relation_keys:
            return
        relation_keys.add(key)
        relations.append({'source': source, 'target': target, 'kind': kind,
                          'file': path, 'line': line, 'evidence_type': 'inference'})

    for ident, cls in classes.items():
        node = nodes.get((cls['file'], cls['line']))
        if not node:
            continue
        methods = {functions[m]['line']: m for m in cls.get('methods', []) if m in functions}
        constructors = {(c['line'], c.get('expression')): c['target'] for c in graph.get('calls', [])
                        if c.get('source') in methods.values() and c.get('target') in classes and c.get('status') == 'resolved'}
        for method in [m for m in node.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]:
            for item in own_walk(method):
                if isinstance(item, ast.Call) and (item.lineno, ast.unparse(item.func)) in constructors:
                    relation(ident, constructors[(item.lineno, ast.unparse(item.func))], 'dependency', cls['file'], item.lineno)
                if method.name == '__init__' and isinstance(item, (ast.Assign, ast.AnnAssign)):
                    value = item.value
                    targets = item.targets if isinstance(item, ast.Assign) else [item.target]
                    if isinstance(value, ast.Call) and (value.lineno, ast.unparse(value.func)) in constructors and any(isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == 'self' for t in targets):
                        relation(ident, constructors[(value.lineno, ast.unparse(value.func))], 'composition', cls['file'], item.lineno)
        # Resolve annotations with explicit module imports, not globally matching short names.
        aliases = {}
        record = next(r for r in result['files'] if r['path'] == cls['file'])
        for item in trees[cls['file']].body:
            if isinstance(item, ast.Import):
                for a in item.names:
                    aliases[a.asname or a.name.split('.')[0]] = a.name if a.asname else a.name.split('.')[0]
            elif isinstance(item, ast.ImportFrom):
                prefix = item.module or ''
                if item.level:
                    package = record['module'].split('.') if record['path'].endswith('/__init__.py') else record['module'].split('.')[:-1]
                    remove = item.level - 1
                    package = package[:len(package)-remove] if remove <= len(package) else []
                    prefix = '.'.join(package + ([item.module] if item.module else []))
                for a in item.names:
                    aliases[a.asname or a.name] = prefix + '.' + a.name
        for other in classes.values():
            if other['file'] == cls['file']:
                aliases.setdefault(other['name'], other['id'])
        def annotation_targets(annotation):
            if isinstance(annotation, ast.Constant) and isinstance(annotation.value, str):
                try:
                    annotation = ast.parse(annotation.value, mode='eval').body
                except SyntaxError:
                    return set()
            found = set()
            for part in ast.walk(annotation):
                if isinstance(part, (ast.Name, ast.Attribute)):
                    name = ast.unparse(part)
                    head, _, tail = name.partition('.')
                    target = aliases.get(head, head) + ('.' + tail if tail else '')
                    if target in classes:
                        found.add(target)
            return found
        # Nested definitions have their own scope; don't assign their annotations to this class.
        annotation_nodes = list(node.body)
        for m in node.body:
            if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                annotation_nodes.extend(own_walk(m))
        for item in annotation_nodes:
            if isinstance(item, ast.AnnAssign):
                for target in annotation_targets(item.annotation):
                    relation(ident, target, 'association', cls['file'], item.lineno)
            elif isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.lineno in methods:
                annotations = [a.annotation for a in item.args.posonlyargs + item.args.args + item.args.kwonlyargs if a.annotation]
                if item.returns:
                    annotations.append(item.returns)
                for annotation in annotations:
                    for target in annotation_targets(annotation):
                        relation(ident, target, 'dependency', cls['file'], item.lineno)

    def depth(ident, visited):
        if ident in visited:
            return None
        cls = classes[ident]
        if len(cls.get('bases') or []) != len(parents.get(ident, set())):
            return None
        values = [depth(p, visited | {ident}) for p in parents.get(ident, set())]
        return None if any(v is None for v in values) else 1 + max(values) if values else 0

    metrics = []
    for ident, cls in sorted(classes.items()):
        method_ids = [m for m in cls.get('methods', []) if m in functions]
        fields = []
        for mid in method_ids:
            method = nodes.get((cls['file'], functions[mid]['line']))
            if not method or any(isinstance(d, ast.Name) and d.id in {'staticmethod', 'classmethod'} for d in method.decorator_list):
                continue
            args = method.args.posonlyargs + method.args.args
            receiver = args[0].arg if args else None
            fields.append({n.attr for n in own_walk(method) if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)
                           and n.value.id == receiver and not any(functions[x]['name'] == n.attr for x in method_ids)})
        shared = sum(bool(a & b) for a, b in combinations(fields, 2))
        pairs = len(fields) * (len(fields) - 1) // 2
        coupled = {e['target'] for e in relations if e['source'] == ident} | {e['source'] for e in relations if e['target'] == ident}
        metrics.append({'id': ident, 'file': cls['file'], 'line': cls['line'],
                        'wmc': sum(functions[m].get('cc', 1) for m in method_ids),
                        'dit': depth(ident, set()), 'cbo': len(coupled - {ident}), 'lcom': max(0, pairs - 2 * shared)})
    clones = {}
    for ident, fn in sorted(functions.items()):
        node = nodes.get((fn['file'], fn['line']))
        if node is None:
            continue
        body = list(node.body)
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            body.pop(0)
        if sum(isinstance(n, ast.stmt) for statement in body for n in ast.walk(statement)) < 4:
            continue
        digest = hashlib.sha256('\n'.join(ast.dump(n, include_attributes=False) for n in body).encode()).hexdigest()
        clones.setdefault(digest, []).append({'id': ident, 'file': fn['file'], 'line': fn['line'], 'end_line': fn['end_line']})
    duplicate_groups = list(result.get('duplicates') or [])
    ast_duplicate_groups = [
        {'fingerprint': key, 'occurrences': rows}
        for key, rows in sorted(clones.items()) if len(rows) > 1
    ]
    duplicate_groups.extend(ast_duplicate_groups)
    findings = [dict(f) for f in result.get('findings', [])]
    for group in ast_duplicate_groups:
        first, *others = group['occurrences']
        for duplicate in others:
            findings.append({'rule_id': 'DUP-01', 'severity': 'info', 'file': duplicate['file'], 'line': duplicate['line'],
                             'message': '函数体与 {}:{} 的 AST 结构相同，建议复核是否需要提取复用。'.format(first['file'], first['line']),
                             'suggestion': '核对职责和变化原因；仅在需要同步维护时提取公共实现。',
                             'evidence_type': 'fact', 'actual': len(group['occurrences']), 'threshold': 1,
                             'confidence': 'high', 'related': [first]})
    for i, finding in enumerate(findings, 1):
        finding['id'] = 'finding-' + str(i)
    graph['class_relations'] = sorted(relations, key=lambda e: (e['source'], e['target'], e['kind'], e['line']))
    return {**result, 'graph': graph, 'class_metrics': metrics, 'duplicates': duplicate_groups,
            'quality_notes': list(NOTES), 'findings': findings,
            'summary': {**result['summary'], 'findings': len(findings)},
            'config': {**result['config'], 'rules': list(result['config']['rules']) + ['DUP-01']}}
