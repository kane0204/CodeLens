/* views/risks.js — 风险审查：筛选工具栏 + 固定表头表格 + 级别色条 + 详情弹窗。
   render 为纯字符串；mount 只负责用捕获阶段接管「详情」按钮与本地筛选，不查子节点。 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = CL.dom || {};

  function esc(v) { return D.esc ? D.esc(v) : String(v === null || v === undefined ? '' : v); }
  function fmtInt(v) { return D.fmtInt ? D.fmtInt(v) : String(Number(v) || 0); }
  function tag(t, c) { return D.tag ? D.tag(t, c) : '<span class="tag tag--neutral">' + esc(t) + '</span>'; }
  function emptyBox(t, d, a) { return D.empty ? D.empty(t, d, a) : '<div class="empty"><p class="empty__title">' + esc(t) + '</p></div>'; }
  function basename(p) { return D.basename ? D.basename(p) : String(p || '').split('/').pop(); }

  var LEVEL = { critical: '严重', warning: '警告', info: '提示' };
  var TONE = { critical: 'danger', warning: 'warn', info: 'info' };
  var EVIDENCE = { fact: '事实', inference: '推断' };
  var SEV_ORDER = { critical: 0, warning: 1, info: 2 };

  /* 本地文件筛选（不改 state，避免污染其它视图） */
  var fileFilter = '';

  function head(sub, actions) {
    return [
      '<header class="page-head view__head">',
      '<div class="view__titles">',
      '<p class="eyebrow">RISK REVIEW</p>',
      '<h1 class="view__title">风险审查</h1>',
      '<p class="page-sub view__sub">', sub, '</p>',
      '</div>',
      '<div class="page-actions view__actions">', actions || '', '</div>',
      '</header>'
    ].join('');
  }

  function page(inner, sub, actions) {
    return '<div class="page view">' + head(sub, actions) + inner + '</div>';
  }

  function arr(v) { return Array.isArray(v) ? v : []; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function severityOf(f) {
    var s = String(f && f.severity ? f.severity : 'info');
    return Object.prototype.hasOwnProperty.call(LEVEL, s) ? s : 'info';
  }

  function countBy(findings) {
    var out = { all: findings.length, critical: 0, warning: 0, info: 0, fact: 0, inference: 0 };
    findings.forEach(function (f) {
      out[severityOf(f)] += 1;
      if (f && f.evidence_type === 'inference') out.inference += 1; else out.fact += 1;
    });
    return out;
  }

  function matchesQuery(f, q) {
    if (!q) return true;
    var needle = String(q).toLowerCase();
    var hay = [f.message, f.rule_id, f.file, f.suggestion, String(f.line)].join(' ').toLowerCase();
    return hay.indexOf(needle) >= 0;
  }

  function selectOptions(list, current, allLabel) {
    var out = ['<option value="">' + esc(allLabel) + '</option>'];
    list.forEach(function (item) {
      out.push('<option value="' + esc(item.value) + '"' + (item.value === current ? ' selected' : '') + '>' +
        esc(item.label) + '</option>');
    });
    return out.join('');
  }

  function toolbar(result, state, counts, fileOptions, shown) {
    var sev = state && state.severity ? state.severity : 'all';
    var ev = state && state.evidence ? state.evidence : 'all';
    var pills = ['all', 'critical', 'warning', 'info'].map(function (key) {
      var on = (key === 'all' && (sev === 'all' || !sev)) || key === sev;
      var label = key === 'all' ? '全部' : LEVEL[key];
      return [
        '<button class="risk-pill', on ? ' is-on' : '', '" type="button"',
        key !== 'all' ? ' data-sev="' + key + '"' : '',
        ' data-risk-sev="', key, '" aria-pressed="', on ? 'true' : 'false', '">',
        esc(label), ' <b>', fmtInt(counts[key]), '</b>',
        '</button>'
      ].join('');
    }).join('');

    var evidenceOptions = [
      { value: 'fact', label: '事实（语法/指标直接命中）' },
      { value: 'inference', label: '推断（跨文件或语义推测）' }
    ];

    return [
      '<section class="card">',
      '<div class="card__body">',
      '<div class="row row--wrap" style="gap:10px">',
      '<div class="risk-summary">', pills, '</div>',
      '<span class="spacer"></span>',
      '<label class="field" style="min-width:200px">',
      '<span class="field__label">检索</span>',
      '<input class="input" type="search" placeholder="问题、规则、路径…" data-filter="query" value="', esc(state && state.query ? state.query : ''), '">',
      '</label>',
      '<label class="field" style="min-width:190px">',
      '<span class="field__label">证据类型</span>',
      '<select class="select" data-filter="evidence">',
      selectOptions(evidenceOptions, ev === 'all' ? '' : ev, '全部证据'),
      '</select>',
      '</label>',
      '<label class="field" style="min-width:190px">',
      '<span class="field__label">文件</span>',
      '<select class="select" data-risk-filter="file">',
      selectOptions(fileOptions, fileFilter, '全部文件'),
      '</select>',
      '</label>',
      '</div>',
      '<div class="row row--wrap" style="margin-top:10px">',
      '<span class="tiny dim">匹配 ', fmtInt(shown), ' / 共 ', fmtInt(counts.all), ' 项</span>',
      '<span class="tiny dim">严重 ', fmtInt(counts.critical), ' · 警告 ', fmtInt(counts.warning), ' · 提示 ', fmtInt(counts.info), '</span>',
      '<span class="spacer"></span>',
      '<button class="btn btn--sm btn--ghost" type="button" data-action="reset-filters">重置筛选</button>',
      '</div>',
      '</div>',
      '</section>'
    ].join('');
  }

  function confidenceCell(f) {
    var c = num(f.confidence);
    var pct = Math.max(0, Math.min(100, Math.round(c <= 1 ? c * 100 : c)));
    return [
      '<div class="row" style="gap:8px">',
      '<span class="mono-tag">', fmtInt(pct), '%</span>',
      '<span style="flex:1;min-width:38px;height:4px;border-radius:2px;background:#eef2f7;overflow:hidden">',
      '<span style="display:block;height:100%;width:', String(pct), '%;background:var(--brand)"></span>',
      '</span>',
      '</div>'
    ].join('');
  }

  function row(f, active) {
    var sev = severityOf(f);
    return [
      '<tr', active ? ' class="is-selected"' : '', ' data-finding="', esc(f.id), '" role="button" tabindex="0">',
      '<td><span class="sevbar sevbar--', TONE[sev], '" aria-hidden="true"></span>', tag(LEVEL[sev], TONE[sev]), '</td>',
      '<td>',
      '<div style="display:grid;gap:2px;min-width:0">',
      '<span style="font-weight:500">', esc(f.message || '（无描述）'), '</span>',
      '<span class="tiny dim" style="font-family:var(--mono)">', esc(f.file || ''), ':', fmtInt(f.line), '</span>',
      '</div>',
      '</td>',
      '<td><span class="finding__rule">', esc(f.rule_id || '—'), '</span></td>',
      '<td>', tag(EVIDENCE[f.evidence_type] || '事实', f.evidence_type === 'inference' ? 'tech' : 'neutral'), '</td>',
      '<td>', confidenceCell(f), '</td>',
      '<td style="text-align:right;white-space:nowrap">',
      '<button class="btn btn--sm" type="button" data-risk-detail="', esc(f.id), '">详情</button>',
      '</td>',
      '</tr>'
    ].join('');
  }

  function table(findings, state) {
    var rows = findings.map(function (f) {
      return row(f, state && state.selectedFinding === f.id);
    }).join('');
    return [
      '<section class="card">',
      '<div class="card__body card__body--flush">',
      '<div class="table-wrap" style="max-height:calc(100vh - 372px);min-height:240px">',
      '<table class="table">',
      '<thead><tr>',
      '<th style="width:104px">级别</th>',
      '<th>问题与位置</th>',
      '<th style="width:150px">规则</th>',
      '<th style="width:96px">证据</th>',
      '<th style="width:132px">置信度</th>',
      '<th style="width:88px"></th>',
      '</tr></thead>',
      '<tbody>', rows, '</tbody>',
      '</table>',
      '</div>',
      '</div>',
      '</section>'
    ].join('');
  }

  /* ---------------- 详情弹窗 ---------------- */
  function detailHtml(f, counts) {
    if (!f) return '';
    var sev = severityOf(f);
    var actual = (f.actual === null || f.actual === undefined) ? '—' : String(f.actual);
    var threshold = (f.threshold === null || f.threshold === undefined) ? '—' : String(f.threshold);
    var conf = num(f.confidence);
    var pct = Math.max(0, Math.min(100, Math.round(conf <= 1 ? conf * 100 : conf)));
    var evidence = f.evidence_type === 'inference' ? '推断' : '事实';

    return [
      '<div class="dlg-head">',
      '<div>',
      '<p class="dlg-title">', esc(f.message || '发现项'), '</p>',
      '<p class="dlg-sub">', esc(f.file || ''), ':', fmtInt(f.line), '</p>',
      '</div>',
      '<button class="dlg-close" type="button" data-action="close-dialog" aria-label="关闭">',
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
      '</button>',
      '</div>',
      '<div class="dlg-main">',
      '<div class="row row--wrap" style="margin-bottom:10px">',
      '<span class="sevbar sevbar--', TONE[sev], '" aria-hidden="true"></span>',
      tag(LEVEL[sev], TONE[sev]),
      tag(EVIDENCE[f.evidence_type] || '事实', f.evidence_type === 'inference' ? 'tech' : 'neutral'),
      f.rule_id ? '<span class="finding__rule">' + esc(f.rule_id) + '</span>' : '',
      '</div>',
      '<dl class="kv">',
      '<dt>规则</dt><dd>', esc(f.rule_id || '—'), '</dd>',
      '<dt>级别</dt><dd>', esc(LEVEL[sev]), '</dd>',
      '<dt>证据</dt><dd>', esc(evidence), '（', esc(EVIDENCE[f.evidence_type] || '事实'), '）</dd>',
      '<dt>位置</dt><dd>', esc(f.file || ''), ':', fmtInt(f.line), '</dd>',
      '<dt>实际值</dt><dd>', esc(actual), '</dd>',
      '<dt>阈值</dt><dd>', esc(threshold), '</dd>',
      '<dt>置信度</dt><dd>', fmtInt(pct), '%</dd>',
      '<dt>命中依据</dt><dd>',
      f.evidence_type === 'inference'
        ? '基于跨文件引用或命名推断，需要人工确认调用关系。'
        : '由 AST 语法结构与度量直接得到，未做语义推断。',
      '</dd>',
      '<dt>复核建议</dt><dd>', esc(f.suggestion || '建议结合上下文人工复核该处实现。'), '</dd>',
      '</dl>',
      '<div class="notice notice--info" style="margin-top:12px">',
      '<span class="notice__icon" aria-hidden="true">i</span>',
      '<div>这是规则命中的静态事实，不等于已确认缺陷；同一次分析共 ', fmtInt(counts.all), ' 项发现。</div>',
      '</div>',
      '</div>',
      '<div class="dlg-foot">',
      '<span class="tiny dim">Esc 关闭</span>',
      '<span class="spacer"></span>',
      '<button class="btn" type="button" data-action="close-dialog">关闭</button>',
      '<button class="btn btn--primary" type="button" data-location="', esc(f.file || ''), '" data-line="', fmtInt(f.line), '">定位原始源码</button>',
      '</div>'
    ].join('');
  }

  function findById(result, id) {
    var list = arr(result && result.findings);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  /* ---------------- 渲染 ---------------- */
  function render(state, ctx) {
    var result = (ctx && ctx.result) || (state && state.result) || null;
    if (!result) {
      return page(
        emptyBox('还没有分析结果', '先导入一个 Python 项目并完成分析，这里才会列出真实规则命中。',
          '<button class="btn btn--primary" type="button" data-action="import">导入项目</button>'),
        '导入并分析项目后，这里按严重度汇总引擎真实命中的规则项。'
      );
    }

    var all = arr(result.findings);
    var counts = countBy(all);
    var sev = state && state.severity ? String(state.severity) : 'all';
    var ev = state && state.evidence ? String(state.evidence) : 'all';
    var q = state && state.query ? String(state.query) : '';

    var filtered = all.filter(function (f) {
      if (!f) return false;
      if (sev && sev !== 'all' && severityOf(f) !== sev) return false;
      if (ev && ev !== 'all') {
        var type = f.evidence_type === 'inference' ? 'inference' : 'fact';
        if (type !== ev) return false;
      }
      if (fileFilter && String(f.file || '') !== fileFilter) return false;
      return matchesQuery(f, q);
    }).sort(function (a, b) {
      var d = SEV_ORDER[severityOf(a)] - SEV_ORDER[severityOf(b)];
      if (d !== 0) return d;
      return num(b.confidence) - num(a.confidence);
    });

    var files = arr(result.files).map(function (f) { return String(f && f.path ? f.path : ''); })
      .filter(function (p) { return p; });
    var fileOptions = files.map(function (p) { return { value: p, label: p }; });

    var actions = [
      '<button class="btn" type="button" data-nav="overview">返回概览</button>',
      '<button class="btn" type="button" data-action="reanalyze"', (ctx && ctx.busy) ? ' disabled' : '', '>',
      (ctx && ctx.busy) ? '分析中…' : '重新分析',
      '</button>'
    ].join('');

    var body;
    if (!all.length) {
      body = [
        '<section class="card"><div class="card__body">',
        emptyBox('本次规则集没有命中任何问题',
          '这只表示当前规则集没有命中，不表示代码不存在问题；可在概览页查看已解析范围。',
          '<button class="btn" type="button" data-nav="overview">查看概览</button>'),
        '</div></section>'
      ].join('');
    } else if (!filtered.length) {
      body = [
        '<section class="card"><div class="card__body">',
        emptyBox('当前筛选条件下没有匹配项', '共 ' + fmtInt(all.length) + ' 项发现，请放宽筛选条件。',
          '<button class="btn" type="button" data-action="reset-filters">重置筛选</button>'),
        '</div></section>'
      ].join('');
    } else {
      body = table(filtered, state);
    }

    var summary = [
      '<section class="card"><div class="card__body">',
      '<div class="row row--wrap">',
      '<span class="tiny muted">本次分析共 ', fmtInt(counts.all), ' 项发现：',
      '严重 ', fmtInt(counts.critical), ' · 警告 ', fmtInt(counts.warning), ' · 提示 ', fmtInt(counts.info), '</span>',
      '<span class="spacer"></span>',
      '<span class="tiny dim">事实 ', fmtInt(counts.fact), ' 项 · 推断 ', fmtInt(counts.inference), ' 项</span>',
      '</div>',
      '</div></section>'
    ].join('');

    var inner = [
      summary,
      toolbar(result, state, counts, fileOptions, filtered.length),
      body,
      '<p class="tiny dim">事实指语法或指标的直接命中，不等于已确认缺陷；推断项需要人工确认。点击行定位源码，点「详情」查看规则依据与复核建议。</p>'
    ].join('');

    return page(inner, '项目 ' + esc(result.project || '—') + ' 的规则命中，全部来自本次真实分析结果。', actions);
  }

  /* ---------------- mount：捕获阶段接管详情与本地筛选 ---------------- */
  function closestAttr(node, name) {
    var current = node;
    var depth = 0;
    while (current && depth < 40) {
      if (current.getAttribute) {
        var value = current.getAttribute(name);
        if (value !== null && value !== undefined && value !== '') return value;
      }
      current = current.parentNode;
      depth += 1;
    }
    return null;
  }

  function mount(rootEl, state, ctx) {
    if (!rootEl || typeof rootEl.addEventListener !== 'function') return null;
    var host = rootEl;
    var local = { state: state, ctx: ctx };
    var off = false;

    function onClick(event) {
      if (off) return;
      var target = event && event.target ? event.target : null;
      if (!target) return;
      var detailId = closestAttr(target, 'data-risk-detail');
      if (detailId) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        if (event.stopImmediatePropagation) { try { event.stopImmediatePropagation(); } catch (e) { /* 忽略 */ } }
        var result = local.ctx && local.ctx.result ? local.ctx.result : null;
        var finding = findById(result, detailId);
        if (finding && local.ctx && typeof local.ctx.openDetail === 'function') {
          var findings = arr(result && result.findings);
          try { local.ctx.openDetail(detailHtml(finding, { all: findings.length })); } catch (e) { /* 忽略 */ }
        }
        return;
      }

      var sevKey = closestAttr(target, 'data-risk-sev');
      if (sevKey && local.ctx) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        var next = sevKey === 'all' ? 'all' : sevKey;
        try {
          if (typeof local.ctx.setState === 'function') local.ctx.setState({ severity: next });
        } catch (e) { /* 忽略 */ }
        if (typeof local.ctx.rerender === 'function') { try { local.ctx.rerender(); } catch (e) { /* 忽略 */ } }
      }
    }

    function onChange(event) {
      if (off) return;
      var target = event && event.target ? event.target : null;
      if (!target) return;
      var value = null;
      if (target.getAttribute) value = target.getAttribute('data-risk-filter');
      if (value !== 'file') return;
      if (event.stopPropagation) event.stopPropagation();
      fileFilter = target.value === null || target.value === undefined ? '' : String(target.value);
      if (local.ctx && typeof local.ctx.rerender === 'function') {
        try { local.ctx.rerender(); } catch (e) { /* 忽略 */ }
      }
    }

    /* reset-filters 需要在 app.js 渲染前清掉本地文件筛选，因此用捕获阶段 */
    function onReset(event) {
      if (off) return;
      var target = event && event.target ? event.target : null;
      if (!target) return;
      if (closestAttr(target, 'data-action') !== 'reset-filters') return;
      fileFilter = '';
    }

    try {
      host.addEventListener('click', onClick, true);
      host.addEventListener('change', onChange, true);
      host.addEventListener('click', onReset, true);
    } catch (e) { /* 桩环境忽略 */ }

    return function destroy() {
      off = true;
      try {
        host.removeEventListener('click', onClick, true);
        host.removeEventListener('change', onChange, true);
        host.removeEventListener('click', onReset, true);
      } catch (e) { /* 忽略 */ }
    };
  }

  CL.views = CL.views || {};
  CL.views.risks = { render: render, mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
