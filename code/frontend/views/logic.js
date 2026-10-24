/* views/logic.js — 逻辑浏览：文件 / 函数与语句 / 源码 三栏。纯字符串渲染，滚动在 mount 内做且全程 try/catch。 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = CL.dom || {};

  function esc(v) { return D.esc ? D.esc(v) : String(v === null || v === undefined ? '' : v); }
  function fmtInt(v) { return D.fmtInt ? D.fmtInt(v) : String(v === null || v === undefined ? 0 : v); }
  function tag(t, c) { return D.tag ? D.tag(t, c) : '<span class="tag tag--neutral">' + esc(t) + '</span>'; }
  function emptyBox(t, d, a) { return D.empty ? D.empty(t, d, a) : '<div class="empty"><p class="empty__title">' + esc(t) + '</p></div>'; }

  var RANK_TONE = { A: 'ok', B: 'ok', C: 'neutral', D: 'warn', E: 'critical', F: 'critical' };

  function filesOf(result) { return (result && Array.isArray(result.files)) ? result.files : []; }
  function functionsOf(result, filePath) {
    var all = (result && Array.isArray(result.functions)) ? result.functions : [];
    var out = [];
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] && all[i].file === filePath) out.push(all[i]);
    }
    return out;
  }
  function findFile(result, filePath) {
    var list = filesOf(result);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].path === filePath) return { file: list[i], index: i };
    }
    return null;
  }
  function findFn(list, fnId) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].id === fnId) return list[i];
    }
    return null;
  }

  function head(state, result) {
    var files = filesOf(result);
    var file = state && state.file ? state.file : (files[0] ? files[0].path : '');
    var fns = functionsOf(result, file);
    var sub = state && state.file
      ? '当前文件 ' + esc(state.file) + '；共 ' + fmtInt(fns.length) + ' 个函数与方法。'
      : '从左侧选择文件，再从中间选择函数，右侧是可逐行追溯的源码。';
    return [
      '<header class="page-head view__head">',
      '<div class="view__titles">',
      '<p class="eyebrow">LOGIC WALKTHROUGH</p>',
      '<h1 class="view__title">逻辑浏览</h1>',
      '<p class="page-sub view__sub">', sub, '</p>',
      '</div>',
      '<div class="page-actions view__actions">',
      '<button class="btn btn--sm" type="button" data-nav="structure">查看结构视图</button>',
      '<button class="btn btn--sm" type="button" data-nav="risks">风险审查</button>',
      '</div>',
      '</header>'
    ].join('');
  }

  function filePane(result, state, activePath) {
    var files = filesOf(result);
    var rows = files.map(function (f, i) {
      var isActive = f.path === activePath;
      var fns = (f.functions || []).length;
      var failed = f.status === 'error' || f.status === 'failed';
      return [
        '<div class="tree__file', isActive ? ' is-active' : '', '" role="button" tabindex="0"',
        ' data-open-file="', String(i), '" data-file-path="', esc(f.path), '">',
        '<span class="tree__icon" aria-hidden="true">',
        failed
          ? '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2.6 1.8 13.4h12.4L8 2.6z"/><path d="M8 6.4v3M8 11.4h.01"/></svg>'
          : '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>',
        '</span>',
        '<span class="tree__name"><bdi>', esc(f.path), '</bdi></span>',
        failed
          ? '<span class="tree__count" title="解析失败">!</span>'
          : '<span class="tree__count">', String(fns), '</span>',
        '</div>'
      ].join('');
    }).join('');

    return [
      '<section class="pane">',
      '<div class="pane__head">',
      '<span class="pane__title">文件</span>',
      '<span class="pane__count">', fmtInt(files.length), '</span>',
      '</div>',
      '<div class="pane__body">',
      files.length ? '<div class="tree">' + rows + '</div>'
        : '<div class="code-blank">本次没有实际分析文件</div>',
      '</div>',
      '</section>'
    ].join('');
  }

  function fnPane(result, state, file) {
    var fns = functionsOf(result, file ? file.path : '');
    var current = findFn(fns, state.fn) || fns[0] || null;
    var picker = '';
    if (fns.length) {
      picker = [
        '<select class="select" id="function-picker" data-filter="fn" aria-label="选择函数">',
        fns.map(function (fn) {
          return '<option value="' + esc(fn.id) + '"' + (current && current.id === fn.id ? ' selected' : '') + '>' +
            esc(fn.name) + ' · 第 ' + fmtInt(fn.line) + ' 行</option>';
        }).join(''),
        '</select>'
      ].join('');
    }

    var body;
    if (!file) {
      body = emptyBox('还没有选择文件', '从左侧列表选择一个 Python 文件开始浏览。');
    } else if (file.status === 'error' || file.status === 'failed') {
      var err = file.error || {};
      body = emptyBox('这个文件解析失败',
        (err.message ? err.message : '引擎未能解析该文件') + (err.line ? '（第 ' + fmtInt(err.line) + ' 行）' : '') +
        '；右侧仍显示原始源码。');
    } else if (!fns.length) {
      body = emptyBox('这个文件没有函数或方法', '模块级语句仍可在右侧源码中查看；当前只展示函数级的语句步骤。');
    } else {
      var steps = (current && Array.isArray(current.statements)) ? current.statements : [];
      var step = Number(state.step) || 0;
      if (step >= steps.length) step = 0;
      var metrics = [
        '<div class="row row--wrap">',
        '<span class="tiny muted">圈复杂度</span>',
        '<span class="mono-tag">', fmtInt(current.cc), '</span>',
        tag('等级 ' + String(current.rank || '—'), RANK_TONE[current.rank] === 'critical' ? 'critical' : (RANK_TONE[current.rank] || 'neutral')),
        '<span class="tiny muted">行数 ', fmtInt(current.length), '</span>',
        '<span class="tiny muted">嵌套 ', fmtInt(current.nesting), '</span>',
        '</div>'
      ].join('');

      var stepHtml = steps.length ? steps.map(function (st, i) {
        var on = i === step;
        return [
          '<div class="list__item', on ? ' is-active' : '', '" role="button" tabindex="0" data-step="', String(i), '">',
          '<span class="list__side mono-tag">', String(i + 1), '</span>',
          '<div class="list__main">',
          '<span class="list__title">', esc(st.description || st.ast_type || '语句'), '</span>',
          '<span class="list__meta">L', fmtInt(st.line), '–', fmtInt(st.end_line || st.line), ' · ', esc(st.ast_type || '—'), '</span>',
          '</div>',
          '</div>'
        ].join('');
      }).join('') : '<div class="code-blank">该函数没有记录到语句级步骤</div>';

      body = [
        '<div class="pane__body--pad">',
        picker,
        '<div class="hr"></div>',
        metrics,
        '</div>',
        '<div class="hr"></div>',
        '<div class="list">', stepHtml, '</div>'
      ].join('');
    }

    return [
      '<section class="pane">',
      '<div class="pane__head">',
      '<span class="pane__title">函数与语句</span>',
      '<span class="pane__count">', fmtInt(fns.length), '</span>',
      '</div>',
      '<div class="pane__body">', body, '</div>',
      '</section>'
    ].join('');
  }

  function markRanges(fn) {
    var out = [];
    if (!fn || !Array.isArray(fn.statements)) return out;
    for (var i = 0; i < fn.statements.length; i += 1) {
      var st = fn.statements[i];
      var from = Number(st.line) || 0;
      var to = Number(st.end_line) || from;
      if (from > 0) out.push([from, to]);
    }
    return out;
  }

  function inRanges(ranges, line) {
    for (var i = 0; i < ranges.length; i += 1) {
      if (line >= ranges[i][0] && line <= ranges[i][1]) return true;
    }
    return false;
  }

  function sourcePane(result, state, file) {
    var fns = functionsOf(result, file ? file.path : '');
    var current = findFn(fns, state.fn) || null;
    var source = file && typeof file.source === 'string' ? file.source : '';
    var focus = state && state.line ? Number(state.line) : 0;

    var body;
    if (!file) {
      body = '<div class="code-blank">没有可显示的源码</div>';
    } else if (!source) {
      body = '<div class="code-blank">这个文件没有保留源码文本（可能已超出单文件大小限制），无法逐行定位。</div>';
    } else {
      var lines = source.split(/\r?\n/);
      var ranges = markRanges(current);
      var html = [];
      for (var i = 0; i < lines.length; i += 1) {
        var n = i + 1;
        var cls = 'code__line';
        if (focus && n === focus) cls += ' is-focus';
        else if (ranges.length && inRanges(ranges, n)) cls += ' is-mark';
        html.push(
          '<div class="' + cls + '" id="source-line-' + n + '">' +
          '<span class="ln">' + n + '</span>' +
          '<span class="src">' + esc(lines[i]) + '</span>' +
          '</div>'
        );
      }
      body = '<div class="code">' + html.join('') + '</div>';
    }

    var title = file ? file.path : '未选择文件';
    var meta = [];
    if (file) {
      meta.push(fmtInt(file.line_count) + ' 行');
      meta.push('代码行 ' + fmtInt(file.code_lines));
      meta.push(file.status === 'error' || file.status === 'failed' ? '解析失败' : '已解析');
    }

    return [
      '<section class="pane">',
      '<div class="pane__head">',
      '<span class="pane__title ellipsis">', esc(title), '</span>',
      '<span class="pane__count">', esc(meta.join(' · ')), '</span>',
      '</div>',
      '<div class="pane__body">', body, '</div>',
      '</section>'
    ].join('');
  }

  function render(state, ctx) {
    var result = ctx && ctx.result;
    if (!result) {
      return [
        '<div class="page view">',
        head(state, null),
        '<section class="card"><div class="card__body">',
        emptyBox('还没有分析结果', '导入一个 Python 项目后再进入逻辑浏览。',
          '<button class="btn btn--primary" type="button" data-action="import">导入项目文件夹</button>'),
        '</div></section>',
        '</div>'
      ].join('');
    }

    var files = filesOf(result);
    if (!files.length) {
      return [
        '<div class="page view">',
        head(state, result),
        '<section class="card"><div class="card__body">',
        emptyBox('本次没有可分析文件', '所选目录里没有被保留的 .py 文件，因此没有源码可以浏览。',
          '<button class="btn btn--primary" type="button" data-action="import">重新导入</button>'),
        '</div></section>',
        '</div>'
      ].join('');
    }

    var picked = state && state.file ? findFile(result, state.file) : null;
    if (!picked) picked = { file: files[0], index: 0 };
    var activePath = picked.file.path;
    var activeState = state || {};
    if (!activeState.file) activeState = { file: activePath, fn: '', step: 0, line: null };

    var cols = [
      filePane(result, activeState, activePath),
      fnPane(result, activeState, picked.file),
      sourcePane(result, activeState, picked.file)
    ].join('');

    return [
      '<div class="page view">',
      head(activeState, result),
      '<div class="logic">', cols, '</div>',
      '<p class="tiny dim">源码只读展示，不执行；行号与引擎返回的 AST 行号一一对应。',
      activeState.line ? '当前定位第 ' + fmtInt(activeState.line) + ' 行。' : '</p>',
      '</div>'
    ].join('');
  }

  function mount(rootEl, state, ctx) {
    var api = { destroy: function () {} };
    try {
      if (!state || !state.line) return api;
      var node = rootEl && rootEl.querySelector ? rootEl.querySelector('#source-line-' + Number(state.line)) : null;
      if (!node) return api;
      if (typeof node.scrollIntoView === 'function') {
        try { node.scrollIntoView({ block: 'nearest' }); } catch (e) { try { node.scrollIntoView(); } catch (e2) { /* 忽略 */ } }
      }
    } catch (e) { /* 测量失败不影响渲染结果 */ }
    return api;
  }

  CL.views = CL.views || {};
  CL.views.logic = { render: render, mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
