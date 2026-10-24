/* views/structure.js — 结构视图：确定性分层布局 + transform 视口
 * 契约见 docs/software/frontend-redesign.md §4.2 / §5.3 / §1.2 / 附录D
 *   CL.views.structure = { render(state, ctx) : string, mount(root, state, ctx) : handle }
 *
 * 旧代码 6 个根因在此逐一消除（规格 §1.2）：
 *   ① 不再用滚动条承载大图：.graph-viewport{overflow:hidden} + SVG 内 <g.viewport> 做变换，
 *      视图不设置任何内联高度、不出现 overflow:auto，滚动全部交给 #main。
 *   ② 布局是确定性纯函数 CL.layout（SCC 收缩 + 最长路径分层），节点 200×56，
 *      同层水平间距 ≥56、层间 ≥120；本文件不写任何坐标常量。
 *   ③ 边端点由 CL.layout 依端口圆点算出（源外侧端口 → 目标入端口），视图不做几何计算。
 *   ④ 图层顺序由 CL.graphSvg.render 固定为 edges → nodes → labels，箭头永不被节点覆盖。
 *   ⑤ 初始 fit-to-screen（padding 32），全部节点与边一次性可见。
 *   ⑥ data-node 写节点 id；节点数超上限时显式提示，不静默 slice。
 *
 * render 阶段零 DOM 访问、零测量；测量与事件绑定只在 mount 内，且全部 try/catch
 * （附录 D：桩环境下 clientWidth / getBoundingClientRect 全为 0，退回 1200×560）。
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = CL.dom || {};

  /* ---------------- 依赖兜底（lib/dom.js 缺失时仍可渲染） ---------------- */
  function esc(v) { return D.esc ? D.esc(v) : String(v === null || v === undefined ? '' : v); }
  function fmtInt(v) { return D.fmtInt ? D.fmtInt(v) : String(v === null || v === undefined ? 0 : v); }
  function tag(t, c) { return D.tag ? D.tag(t, c) : '<span class="tag tag--neutral">' + esc(t) + '</span>'; }
  function emptyBox(t, d, a) {
    if (D.empty) return D.empty(t, d, a);
    return '<div class="empty"><p class="empty__title">' + esc(t) + '</p>' +
      '<p class="empty__desc">' + esc(d || '') + '</p>' +
      (a ? '<div class="empty__action">' + a + '</div>' : '') + '</div>';
  }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function num(v, f) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : (f || 0);
  }
  function r2(v) { return Math.round(num(v, 0) * 100) / 100; }

  var PAD = 32;             /* fit 内边距（规格 §5.3） */
  var NODE_LIMIT = 60;      /* 节点上限（规格 §1.2） */
  var LIST_CAP = 200;       /* 关系依据清单最多列 200 条（规格 §5.3） */
  var MINIMAP_MAX = 80;     /* 节点数超过 80 不画小地图 */
  var FALLBACK = { width: 1200, height: 560 };   /* 附录 D 兜底视口 */

  var MODES = [
    { id: 'modules', label: '模块依赖', unit: '依赖', line: 'dep', semantics: '箭头指向被依赖的模块' },
    { id: 'classes', label: '类与继承', unit: '继承', line: 'inherit', semantics: '箭头指向父类' },
    { id: 'calls', label: '已解析调用', unit: '调用', line: 'call', semantics: '箭头指向被调用者' }
  ];

  var SUB = '按依赖深度做确定性分层布局：节点固定 200×56，同层水平间距不小于 56px、层间不小于 120px；' +
    '进入时自动适配视口，全部节点与关系一次可见。滚轮缩放（0.35× – 2.0×，以光标为锚点）、' +
    '拖拽空白平移、单击节点高亮其关联关系、双击跳转源码、按 0 键适配视口、+ / − 缩放、方向键平移、Esc 取消选中。';

  /* state.graph 规范化：兼容 modules/classes/calls 以及 module/inherit/call 别名 */
  var MODE_ALIAS = {
    modules: 'modules', module: 'modules',
    classes: 'classes', inherit: 'classes', inheritance: 'classes', class: 'classes',
    calls: 'calls', call: 'calls'
  };

  function modeOf(state) {
    var m = state ? str(state.graph) : '';
    return MODE_ALIAS[m] || 'modules';
  }

  function modeInfo(id) {
    for (var i = 0; i < MODES.length; i += 1) if (MODES[i].id === id) return MODES[i];
    return MODES[0];
  }

  /* 跨重渲染记住视口变换：点击节点会触发 app.js 的整页重渲染，
     若每次都重新 fit，用户刚放大的视图会被无谓重置。键 = 模式 + 节点数 + 画布尺寸。 */
  var viewCache = { key: '', view: null };

  function layoutKey(layout) {
    if (!layout) return '';
    return str(layout.mode) + '|' + ((layout.nodes || []).length) + '|' +
      r2(layout.width) + 'x' + r2(layout.height);
  }
  function cacheView(layout, view) {
    if (!layout || !view || !isFinite(num(view.k, NaN))) return;
    var k = num(view.k, 0);
    if (k <= 0) return;
    viewCache.key = layoutKey(layout);
    viewCache.view = { k: k, tx: num(view.tx, 0), ty: num(view.ty, 0) };
  }
  function cachedView(layout) {
    if (!layout || !viewCache.view) return null;
    return viewCache.key === layoutKey(layout) ? viewCache.view : null;
  }

  /* ---------------- 数据 ---------------- */

  function computeLayout(mode, result) {
    var L = CL.layout;
    if (!L || typeof L.buildGraph !== 'function' || typeof L.layoutGraph !== 'function') return null;
    try {
      return L.layoutGraph(L.buildGraph(mode, result || null, NODE_LIMIT));
    } catch (e) {
      return null;
    }
  }

  function previewView(layout) {
    var L = CL.layout;
    if (L && typeof L.fitTransform === 'function') {
      try { return L.fitTransform(layout && layout.bounds, FALLBACK, PAD); } catch (e) { /* 落到兜底 */ }
    }
    return { k: 1, tx: 0, ty: 0 };
  }

  function nodeMapOf(layout) {
    var m = Object.create(null);
    var list = (layout && layout.nodes) || [];
    for (var i = 0; i < list.length; i += 1) m[list[i].id] = list[i];
    return m;
  }

  /* ---------------- 页头 ---------------- */

  function head() {
    return [
      '<header class="page-head view__head">',
      '<div class="view__titles">',
      '<p class="eyebrow">STRUCTURE MAP</p>',
      '<h1 class="view__title">结构视图</h1>',
      '<p class="page-sub view__sub">', esc(SUB), '</p>',
      '</div>',
      '</header>'
    ].join('');
  }

  function wrapPage(inner) {
    return '<div class="page view">' + head() + inner + '</div>';
  }

  /* ---------------- 工具栏 ---------------- */

  function modeButtons(mode) {
    var out = [];
    for (var i = 0; i < MODES.length; i += 1) {
      var m = MODES[i];
      var on = m.id === mode;
      out.push(
        '<button type="button" class="btn btn--sm', on ? ' is-on' : '',
        '" data-action="graph-mode" data-value="', m.id, '" data-mode="', m.id,
        '" aria-pressed="', on ? 'true' : 'false', '" title="切换到', m.label, '图">',
        m.label, '</button>'
      );
    }
    return '<div class="graph-toolbar__group" role="group" aria-label="图模式">' + out.join('') + '</div>';
  }

  function zoomGroup(k) {
    return [
      '<div class="graph-toolbar__group" role="group" aria-label="缩放">',
      '<button type="button" class="btn btn--sm btn--icon" data-action="graph-zoom" data-value="out"',
      ' title="缩小（−）" aria-label="缩小">−</button>',
      '<span class="graph-zoom" data-graph-zoom="1">', Math.round(num(k, 1) * 100), '%</span>',
      '<button type="button" class="btn btn--sm btn--icon" data-action="graph-zoom" data-value="in"',
      ' title="放大（+）" aria-label="放大">+</button>',
      '</div>',
      '<button type="button" class="btn btn--sm" data-action="graph-fit" title="适配视口（0 键）">适配</button>'
    ].join('');
  }

  function legend(mode) {
    var m = modeInfo(mode);
    return [
      '<div class="graph-legend">',
      '<span><i class="', m.line, '"></i>', esc(m.unit), '：', esc(m.semantics), '</span>',
      '<span><i></i>边自源节点外侧端口出发、汇入目标节点外侧端口，不穿过节点</span>',
      '<span>同层关系与自环沿右侧外环绕行</span>',
      '</div>'
    ].join('');
  }

  function toolbar(layout, mode, k) {
    var st = (layout && layout.stats) || {};
    var nodes = (layout && layout.nodes) || [];
    var edges = (layout && layout.edges) || [];
    var out = ['<div class="graph-toolbar">', modeButtons(mode)];
    out.push(tag('节点 ' + fmtInt(nodes.length), 'neutral'));
    out.push(tag('关系 ' + fmtInt(edges.length), 'tech'));
    if (st.truncated) out.push(tag('已截断 · 全图 ' + fmtInt(st.totalNodes || nodes.length) + ' 个节点', 'warning'));
    if (mode === 'modules' && num(st.cycles, 0) > 0) out.push(tag('循环依赖 ' + fmtInt(st.cycles), 'warning'));
    out.push(legend(mode));
    out.push('<span class="spacer"></span>');
    out.push(zoomGroup(k));
    out.push('</div>');
    return out.join('');
  }

  /* ---------------- 画布 ---------------- */

  function renderSvg(layout, mode, state) {
    var G = CL.graphSvg;
    if (!G || typeof G.render !== 'function') return '';
    try {
      return G.render(layout, {
        mode: mode,
        view: previewView(layout),
        width: FALLBACK.width,
        height: FALLBACK.height,
        selected: str(state && state.focusNode)
      });
    } catch (e) {
      return '';
    }
  }

  /* 小地图：几何全部来自 layout，不参与任何测量；节点过多时不画。 */
  function minimap(layout) {
    var nodes = (layout && layout.nodes) || [];
    if (!nodes.length || nodes.length > MINIMAP_MAX) return '';
    var b = (layout && layout.bounds) || {};
    var pad = 24;
    var vx = num(b.minX, 0) - pad;
    var vy = num(b.minY, 0) - pad;
    var vw = Math.max(1, num(b.width, layout.width) + pad * 2);
    var vh = Math.max(1, num(b.height, layout.height) + pad * 2);
    var out = ['<div class="graph-minimap" aria-hidden="true"><svg viewBox="',
      r2(vx), ' ', r2(vy), ' ', r2(vw), ' ', r2(vh), '" preserveAspectRatio="xMidYMid meet">'];
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      out.push('<rect x="', r2(n.x), '" y="', r2(n.y), '" width="', r2(n.w),
        '" height="', r2(n.h), '" rx="2"></rect>');
    }
    out.push('<rect class="mm-view" x="', r2(vx), '" y="', r2(vy), '" width="', r2(vw),
      '" height="', r2(vh), '"></rect>');
    out.push('</svg></div>');
    return out.join('');
  }

  function canvas(layout, mode, state) {
    var nodes = (layout && layout.nodes) || [];
    if (!nodes.length) return '';
    return [
      '<div class="graph-wrap" data-graph-wrap="1">',
      toolbar(layout, mode, previewView(layout).k),
      '<div class="graph-viewport" data-graph-host="1" role="group" aria-label="结构关系画布">',
      renderSvg(layout, mode, state),
      minimap(layout),
      '<div class="graph-tip" role="tooltip"></div>',
      '</div>',
      '</div>'
    ].join('');
  }

  /* ---------------- 提示条 ---------------- */

  function notices(layout, mode) {
    var st = (layout && layout.stats) || {};
    var out = [];
    if (st.buildError) {
      out.push('<div class="notice notice--error"><span class="notice__icon">!</span><div>',
        '构建图数据时出错：', esc(st.buildError), '。画布只显示可用的部分。</div></div>');
    }
    if (st.truncated) {
      out.push('<div class="notice notice--warn"><span class="notice__icon">!</span><div>',
        '仅绘制前 ', fmtInt(st.nodes || 0), ' 个节点（全图共 ', fmtInt(st.totalNodes || 0),
        ' 个），其余节点未参与布局。可切换到更聚焦的模式，或先缩小分析范围再重试。</div></div>');
    }
    if (mode === 'modules' && num(st.cycles, 0) > 0) {
      var groups = st.cycleGroups || [];
      var detail = '';
      if (groups.length) {
        detail = '：' + groups.map(function (g) {
          var list = g || [];
          var names = list.map(function (x) { return esc(str(x).split('.').pop()); });
          var head0 = esc(str(list[0] || '').split('.').pop());
          return '<span class="mono-tag">' + names.join(' → ') + ' → ' + head0 + '</span>';
        }).join('、');
      }
      out.push('<div class="notice notice--warn"><span class="notice__icon">!</span><div>',
        '检测到 ', fmtInt(st.cycles), ' 组循环依赖', detail, '。',
        '环内节点被收缩到同一层，避免布局互相追逐；相关关系沿右侧外环绕行。</div></div>');
    }
    if (num(st.omittedEdges, 0) > 0) {
      out.push('<div class="notice notice--info"><span class="notice__icon">i</span><div>',
        '有 ', fmtInt(st.omittedEdges), ' 条内部依赖的端点未进入当前节点上限，因此未绘制。</div></div>');
    }
    return out.join('');
  }

  /* ---------------- 关系依据清单 ---------------- */

  function relationRows(layout) {
    var byId = nodeMapOf(layout);
    var edges = ((layout && layout.edges) || []).slice(0, LIST_CAP);
    var out = [];
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var a = byId[e.from] || {};
      var b = byId[e.to] || {};
      var evidence = str(e.evidence) || '关系';
      if (num(e.count, 1) > 1) evidence += ' ×' + fmtInt(e.count);
      if (e.expression) evidence += ' · ' + str(e.expression);
      var file = str(e.file);
      var line = num(e.line, 1);
      var attrs = file
        ? ' data-location="' + esc(file) + '" data-line="' + line + '" role="button" tabindex="0"'
        : '';
      out.push('<tr', attrs, '>');
      out.push('<td><span class="ellipsis" title="', esc(a.fullLabel || e.from), '">',
        esc(a.label || e.from), '</span></td>');
      out.push('<td><span class="ellipsis" title="', esc(b.fullLabel || e.to), '">',
        esc(b.label || e.to), '</span></td>');
      out.push('<td>', esc(evidence),
        e.route === 'self' ? ' ' + tag('自环', 'info') : '', '</td>');
      out.push('<td class="path">',
        file ? esc(file + ':' + line) : '<span class="dim">无源码位置</span>', '</td>');
      out.push('</tr>');
    }
    return out.join('');
  }

  function relationCard(layout, mode) {
    var edges = (layout && layout.edges) || [];
    var m = modeInfo(mode);
    var out = ['<section class="card">',
      '<div class="card__head">',
      '<h2 class="card__title">关系依据</h2>',
      '<p class="card__hint">', esc(m.unit), ' · 共 ', fmtInt(edges.length), ' 条',
      edges.length > LIST_CAP ? ' · 仅列前 ' + LIST_CAP + ' 条' : '', '</p>',
      '</div>'];

    if (!edges.length) {
      out.push('<div class="card__body"><div class="notice notice--info">',
        '<span class="notice__icon">i</span><div>当前模式下没有解析出「', esc(m.unit),
        '」关系，画布因此只有节点。可切换上方模式，或确认分析结果里确实存在这类关系。</div></div></div>');
      out.push('</section>');
      return out.join('');
    }

    out.push('<div class="card__body card__body--flush"><div class="table-wrap">');
    out.push('<table class="table table--compact">');
    out.push('<thead><tr><th>源</th><th>目标</th><th>依据</th><th>源码位置</th></tr></thead>');
    out.push('<tbody>', relationRows(layout), '</tbody>');
    out.push('</table></div></div>');
    out.push('<div class="card__foot"><span class="tiny">点任意一行可跳转到源码对应行。</span></div>');
    out.push('</section>');
    return out.join('');
  }

  /* ---------------- 未解析调用（仅 calls 模式） ---------------- */

  function unresolvedCard(layout) {
    var st = (layout && layout.stats) || {};
    var samples = st.unresolvedSamples || [];
    var unresolved = num(st.unresolved, 0);
    var resolved = num(st.resolved, 0);
    var total = num(st.totalCalls, 0);
    var out = ['<section class="card">',
      '<div class="card__head">',
      '<h2 class="card__title">未解析调用</h2>',
      '<p class="card__hint">调用 ', fmtInt(total), ' 条 · 已解析 ', fmtInt(resolved),
      ' · 未解析 ', fmtInt(unresolved), '</p>',
      '</div>'];

    if (!unresolved) {
      out.push('<div class="card__body"><div class="notice notice--ok">',
        '<span class="notice__icon">✓</span><div>本次分析中的所有调用表达式都已解析到具体目标，调用图没有缺口。</div></div></div>');
      out.push('</section>');
      return out.join('');
    }

    if (!samples.length) {
      out.push('<div class="card__body"><div class="notice notice--warn">',
        '<span class="notice__icon">!</span><div>有 ', fmtInt(unresolved),
        ' 条调用未能解析到目标，但它们不在当前节点上限内，未逐条列出。</div></div></div>');
      out.push('</section>');
      return out.join('');
    }

    out.push('<div class="card__body card__body--flush"><div class="list list--scroll">');
    for (var i = 0; i < samples.length; i += 1) {
      var s = samples[i] || {};
      var file = str(s.file);
      var line = num(s.line, 1);
      var attrs = file
        ? ' data-location="' + esc(file) + '" data-line="' + line + '" role="button" tabindex="0"'
        : '';
      out.push('<div class="list__item"', attrs, '>');
      out.push('<div class="list__main">');
      out.push('<div class="list__title">', esc(s.expression), '</div>');
      out.push('<div class="list__meta">',
        file ? esc(file + ':' + line) : '无源码位置',
        s.scope ? ' · 调用方 ' + esc(str(s.scope).split('.').pop()) : '', '</div>');
      out.push('</div>');
      out.push('<div class="list__side">', tag('未解析', 'warning'), '</div>');
      out.push('</div>');
    }
    out.push('</div></div>');
    if (unresolved > samples.length) {
      out.push('<div class="card__foot"><span class="tiny">共 ' + fmtInt(unresolved) +
        ' 条未解析调用，这里列出前 ' + fmtInt(samples.length) + ' 条。</span></div>');
    }
    out.push('</section>');
    return out.join('');
  }

  /* ---------------- render（纯字符串，不查 DOM） ---------------- */

  function render(state, ctx) {
    var mode = modeOf(state);
    var result = (ctx && ctx.result) || null;

    if (!result) {
      return wrapPage(emptyBox(
        '还没有分析结果',
        '导入一个项目后，这里会按依赖深度绘制结构关系图：模块依赖、类与继承、已解析调用三种视角。',
        '<button type="button" class="btn btn--primary" data-action="import">导入项目</button>'
      ));
    }

    var layout = computeLayout(mode, result);
    var nodes = (layout && layout.nodes) || [];

    if (!layout || !nodes.length) {
      var m = modeInfo(mode);
      var switchActions = MODES.map(function (mm) {
        return '<button type="button" class="btn btn--sm' + (mm.id === mode ? ' is-on' : '') +
          '" data-action="graph-mode" data-value="' + mm.id + '">' + mm.label + '</button>';
      }).join('');
      var reason = mode === 'calls'
        ? '当前分析结果里没有「已解析」的调用关系（目标无法解析的调用不会画在图上）。'
        : '当前分析结果里没有可绘制的' + m.unit + '关系节点。';
      return wrapPage(emptyBox('当前模式没有可绘制的节点', reason + '可以切换到其他视角看看。', switchActions));
    }

    var html = ['<div class="page view">', head()];

    html.push(notices(layout, mode));
    html.push(canvas(layout, mode, state));
    html.push(relationCard(layout, mode));
    if (mode === 'calls') html.push(unresolvedCard(layout));
    html.push('</div>');

    return html.join('');
  }

  /* ---------------- mount（唯一做测量与绑定事件的地方） ---------------- */

  function q(scope, sel) {
    try { return scope && scope.querySelector ? scope.querySelector(sel) : null; } catch (e) { return null; }
  }

  function setZoomLabel(el, k) {
    if (!el) return;
    try { el.textContent = Math.round(num(k, 1) * 100) + '%'; } catch (e) { /* 忽略 */ }
  }

  function mount(rootEl, state, ctx) {
    var layout = null;
    var cleanup = null;
    var zoomEl = null;
    var handle = {
      fit: function () { try { if (cleanup) cleanup.fit(); } catch (e) { /* 忽略 */ } },
      zoomIn: function () { try { if (cleanup) cleanup.zoomIn(); } catch (e) { /* 忽略 */ } },
      zoomOut: function () { try { if (cleanup) cleanup.zoomOut(); } catch (e) { /* 忽略 */ } }
    };
    var api = {
      destroy: function () {
        try {
          if (cleanup) {
            var t = typeof cleanup.transform === 'function' ? cleanup.transform() : null;
            if (t) cacheView(layout, t);
            cleanup();
          }
        } catch (e) { /* 忽略 */ }
        cleanup = null;
      },
      graph: handle
    };

    try {
      layout = computeLayout(modeOf(state), (ctx && ctx.result) || null);
      if (!layout || !((layout.nodes || []).length)) return api;

      var wrap = q(rootEl, '.graph-wrap') || q(rootEl, '.graph-viewport');
      if (!wrap) return api;
      var host = q(wrap, '.graph-viewport') || wrap;
      zoomEl = q(wrap, '.graph-zoom');

      var G = CL.graphSvg;
      if (!G || typeof G.mount !== 'function') return api;

      var cached = cachedView(layout);
      var graphCtx = {
        selected: str(state && state.focusNode),
        onOpen: function (node) {
          try {
            if (ctx && typeof ctx.locate === 'function' && node && node.file) ctx.locate(node.file, num(node.line, 1));
          } catch (e) { /* 忽略 */ }
        },
        onTransform: function (view) {
          cacheView(layout, view);
          setZoomLabel(zoomEl, view && view.k);
        }
      };

      cleanup = G.mount(host, layout, graphCtx) || null;
      if (!cleanup) return api;

      /* mount 末尾会自己 fit 一次：没有历史视图时保留该 fit 结果，
         有历史视图（用户刚缩放/平移过）时用 setView 还原，避免点节点就跳回全局。 */
      if (cached) {
        if (typeof cleanup.setView === 'function') {
          try { cleanup.setView(cached); } catch (e) { /* 回落到 fit 结果 */ }
        }
      }
      if (typeof cleanup.transform === 'function') {
        try { cacheView(layout, cleanup.transform()); } catch (e) { /* 忽略 */ }
      }
      if (typeof cleanup.transform === 'function') {
        try { setZoomLabel(zoomEl, cleanup.transform().k); } catch (e) { /* 忽略 */ }
      }
    } catch (e) {
      /* 附录 D：桩环境无测量能力，任何失败都不影响已渲染的 HTML */
    }

    return api;
  }

  CL.views = CL.views || {};
  CL.views.structure = { render: render, mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
