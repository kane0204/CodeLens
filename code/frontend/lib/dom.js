/* lib/dom.js — 基础工具：查询、转义、格式化、提示。无 DOM 时安全降级。 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  function $(sel, scope) {
    try {
      var host = scope || (typeof document !== 'undefined' ? document : null);
      return host && host.querySelector ? host.querySelector(sel) : null;
    } catch (e) { return null; }
  }

  function $$(sel, scope) {
    try {
      var host = scope || (typeof document !== 'undefined' ? document : null);
      var list = host && host.querySelectorAll ? host.querySelectorAll(sel) : [];
      return Array.prototype.slice.call(list || []);
    } catch (e) { return []; }
  }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, function (ch) { return ESC[ch]; });
  }

  function fmtInt(value) {
    var n = Number(value);
    if (!isFinite(n)) return '0';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtNum(value, digits) {
    var n = Number(value);
    if (!isFinite(n)) return '0';
    var d = typeof digits === 'number' ? digits : 1;
    var fixed = n.toFixed(d);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  }

  function fmtBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return fmtNum(n / 1024, 1) + ' KB';
    return fmtNum(n / (1024 * 1024), 1) + ' MB';
  }

  /* 按显示宽度截断：中文等宽字符计 2，超出加省略号。 */
  function clip(text, maxWidth) {
    var s = String(text === null || text === undefined ? '' : text);
    var limit = maxWidth || 18;
    var width = 0;
    var out = '';
    for (var i = 0; i < s.length; i += 1) {
      var ch = s.charAt(i);
      width += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1;
      if (width > limit) return out + '…';
      out += ch;
    }
    return out;
  }

  function basename(filePath) {
    var s = String(filePath || '');
    var i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function dirname(filePath) {
    var s = String(filePath || '');
    var i = s.lastIndexOf('/');
    return i > 0 ? s.slice(0, i) : '';
  }

  function debounce(fn, wait) {
    var timer = null;
    var delay = typeof wait === 'number' ? wait : 160;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, delay);
    };
  }

  var TOAST_KINDS = { info: 'toast--info', ok: 'toast--ok', warn: 'toast--warn', error: 'toast--error' };
  var toastTimer = null;

  function toast(message, kind) {
    var host = $('#toast');
    if (!host) return;
    var cls = TOAST_KINDS[kind] || TOAST_KINDS.info;
    host.className = 'toast is-visible ' + cls;
    host.textContent = String(message || '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      host.className = 'toast ' + cls;
    }, 3600);
  }

  var TAG_COLORS = { critical: 'danger', warning: 'warn', info: 'info', ok: 'ok', neutral: 'neutral', tech: 'tech' };

  function tag(text, color) {
    var tone = TAG_COLORS[color] || TAG_COLORS.neutral;
    return '<span class="tag tag--' + tone + '">' + esc(text) + '</span>';
  }

  function empty(title, desc, actionHtml) {
    return [
      '<div class="empty">',
      '  <div class="empty__icon" aria-hidden="true">',
      '    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">',
      '      <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
      '    </svg>',
      '  </div>',
      '  <p class="empty__title">' + esc(title || '暂无数据') + '</p>',
      desc ? '  <p class="empty__desc">' + esc(desc) + '</p>' : '',
      actionHtml ? '  <div class="empty__action">' + actionHtml + '</div>' : '',
      '</div>'
    ].join('\n');
  }

  function pct(part, total) {
    var t = Number(total) || 0;
    if (t <= 0) return 0;
    return Math.max(0, Math.min(100, (Number(part) || 0) / t * 100));
  }

  CL.dom = {
    $: $, $$: $$, esc: esc, fmtInt: fmtInt, fmtNum: fmtNum, fmtBytes: fmtBytes,
    clip: clip, basename: basename, dirname: dirname, debounce: debounce,
    toast: toast, tag: tag, empty: empty, pct: pct
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
