/* features/import.js — 导入：窗口任意位置拖拽、目录递归读取、input 归一化、导入弹窗。
   接口：open() / close() / accept(selection) / readDrop(dataTransfer) / fromFileList(fileList)。
   只产出 selection，不做任何网络请求；分析统一由 app.js 的 runAnalysis 触发。 */
(function (root) {
  'use strict';

  var CL = root.CL = root.CL || {};
  var D = CL.dom || {};

  function esc(v) { return D.esc ? D.esc(v) : String(v === null || v === undefined ? '' : v); }
  function fmtInt(v) { return D.fmtInt ? D.fmtInt(v) : String(v === null || v === undefined ? 0 : v); }
  function fmtBytes(v) { return D.fmtBytes ? D.fmtBytes(v) : String(v === null || v === undefined ? 0 : v) + ' B'; }
  function toast(msg, kind) {
    if (D.toast) { D.toast(msg, kind); return; }
    if (CL.app && typeof CL.app.toast === 'function') { try { CL.app.toast(msg, kind); } catch (e) { /* 忽略 */ } }
  }

  /* 与 code/core_engine/engine.py 保持一致的硬性边界 */
  var EXCLUDED = {
    '.git': 1, '.venv': 1, 'venv': 1, '__pycache__': 1,
    'node_modules': 1, 'build': 1, 'dist': 1, 'tests': 1
  };
  var MAX_FILES = 200;
  var MAX_FILE_BYTES = 1024 * 1024;
  var MAX_TOTAL_BYTES = 8 * 1024 * 1024;
  var PREVIEW_LIMIT = 60;
  var READ_CAP = 20000;

  var pending = null;
  var dragDepth = 0;
  var bound = false;

  /* ---------------- 小工具 ---------------- */
  function doc() { return (typeof document !== 'undefined') ? document : null; }

  function q(sel) {
    try {
      var d = doc();
      return d && d.querySelector ? d.querySelector(sel) : null;
    } catch (e) { return null; }
  }

  function hasClass(node, name) {
    try {
      if (!node) return false;
      if (node.classList && typeof node.classList.add === 'function') {
        var on = node.classList.contains(name);
        return !!on;
      }
      return (' ' + String(node.className || '') + ' ').indexOf(' ' + name + ' ') >= 0;
    } catch (e) { return false; }
  }

  function toggleClass(node, name, on) {
    try {
      if (!node) return;
      if (node.classList && typeof node.classList.add === 'function') {
        if (on) node.classList.add(name); else node.classList.remove(name);
        return;
      }
      var parts = String(node.className || '').split(/\s+/).filter(function (item) { return item && item !== name; });
      if (on) parts.push(name);
      node.className = parts.join(' ');
    } catch (e) { /* 忽略 */ }
  }

  function isPy(name) { return /\.py$/i.test(String(name || '')); }
  function isExcluded(name) { return Object.prototype.hasOwnProperty.call(EXCLUDED, String(name || '').toLowerCase()); }

  function normalizePath(value) {
    var p = String(value === null || value === undefined ? '' : value).replace(/\\/g, '/');
    p = p.replace(/^\.?\/+/, '').replace(/\/+$/, '');
    return p;
  }

  function splitPath(path) {
    return normalizePath(path).split('/').filter(function (item) { return item.length > 0; });
  }

  function hasExcludedSegment(path) {
    var parts = splitPath(path);
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (isExcluded(parts[i])) return true;
    }
    return false;
  }

  function sizeOf(file) {
    var n = file && typeof file.size === 'number' ? file.size : 0;
    return isFinite(n) && n > 0 ? n : 0;
  }

  /* ---------------- 目录递归读取 ---------------- */
  function readEntryFile(entry) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok(file) { if (done) return; done = true; resolve(file || null); }
      function fail(err) { if (done) return; done = true; reject(err || new Error('无法读取文件内容')); }
      var ret = null;
      try {
        ret = entry.file(ok, fail);
      } catch (e) {
        fail(e);
        return;
      }
      if (ret && typeof ret.then === 'function') {
        try { ret.then(ok, fail); } catch (e) { fail(e); }
      }
    });
  }

  /* readEntries 只返回一页（Chrome 通常 100 条），必须一直读到空数组为止 */
  function readEntriesPage(reader) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok(batch) { if (done) return; done = true; resolve(batch || []); }
      function fail(err) { if (done) return; done = true; reject(err || new Error('无法读取目录')); }
      var ret = null;
      try {
        ret = reader.readEntries(ok, fail);
      } catch (e) {
        fail(e);
        return;
      }
      if (ret && typeof ret.then === 'function') {
        try { ret.then(ok, fail); } catch (e) { fail(e); }
      }
    });
  }

  function readEntriesAll(entry) {
    return new Promise(function (resolve, reject) {
      var reader = null;
      try { reader = entry.createReader(); } catch (e) { reject(e); return; }
      var all = [];
      function step() {
        readEntriesPage(reader).then(function (batch) {
          if (!batch.length) { resolve(all); return; }
          for (var i = 0; i < batch.length; i += 1) all.push(batch[i]);
          if (all.length > READ_CAP) { resolve(all.slice(0, READ_CAP)); return; }
          step();
        }, reject);
      }
      step();
    });
  }

  function pushFile(acc, counters, path, file) {
    var rel = normalizePath(path);
    if (!rel || !isPy(rel)) { counters.skipped += 1; return; }
    if (hasExcludedSegment(rel)) { counters.excluded += 1; return; }
    acc.push({ path: rel, file: file });
    counters.bytes += sizeOf(file);
    counters.size += 1;
  }

  function walkEntry(entry, prefix, acc, counters) {
    return Promise.resolve().then(function () {
      if (!entry) return null;
      if (entry.isFile && !entry.isDirectory) {
        var name = String(entry.name || '');
        if (!isPy(name)) { counters.skipped += 1; return null; }
        return readEntryFile(entry).then(function (file) {
          if (file) pushFile(acc, counters, prefix + name, file);
          else counters.skipped += 1;
          return null;
        }, function () { counters.skipped += 1; return null; });
      }
      if (!entry.isDirectory) return null;
      if (prefix && isExcluded(entry.name)) { counters.excluded += 1; return null; }
      return walkDir(entry, prefix + String(entry.name || '') + '/', acc, counters);
    });
  }

  function walkDir(dirEntry, prefix, acc, counters) {
    return readEntriesAll(dirEntry).then(function (children) {
      var chain = Promise.resolve(null);
      children.forEach(function (child) {
        chain = chain.then(function () { return walkEntry(child, prefix, acc, counters); });
      });
      return chain;
    }, function () {
      counters.skipped += 1;
      return null;
    });
  }

  function commonParentName(paths) {
    if (!paths.length) return '';
    var dirs = paths.map(function (p) {
      var i = p.lastIndexOf('/');
      return i > 0 ? p.slice(0, i) : '';
    });
    var same = true;
    for (var i = 1; i < dirs.length; i += 1) { if (dirs[i] !== dirs[0]) { same = false; break; } }
    if (same) {
      if (!dirs[0]) return '';
      var segs = dirs[0].split('/');
      return segs[segs.length - 1];
    }
    var parts = dirs.map(function (d) { return d ? d.split('/') : []; });
    var common = [];
    for (var idx = 0; idx < parts[0].length; idx += 1) {
      var seg = parts[0][idx];
      var all = true;
      for (var k = 0; k < parts.length; k += 1) { if (parts[k][idx] !== seg) { all = false; break; } }
      if (!all) break;
      common.push(seg);
    }
    return common.length ? common[common.length - 1] : '';
  }

  /* 统一校验：数量、单文件、总大小、空结果 */
  function finalize(projectName, files, counters) {
    var list = files.slice().sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
    var problems = [];
    var bytes = 0;
    var kept = [];

    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      var size = sizeOf(item.file);
      if (size > MAX_FILE_BYTES) {
        problems.push('文件超过单文件 1 MB 限制，未纳入分析：' + item.path + '（' + fmtBytes(size) + '）');
        continue;
      }
      if (kept.length >= MAX_FILES) {
        problems.push('文件数超过上限 ' + MAX_FILES + ' 个，超出部分未纳入分析（共读取到 ' + fmtInt(list.length) + ' 个 .py 文件）');
        break;
      }
      if (bytes + size > MAX_TOTAL_BYTES) {
        problems.push('项目总大小超过 ' + fmtBytes(MAX_TOTAL_BYTES) + ' 限制，超出部分未纳入分析');
        break;
      }
      bytes += size;
      kept.push(item);
    }

    var project = String(projectName || '').trim();
    if (!project) project = '拖入的 ' + fmtInt(kept.length) + ' 个文件';

    var error = problems.join('；');
    if (!kept.length) {
      var empty = '这次导入没有读到可分析的 .py 文件。请确认所选目录里有 Python 源码，且已排除 ' +
        '.git / .venv / venv / __pycache__ / node_modules / build / dist / tests。';
      error = error ? (empty + ' ' + error) : empty;
    }

    return {
      project: project,
      files: kept,
      error: error,
      total_bytes: bytes,
      excluded: counters && typeof counters.excluded === 'number' ? counters.excluded : 0,
      skipped: counters && typeof counters.skipped === 'number' ? counters.skipped : 0
    };
  }

  function emptyCounters() { return { bytes: 0, size: 0, excluded: 0, skipped: 0 }; }

  /* ---------------- readDrop：优先 webkitGetAsEntry ---------------- */
  function entriesOf(dataTransfer) {
    var out = [];
    var items = dataTransfer && dataTransfer.items ? dataTransfer.items : null;
    if (!items || typeof items.length !== 'number') return out;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (!item) continue;
      if (typeof item.kind === 'string' && item.kind !== 'file') continue;
      if (typeof item.webkitGetAsEntry !== 'function') continue;
      var entry = null;
      try { entry = item.webkitGetAsEntry(); } catch (e) { entry = null; }
      if (entry) out.push(entry);
    }
    return out;
  }

  function readDrop(dataTransfer) {
    var dt = dataTransfer || {};
    var entries = entriesOf(dt);
    if (!entries.length) return Promise.resolve(fromFileList(dt.files));

    var acc = [];
    var counters = emptyCounters();
    var dirs = entries.filter(function (e) { return e && e.isDirectory; });
    var files = entries.filter(function (e) { return e && e.isFile && !e.isDirectory; });

    var project = '';
    var chain = Promise.resolve(null);

    if (dirs.length === 1 && !files.length) {
      /* 单个项目文件夹：project 取根目录名，路径相对根目录 */
      project = String(dirs[0].name || '');
      chain = chain.then(function () { return walkDir(dirs[0], '', acc, counters); });
    } else {
      entries.forEach(function (entry) {
        chain = chain.then(function () {
          if (entry && entry.isDirectory) return walkDir(entry, String(entry.name || '') + '/', acc, counters);
          return walkEntry(entry, '', acc, counters);
        });
      });
    }

    return chain.then(function () {
      if (!acc.length && dirs.length === 1 && !files.length) project = '';
      var selection = finalize(project, acc, counters);
      if (!acc.length) {
        var fallback = fromFileList(dt.files);
        if (fallback.files.length) return fallback;
      }
      return selection;
    }, function () {
      /* 目录接口失败：回退到 dataTransfer.files */
      return fromFileList(dt.files);
    });
  }

  /* ---------------- fromFileList：<input webkitdirectory> ---------------- */
  function fromFileList(fileList) {
    var list = [];
    try {
      if (fileList && typeof fileList.length === 'number') list = Array.prototype.slice.call(fileList);
    } catch (e) { list = []; }

    var counters = emptyCounters();
    var acc = [];
    var rels = [];

    for (var i = 0; i < list.length; i += 1) {
      var file = list[i];
      if (!file) continue;
      var rel = normalizePath(file.webkitRelativePath || file.relativePath || file.name || '');
      rels.push(rel || String(file.name || ('file-' + i)));
    }

    var rootName = '';
    if (rels.length) {
      var firsts = rels.map(function (p) { return p.split('/')[0]; });
      var same = true;
      for (var k = 1; k < firsts.length; k += 1) { if (firsts[k] !== firsts[0]) { same = false; break; } }
      if (same && rels.every(function (p) { return p.indexOf('/') >= 0; })) rootName = firsts[0];
    }

    for (var j = 0; j < list.length; j += 1) {
      var item = list[j];
      if (!item) continue;
      var path = normalizePath(item.webkitRelativePath || item.relativePath || item.name || '');
      if (rootName && path.indexOf(rootName + '/') === 0) path = path.slice(rootName.length + 1);
      if (!isPy(path)) { counters.skipped += 1; continue; }
      pushFile(acc, counters, path, item);
    }

    return finalize(rootName, acc, counters);
  }

  /* ---------------- 遮罩 ---------------- */
  function overlayEl() { return q('#drop-overlay'); }

  function showOverlay() {
    var el = overlayEl();
    if (el) {
      toggleClass(el, 'is-on', true);
      try { if (el.setAttribute) el.setAttribute('aria-hidden', 'false'); } catch (e) { /* 忽略 */ }
    }
    try {
      var body = doc() && doc().body ? doc().body : null;
      toggleClass(body, 'is-dragging', true);
    } catch (e) { /* 忽略 */ }
  }

  function hideOverlay() {
    var el = overlayEl();
    if (el) {
      toggleClass(el, 'is-on', false);
      try { if (el.setAttribute) el.setAttribute('aria-hidden', 'true'); } catch (e) { /* 忽略 */ }
    }
    try {
      var body = doc() && doc().body ? doc().body : null;
      toggleClass(body, 'is-dragging', false);
    } catch (e) { /* 忽略 */ }
  }

  function carriesFiles(event) {
    var dt = event && event.dataTransfer ? event.dataTransfer : null;
    if (!dt) return true;
    var types = dt.types;
    if (!types || typeof types.length !== 'number' || !types.length) return true;
    for (var i = 0; i < types.length; i += 1) {
      if (String(types[i]) === 'Files') return true;
    }
    return false;
  }

  /* ---------------- 导入弹窗 ---------------- */
  function dialogEl() { return q('#import-dialog'); }
  function bodyEl() { return q('#import-body'); }

  function summaryHtml(selection) {
    var files = selection && Array.isArray(selection.files) ? selection.files : [];
    var preview = files.slice(0, PREVIEW_LIMIT).map(function (item) {
      return '<div class="pick">' +
        '<span class="pick__check" aria-hidden="true">·</span>' +
        '<span class="pick__path"><bdi>' + esc(item.path) + '</bdi></span>' +
        '<span class="pick__size">' + fmtBytes(sizeOf(item.file)) + '</span>' +
        '</div>';
    }).join('');

    var errorHtml = selection && selection.error
      ? '<div class="notice notice--error"><span class="notice__icon" aria-hidden="true">!</span><div>' + esc(selection.error) + '</div></div>'
      : '';

    var facts = [
      '<span class="tag tag--tech">' + esc(selection && selection.project ? selection.project : '未识别项目名') + '</span>',
      '<span class="tiny">' + fmtInt(files.length) + ' 个 .py 文件</span>',
      '<span class="tiny muted">共 ' + fmtBytes(selection && selection.total_bytes ? selection.total_bytes : 0) + '</span>'
    ].join('');
    if (selection && selection.excluded) {
      facts += '<span class="tiny dim">已排除目录 ' + fmtInt(selection.excluded) + ' 处</span>';
    }

    var more = files.length > PREVIEW_LIMIT
      ? '<p class="tiny dim">仅列出前 ' + PREVIEW_LIMIT + ' 个路径，其余 ' + fmtInt(files.length - PREVIEW_LIMIT) + ' 个已一并纳入。</p>'
      : '';

    return [
      '<div class="row row--wrap">', facts, '</div>',
      errorHtml,
      files.length ? '<div class="pick-list">' + preview + '</div>' : '',
      more
    ].join('');
  }

  function renderBody() {
    var selection = pending;
    var files = selection && Array.isArray(selection.files) ? selection.files : [];
    var blocked = !!(selection && (selection.error || !files.length));

    var html = [
      '<div class="dlg-head">',
      '<div>',
      '<p class="dlg-title">导入 Python 项目</p>',
      '<p class="dlg-sub">目录递归读取 · 仅在本机内存中解析</p>',
      '</div>',
      '<button class="dlg-close" type="button" data-import-action="close" aria-label="关闭">',
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
      '</button>',
      '</div>',
      '<div class="dlg-main">',
      '<div class="dropzone" id="import-dropzone" role="button" tabindex="0" data-import-action="pick-folder">',
      '<span class="dropzone__icon" aria-hidden="true">',
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">',
      '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16"/>',
      '</svg>',
      '</span>',
      '<p class="dropzone__title">把项目文件夹拖到这里</p>',
      '<p class="dropzone__desc">也可以直接拖到窗口任意位置；或选择单个文件夹、多个 .py 文件。</p>',
      '<div class="dropzone__row">',
      '<button class="btn btn--sm btn--primary" type="button" data-import-action="pick-folder">选择文件夹</button>',
      '<button class="btn btn--sm" type="button" data-import-action="pick-files">选择 .py 文件</button>',
      '</div>',
      '</div>',
      selection ? summaryHtml(selection) : '<p class="tiny dim">还没有选择任何文件。</p>',
      '<p class="tiny dim">只收集 .py；自动排除 .git / .venv / venv / __pycache__ / node_modules / build / dist / tests；单文件 ≤ 1 MB，总计 ≤ 8 MB，最多 200 个文件。</p>',
      '<p class="tiny dim">文件只会发送到本机 127.0.0.1 的分析引擎，不会上传到任何外部服务；源码不执行。</p>',
      '</div>',
      '<div class="dlg-foot">',
      '<span class="tiny dim">', selection ? (blocked ? '当前选择不可分析，请重新选择。' : '准备就绪') : '等待选择', '</span>',
      '<span class="spacer"></span>',
      '<button class="btn" type="button" data-import-action="close">取消</button>',
      '<button class="btn btn--primary" type="button" data-import-action="accept"',
      blocked ? ' disabled aria-disabled="true"' : '',
      '>开始分析</button>',
      '</div>'
    ].join('');

    var host = bodyEl();
    if (host) { try { host.innerHTML = html; } catch (e) { /* 桩环境忽略 */ } }
    return html;
  }

  function showDialog() {
    var dlg = dialogEl();
    if (!dlg) return;
    try {
      if (dlg.showModal && !dlg.open) { dlg.showModal(); return; }
      if (dlg.setAttribute) dlg.setAttribute('open', '');
    } catch (e) { /* 桩环境忽略 */ }
  }

  function close() {
    pending = null;
    var dlg = dialogEl();
    if (!dlg) return;
    try {
      if (dlg.close && dlg.open) dlg.close();
      else if (dlg.removeAttribute) dlg.removeAttribute('open');
    } catch (e) { /* 忽略 */ }
  }

  function open() {
    bind();
    pending = null;
    renderBody();
    showDialog();
  }

  function present(selection) {
    pending = selection || fromFileList([]);
    renderBody();
    showDialog();
    return pending;
  }

  function accept(selection) {
    var choice = selection || pending;
    if (!choice) { toast('还没有选择项目', 'warn'); return null; }
    if (choice.error) { toast(choice.error, 'warn'); return null; }
    if (!choice.files || !choice.files.length) { toast('没有读到可分析的 .py 文件', 'warn'); return null; }

    var app = CL.app;
    if (app && typeof app.setSelection === 'function') {
      try { app.setSelection(choice); } catch (e) { root.selection = choice; }
    } else {
      root.selection = choice;
    }

    close();

    if (app && typeof app.runAnalysis === 'function') {
      return Promise.resolve().then(function () {
        return app.runAnalysis();
      }).catch(function () { return null; });
    }
    return null;
  }

  function pick(inputSelector) {
    var input = q(inputSelector);
    if (input && input.click) { try { input.click(); } catch (e) { /* 忽略 */ } return true; }
    return false;
  }

  function handleAction(action) {
    if (!action) return;
    if (action === 'close') { close(); return; }
    if (action === 'pick-folder') { pick('#folder-input'); return; }
    if (action === 'pick-files') { pick('#files-input'); return; }
    if (action === 'accept') { accept(pending); }
  }

  function closestImportAction(node) {
    var current = node;
    while (current) {
      if (current.getAttribute) {
        var value = current.getAttribute('data-import-action');
        if (value) return value;
      }
      current = current.parentNode;
    }
    return null;
  }

  function onDialogClick(event) {
    var target = event && event.target ? event.target : null;
    if (!target) return;
    var action = closestImportAction(target);
    if (!action) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    handleAction(action);
  }

  function onDialogKey(event) {
    if (!event) return;
    var key = event.key || '';
    if (key === 'Escape' || key === 'Esc') { close(); return; }
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
    var target = event && event.target ? event.target : null;
    var action = closestImportAction(target);
    if (!action) return;
    if (event.preventDefault) event.preventDefault();
    handleAction(action);
  }

  function onDirectoryInput(event) {
    var target = event && event.target ? event.target : null;
    var files = target && target.files ? target.files : null;
    var selection = fromFileList(files);
    present(selection);
    try { if (target) target.value = ''; } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 全局拖拽 ---------------- */
  function onDragEnter(event) {
    if (!carriesFiles(event)) return;
    dragDepth += 1;
    showOverlay();
  }

  function onDragOver(event) {
    if (!carriesFiles(event)) return;
    if (event && event.preventDefault) event.preventDefault();
    try {
      if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    } catch (e) { /* 忽略 */ }
  }

  function onDragLeave(event) {
    if (!carriesFiles(event)) return;
    dragDepth -= 1;
    if (dragDepth <= 0) { dragDepth = 0; hideOverlay(); }
  }

  function onDrop(event) {
    if (event && event.preventDefault) event.preventDefault();
    dragDepth = 0;
    hideOverlay();
    var dt = event && event.dataTransfer ? event.dataTransfer : null;
    if (!dt) return;
    Promise.resolve()
      .then(function () { return readDrop(dt); })
      .then(function (selection) { present(selection); })
      .catch(function () {
        present({
          project: '',
          files: [],
          error: '读取拖入内容失败：浏览器没有开放目录读取权限，请改用「选择文件夹」按钮导入。'
        });
      });
  }

  function bind() {
    if (bound) return;
    var d = doc();
    if (!d) return;
    bound = true;

    try {
      if (d.addEventListener) {
        d.addEventListener('dragover', onDragOver);
        d.addEventListener('drop', onDrop);
      }
      if (root && typeof root.addEventListener === 'function') {
        root.addEventListener('dragenter', onDragEnter);
        root.addEventListener('dragleave', onDragLeave);
        root.addEventListener('dragover', onDragOver);
        root.addEventListener('drop', onDrop);
      }
    } catch (e) { /* 忽略 */ }

    try {
      var folder = q('#folder-input');
      if (folder && folder.addEventListener) folder.addEventListener('change', onDirectoryInput);
      var files = q('#files-input');
      if (files && files.addEventListener) files.addEventListener('change', onDirectoryInput);
      var dlg = dialogEl();
      if (dlg && dlg.addEventListener) {
        dlg.addEventListener('click', onDialogClick);
        dlg.addEventListener('keydown', onDialogKey);
        dlg.addEventListener('cancel', function () { close(); });
      }
    } catch (e) { /* 忽略 */ }
  }

  CL.features = CL.features || {};
  CL.features.import = {
    open: open,
    close: close,
    accept: accept,
    readDrop: readDrop,
    fromFileList: fromFileList,
    refresh: function () { renderBody(); }
  };

  try { bind(); } catch (e) { /* 模块顶层安全降级：没有 DOM 时不绑定 */ }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
