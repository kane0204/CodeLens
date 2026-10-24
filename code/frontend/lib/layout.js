/* CodeLens · 结构图布局（纯函数、无 DOM，可直接在 Node 中 require）
 * 契约见 docs/software/frontend-redesign.md §4.2 / §5.3 / §1.2
 * 只导出 CL.layout = { buildGraph, layoutGraph, fitTransform, __test }
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  var NODE_W = 200;         /* 节点宽（规格 §5.3） */
  var NODE_H = 56;          /* 节点高（规格 §5.3） */
  var GAP_X = 56;           /* 同层水平间距下限 */
  var GAP_Y = 120;          /* 层间垂直间距下限 */
  var PAD = 32;             /* fit 内边距 */
  var MAX_PER_ROW = 7;      /* 单行最多节点数，超出折行（折行后仍满足 GAP_Y） */
  var LANE_BASE = 48;       /* 右侧外环起点偏移 */
  var LANE_STEP = 20;       /* 外环 lane 间距 */
  var SELF_ARC = 46;        /* 自环外弧凸出量 */
  var ARROW_GAP = 2;        /* 箭头尖端落在端口圆点外侧 2px（规格 §1.2） */
  var ROW_PORT = 9;         /* 同层边在右边缘的上下端口错位，避免正交路径塌陷 */
  var DEFAULT_LIMIT = 60;   /* 节点上限（规格 §1.2） */
  var EPS = 0.5;

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function num(v, fallback) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : (fallback || 0); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function baseName(path) {
    var p = str(path);
    var i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(i + 1) : p;
  }
  function pathOf(file, line) { return baseName(file) + ':' + num(line, 1); }
  function exprLabel(id) {
    var m = /<expression:(\d+):\d+>/.exec(str(id));
    return m ? '表达式 L' + m[1] : '';
  }
  function push(map, key, value) {
    var list = map[key];
    if (!list) { list = map[key] = []; }
    list.push(value);
  }

  /* ------------------------------------------------------------------ */
  /* 图构建：只消费 engine 现有字段（附录 A），不假设额外字段            */
  /* ------------------------------------------------------------------ */

  function emptyGraph(mode, stats) {
    return {
      mode: mode,
      nodes: [],
      edges: [],
      stats: {
        mode: mode, nodes: 0, edges: 0, totalNodes: 0, totalEdges: 0,
        truncated: false, omittedEdges: 0, cycles: 0, unresolved: 0,
        resolved: 0, unresolvedSamples: []
      }
    };
  }

  function capList(list, cap) {
    if (list.length <= cap) return {list: list, truncated: false};
    return {list: list.slice(0, cap), truncated: true};
  }

  /* 模块依赖：节点=模块，边=通过 internal 依赖聚合后的 import 关系 */
  function buildModuleGraph(result, cap) {
    var files = (result && result.files) || [];
    var graph = (result && result.graph) || {};
    var deps = graph.dependencies || [];
    var cycles = graph.cycles || [];
    var info = Object.create(null);

    function ensure(module, file, line) {
      if (!module) return;
      if (!info[module]) info[module] = {file: str(file), line: num(line, 1)};
      else if (str(file) && str(file) < info[module].file) info[module].file = str(file);
    }

    files.forEach(function (f) {
      if (!f) return;
      var module = str(f.module) || str(f.path).replace(/\.py$/i, '').replace(/[\\/]/g, '.');
      ensure(module, f.path, 1);
    });

    var internal = [];
    deps.forEach(function (d) {
      if (!d || !d.internal) return;
      var source = str(d.source);
      var target = str(d.target);
      if (!source || !target) return;
      ensure(source, d.file, 1);
      ensure(target, d.file, 1);
      internal.push(d);
    });

    var ids = Object.keys(info).sort(cmp);
    var names = Object.create(null);
    ids.forEach(function (id) {
      var parts = id.split('.');
      var last = parts[parts.length - 1];
      var duplicated = ids.some(function (other) {
        return other !== id && other.split('.').pop() === last;
      });
      names[id] = duplicated && parts.length > 1 ? parts.slice(-2).join('.') : last;
    });

    var allNodes = ids.map(function (id) {
      return {
        id: id,
        label: names[id],
        fullLabel: id,
        sub: pathOf(info[id].file, info[id].line),
        file: info[id].file,
        line: info[id].line,
        kind: 'module'
      };
    });

    var capped = capList(allNodes, cap);
    var kept = Object.create(null);
    capped.list.forEach(function (n) { kept[n.id] = true; });

    var edges = [];
    var edgeMap = Object.create(null);
    internal.forEach(function (d) {
      var source = str(d.source);
      var target = str(d.target);
      if (!kept[source] || !kept[target] || source === target) return;
      var key = source + ' -> ' + target;
      var edge = edgeMap[key];
      if (!edge) {
        edge = edgeMap[key] = {
          id: 'dep:' + key,
          from: source,
          to: target,
          kind: 'dependency',
          evidence: '导入语句',
          file: str(d.file),
          line: num(d.line, 1),
          count: 0,
          evidence_type: str(d.evidence_type) || 'fact'
        };
        edges.push(edge);
      }
      edge.count += 1;
    });
    edges.sort(function (a, b) { return cmp(a.from, b.from) || cmp(a.to, b.to); });

    var stats = {
      mode: 'modules',
      nodes: capped.list.length,
      edges: edges.length,
      totalNodes: allNodes.length,
      totalEdges: edges.length,
      truncated: capped.truncated,
      omittedEdges: internal.length - edges.length,
      cycles: cycles.length,
      cycleGroups: cycles.slice(0, 4),
      resolved: 0,
      unresolved: 0,
      unresolvedSamples: []
    };
    return {mode: 'modules', nodes: capped.list, edges: edges, stats: stats};
  }

  /* 类与继承：节点=类，边=解析成功的继承关系 */
  function buildClassGraph(result, cap) {
    var classes = (result && result.classes) || [];
    var inheritance = ((result && result.graph) || {}).inheritance || [];
    var cycles = ((result && result.graph) || {}).cycles || [];

    var allNodes = classes.filter(Boolean).map(function (c) {
      return {
        id: str(c.id),
        label: str(c.name) || str(c.id).split('.').pop(),
        fullLabel: str(c.id),
        sub: pathOf(c.file, c.line),
        file: str(c.file),
        line: num(c.line, 1),
        kind: 'class',
        methods: (c.methods || []).length,
        bases: (c.bases || []).slice()
      };
    }).sort(function (a, b) { return cmp(a.file, b.file) || (a.line - b.line) || cmp(a.id, b.id); });

    var capped = capList(allNodes, cap);
    var kept = Object.create(null);
    capped.list.forEach(function (n) { kept[n.id] = true; });

    var edges = [];
    var edgeMap = Object.create(null);
    inheritance.forEach(function (e) {
      if (!e) return;
      var source = str(e.source);
      var target = str(e.target);
      if (!kept[source] || !kept[target] || source === target) return;
      var key = source + ' -> ' + target;
      if (edgeMap[key]) { edgeMap[key].count += 1; return; }
      edgeMap[key] = {
        id: 'inh:' + key,
        from: source,
        to: target,
        kind: 'inheritance',
        evidence: '继承声明',
        file: str(e.file),
        line: num(e.line, 1),
        count: 1,
        evidence_type: str(e.evidence_type) || 'fact'
      };
      edges.push(edgeMap[key]);
    });
    edges.sort(function (a, b) { return cmp(a.from, b.from) || cmp(a.to, b.to); });

    var stats = {
      mode: 'classes',
      nodes: capped.list.length,
      edges: edges.length,
      totalNodes: allNodes.length,
      totalEdges: edges.length,
      truncated: capped.truncated,
      omittedEdges: 0,
      cycles: cycles.length,
      resolved: 0,
      unresolved: 0,
      unresolvedSamples: []
    };
    return {mode: 'classes', nodes: capped.list, edges: edges, stats: stats};
  }

  /* 已解析调用：节点=调用作用域与被调用者，边=解析成功的调用 */
  function buildCallGraph(result, cap) {
    var graph = (result && result.graph) || {};
    var calls = graph.calls || [];
    var functions = (result && result.functions) || [];
    var classes = (result && result.classes) || [];
    var files = (result && result.files) || [];
    var cycles = graph.cycles || [];

    var fnById = Object.create(null);
    functions.forEach(function (f) { if (f && f.id) fnById[str(f.id)] = f; });
    var clsById = Object.create(null);
    classes.forEach(function (c) { if (c && c.id) clsById[str(c.id)] = c; });
    var moduleFile = Object.create(null);
    files.forEach(function (f) {
      if (!f) return;
      var module = str(f.module) || str(f.path).replace(/\.py$/i, '').replace(/[\\/]/g, '.');
      if (module && moduleFile[module] === undefined) moduleFile[module] = {file: str(f.path), line: 1};
    });

    var resolved = [];
    var unresolved = [];
    calls.forEach(function (c) {
      if (!c) return;
      if (str(c.status) === 'resolved' && str(c.target)) resolved.push(c);
      else unresolved.push(c);
    });

    function describe(id, sample) {
      var key = str(id);
      var fn = fnById[key];
      if (fn) {
        return {
          id: key,
          label: str(fn.name) || key.split('.').pop(),
          fullLabel: key,
          sub: pathOf(fn.file, fn.line),
          file: str(fn.file),
          line: num(fn.line, 1),
          kind: str(fn.kind) || 'function'
        };
      }
      var cls = clsById[key];
      if (cls) {
        return {
          id: key,
          label: str(cls.name) || key.split('.').pop(),
          fullLabel: key,
          sub: pathOf(cls.file, cls.line),
          file: str(cls.file),
          line: num(cls.line, 1),
          kind: 'class'
        };
      }
      var expr = exprLabel(key);
      if (expr) {
        return {
          id: key, label: expr, fullLabel: key,
          sub: pathOf(sample.file, sample.line),
          file: str(sample.file), line: num(sample.line, 1), kind: 'expression'
        };
      }
      var mod = moduleFile[key];
      return {
        id: key, label: key.split('.').pop() || key, fullLabel: key,
        sub: mod ? pathOf(mod.file, mod.line) : pathOf(sample.file, sample.line),
        file: mod ? mod.file : str(sample.file),
        line: mod ? mod.line : num(sample.line, 1),
        kind: mod ? 'module' : 'scope'
      };
    }

    var nodeMap = Object.create(null);
    var order = [];
    function touch(id, sample) {
      var key = str(id);
      if (!key) return;
      if (!nodeMap[key]) { nodeMap[key] = describe(key, sample); order.push(key); }
    }
    resolved.forEach(function (c) { touch(c.source, c); touch(c.target, c); });

    var allNodes = order.map(function (id) { return nodeMap[id]; });
    allNodes.sort(function (a, b) {
      return cmp(a.file, b.file) || (a.line - b.line) || cmp(a.id, b.id);
    });

    var capped = capList(allNodes, cap);
    var kept = Object.create(null);
    capped.list.forEach(function (n) { kept[n.id] = true; });

    var edges = [];
    var edgeMap = Object.create(null);
    resolved.forEach(function (c) {
      var source = str(c.source);
      var target = str(c.target);
      if (!kept[source] || !kept[target]) return;
      var key = source + ' -> ' + target;
      var edge = edgeMap[key];
      if (!edge) {
        edge = edgeMap[key] = {
          id: 'call:' + key,
          from: source,
          to: target,
          kind: 'call',
          evidence: '调用表达式',
          expression: str(c.expression),
          file: str(c.file),
          line: num(c.line, 1),
          count: 0,
          evidence_type: str(c.evidence_type) || 'fact'
        };
        edges.push(edge);
      }
      edge.count += 1;
    });
    edges.sort(function (a, b) { return cmp(a.from, b.from) || cmp(a.to, b.to); });

    var samples = unresolved.slice(0, 8).map(function (c) {
      return {
        expression: str(c.expression) || '（无法解析的表达式）',
        file: str(c.file),
        line: num(c.line, 1),
        scope: str(c.source)
      };
    });

    var stats = {
      mode: 'calls',
      nodes: capped.list.length,
      edges: edges.length,
      totalNodes: allNodes.length,
      totalEdges: edges.length,
      truncated: capped.truncated,
      omittedEdges: 0,
      cycles: cycles.length,
      resolved: resolved.length,
      unresolved: unresolved.length,
      unresolvedSamples: samples,
      totalCalls: calls.length
    };
    return {mode: 'calls', nodes: capped.list, edges: edges, stats: stats};
  }

  function buildGraph(mode, result, limit) {
    var cap = num(limit, DEFAULT_LIMIT);
    if (!isFinite(cap) || cap <= 0) cap = DEFAULT_LIMIT;
    cap = Math.floor(cap);
    var normalized = mode === 'classes' || mode === 'calls' ? mode : 'modules';
    if (!result) return emptyGraph(normalized);
    try {
      if (normalized === 'classes') return buildClassGraph(result, cap);
      if (normalized === 'calls') return buildCallGraph(result, cap);
      return buildModuleGraph(result, cap);
    } catch (err) {
      var empty = emptyGraph(normalized);
      empty.stats.buildError = String(err && err.message ? err.message : err);
      return empty;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 分层：Tarjan 强连通分量收缩 + 最长路径分层（环内同层，确定性）      */
  /* ------------------------------------------------------------------ */

  function stronglyConnected(count, adj) {
    var index = 0;
    var idx = new Array(count);
    var low = new Array(count);
    var onStack = new Array(count);
    var comp = new Array(count);
    var stack = [];
    var compCount = 0;
    var i;
    for (i = 0; i < count; i++) { idx[i] = -1; low[i] = 0; onStack[i] = false; comp[i] = -1; }

    for (var start = 0; start < count; start++) {
      if (idx[start] !== -1) continue;
      var work = [{v: start, i: 0}];
      idx[start] = low[start] = index++;
      stack.push(start); onStack[start] = true;
      while (work.length) {
        var frame = work[work.length - 1];
        var v = frame.v;
        if (frame.i < adj[v].length) {
          var w = adj[v][frame.i++];
          if (idx[w] === -1) {
            idx[w] = low[w] = index++;
            stack.push(w); onStack[w] = true;
            work.push({v: w, i: 0});
          } else if (onStack[w] && idx[w] < low[v]) {
            low[v] = idx[w];
          }
        } else {
          work.pop();
          if (work.length) {
            var parent = work[work.length - 1].v;
            if (low[v] < low[parent]) low[parent] = low[v];
          }
          if (low[v] === idx[v]) {
            var member;
            do {
              member = stack.pop();
              onStack[member] = false;
              comp[member] = compCount;
            } while (member !== v);
            compCount++;
          }
        }
      }
    }
    return {comp: comp, count: compCount};
  }

  function computeDepths(count, adj) {
    var scc = stronglyConnected(count, adj);
    var comp = scc.comp;
    var ccount = scc.count;
    var cadj = [];
    var indeg = [];
    var i;
    for (i = 0; i < ccount; i++) { cadj.push([]); indeg.push(0); }
    var seen = Object.create(null);
    for (var a = 0; a < count; a++) {
      for (var k = 0; k < adj[a].length; k++) {
        var b = adj[a][k];
        var ca = comp[a];
        var cb = comp[b];
        if (ca === cb) continue;
        var key = ca + ':' + cb;
        if (seen[key]) continue;
        seen[key] = true;
        cadj[ca].push(cb);
        indeg[cb] += 1;
      }
    }
    var depth = new Array(ccount);
    for (i = 0; i < ccount; i++) depth[i] = 0;
    var queue = [];
    for (i = 0; i < ccount; i++) if (indeg[i] === 0) queue.push(i);
    var head = 0;
    while (head < queue.length) {
      var u = queue[head++];
      for (var m = 0; m < cadj[u].length; m++) {
        var v = cadj[u][m];
        if (depth[u] + 1 > depth[v]) depth[v] = depth[u] + 1;
        indeg[v] -= 1;
        if (indeg[v] === 0) queue.push(v);
      }
    }
    return {comp: comp, depth: depth};
  }

  /* ------------------------------------------------------------------ */
  /* 主布局：确定性纯函数（同输入同输出）                                */
  /* ------------------------------------------------------------------ */

  function layoutGraph(graph) {
    var srcNodes = (graph && graph.nodes) || [];
    var srcEdges = (graph && graph.edges) || [];
    var nodes = [];
    var byId = Object.create(null);
    var i;

    for (i = 0; i < srcNodes.length; i++) {
      var raw = srcNodes[i];
      if (!raw || raw.id === undefined || raw.id === null) continue;
      var id = str(raw.id);
      if (byId[id]) continue;
      var node = {
        id: id,
        label: str(raw.label) || id,
        fullLabel: str(raw.fullLabel) || str(raw.label) || id,
        sub: str(raw.sub),
        file: str(raw.file),
        line: num(raw.line, 0),
        kind: str(raw.kind),
        order: i,
        x: 0, y: 0,
        w: NODE_W, h: NODE_H,
        depth: 0,
        layer: 0,
        ports: []
      };
      byId[id] = node;
      nodes.push(node);
    }

    var edgesRaw = [];
    var selfRaw = [];
    srcEdges.forEach(function (e) {
      if (!e) return;
      var from = str(e.from);
      var to = str(e.to);
      if (!byId[from] || !byId[to]) return;
      var copy = {
        id: str(e.id) || (from + '->' + to),
        from: from,
        to: to,
        kind: str(e.kind) || 'dependency',
        evidence: str(e.evidence),
        expression: str(e.expression),
        file: str(e.file),
        line: num(e.line, 1),
        count: num(e.count, 1),
        evidence_type: str(e.evidence_type) || 'fact'
      };
      if (from === to) selfRaw.push(copy);
      else edgesRaw.push(copy);
    });

    /* 去重 + 稳定排序，保证确定性 */
    var seenPairs = Object.create(null);
    edgesRaw = edgesRaw.filter(function (e) {
      var key = e.from + '\u0000' + e.to;
      if (seenPairs[key]) return false;
      seenPairs[key] = true;
      return true;
    });
    edgesRaw.sort(function (a, b) { return cmp(a.from, b.from) || cmp(a.to, b.to); });
    selfRaw.sort(function (a, b) { return cmp(a.from, b.from); });

    var idxOf = Object.create(null);
    nodes.forEach(function (n, k) { idxOf[n.id] = k; });

    var adj = nodes.map(function () { return []; });
    var radj = nodes.map(function () { return []; });
    edgesRaw.forEach(function (e) {
      var a = idxOf[e.from];
      var b = idxOf[e.to];
      adj[a].push(b);
      radj[b].push(a);
    });
    adj.forEach(function (list) { list.sort(function (a, b) { return a - b; }); });
    radj.forEach(function (list) { list.sort(function (a, b) { return a - b; }); });

    var depthInfo = computeDepths(nodes.length, adj);
    var layers = [];
    var maxDepth = 0;
    nodes.forEach(function (n, k) {
      var d = depthInfo.depth[depthInfo.comp[k]] || 0;
      n.depth = d;
      if (d > maxDepth) maxDepth = d;
      if (!layers[d]) layers[d] = [];
      layers[d].push(k);
    });
    for (var d = 0; d <= maxDepth; d++) if (!layers[d]) layers[d] = [];

    function labelCmp(a, b) {
      var na = nodes[a];
      var nb = nodes[b];
      return cmp(na.label, nb.label) || cmp(na.id, nb.id);
    }
    layers.forEach(function (list) { list.sort(labelCmp); });

    /* 两次重心排序：父节点位置中位数在前，同级未连接节点保持 label 序 */
    for (var pass = 0; pass < 2; pass++) {
      var posOf = Object.create(null);
      layers.forEach(function (list) {
        list.forEach(function (nodeIndex, position) { posOf[nodeIndex] = position; });
      });
      for (var d2 = 1; d2 <= maxDepth; d2++) {
        layers[d2].sort(function (a, b) {
          function bary(k) {
            var parents = radj[k];
            if (!parents.length) return Number.MAX_SAFE_INTEGER;
            var total = 0;
            for (var p = 0; p < parents.length; p++) total += posOf[parents[p]] || 0;
            return total / parents.length;
          }
          return (bary(a) - bary(b)) || labelCmp(a, b);
        });
      }
    }

    /* 按行切分：单行最多 MAX_PER_ROW 个，行间距仍为 NODE_H + GAP_Y */
    var rows = [];
    for (var dd = 0; dd <= maxDepth; dd++) {
      var members = layers[dd];
      for (var offset = 0; offset < members.length; offset += MAX_PER_ROW) {
        rows.push({depth: dd, members: members.slice(offset, offset + MAX_PER_ROW)});
      }
    }

    var contentW = NODE_W;
    rows.forEach(function (row) {
      var w = row.members.length * NODE_W + Math.max(0, row.members.length - 1) * GAP_X;
      row.width = w;
      if (w > contentW) contentW = w;
    });

    rows.forEach(function (row, rowIndex) {
      var y = PAD + rowIndex * (NODE_H + GAP_Y);
      var x = PAD + (contentW - row.width) / 2;
      row.members.forEach(function (nodeIndex, position) {
        var node = nodes[nodeIndex];
        node.x = x + position * (NODE_W + GAP_X);
        node.y = y;
        node.layer = rowIndex;
      });
    });

    var width = contentW + PAD * 2;

    /* ---- 端口与边路由 ---- */
    function addPort(node, localX, localY) {
      for (var p = 0; p < node.ports.length; p++) {
        if (Math.abs(node.ports[p].x - localX) < 0.01 && Math.abs(node.ports[p].y - localY) < 0.01) return;
      }
      node.ports.push({x: r2(localX), y: r2(localY)});
    }

    var routed = [];

    /* 同层 / 自环边走右侧外环，按 y 区间复用 lane，避免互相压线 */
    var outer = [];
    edgesRaw.forEach(function (e) {
      if (byId[e.from].layer === byId[e.to].layer) outer.push({edge: e, self: false});
    });
    selfRaw.forEach(function (e) { outer.push({edge: e, self: true}); });

    outer.forEach(function (item) {
      var a = byId[item.edge.from];
      var b = byId[item.edge.to];
      var top = item.self ? a.y : Math.min(a.y, b.y);
      var bottom = item.self ? a.y + a.h : Math.max(a.y + a.h, b.y + b.h);
      item.top = top;
      item.bottom = bottom;
    });
    outer.sort(function (a, b) { return (a.top - b.top) || (a.bottom - b.bottom) || cmp(a.edge.id, b.edge.id); });

    var lanes = [];
    outer.forEach(function (item) {
      var lane = null;
      for (var l = 0; l < lanes.length; l++) {
        if (lanes[l].lastBottom + 12 < item.top) { lane = lanes[l]; break; }
      }
      if (!lane) {
        lane = {x: PAD + contentW + LANE_BASE + lanes.length * LANE_STEP, lastBottom: -Infinity};
        lanes.push(lane);
      }
      lane.lastBottom = item.bottom;
      item.laneX = lane.x;
    });

    function bezierPath(start, c1, c2, end) {
      return 'M' + r2(start.x) + ',' + r2(start.y) +
        ' C' + r2(c1.x) + ',' + r2(c1.y) +
        ' ' + r2(c2.x) + ',' + r2(c2.y) +
        ' ' + r2(end.x) + ',' + r2(end.y);
    }
    function bezierPoint(start, c1, c2, end, t) {
      var mt = 1 - t;
      var a = mt * mt * mt;
      var b = 3 * mt * mt * t;
      var c = 3 * mt * t * t;
      var d = t * t * t;
      return {
        x: a * start.x + b * c1.x + c * c2.x + d * end.x,
        y: a * start.y + b * c1.y + c * c2.y + d * end.y
      };
    }

    edgesRaw.forEach(function (e) {
      var a = byId[e.from];
      var b = byId[e.to];
      var start, end, c1, c2, d, mid;

      if (a.layer === b.layer) {
        var same = outer.filter(function (item) { return item.edge === e; })[0];
        var laneX = same ? same.laneX : PAD + contentW + LANE_BASE;
        var outY = a.y + a.h / 2 - ROW_PORT;
        var inY = b.y + b.h / 2 + ROW_PORT;
        start = {x: a.x + a.w, y: outY};
        end = {x: b.x + b.w + ARROW_GAP, y: inY};
        /* 末端留 14px 小钩，使箭头朝左指向目标右端口，尖端仍在矩形外 2px */
        var hookX = end.x + 14;
        var hook = laneX > hookX;
        d = 'M' + r2(start.x) + ',' + r2(start.y) +
          ' L' + r2(laneX) + ',' + r2(start.y) +
          ' L' + r2(laneX) + ',' + r2(end.y) +
          (hook ? ' L' + r2(hookX) + ',' + r2(end.y) : '') +
          ' L' + r2(end.x) + ',' + r2(end.y);
        /* 折线中点：按段长取中点，chip 落在路径中央 */
        var seg1 = Math.abs(laneX - start.x);
        var seg2 = Math.abs(end.y - start.y);
        var seg3 = Math.abs((hook ? hookX : end.x) - laneX);
        var seg4 = Math.abs(end.x - (hook ? hookX : end.x));
        var half = (seg1 + seg2 + seg3 + seg4) / 2;
        if (half <= seg1) {
          mid = {x: start.x + (laneX > start.x ? half : -half), y: start.y};
        } else if (half <= seg1 + seg2) {
          mid = {x: laneX, y: start.y + (end.y > start.y ? half - seg1 : seg1 - half)};
        } else if (half <= seg1 + seg2 + seg3) {
          var rest = half - seg1 - seg2;
          mid = {x: laneX + (end.x > laneX ? rest : -rest), y: end.y};
        } else {
          mid = {x: hookX - (half - seg1 - seg2 - seg3), y: end.y};
        }
        addPort(a, a.w, outY - a.y);
        addPort(b, b.w, inY - b.y);
        routed.push({
          id: e.id, from: e.from, to: e.to, kind: e.kind, evidence: e.evidence,
          expression: e.expression, file: e.file, line: e.line, count: e.count,
          evidence_type: e.evidence_type,
          route: 'ortho', d: d, start: start, end: end,
          controls: [{x: laneX, y: start.y}, {x: laneX, y: end.y}],
          mid: mid
        });
        return;
      }

      var down = (b.y + b.h / 2) >= (a.y + a.h / 2);
      if (down) {
        start = {x: a.x + a.w / 2, y: a.y + a.h};
        end = {x: b.x + b.w / 2, y: b.y - ARROW_GAP};
      } else {
        start = {x: a.x + a.w / 2, y: a.y};
        end = {x: b.x + b.w / 2, y: b.y + b.h + ARROW_GAP};
      }
      var dy = end.y - start.y;
      c1 = {x: start.x, y: start.y + dy * 0.5};
      c2 = {x: end.x, y: end.y - dy * 0.5};
      d = bezierPath(start, c1, c2, end);
      mid = bezierPoint(start, c1, c2, end, 0.5);
      if (down) addPort(a, a.w / 2, a.h);
      else addPort(a, a.w / 2, 0);
      if (down) addPort(b, b.w / 2, 0);
      else addPort(b, b.w / 2, b.h);
      routed.push({
        id: e.id, from: e.from, to: e.to, kind: e.kind, evidence: e.evidence,
        expression: e.expression, file: e.file, line: e.line, count: e.count,
        evidence_type: e.evidence_type,
        route: 'bezier', d: d, start: start, end: end,
        controls: [c1, c2], mid: mid
      });
    });

    selfRaw.forEach(function (e) {
      var a = byId[e.from];
      var item = outer.filter(function (o) { return o.edge === e; })[0];
      var bulge = item && item.laneX ? Math.max(item.laneX - (a.x + a.w), SELF_ARC) : SELF_ARC;
      var startY = a.y + a.h / 2 - 10;
      var endY = a.y + a.h / 2 + 10;
      var start = {x: a.x + a.w, y: startY};
      var end = {x: a.x + a.w + ARROW_GAP, y: endY};
      var c1 = {x: a.x + a.w + bulge, y: startY};
      var c2 = {x: a.x + a.w + bulge, y: endY};
      addPort(a, a.w, startY - a.y);
      addPort(a, a.w, endY - a.y);
      routed.push({
        id: e.id, from: e.from, to: e.to, kind: e.kind, evidence: e.evidence,
        expression: e.expression, file: e.file, line: e.line, count: e.count,
        evidence_type: e.evidence_type,
        route: 'self', d: bezierPath(start, c1, c2, end),
        start: start, end: end, controls: [c1, c2],
        mid: bezierPoint(start, c1, c2, end, 0.5)
      });
    });

    routed.sort(function (a, b) { return cmp(a.id, b.id); });

    /* ---- 边界：节点矩形 + 边控制点（贝塞尔曲线位于控制点凸包内） ---- */
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function extend(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    nodes.forEach(function (n) { extend(n.x, n.y); extend(n.x + n.w, n.y + n.h); });
    routed.forEach(function (e) {
      extend(e.start.x, e.start.y);
      extend(e.end.x, e.end.y);
      (e.controls || []).forEach(function (c) { extend(c.x, c.y); });
      extend(e.mid.x, e.mid.y);
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = NODE_W; maxY = NODE_H; }
    var bounds = {
      minX: r2(minX), minY: r2(minY), maxX: r2(maxX), maxY: r2(maxY),
      width: r2(maxX - minX), height: r2(maxY - minY)
    };

    return {
      mode: (graph && graph.mode) || 'modules',
      width: r2(Math.max(width, maxX + PAD)),
      height: r2(Math.max(PAD * 2 + rows.length * (NODE_H + GAP_Y) - GAP_Y, maxY + PAD)),
      padding: PAD,
      nodeW: NODE_W,
      nodeH: NODE_H,
      bounds: bounds,
      rows: rows.length,
      nodes: nodes,
      edges: routed,
      stats: (graph && graph.stats) || {}
    };
  }

  /* 初始 fit：全部内容（含外环与自环）落在视口内，内边距 padding 逻辑像素 */
  function fitTransform(bounds, viewport, padding) {
    var b = bounds || {};
    var vw = num(viewport && viewport.width, 1200);
    var vh = num(viewport && viewport.height, 560);
    if (vw <= 0) vw = 1200;
    if (vh <= 0) vh = 560;
    var pad = num(padding, PAD);
    if (pad < 0) pad = 0;
    var bw = Math.max(num(b.width, 1), 1);
    var bh = Math.max(num(b.height, 1), 1);
    var minX = num(b.minX, 0);
    var minY = num(b.minY, 0);
    var kw = (vw - pad * 2) / bw;
    var kh = (vh - pad * 2) / bh;
    var k = Math.min(kw, kh, 1);
    if (!isFinite(k) || k <= 0) k = 1;
    return {
      k: k,
      tx: (vw - bw * k) / 2 - minX * k,
      ty: (vh - bh * k) / 2 - minY * k
    };
  }

  /* ------------------------------------------------------------------ */
  /* 测试用不变量（Node 无 DOM 可直接调用）                              */
  /* ------------------------------------------------------------------ */

  function nodesOverlap(layout) {
    var out = [];
    var list = (layout && layout.nodes) || [];
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j];
        if (a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS) continue;
        if (a.y + a.h <= b.y + EPS || b.y + b.h <= a.y + EPS) continue;
        out.push({a: a.id, b: b.id});
      }
    }
    return out;
  }

  function edgesExitNodes(layout) {
    var out = [];
    var ns = (layout && layout.nodes) || [];
    var es = (layout && layout.edges) || [];
    var points = ['start', 'end'];
    es.forEach(function (e) {
      points.forEach(function (key) {
        var pt = e[key];
        if (!pt) return;
        for (var k = 0; k < ns.length; k++) {
          var n = ns[k];
          var inside = pt.x > n.x + EPS && pt.x < n.x + n.w - EPS &&
            pt.y > n.y + EPS && pt.y < n.y + n.h - EPS;
          if (inside) out.push({edge: e.id, node: n.id, point: key, x: r2(pt.x), y: r2(pt.y)});
        }
      });
    });
    return out;
  }

  function boundsOf(layout) {
    var b = (layout && layout.bounds) || {};
    var ns = (layout && layout.nodes) || [];
    var es = (layout && layout.edges) || [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function extend(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    ns.forEach(function (n) { extend(n.x, n.y); extend(n.x + n.w, n.y + n.h); });
    es.forEach(function (e) {
      extend(e.start.x, e.start.y);
      extend(e.end.x, e.end.y);
      (e.controls || []).forEach(function (c) { extend(c.x, c.y); });
    });
    if (!isFinite(minX)) return {minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0};
    return {
      minX: r2(minX), minY: r2(minY), maxX: r2(maxX), maxY: r2(maxY),
      width: r2(maxX - minX), height: r2(maxY - minY),
      declared: b
    };
  }

  function placeInViewport(layout, viewport, padding) {
    var t = fitTransform(boundsOf(layout), viewport, padding === undefined ? PAD : padding);
    var transformed = (layout && layout.nodes || []).map(function (n) {
      return {
        id: n.id,
        x: n.x * t.k + t.tx, y: n.y * t.k + t.ty,
        w: n.w * t.k, h: n.h * t.k
      };
    });
    return {transform: t, nodes: transformed};
  }

  CL.layout = {
    buildGraph: buildGraph,
    layoutGraph: layoutGraph,
    fitTransform: fitTransform,
    placeInViewport: placeInViewport,
    __test: {
      nodesOverlap: nodesOverlap,
      edgesExitNodes: edgesExitNodes,
      boundsOf: boundsOf,
      constants: {
        NODE_W: NODE_W, NODE_H: NODE_H, GAP_X: GAP_X, GAP_Y: GAP_Y,
        PAD: PAD, DEFAULT_LIMIT: DEFAULT_LIMIT
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
