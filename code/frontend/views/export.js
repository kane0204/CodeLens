/* views/export.js — 导出：Markdown / JSON / Mermaid 三种格式卡片 + 报告预览。
   纯字符串渲染，不查 DOM；同时向 app.js 提供 buildDraft(result)（
   { json, markdown, mermaid, ... }），下载统一走 app.js 的 download(kind)。 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};
  var D = CL.dom || {};

  function esc(v) { return D.esc ? D.esc(v) : String(v === null || v === undefined ? '' : v); }
  function fmtInt(v) { return D.fmtInt ? D.fmtInt(v) : String(Number(v) || 0); }
  function fmtNum(v, d) { return D.fmtNum ? D.fmtNum(v, d) : String(v === null || v === undefined ? 0 : v); }
  function tag(t, c) { return D.tag ? D.tag(t, c) : '<span class="tag tag--neutral">' + esc(t) + '</span>'; }
  function emptyBox(t, d, a) { return D.empty ? D.empty(t, d, a) : '<div class="empty"><p class="empty__title">' + esc(t) + '</p></div>'; }

  var LEVEL = { critical: '严重', warning: '警告', info: '提示' };
  var STATUS_TEXT = { complete: '分析完成', partial: '部分完成', failed: '分析失败', empty: '结果为空' };
  var PREVIEW_LIMIT = 20000;

  function arr(v) { return Array.isArray(v) ? v : []; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---------------- 页面骨架 ---------------- */
  function head(sub, actions) {
    return [
      '<header class="page-head view__head">',
      '<div class="view__titles">',
      '<p class="eyebrow">EXPORT</p>',
      '<h1 class="view__title">导出报告</h1>',
      '<p class="page-sub view__sub">', sub, '</p>',
      '</div>',
      '<div class="page-actions view__actions">', actions || '', '</div>',
      '</header>'
    ].join('');
  }

  function page(inner, sub, actions) {
    return '<div class="page view">' + head(sub, actions) + inner + '</div>';
  }

  /* ---------------- 文本工具 ---------------- */
  function mdCell(value) {
    var s = String(value === null || value === undefined ? '' : value);
    s = s.replace(/\r?\n/g, ' ');
    return s.replace(/\|/g, '\\|').replace(/^\s+|\s+$/g, '');
  }

  function mdTable(headers, rows) {
    if (!rows.length) return '';
    var out = [];
    out.push('| ' + headers.join(' | ') + ' |');
    out.push('| ' + headers.map(function () { return '---'; }).join(' | ') + ' |');
    rows.forEach(function (cells) {
      out.push('| ' + cells.map(mdCell).join(' | ') + ' |');
    });
    return out.join('\n');
  }

  function isOk(file) { return file && (file.status === 'ok' || file.status === 'parsed'); }

  /* ---------------- JSON 导出：深拷贝后剔除源码 ---------------- */
  function stripSource(data) {
    var copy = null;
    try { copy = JSON.parse(JSON.stringify(data)); } catch (e) { copy = null; }
    if (!copy || typeof copy !== 'object' || Array.isArray(copy)) {
      copy = {};
      for (var key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) copy[key] = data[key];
      }
      copy.files = arr(data.files).map(function (file) {
        var item = {};
        for (var field in file) {
          if (Object.prototype.hasOwnProperty.call(file, field) && field !== 'source') item[field] = file[field];
        }
        return item;
      });
    }
    if (Array.isArray(copy.files)) {
      copy.files.forEach(function (file) {
        if (file && Object.prototype.hasOwnProperty.call(file, 'source')) delete file.source;
      });
    }
    return copy;
  }

  function jsonText(data) {
    try { return JSON.stringify(stripSource(data), null, 2); } catch (e) { return ''; }
  }

  /* ---------------- Markdown 报告 ---------------- */
  function markdownReport(data) {
    var s = data.summary || {};
    var files = arr(data.files);
    var functions = arr(data.functions);
    var classes = arr(data.classes);
    var findings = arr(data.findings);
    var graph = data.graph || {};
    var deps = arr(graph.dependencies);
    var calls = arr(graph.calls);
    var cycles = arr(graph.cycles);
    var out = [];

    out.push('# CodeLens 分析报告');
    out.push('');
    out.push('- 项目：' + (data.project || '未命名'));
    out.push('- 状态：' + (STATUS_TEXT[data.status] || String(data.status || '未知')));
    out.push('- 引擎版本：' + (data.engine_version || '—') + '（schema ' + (data.schema_version === undefined ? '—' : data.schema_version) + '）');
    out.push('- 生成时间：' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC');
    out.push('');

    out.push('## 概览');
    out.push('');
    out.push(mdTable(['指标', '数值'], [
      ['源文件', fmtInt(s.files)],
      ['解析成功', fmtInt(s.parsed)],
      ['解析失败', fmtInt(s.failed)],
      ['被排除', fmtInt(s.excluded)],
      ['函数与方法', fmtInt(s.functions)],
      ['类', fmtInt(s.classes)],
      ['有效代码行', fmtInt(s.code_lines)],
      ['待复核发现', fmtInt(s.findings)],
      ['平均圈复杂度', (s.average_cc === null || s.average_cc === undefined) ? '—' : fmtNum(s.average_cc, 2)],
      ['最高圈复杂度', (s.max_cc === null || s.max_cc === undefined) ? '—' : fmtNum(s.max_cc, 0)]
    ]));
    out.push('');

    out.push('## 实际分析范围');
    out.push('');
    out.push('只统计本次真正送入引擎并被解析的文件；被排除的目录与超限文件不计入任何指标。');
    out.push('');
    out.push(mdTable(['文件', '模块', '状态', '总行数', '代码行', '函数', '类'], files.map(function (f) {
      return [
        f.path || '',
        f.module || '',
        isOk(f) ? '已解析' : ('失败' + (f.error ? '：' + f.error : '')),
        fmtInt(f.line_count),
        fmtInt(f.code_lines),
        fmtInt(arr(f.functions).length),
        fmtInt(arr(f.classes).length)
      ];
    })) || '（没有任何文件）');
    out.push('');

    out.push('## 函数与复杂度');
    out.push('');
    out.push(mdTable(['函数', '位置', '类型', '圈复杂度', '等级', '嵌套', '长度'], functions.map(function (f) {
      return [
        (f.id || f.name || ''),
        (f.file || '') + ':' + fmtInt(f.line),
        f.kind || 'function',
        fmtInt(f.cc),
        f.rank || '—',
        fmtInt(f.nesting),
        fmtInt(f.length)
      ];
    })) || '（没有解析到函数）');
    out.push('');

    out.push('## 类');
    out.push('');
    if (!classes.length) {
      out.push('（没有解析到类）');
    } else {
      classes.forEach(function (c) {
        out.push('- **' + (c.name || c.id || '') + '**（' + (c.file || '') + ':' + fmtInt(c.line) + '，' + (c.kind || 'class') + '）');
        if (arr(c.methods).length) out.push('  - 方法：' + c.methods.join('、'));
        if (arr(c.bases).length) out.push('  - 基类：' + c.bases.join('、'));
      });
    }
    out.push('');

    out.push('## 待复核发现');
    out.push('');
    if (!findings.length) {
      out.push('（本次没有产生任何发现项）');
    } else {
      findings.forEach(function (f) {
        out.push('- **[' + (LEVEL[f.severity] || f.severity || '提示') + '] ' + (f.rule_id || '') + '** ' + (f.message || ''));
        out.push('  - 位置：' + (f.file || '') + ':' + fmtInt(f.line));
        if (f.actual !== undefined && f.actual !== null) out.push('  - 实际值：' + f.actual);
        if (f.threshold !== undefined && f.threshold !== null) out.push('  - 阈值：' + f.threshold);
        out.push('  - 证据类型：' + (f.evidence_type === 'inference' ? '推断' : '事实') + '，置信度 ' + fmtInt(Math.round(num(f.confidence) * 100)) + '%');
        if (f.suggestion) out.push('  - 复核建议：' + f.suggestion);
      });
    }
    out.push('');

    out.push('## 结构图数据');
    out.push('');
    out.push('- 模块依赖：' + fmtInt(deps.length) + ' 条');
    out.push('- 调用关系：' + fmtInt(calls.length) + ' 条（已解析 ' + fmtInt(calls.filter(function (c) { return c && c.status === 'resolved'; }).length) + ' 条）');
    out.push('- 循环依赖：' + fmtInt(cycles.length) + ' 组' + (cycles.length ? '（' + cycles.map(function (c) { return arr(c).join(' → '); }).join('；') + '）' : ''));
    out.push('');

    out.push('## 限制与错误');
    out.push('');
    var limits = arr(data.limitations);
    var errors = arr(data.errors);
    var warnings = arr(data.warnings);
    if (!limits.length && !errors.length && !warnings.length) {
      out.push('（引擎未报告任何限制或错误）');
    } else {
      limits.forEach(function (l) { out.push('- 限制：' + l); });
      warnings.forEach(function (w) { out.push('- 警告：' + (typeof w === 'string' ? w : JSON.stringify(w))); });
      errors.forEach(function (e) { out.push('- 错误：' + (typeof e === 'string' ? e : JSON.stringify(e))); });
    }
    out.push('');
    out.push('> 本报告只包含静态分析事实与推断，事实不等于已确认缺陷；全部数字来自本次真实分析结果，不包含源码原文。');
    out.push('');
    return out.join('\n');
  }

  /* ---------------- Mermaid 图数据 ---------------- */
  function labelOf(name) {
    return String(name === null || name === undefined ? '' : name).replace(/"/g, '#quot;').replace(/\r?\n/g, ' ');
  }

  function mermaidGraph(data) {
    var graph = data.graph || {};
    var deps = arr(graph.dependencies);
    var cycles = arr(graph.cycles);
    var lines = ['flowchart TD'];
    var ids = {};
    var order = [];

    function idOf(name) {
      var key = String(name === null || name === undefined ? '' : name);
      if (Object.prototype.hasOwnProperty.call(ids, key)) return ids[key];
      var id = 'M' + order.length;
      ids[key] = id;
      order.push(key);
      return id;
    }

    var edges = [];
    deps.forEach(function (d) {
      if (!d || !d.source || !d.target) return;
      if (String(d.source) === String(d.target)) return;
      edges.push([idOf(d.source), idOf(d.target)]);
    });

    if (!order.length) {
      lines.push('  P0["' + labelOf(data.project || '未命名项目') + '"]');
      lines.push('  %% 本次分析没有检测到模块之间的依赖关系');
    } else {
      order.forEach(function (name) {
        lines.push('  ' + ids[name] + '["' + labelOf(name) + '"]');
      });
      edges.forEach(function (pair) {
        lines.push('  ' + pair[0] + ' --> ' + pair[1]);
      });
    }

    var cycleMembers = {};
    var hasCycle = false;
    cycles.forEach(function (group) {
      arr(group).forEach(function (name) {
        var key = String(name);
        if (Object.prototype.hasOwnProperty.call(ids, key)) { cycleMembers[key] = ids[key]; hasCycle = true; }
      });
    });

    lines.push('');
    lines.push('  classDef module fill:#f8fafc,stroke:#cbd5e1,stroke-width:1px,color:#0f172a;');
    if (hasCycle) {
      lines.push('  classDef cycle fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;');
    }
    if (order.length) {
      var plain = order.filter(function (name) { return !Object.prototype.hasOwnProperty.call(cycleMembers, name); });
      if (plain.length) lines.push('  class ' + plain.map(function (n) { return ids[n]; }).join(',') + ' module;');
      if (hasCycle) {
        lines.push('  class ' + Object.keys(cycleMembers).map(function (k) { return cycleMembers[k]; }).join(',') + ' cycle;');
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  /* ---------------- draft ---------------- */
  function buildDraft(data) {
    if (!data) return null;
    var markdown = '';
    var mermaid = '';
    var json = '';
    try { markdown = markdownReport(data); } catch (e) { markdown = ''; }
    try { mermaid = mermaidGraph(data); } catch (e) { mermaid = ''; }
    try { json = jsonText(data); } catch (e) { json = ''; }
    if (!json) return null;
    var graph = data.graph || {};
    var deps = arr(graph.dependencies);
    var modules = {};
    deps.forEach(function (d) {
      if (!d) return;
      if (d.source) modules[String(d.source)] = 1;
      if (d.target) modules[String(d.target)] = 1;
    });
    return {
      json: json,
      markdown: markdown,
      mermaid: mermaid,
      meta: {
        files: arr(data.files).length,
        functions: arr(data.functions).length,
        findings: arr(data.findings).length,
        modules: Object.keys(modules).length,
        edges: deps.length,
        cycles: arr(graph.cycles).length,
        json_bytes: json.length,
        md_bytes: markdown.length,
        mmd_bytes: mermaid.length
      }
    };
  }

  /* ---------------- 卡片 ---------------- */
  var ICONS = {
    md: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    json: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2"/></svg>',
    mmd: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><path d="M10 6h3.5a2 2 0 0 1 2 2v7"/><path d="M6.5 9v6a2 2 0 0 0 2 2H14"/></svg>'
  };

  function formatCard(opts) {
    return [
      '<article class="card card--hover export-card">',
      '<div class="card__body">',
      '<div class="export-card__icon" data-tone="', opts.tone, '" aria-hidden="true">', ICONS[opts.kind] || '', '</div>',
      '<p class="export-card__title">', esc(opts.title), '</p>',
      '<p class="export-card__desc">', esc(opts.desc), '</p>',
      '<p class="tiny dim">', opts.fact || '', '</p>',
      '<button class="btn ', opts.disabled ? '' : 'btn--primary', '" type="button" data-download="', opts.kind, '"',
      opts.disabled ? ' disabled aria-disabled="true"' : '',
      '>', esc(opts.button), '</button>',
      '<p class="export-card__note">', opts.note || '', '</p>',
      '</div>',
      '</article>'
    ].join('');
  }

  function previewPanel(draft) {
    var text = draft && draft.markdown ? draft.markdown : '';
    var body;
    if (!text) {
      body = emptyBox('报告预览不可用', '当前结果无法生成 Markdown 报告，请重新分析。');
    } else {
      var shown = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text;
      body = [
        '<pre class="preview" aria-label="Markdown 报告预览">', esc(shown), '</pre>',
        text.length > PREVIEW_LIMIT
          ? '<p class="tiny dim">预览已截断，只显示前 ' + fmtInt(PREVIEW_LIMIT) + ' 个字符；下载得到完整报告。</p>'
          : ''
      ].join('');
    }
    return [
      '<section class="card">',
      '<div class="card__head">',
      '<div><p class="card__title">报告预览</p><p class="card__hint">Markdown 原文，只含统计与定位信息，不含源码</p></div>',
      '<span class="spacer"></span>',
      text ? '<span class="tiny dim">' + fmtInt(text.split('\n').length) + ' 行 · ' + fmtInt(text.length) + ' 字符</span>' : '',
      '</div>',
      '<div class="card__body card__body--flush">', body, '</div>',
      '</section>'
    ].join('');
  }

  /* ---------------- 渲染 ---------------- */
  function render(state, ctx) {
    var result = (ctx && ctx.result) || (state && state.result) || null;
    if (!result) {
      return page(
        emptyBox('还没有可导出的结果', '先导入一个 Python 项目并完成分析，这里才会生成真实报告。',
          '<button class="btn btn--primary" type="button" data-action="import">导入项目</button>'),
        '导入并分析项目后，可导出 Markdown 报告、JSON 数据与 Mermaid 结构图。'
      );
    }

    var draft = null;
    try { draft = buildDraft(result); } catch (e) { draft = null; }
    var meta = (draft && draft.meta) || { files: 0, functions: 0, findings: 0, modules: 0, edges: 0, cycles: 0 };

    var cards = [
      formatCard({
        kind: 'md', tone: 'brand', title: 'Markdown 报告',
        desc: '人读的完整报告：概览、实际分析范围、函数复杂度、风险清单、限制说明。',
        fact: fmtInt(meta.files) + ' 个文件 · ' + fmtInt(meta.functions) + ' 个函数 · ' + fmtInt(meta.findings) + ' 项发现',
        button: '下载 .md',
        disabled: !(draft && draft.markdown),
        note: '含「实际分析范围」小节'
      }),
      formatCard({
        kind: 'json', tone: 'tech', title: 'JSON 数据',
        desc: '引擎原始结果结构的深拷贝，便于二次处理或接入其他工具。',
        fact: 'schema ' + esc(result.schema_version === undefined ? '—' : result.schema_version) + ' · 约 ' + fmtInt(meta.json_bytes) + ' 字符',
        button: '下载 .json',
        disabled: !(draft && draft.json),
        note: '已剔除 files[].source 源码字段'
      }),
      formatCard({
        kind: 'mmd', tone: 'warn', title: 'Mermaid 结构图',
        desc: '模块依赖关系导出为 Mermaid 文本，可直接粘进文档或看板渲染。',
        fact: fmtInt(meta.modules) + ' 个模块 · ' + fmtInt(meta.edges) + ' 条依赖 · ' + fmtInt(meta.cycles) + ' 组环',
        button: '下载 .mmd',
        disabled: !(draft && draft.mermaid),
        note: '以 flowchart TD 开头'
      })
    ].join('');

    var inner = [
      '<div class="grid grid--sidebar">',
      '<div class="stack-12">',
      '<div class="export-grid">', cards, '</div>',
      '<div class="notice notice--info"><span class="notice__icon" aria-hidden="true">i</span>',
      '<div>导出内容是本次分析的真实结果：不含源码原文，不含模拟数据；若某个格式暂不可用，按钮会置灰而不是给出占位内容。</div>',
      '</div>',
      '</div>',
      previewPanel(draft),
      '</div>'
    ].join('');

    var actions = [
      '<span class="row row--wrap">',
      tag(STATUS_TEXT[result.status] || '未知状态', result.status === 'complete' ? 'ok' : (result.status === 'failed' ? 'critical' : 'warn')),
      '<span class="tiny dim">', esc(result.project || '未命名项目'), '</span>',
      '</span>'
    ].join('');

    return page(inner, '把本次分析结果导出为可归档、可分享的文件；所有数字与分析页面一致。', actions);
  }

  CL.views = CL.views || {};
  CL.views.export = {
    render: render,
    buildDraft: buildDraft
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
