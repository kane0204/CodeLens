/* CodeLens · 结构图 SVG 渲染与交互
 * 契约：docs/software/frontend-redesign.md §1.2 / §4.2 / §5.3
 * 导出：CL.graphSvg = { render(layout, opts), mount(container, layout, ctx) }
 *
 * 消除 §1.2 的旧根因：
 *  - 不再用滚动条承载大图：所有平移/缩放都落在 <g class="viewport"> 的 transform 上；
 *  - 图层顺序固定 edges → nodes → labels，箭头永远不被节点遮住；
 *  - markerUnits="userSpaceOnUse"，箭头尖端正好落在端口圆点外侧 2px 的路径终点；
 *  - data-node 使用节点 id（不用数组下标）。
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  var MIN_K = 0.35;          /* 缩放下限（规格 §1.2） */
  var MAX_K = 2.0;           /* 缩放上限（规格 §1.2） */
  var FIT_PAD = 32;          /* 适配内边距（规格 §1.2） */
  var CHIP_LIMIT = 40;       /* 关系数 ≤40 时边标签常显，超出只 hover/选中显示 */
  var FALLBACK_W = 1200;     /* 附录 D：测量失败兜底 */
  var FALLBACK_H = 560;
  var NODE_RX = 8;
  var STRIPE_W = 3;
  var PORT_R = 3.2;
  var TITLE_MAX = 18;        /* 显示宽度 >18 加省略号，中文按 2 计 */
  var SUB_MAX = 26;
  var STEP_PAN = 60;
  var GLOW = '#0f766e';

  /* 8 色文件色条（按路径哈希取色） */
  var PALETTE = ['#0f766e', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#b45309', '#15803d', '#475569'];

  var EDGE_STYLE = {
    dependency: { cls: 'edge-path--dep', marker: 'dep' },
    call: { cls: 'edge-path--call', marker: 'call' },
    inheritance: { cls: 'edge-path--inherit', marker: 'inherit' }
  };
  var BASE_EDGE = { cls: '', marker: 'base' };
  var MARKER_COLOR = { dep: '#0891b2', call: '#7c3aed', inherit: '#0f766e', base: '#9aa9be' };

  var ARIA_LABEL = {
    modules: '模块依赖图：箭头指向被依赖的模块',
    classes: '类与继承图：箭头指向父类',
    calls: '已解析调用图：箭头指向被调用者'
  };

  /* ------------------------------------------------------------------ */
  /* 小工具（不依赖 DOM，可安全用于 Node 字符串测试）                    */
  /* ------------------------------------------------------------------ */
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : (typeof fallback === 'number' ? fallback : 0);
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) { return str(v).replace(/[&<>"']/g, function (ch) { return ESC_MAP[ch]; }); }

  function displayWidth(s) {
    var text = str(s), width = 0;
    for (var i = 0; i < text.length; i += 1) {
      width += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(text.charAt(i)) ? 2 : 1;
    }
    return width;
  }

  function clipWidth(s, max) {
    var text = str(s), limit = num(max, TITLE_MAX), width = 0, out = '';
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      width += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1;
      if (width > limit) return out + '…';
      out += ch;
    }
    return out;
  }

  function hashOf(path) {
    var s = str(path), h = 5381, i;
    for (i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h % PALETTE.length;
  }

  function iconOf(node) {
    var kind = str(node && node.kind);
    if (kind === 'class') return '类';
    if (kind === 'expression') return '表达式';
    if (kind === 'module') return '模块';
    if (kind === 'method') return '方法';
    if (kind === 'function') return '函数';
    return '';
  }

  function transformAttr(view) {
    return 'translate(' + r2(view.tx) + ',' + r2(view.ty) + ') scale(' + r3(view.k) + ')';
  }

  function normView(v) {
    var o = v || {};
    var k = num(o.k, 1);
    if (!isFinite(k) || k <= 0) k = 1;
    return { k: clamp(k, MIN_K, MAX_K), tx: num(o.tx, 0), ty: num(o.ty, 0) };
  }

  /* ------------------------------------------------------------------ */
  /* SVG 片段                                                            */
  /* ------------------------------------------------------------------ */

  function renderDefs() {
    var keys = ['dep', 'call', 'inherit', 'base'];
    var out = ['<defs>'];
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      out.push(
        '<marker id="cl-arrow-' + key + '" markerWidth="10" markerHeight="10" refX="8.4" refY="5"' +
        ' orient="auto" markerUnits="userSpaceOnUse">' +
        '<path d="M0.8,1.1 L8.4,5 L0.8,8.9" fill="' + MARKER_COLOR[key] + '"/></marker>'
      );
    }
    out.push('</defs>');
    return out.join('');
  }

  function edgeTip(e, nodeMap) {
    var a = nodeMap[e.from] || { label: e.from };
    var b = nodeMap[e.to] || { label: e.to };
    var text = str(a.label) + ' → ' + str(b.label);
    if (e.file) text += ' · ' + str(e.file) + ':' + num(e.line, 1);
    if (num(e.count, 1) > 1) text += ' · ' + num(e.count, 1) + ' 处';
    return str(e.expression) ? text + ' · ' + str(e.expression) : text;
  }

  function nodeTip(n) {
    var text = str(n.fullLabel) || str(n.label) || str(n.id);
    if (n.sub) text += ' · ' + str(n.sub);
    return text;
  }

  function renderEdgeLayer(edges, nodeMap, edgeHot, dim) {
    var out = ['<g class="graph-edges" data-graph-layer="edges">'];
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var style = EDGE_STYLE[e.kind] || BASE_EDGE;
      var cls = 'edge-path' + (style.cls ? ' ' + style.cls : '');
      if (dim) cls += edgeHot[e.id] ? ' is-hot' : ' is-dim';
      out.push(
        '<path class="' + cls + '" data-edge="' + esc(e.id) + '" d="' + str(e.d) + '"' +
        ' fill="none" marker-end="url(#cl-arrow-' + style.marker + ')"/>'
      );
    }
    out.push('</g>');
    return out.join('');
  }

  function renderHitLayer(edges, nodeMap) {
    var out = ['<g class="graph-edge-hits" data-graph-layer="hits">'];
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      out.push(
        '<path class="edge-hit" data-edge="' + esc(e.id) + '" d="' + str(e.d) + '">' +
        '<title>' + esc(edgeTip(e, nodeMap)) + '</title></path>'
      );
    }
    out.push('</g>');
    return out.join('');
  }

  function portDirection(edges, nodeMap) {
    var map = Object.create(null);
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var a = nodeMap[e.from];
      var b = nodeMap[e.to];
      if (a && e.start) map[e.from + '|' + r2(e.start.x - a.x) + '|' + r2(e.start.y - a.y)] = 'out';
      if (b && e.end) map[e.to + '|' + r2(e.end.x - b.x) + '|' + r2(e.end.y - b.y)] = 'in';
    }
    return map;
  }

  function renderNodeLayer(nodes, portDir, nodeHot, dim, selected) {
    var out = ['<g class="graph-nodes" data-graph-layer="nodes">'];
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      var w = num(n.w, 200);
      var h = num(n.h, 56);
      var cls = 'node';
      var focused = selected && n.id === selected;
      if (focused) cls += ' is-focus';
      else if (dim && !nodeHot[n.id]) cls += ' is-dim';
      var color = PALETTE[hashOf(n.file || n.id)];
      out.push(
        '<g class="' + cls + '" data-node="' + esc(n.id) + '" role="button" tabindex="0"' +
        ' aria-label="' + esc((str(n.fullLabel) || str(n.label)) + ' ' + str(n.sub)) + '"' +
        ' transform="translate(' + r2(n.x) + ',' + r2(n.y) + ')">'
      );
      out.push('<title>' + esc(nodeTip(n)) + '</title>');
      if (focused) {
        out.push(
          '<rect class="node-halo" x="-3" y="-3" width="' + r2(w + 6) + '" height="' + r2(h + 6) + '"' +
          ' rx="' + (NODE_RX + 3) + '" fill="none" stroke="' + GLOW + '" stroke-opacity="0.2" stroke-width="6"/>'
        );
      }
      out.push('<rect class="node-box node-box--file" width="' + r2(w) + '" height="' + r2(h) + '" rx="' + NODE_RX + '"/>');
      out.push(
        '<rect class="node-stripe" x="0.8" y="0.8" width="' + STRIPE_W + '" height="' + r2(h - 1.6) + '"' +
        ' rx="1.5" fill="' + color + '"/>'
      );
      var ports = n.ports || [];
      for (var p = 0; p < ports.length; p += 1) {
        var pt = ports[p];
        var key = n.id + '|' + r2(pt.x) + '|' + r2(pt.y);
        var dir = portDir[key];
        var pcls = 'node-port' + (dir === 'out' ? ' node-port--out' : dir === 'in' ? ' node-port--in' : '');
        out.push(
          '<circle class="' + pcls + '" cx="' + r2(pt.x) + '" cy="' + r2(pt.y) + '" r="' + PORT_R + '"' +
          ' pointer-events="none"/>'
        );
      }
      out.push('</g>');
    }
    out.push('</g>');
    return out.join('');
  }

  function renderLabelLayer(nodes, nodeHot, dim, selected) {
    var out = ['<g class="graph-labels" data-graph-layer="labels" pointer-events="none">'];
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      var focused = selected && n.id === selected;
      var dimmed = dim && !focused && !nodeHot[n.id];
      out.push(
        '<g class="graph-label" data-label-for="' + esc(n.id) + '"' +
        (dimmed ? ' opacity="0.3"' : '') + '>'
      );
      var title = clipWidth(n.label || n.id, TITLE_MAX);
      var sub = clipWidth(n.sub || '', SUB_MAX);
      out.push('<text class="node-title" x="' + r2(n.x + 14) + '" y="' + r2(n.y + 23) + '">' + esc(title) + '</text>');
      if (sub) {
        out.push('<text class="node-sub" x="' + r2(n.x + 14) + '" y="' + r2(n.y + 41) + '">' + esc(sub) + '</text>');
      }
      var badge = iconOf(n);
      if (badge) {
        out.push(
          '<text class="node-chip" x="' + r2(n.x + num(n.w, 200) - 10) + '" y="' + r2(n.y + 41) + '"' +
          ' text-anchor="end" fill="#94a3b8">' + esc(badge) + '</text>'
        );
      }
      out.push('</g>');
    }
    out.push('</g>');
    return out.join('');
  }

  function chipText(e, nodeMap) {
    var a = nodeMap[e.from] || { label: e.from };
    var b = nodeMap[e.to] || { label: e.to };
    return clipWidth(a.label, 10) + ' → ' + clipWidth(b.label, 10);
  }

  function renderChipLayer(edges, nodeMap, alwaysOn, edgeHot, dim) {
    if (!edges.length) return '';
    var out = ['<g class="graph-chips" data-graph-layer="chips" pointer-events="none">'];
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var mid = e.mid || e.end;
      if (!mid) continue;
      var text = chipText(e, nodeMap);
      var cw = Math.round(displayWidth(text) * 6.1 + 14);
      var ch = 18;
      var visible = alwaysOn || (dim && edgeHot[e.id]);
      out.push(
        '<g class="graph-chip' + (edgeHot[e.id] ? ' is-hot' : '') + '" data-chip-for="' + esc(e.id) + '"' +
        ' opacity="' + (visible ? '1' : '0') + '">'
      );
      out.push(
        '<rect x="' + r2(mid.x - cw / 2) + '" y="' + r2(mid.y - ch / 2) + '" width="' + cw + '" height="' + ch + '"' +
        ' rx="9" fill="#ffffff" fill-opacity="0.94" stroke="#e3e8ef" stroke-width="1"/>'
      );
      out.push(
        '<text class="node-chip" x="' + r2(mid.x) + '" y="' + r2(mid.y + 3.5) + '" text-anchor="middle"' +
        ' fill="#64748b">' + esc(text) + '</text>'
      );
      out.push('</g>');
    }
    out.push('</g>');
    return out.join('');
  }

  /* ------------------------------------------------------------------ */
  /* render：纯字符串，不做任何测量（附录 D）                            */
  /* ------------------------------------------------------------------ */
  function render(layout, opts) {
    var L = layout || {};
    var o = opts || {};
    var nodes = L.nodes || [];
    var edges = L.edges || [];
    var mode = str(o.mode) || str(L.mode) || 'modules';
    var view = normView(o.view);
    var w = Math.max(1, Math.round(num(o.width, FALLBACK_W)));
    var h = Math.max(1, Math.round(num(o.height, FALLBACK_H)));
    var selected = str(o.selected);
    var dim = !!selected && o.dimUnrelated !== false;

    var nodeMap = Object.create(null);
    var nodeHot = Object.create(null);
    var edgeHot = Object.create(null);
    var i;

    for (i = 0; i < nodes.length; i += 1) nodeMap[nodes[i].id] = nodes[i];

    if (selected) {
      nodeHot[selected] = true;
      for (i = 0; i < edges.length; i += 1) {
        var e = edges[i];
        if (e.from === selected || e.to === selected) {
          edgeHot[e.id] = true;
          nodeHot[e.from] = true;
          nodeHot[e.to] = true;
        }
      }
    }

    var portDir = portDirection(edges, nodeMap);
    var alwaysOn = edges.length <= CHIP_LIMIT;

    var out = [];
    out.push(
      '<svg class="graph-svg" data-graph-mode="' + esc(mode) + '" width="' + w + '" height="' + h + '"' +
      ' role="group" aria-label="' + esc(ARIA_LABEL[mode] || '结构关系图') + '">'
    );
    out.push(renderDefs());
    out.push('<g class="viewport" data-graph-layer="viewport" transform="' + transformAttr(view) + '">');
    out.push(renderEdgeLayer(edges, nodeMap, edgeHot, dim));
    out.push(renderHitLayer(edges, nodeMap));
    out.push(renderNodeLayer(nodes, portDir, nodeHot, dim, selected));
    out.push(renderLabelLayer(nodes, nodeHot, dim, selected));
    out.push(renderChipLayer(edges, nodeMap, alwaysOn, edgeHot, dim));
    out.push('</g>');
    out.push('</svg>');
    return out.join('');
  }

  /* ------------------------------------------------------------------ */
  /* mount：视口交互（滚轮锚点缩放 / 拖拽平移 / 选中 / 键盘）            */
  /* ------------------------------------------------------------------ */
  function q(scope, sel) {
    try { return scope && scope.querySelector ? scope.querySelector(sel) : null; } catch (e) { return null; }
  }
  function qa(scope, sel) {
    try {
      if (!scope || !scope.querySelectorAll) return [];
      return Array.prototype.slice.call(scope.querySelectorAll(sel));
    } catch (e) { return []; }
  }
  function closestAttr(el, attr) {
    var cur = el;
    var guard = 0;
    while (cur && guard < 64) {
      guard += 1;
      try {
        if (cur.getAttribute) {
          var v = cur.getAttribute(attr);
          if (v !== null && v !== undefined) return cur;
        }
      } catch (e) { /* 忽略异常节点 */ }
      cur = cur.parentNode;
    }
    return null;
  }
  function measure(el) {
    var w = FALLBACK_W, h = FALLBACK_H, ok = false;
    try {
      if (el) {
        var cw = num(el.clientWidth, 0);
        var ch = num(el.clientHeight, 0);
        if ((cw <= 0 || ch <= 0) && el.getBoundingClientRect) {
          var rect = el.getBoundingClientRect();
          if (rect) { cw = num(rect.width, 0); ch = num(rect.height, 0); }
        }
        if (cw > 0 && ch > 0) { w = cw; h = ch; ok = true; }
      }
    } catch (e) { ok = false; }
    if (!ok) { w = FALLBACK_W; h = FALLBACK_H; }
    return { width: Math.round(w), height: Math.round(h) };
  }
  function rectOf(el) {
    try {
      if (el && el.getBoundingClientRect) {
        var r = el.getBoundingClientRect();
        if (r) return { left: num(r.left, 0), top: num(r.top, 0), width: num(r.width, FALLBACK_W), height: num(r.height, FALLBACK_H) };
      }
    } catch (e) { /* 忽略测量失败 */ }
    return { left: 0, top: 0, width: FALLBACK_W, height: FALLBACK_H };
  }

  function mount(container, layout, ctx) {
    var c = container;
    var cb = ctx || {};
    var noop = function () {};
    if (!c || typeof c.querySelector !== 'function') return noop;

    var svg = q(c, 'svg.graph-svg');
    var layer = q(c, 'g.viewport');
    if (!svg || !layer) return noop;

    var L = layout || {};
    var style = CL.layout && CL.layout.__test;
    var bounds = (L.bounds && num(L.bounds.width, 0) > 0)
      ? L.bounds
      : (style && style.boundsOf ? style.boundsOf(L) : { minX: 0, minY: 0, width: 1, height: 1 });

    var state = { k: 1, tx: 0, ty: 0 };
    var size = measure(c);
    var selectedId = str(cb.selected);
    var dragging = false;
    var moved = false;
    var startX = 0, startY = 0, baseX = 0, baseY = 0;
    var cleanups = [];
    var observer = null;
    var tip = q(c, '.graph-tip');
    var mmView = q(c, '.mm-view');

    function on(el, type, fn, opts) {
      if (!el || typeof el.addEventListener !== 'function') return;
      try {
        el.addEventListener(type, fn, opts || false);
        cleanups.push(function () {
          try { el.removeEventListener(type, fn, opts || false); } catch (e) { /* 已被移除 */ }
        });
      } catch (e) { /* 桩环境忽略 */ }
    }

    function apply() {
      try { svg.setAttribute('width', size.width); svg.setAttribute('height', size.height); } catch (e) { /* 忽略 */ }
      try { layer.setAttribute('transform', transformAttr(state)); } catch (e) { /* 忽略 */ }
      updateMinimap();
      if (typeof cb.onTransform === 'function') {
        try { cb.onTransform({ k: state.k, tx: state.tx, ty: state.ty }); } catch (e) { /* 忽略 */ }
      }
    }

    function updateMinimap() {
      if (!mmView || state.k <= 0) return;
      try {
        mmView.setAttribute('x', r2(-state.tx / state.k));
        mmView.setAttribute('y', r2(-state.ty / state.k));
        mmView.setAttribute('width', r2(size.width / state.k));
        mmView.setAttribute('height', r2(size.height / state.k));
      } catch (e) { /* 忽略 */ }
    }

    function fit() {
      var fn = CL.layout && CL.layout.fitTransform;
      if (typeof fn !== 'function') return;
      var t = fn(bounds, size, FIT_PAD);
      state.k = clamp(t.k, MIN_K, MAX_K);
      state.tx = t.tx;
      state.ty = t.ty;
      apply();
    }

    function zoomAt(cx, cy, factor) {
      var k2 = clamp(state.k * factor, MIN_K, MAX_K);
      if (!isFinite(k2) || k2 === state.k) return;
      var wx = (cx - state.tx) / state.k;
      var wy = (cy - state.ty) / state.k;
      state.k = k2;
      state.tx = cx - wx * k2;
      state.ty = cy - wy * k2;
      apply();
    }

    function zoomCenter(factor) {
      zoomAt(size.width / 2, size.height / 2, factor);
    }

    function panBy(dx, dy) {
      state.tx += dx;
      state.ty += dy;
      apply();
    }

    function paintSelection() {
      var nodes = qa(c, '[data-node]');
      var labels = qa(c, '[data-label-for]');
      var edges = qa(c, '[data-edge]');
      var chips = qa(c, '[data-chip-for]');
      var hotEdges = Object.create(null);
      var hotNodes = Object.create(null);
      var i;

      if (selectedId) {
        hotNodes[selectedId] = true;
        for (i = 0; i < edges.length; i += 1) {
          var id = edges[i].getAttribute('data-edge');
          var from = '', to = '';
          var src = (L.edges || [])[i];
          if (src) { from = src.from; to = src.to; }
          else if (id && id.indexOf('->') > 0) { from = id.split('->')[0]; to = id.split('->')[1]; }
          if (from === selectedId || to === selectedId) hotEdges[id] = true;
        }
      }

      for (i = 0; i < nodes.length; i += 1) {
        var nodeId = nodes[i].getAttribute('data-node');
        var cls = nodes[i].className || '';
        var focus = !!selectedId && nodeId === selectedId;
        var dimmed = !!selectedId && !focus && !hotNodes[nodeId];
        cls = cls.replace(/\s*is-focus/g, '').replace(/\s*is-dim/g, '');
        if (focus) cls += ' is-focus';
        else if (dimmed) cls += ' is-dim';
        try { nodes[i].className = cls; } catch (e) { /* 忽略 */ }
      }
      for (i = 0; i < labels.length; i += 1) {
        var lid = labels[i].getAttribute('data-label-for');
        var ldim = !!selectedId && lid !== selectedId && !hotNodes[lid];
        try { labels[i].setAttribute('opacity', ldim ? '0.3' : '1'); } catch (e) { /* 忽略 */ }
      }
      for (i = 0; i < edges.length; i += 1) {
        var eid = edges[i].getAttribute('data-edge');
        var ecls = edges[i].getAttribute('class') || '';
        ecls = ecls.replace(/\s*is-hot/g, '').replace(/\s*is-dim/g, '');
        if (selectedId) ecls += hotEdges[eid] ? ' is-hot' : ' is-dim';
        try { edges[i].setAttribute('class', ecls); } catch (e) { /* 忽略 */ }
      }
      for (i = 0; i < chips.length; i += 1) {
        var cid = chips[i].getAttribute('data-chip-for');
        var show = !selectedId || !!hotEdges[cid];
        try {
          if (show || !selectedId) chips[i].setAttribute('opacity', selectedId && !hotEdges[cid] ? '0' : '1');
        } catch (e) { /* 忽略 */ }
      }
    }

    function select(id) {
      selectedId = str(id);
      paintSelection();
      if (typeof cb.onSelect === 'function') {
        try { cb.onSelect(selectedId); } catch (e) { /* 忽略 */ }
      }
    }

    function findNode(id) {
      var list = L.nodes || [];
      for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
      return null;
    }

    function showTip(nodeEl) {
      if (!tip) return;
      var id = nodeEl.getAttribute('data-node');
      var node = findNode(id);
      if (!node) return;
      var inCount = 0, outCount = 0;
      var edges = L.edges || [];
      for (var i = 0; i < edges.length; i += 1) {
        if (edges[i].to === id) inCount += 1;
        if (edges[i].from === id) outCount += 1;
      }
      var html = '<b>' + esc(str(node.fullLabel) || str(node.label)) + '</b>';
      if (node.sub) html += '<br>' + esc(node.sub);
      html += '<br>入 ' + inCount + ' · 出 ' + outCount;
      try {
        tip.innerHTML = html;
        tip.className = 'graph-tip is-on';
      } catch (e) { /* 忽略 */ }
    }

    function hideTip() {
      if (!tip) return;
      try { tip.className = 'graph-tip'; } catch (e) { /* 忽略 */ }
    }

    /* ---- 事件 ---- */
    on(c, 'wheel', function (ev) {
      if (!ev) return;
      if (ev.preventDefault) ev.preventDefault();
      var rect = rectOf(c);
      var cx = num(ev.clientX, 0) - rect.left;
      var cy = num(ev.clientY, 0) - rect.top;
      var delta = num(ev.deltaY, 0);
      if (!delta) return;
      zoomAt(cx, cy, Math.pow(1.0016, -delta));
    }, { passive: false });

    on(c, 'pointerdown', function (ev) {
      if (!ev) return;
      if (closestAttr(ev.target, 'data-node')) return;
      if (num(ev.button, 0) !== 0) return;
      dragging = true;
      moved = false;
      startX = num(ev.clientX, 0);
      startY = num(ev.clientY, 0);
      baseX = state.tx;
      baseY = state.ty;
      try { c.className = (c.className || '') + ' is-panning'; } catch (e) { /* 忽略 */ }
      if (ev.preventDefault) ev.preventDefault();
    });

    on(root, 'pointermove', function (ev) {
      if (!dragging || !ev) return;
      var dx = num(ev.clientX, 0) - startX;
      var dy = num(ev.clientY, 0) - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      state.tx = baseX + dx;
      state.ty = baseY + dy;
      apply();
    });

    on(root, 'pointerup', function () {
      if (!dragging) return;
      dragging = false;
      try { c.className = (c.className || '').replace(/\s*is-panning/g, ''); } catch (e) { /* 忽略 */ }
    });

    on(c, 'click', function (ev) {
      if (!ev) return;
      if (moved) { moved = false; return; }
      var nodeEl = closestAttr(ev.target, 'data-node');
      if (!nodeEl) return;
      var id = nodeEl.getAttribute('data-node');
      select(id === selectedId ? '' : id);
    });

    on(c, 'dblclick', function (ev) {
      if (!ev) return;
      var nodeEl = closestAttr(ev.target, 'data-node');
      if (!nodeEl) return;
      var node = findNode(nodeEl.getAttribute('data-node'));
      if (!node) return;
      if (typeof cb.onOpen === 'function') {
        try { cb.onOpen(node); } catch (e) { /* 忽略 */ }
      } else if (typeof cb.locate === 'function' && node.file) {
        try { cb.locate(node.file, num(node.line, 1)); } catch (e) { /* 忽略 */ }
      }
    });

    on(c, 'mouseover', function (ev) {
      if (!ev) return;
      var nodeEl = closestAttr(ev.target, 'data-node');
      if (nodeEl) { showTip(nodeEl); return; }
      var edgeEl = closestAttr(ev.target, 'data-edge');
      if (!edgeEl) return;
      var chipEl = q(c, '[data-chip-for="' + str(edgeEl.getAttribute('data-edge')).replace(/"/g, '\\"') + '"]');
      if (chipEl) { try { chipEl.setAttribute('opacity', '1'); } catch (e) { /* 忽略 */ } }
    });

    on(c, 'mouseout', function (ev) {
      if (!ev) return;
      hideTip();
      var edgeEl = closestAttr(ev.target, 'data-edge');
      if (!edgeEl) return;
      var id = str(edgeEl.getAttribute('data-edge'));
      if (selectedId) return;
      var chipEl = q(c, '[data-chip-for="' + id.replace(/"/g, '\\"') + '"]');
      if (chipEl) { try { chipEl.setAttribute('opacity', '0'); } catch (e) { /* 忽略 */ } }
    });

    on(c, 'keydown', function (ev) {
      if (!ev) return;
      var key = str(ev.key);
      if (key === '0') { if (ev.preventDefault) ev.preventDefault(); fit(); return; }
      if (key === '+' || key === '=') { if (ev.preventDefault) ev.preventDefault(); zoomCenter(1.2); return; }
      if (key === '-' || key === '_') { if (ev.preventDefault) ev.preventDefault(); zoomCenter(1 / 1.2); return; }
      if (key === 'ArrowLeft') { if (ev.preventDefault) ev.preventDefault(); panBy(STEP_PAN, 0); return; }
      if (key === 'ArrowRight') { if (ev.preventDefault) ev.preventDefault(); panBy(-STEP_PAN, 0); return; }
      if (key === 'ArrowUp') { if (ev.preventDefault) ev.preventDefault(); panBy(0, STEP_PAN); return; }
      if (key === 'ArrowDown') { if (ev.preventDefault) ev.preventDefault(); panBy(0, -STEP_PAN); return; }
      if (key === 'Escape' || key === 'Esc') { select(''); }
    });

    try { if (!c.getAttribute || c.getAttribute('tabindex') === null) c.setAttribute('tabindex', '0'); } catch (e) { /* 忽略 */ }

    if (typeof root.ResizeObserver === 'function') {
      try {
        observer = new root.ResizeObserver(function () {
          size = measure(c);
          apply();
        });
        observer.observe(c);
      } catch (e) { observer = null; }
    }
    on(root, 'resize', function () {
      size = measure(c);
      fit();
    });

    fit();
    paintSelection();

    var cleanup = function () {
      var i;
      for (i = 0; i < cleanups.length; i += 1) {
        try { cleanups[i](); } catch (e) { /* 忽略 */ }
      }
      cleanups = [];
      if (observer) {
        try { observer.disconnect(); } catch (e) { /* 忽略 */ }
        observer = null;
      }
      hideTip();
    };
    cleanup.fit = fit;
    cleanup.zoomIn = function () { zoomCenter(1.2); };
    cleanup.zoomOut = function () { zoomCenter(1 / 1.2); };
    cleanup.select = select;
    cleanup.transform = function () { return { k: state.k, tx: state.tx, ty: state.ty }; };
    cleanup.resize = function () { size = measure(c); apply(); };
    /* 供宿主视图回填「上一帧的用户视图」：整页重渲染后不用重新 fit 到全局。 */
    cleanup.setView = function (v) {
      if (!v) return;
      var k = clamp(num(v.k, 1), MIN_K, MAX_K);
      if (!isFinite(k) || k <= 0) return;
      state.k = k;
      state.tx = num(v.tx, 0);
      state.ty = num(v.ty, 0);
      apply();
    };
    cleanup.size = function () { return { width: size.width, height: size.height }; };
    return cleanup;
  }

  CL.graphSvg = { render: render, mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
