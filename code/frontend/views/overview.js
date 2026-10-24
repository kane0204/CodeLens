/* views/overview.js — 项目概览：状态条 + 4 指标卡 + 实际分析文件 / 优先复核。纯字符串渲染，不查 DOM。 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = CL.dom || {};

  function esc(v) { return D.esc ? D.esc(v) : String(v === null || v === undefined ? '' : v); }
  function fmtInt(v) { return D.fmtInt ? D.fmtInt(v) : String(v === null || v === undefined ? 0 : v); }
  function fmtNum(v, d) { return D.fmtNum ? D.fmtNum(v, d) : String(v === null || v === undefined ? 0 : v); }
  function tag(t, c) { return D.tag ? D.tag(t, c) : '<span class="tag tag--neutral">' + esc(t) + '</span>'; }
  function emptyBox(t, d, a) { return D.empty ? D.empty(t, d, a) : '<div class="empty"><p class="empty__title">' + esc(t) + '</p></div>'; }

  var STATUS = {
    complete: { text: '分析完成', tone: 'ok' },
    partial: { text: '部分完成', tone: 'warn' },
    failed: { text: '分析失败', tone: 'danger' },
    empty: { text: '没有可分析文件', tone: 'neutral' }
  };
  var LEVEL = { critical: '严重', warning: '警告', info: '提示' };
  var LEVEL_TONE = { critical: 'danger', warning: 'warn', info: 'info' };

  function statusOf(result) { return STATUS[result && result.status] || STATUS.empty; }

  function head(sub, actions) {
    return [
      '<header class="page-head view__head">',
      '<div class="view__titles">',
      '<p class="eyebrow">PROJECT OVERVIEW</p>',
      '<h1 class="view__title">项目概览</h1>',
      '<p class="page-sub view__sub">', sub, '</p>',
      '</div>',
      '<div class="page-actions view__actions">', actions || '', '</div>',
      '</header>'
    ].join('');
  }

  function page(inner, sub, actions) {
    return '<div class="page view">' + head(sub, actions) + inner + '</div>';
  }

  function countSeverity(findings) {
    var out = { critical: 0, warning: 0, info: 0 };
    (findings || []).forEach(function (f) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.severity)) out[f.severity] += 1;
    });
    return out;
  }

  function stackBar(c) {
    var total = c.critical + c.warning + c.info;
    if (!total) return '';
    return [
      '<div class="stack">',
      '<i data-sev="critical" style="width:', (c.critical / total * 100).toFixed(2), '%"></i>',
      '<i data-sev="warning" style="width:', (c.warning / total * 100).toFixed(2), '%"></i>',
      '<i data-sev="info" style="width:', (c.info / total * 100).toFixed(2), '%"></i>',
      '</div>'
    ].join('');
  }

  function metric(label, value, unit, foot, tone) {
    return [
      '<div class="metric" data-tone="', tone, '">',
      '<p class="metric__label">', esc(label), '</p>',
      '<p class="metric__value">', value, unit ? '<small>' + esc(unit) + '</small>' : '', '</p>',
      '<div class="metric__foot">', foot || '', '</div>',
      '</div>'
    ].join('');
  }

  function statusStrip(result) {
    var st = statusOf(result);
    var s = result.summary || {};
    var files = Array.isArray(result.files) ? result.files : [];
    var failed = typeof s.failed === 'number' ? s.failed : files.filter(function (f) { return f.status === 'error' || f.status === 'failed'; }).length;
    var parsed = typeof s.parsed === 'number' ? s.parsed : files.length - failed;
    var rows = [
      '<section class="card">',
      '<div class="card__body">',
      '<div class="row row--wrap">',
      tag(st.text, st.tone === 'danger' ? 'critical' : st.tone),
      '<span class="tiny muted">解析成功 ', fmtInt(parsed), ' / ', fmtInt(files.length), ' 个文件</span>',
      failed > 0 ? '<span class="tiny">' + tag(fmtInt(failed) + ' 个文件解析失败', 'critical') + '</span>' : '',
      '<span class="spacer"></span>',
      '<span class="tiny dim">引擎 ', esc(result.engine_version || '—'), ' · Python 3.11 语法</span>',
      '</div>',
      '</div>',
      '</section>'
    ];
    return rows.join('');
  }

  function metricCards(result) {
    var s = result.summary || {};
    var c = countSeverity(result.findings);
    var avg = (s.average_cc === null || s.average_cc === undefined) ? null : s.average_cc;
    var max = (s.max_cc === null || s.max_cc === undefined) ? null : s.max_cc;
    var cells = [];
    cells.push(metric('源文件', fmtInt(s.files), '个',
      '<span>有效代码行 ' + fmtInt(s.code_lines) + '</span>' +
      (s.excluded ? '<span class="dim">排除 ' + fmtInt(s.excluded) + ' 个</span>' : ''), 'brand'));
    cells.push(metric('函数与方法', fmtInt(s.functions), '个',
      '<span>类 ' + fmtInt(s.classes) + ' 个</span>' +
      '<span class="dim">来自 AST 定义</span>', 'tech'));
    cells.push(metric('待复核发现', fmtInt(s.findings), '项',
      stackBar(c) + '<span>严重 ' + fmtInt(c.critical) + ' · 警告 ' + fmtInt(c.warning) + ' · 提示 ' + fmtInt(c.info) + '</span>',
      (s.findings && s.findings > 0) ? 'danger' : 'ok'));
    cells.push(metric('平均圈复杂度', avg === null ? '—' : fmtNum(avg, 2), '',
      avg === null
        ? '<span class="dim">没有成功解析的函数</span>'
        : '<span>最高 ' + (max === null ? '—' : fmtNum(max, 0)) + '</span><span class="dim">阈值 CC &gt; 10</span>',
      'warn'));
    return '<div class="grid grid--4">' + cells.join('') + '</div>';
  }

  function filesCard(result, state) {
    var files = Array.isArray(result.files) ? result.files : [];
    var rows = files.map(function (f, i) {
      var ok = f.status === 'ok' || f.status === 'parsed';
      var active = state && state.file === f.path;
      return [
        '<tr', active ? ' class="is-selected"' : '', ' data-open-file="', String(i), '" data-file-path="', esc(f.path), '" role="button" tabindex="0">',
        '<td class="path">', esc(f.path), '</td>',
        '<td class="num">', fmtInt((f.functions || []).length), '</td>',
        '<td class="num">', fmtInt(f.code_lines), '</td>',
        '<td>', ok ? tag('已解析', 'ok') : tag('解析失败', 'critical'), '</td>',
        '</tr>'
      ].join('');
    }).join('');

    var body;
    if (!files.length) {
      body = emptyBox('本次没有实际分析文件', '所选范围内没有被保留的 .py 文件。', '<button class="btn btn--primary" data-action="import">重新导入</button>');
    } else {
      body = [
        '<div class="table-wrap">',
        '<table class="table table--compact">',
        '<thead><tr><th>路径</th><th class="num">函数</th><th class="num">代码行</th><th>状态</th></tr></thead>',
        '<tbody>', rows, '</tbody>',
        '</table>',
        '</div>'
      ].join('');
    }

    return [
      '<section class="card">',
      '<div class="card__head">',
      '<span class="card__title">实际分析文件</span>',
      '<span class="card__hint">', fmtInt(files.length), ' 个</span>',
      '<span class="spacer"></span>',
      '<button class="btn btn--sm btn--ghost" type="button" data-nav="logic">进入逻辑浏览 →</button>',
      '</div>',
      '<div class="card__body card__body--flush">', body, '</div>',
      '</section>'
    ].join('');
  }

  function findingsCard(result) {
    var findings = Array.isArray(result.findings) ? result.findings : [];
    var top = findings.slice(0, 5);
    var body;
    if (!top.length) {
      body = emptyBox('已执行规则没有发现命中', '这不表示代码中不存在其他问题，仅表示当前规则集未命中。');
    } else {
      body = '<div class="list">' + top.map(function (f) {
        return [
          '<div class="list__item" role="button" tabindex="0" data-finding="', esc(f.id), '">',
          '<div class="list__main">',
          '<span class="list__title">', esc(f.message), '</span>',
          '<span class="list__meta">', esc(f.file), ':', fmtInt(f.line), ' · ', esc(f.rule_id), '</span>',
          '</div>',
          '<div class="list__side">', tag(LEVEL[f.severity] || f.severity, LEVEL_TONE[f.severity] || 'neutral'), '</div>',
          '</div>'
        ].join('');
      }).join('') + '</div>';
    }

    return [
      '<section class="card">',
      '<div class="card__head">',
      '<span class="card__title">优先复核</span>',
      '<span class="card__hint">最多 5 项</span>',
      '<span class="spacer"></span>',
      '<button class="btn btn--sm btn--ghost" type="button" data-nav="risks">全部 ', fmtInt(findings.length), ' 项 →</button>',
      '</div>',
      '<div class="card__body card__body--flush">', body, '</div>',
      '</section>'
    ].join('');
  }

  function emptyProject(result) {
    var errors = Array.isArray(result.errors) ? result.errors : [];
    var notes = errors.slice(0, 6).map(function (e) {
      return '<p class="tiny">' + esc(e.file || '') + (e.line ? ':' + fmtInt(e.line) : '') + ' · ' + esc(e.message || '') + '</p>';
    }).join('');
    var inner = [
      '<section class="card"><div class="card__body">',
      emptyBox(
        '本次没有可分析的 Python 文件',
        '所选目录中没有未被排除的 .py 文件；已排除 .git / .venv / venv / __pycache__ / node_modules / build / dist / tests。',
        '<button class="btn btn--primary" type="button" data-action="import">重新导入项目</button>'
      ),
      notes,
      '</div></section>'
    ].join('');
    return page(inner,
      '项目 ' + esc(result.project || '—') + ' 没有产生任何可分析文件，因此不展示任何评分或通过结论。',
      '<button class="btn" type="button" data-action="reanalyze">重新分析</button>');
  }

  function welcome(ctx) {
    var connected = !!(ctx && ctx.connected);
    var engine = (ctx && ctx.engineVersion) ? String(ctx.engineVersion) : '';
    var action = connected
      ? '<button class="btn btn--primary" type="button" data-action="import">导入项目文件夹</button>'
      : '<button class="btn" type="button" data-action="reconnect">重新连接引擎</button>';
    var inner = [
      '<section class="card"><div class="card__body">',
      emptyBox(
        connected ? '分析引擎已就绪' : '分析引擎未连接',
        connected
          ? '拖入一个 Python 项目文件夹，或点击导入选择目录；本机 AST 引擎会生成可逐行追溯的结构、复杂度与规则发现。'
          : '请先在项目根目录运行 start-codelens.cmd，再打开终端提示的本机地址；双击 HTML 无法调用分析引擎。',
        action
      ),
      '<div class="hr"></div>',
      '<p class="tiny dim">没有预置项目、评分或风险记录。尚未分析的内容不会显示为“已通过”。</p>',
      connected && engine ? '<p class="tiny dim">引擎版本 ' + esc(engine) + '</p>' : '',
      '</div></section>'
    ].join('');
    return page(inner, '尚未分析任何项目。导入 Python 源码后，这里会显示本次真实解析得到的结构指标与规则命中。', '');
  }

  function render(state, ctx) {
    var result = ctx && ctx.result;
    if (!result) return welcome(ctx);

    var s = result.summary || {};
    var busy = !!(ctx && ctx.busy);
    var fileCount = Array.isArray(result.files) ? result.files.length : 0;

    if (result.status === 'empty' || (!fileCount && !(s.files > 0))) return emptyProject(result);

    var actions = [
      '<button class="btn" type="button" data-nav="export">导出报告</button>',
      '<button class="btn" type="button" data-action="reanalyze"', busy ? ' disabled' : '', '>',
      busy ? '分析中…' : '重新分析',
      '</button>'
    ].join('');

    var sub = '项目 ' + esc(result.project || '—') + '；所有数字来自本次真实解析结果，源码不执行、不外传。';
    var grid = [
      '<div class="grid grid--sidebar">',
      filesCard(result, state),
      findingsCard(result),
      '</div>'
    ].join('');

    var notes = [];
    if (result.status === 'partial') notes.push('<div class="notice notice--warn"><span class="notice__icon">!</span><div>存在解析失败的文件，结果仅覆盖成功解析的部分。</div></div>');
    if (result.status === 'failed') notes.push('<div class="notice notice--error"><span class="notice__icon">!</span><div>本次分析没有任何文件解析成功，结果不完整。</div></div>');

    return page(
      statusStrip(result) + notes.join('') + metricCards(result) + grid +
      '<p class="tiny dim">事实指语法或指标的直接命中，不等于已确认缺陷；分析不验证敏感字符串的实际有效性。</p>',
      sub, actions);
  }

  CL.views = CL.views || {};
  CL.views.overview = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
