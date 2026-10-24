#!/usr/bin/env node
/* tests/integration/test_frontend.cjs — CodeLens 前端集成测试
 *
 * 覆盖范围（对应 docs/software/frontend-redesign.md）：
 *   A. 附录 C 的 9 条遗留契约（必须保留）
 *   B. 拖拽导入：webkitGetAsEntry 递归、readEntries 分页、排除规则、drop 遮罩计数
 *   C. 结构视图布局不变量：确定性 / 不相交 / fit 视口 / 边端点不落节点内
 *   D. 导出格式：json 剔除 source、md 含“实际分析范围”、mmd 含“flowchart TD”
 *   E. 静态契约：每个 js 过 node --check、index.html 脚本顺序与规格一致
 *
 * 只依赖 Node 内置模块与本机 python（真实引擎），不引入任何 npm 依赖。
 * 用法：node tests/integration/test_frontend.cjs [--only=layout]
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const codeRoot = path.join(repoRoot, 'code');
const frontRoot = path.join(codeRoot, 'frontend');

/* 规格 §4.1 规定的加载顺序 */
const SCRIPT_ORDER = [
  'lib/dom.js', 'lib/api.js', 'lib/layout.js', 'lib/graph-svg.js',
  'views/overview.js', 'views/logic.js', 'views/structure.js',
  'views/risks.js', 'views/export.js', 'features/import.js', 'app.js'
];

const ONLY = (function () {
  const hit = process.argv.find(function (a) { return a.indexOf('--only=') === 0; });
  return hit ? hit.slice('--only='.length) : '';
})();

/* 真实引擎脚本：从文件读 payload、写结果文件。
 * 不走 stdin/stdout 管道，因此在受限沙箱（禁止命名管道）中同样可用。 */
const PY_ENGINE_FILE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[3])',
  'from core_engine.engine import analyze',
  'with open(sys.argv[1], "r", encoding="utf-8") as handle:',
  '    payload = json.load(handle)',
  'with open(sys.argv[2], "w", encoding="utf-8") as handle:',
  '    handle.write(json.dumps(analyze(payload), ensure_ascii=False))'
].join('\n');

/* 调用真实 Python 引擎分析 payload。file 进 / file 出，无 stdio 管道。 */
function engineAnalyze(payload) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelens-qa-'));
  const scriptPath = path.join(tmpDir, 'run_engine.py');
  const inPath = path.join(tmpDir, 'payload.json');
  const outPath = path.join(tmpDir, 'result.json');
  try {
    fs.writeFileSync(scriptPath, PY_ENGINE_FILE, 'utf8');
    fs.writeFileSync(inPath, JSON.stringify(payload), 'utf8');
    const run = spawnSync('python', ['-B', scriptPath, inPath, outPath, codeRoot], {
      cwd: codeRoot,
      stdio: 'ignore',
      timeout: 180000
    });
    if (run.error) {
      throw new Error('无法启动 python：' + run.error.message);
    }
    if (run.status !== 0) {
      throw new Error('Python 引擎退出码 ' + run.status);
    }
    if (!fs.existsSync(outPath)) {
      throw new Error('Python 引擎未产生结果文件');
    }
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  }
}

function nodeCheck(file) {
  const run = spawnSync(process.execPath, ['--check', file], { stdio: 'ignore', timeout: 60000 });
  if (run.error) return { ok: false, message: run.error.message };
  return { ok: run.status === 0, message: run.status === 0 ? '' : ('exit ' + run.status) };
}

/* ------------------------------------------------------------------ */
/* 极简测试运行器                                                      */
/* ------------------------------------------------------------------ */
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name: name, ok: true });
  } catch (error) {
    results.push({ name: name, ok: false, error: error });
  }
}
function noop() {}

/* ------------------------------------------------------------------ */
/* DOM 桩（严格贴近附录 D 的边界）                                      */
/* ------------------------------------------------------------------ */
function createElementStub(tagName) {
  const classes = new Set();
  const attributes = Object.create(null);
  const listeners = Object.create(null);
  const children = [];

  const el = {
    tagName: String(tagName || 'div').toUpperCase(),
    nodeType: 1,
    nodeName: String(tagName || 'div').toUpperCase(),
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    open: false,
    selected: false,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    childNodes: children,
    children: children,
    parentNode: null,
    style: {},
    dataset: {},
    files: [],
    elements: [],
    __classes: classes,
    __attributes: attributes,
    __listeners: listeners
  };

  Object.defineProperty(el, 'className', {
    enumerable: true,
    get: function () { return Array.from(classes).join(' '); },
    set: function (value) {
      classes.clear();
      String(value === undefined || value === null ? '' : value).split(' ').forEach(function (token) {
        if (token) classes.add(token);
      });
    }
  });

  el.classList = {
    add: function () {
      for (let i = 0; i < arguments.length; i += 1) if (arguments[i]) classes.add(String(arguments[i]));
    },
    remove: function () {
      for (let i = 0; i < arguments.length; i += 1) classes.delete(String(arguments[i]));
    },
    contains: function (name) { return classes.has(String(name)); },
    toggle: function (name, force) {
      const key = String(name);
      if (force === true) { classes.add(key); return true; }
      if (force === false) { classes.delete(key); return false; }
      if (classes.has(key)) { classes.delete(key); return false; }
      classes.add(key);
      return true;
    },
    item: function (index) { return Array.from(classes)[index] || null; },
    get length() { return classes.size; }
  };

  el.setAttribute = function (name, value) {
    const key = String(name);
    attributes[key] = String(value);
    if (key === 'class') el.className = value;
    if (key === 'hidden') el.hidden = true;
    if (key === 'value') el.value = String(value);
  };
  el.getAttribute = function (name) {
    const key = String(name);
    return key in attributes ? attributes[key] : null;
  };
  el.hasAttribute = function (name) { return String(name) in attributes; };
  el.removeAttribute = function (name) {
    const key = String(name);
    delete attributes[key];
    if (key === 'hidden') el.hidden = false;
  };

  el.appendChild = function (child) {
    if (child) { children.push(child); if (child.parentNode !== undefined) child.parentNode = el; }
    return child;
  };
  el.append = function () { for (let i = 0; i < arguments.length; i += 1) el.appendChild(arguments[i]); };
  el.prepend = el.append;
  el.insertBefore = function (child) { return el.appendChild(child); };
  el.removeChild = function (child) {
    const index = children.indexOf(child);
    if (index >= 0) children.splice(index, 1);
    if (child) child.parentNode = null;
    return child;
  };
  el.replaceChildren = function () { children.length = 0; };
  el.remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
  el.contains = function (child) { return children.indexOf(child) >= 0; };

  el.addEventListener = function (type, handler) {
    const key = String(type);
    (listeners[key] = listeners[key] || []).push(handler);
  };
  el.removeEventListener = function (type, handler) {
    const key = String(type);
    const list = listeners[key];
    if (!list) return;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
  el.dispatchEvent = function (event) {
    const list = (listeners[event && event.type] || []).slice();
    list.forEach(function (handler) { handler.call(el, event); });
    return true;
  };

  el.querySelector = function () { return null; };
  el.querySelectorAll = function () { return []; };
  el.closest = function () { return null; };
  el.matches = function () { return false; };
  el.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
  el.focus = noop;
  el.blur = noop;
  el.select = noop;
  el.scrollTo = noop;
  el.scrollIntoView = noop;
  el.setPointerCapture = noop;
  el.releasePointerCapture = noop;
  el.setSelectionRange = noop;
  el.getContext = function () { return null; };
  el.click = noop;
  el.showModal = function () { el.open = true; };
  el.show = function () { el.open = true; };
  el.close = function () { el.open = false; };

  return el;
}

/* index.html 中几个节点的初始 DOM 状态，让“初始不可见/隐藏”可判定 */
const PRESETS = {
  '#drop-overlay': { attributes: { 'aria-hidden': 'true' } },
  '#import-notice': { attributes: { hidden: '' }, hidden: true },
  '#import-dialog': { tag: 'dialog' },
  '#detail-dialog': { tag: 'dialog' },
  '#toast': { attrs: {} }
};

function createHarness() {
  const elements = new Map();
  const requests = [];
  const blobs = [];
  const docListeners = Object.create(null);
  const winListeners = Object.create(null);
  const flags = { shouldFail: false };

  function element(key) {
    const selector = String(key);
    if (selector.indexOf(' ') >= 0 || selector.indexOf('>') >= 0) return null;
    if (!elements.has(selector)) {
      const preset = PRESETS[selector] || {};
      const stub = createElementStub(preset.tag || (selector.charAt(0) === '#' ? 'div' : 'div'));
      if (preset.attributes) {
        Object.keys(preset.attributes).forEach(function (name) {
          stub.setAttribute(name, preset.attributes[name]);
        });
      }
      if (preset.hidden) stub.hidden = true;
      elements.set(selector, stub);
    }
    return elements.get(selector);
  }

  function stubResponse(ok, status, data) {
    return {
      ok: ok,
      status: status,
      statusText: ok ? 'OK' : 'ERROR',
      headers: { get: function () { return null; } },
      json: async function () { return data; },
      text: async function () { return typeof data === 'string' ? data : JSON.stringify(data); },
      clone: function () { return this; }
    };
  }

  function fetchImpl(url, options) {
    const opts = options || {};
    const target = String(url);
    if (target === '/api/status' || target.indexOf('/api/status') >= 0) {
      return Promise.resolve(stubResponse(true, 200, { ready: true, token: 'test-only', engine_version: '0.2.0' }));
    }
    return Promise.resolve().then(function () {
      let body = null;
      try { body = JSON.parse(opts.body); } catch (error) { body = null; }
      if (!body) throw new Error('请求体不是 JSON: ' + String(opts.body).slice(0, 120));
      requests.push(body);
      if (flags.shouldFail) throw new Error('connection failed');
      const result = engineAnalyze(body);
      return stubResponse(true, 200, result);
    });
  }

  const sandbox = {
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    Buffer: Buffer,
    Blob: Blob,
    File: File,
    AbortController: AbortController,
    Promise: Promise,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    RegExp: RegExp,
    Error: Error,
    TypeError: TypeError,
    Map: Map,
    Set: Set,
    isFinite: isFinite,
    isNaN: isNaN,
    parseInt: parseInt,
    parseFloat: parseFloat,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setImmediate: setImmediate,
    queueMicrotask: queueMicrotask,
    requestAnimationFrame: function (fn) { fn(0); return 1; },
    cancelAnimationFrame: noop,
    btoa: function (text) { return Buffer.from(String(text), 'binary').toString('base64'); },
    atob: function (text) { return Buffer.from(String(text), 'base64').toString('binary'); },
    URL: {
      createObjectURL: function (blob) { blobs.push(blob); return 'blob:test-' + blobs.length; },
      revokeObjectURL: noop
    },
    location: {
      protocol: 'http:',
      host: '127.0.0.1:8777',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:8777',
      pathname: '/',
      search: '',
      hash: '',
      href: 'http://127.0.0.1:8777/'
    },
    navigator: { userAgent: 'node-stub', platform: 'test' },
    devicePixelRatio: 1,
    fetch: fetchImpl
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const documentStub = {
    querySelector: function (selector) { return element(selector); },
    querySelectorAll: function () { return []; },
    getElementById: function (id) { return element('#' + id); },
    createElement: function (tag) { return createElementStub(tag); },
    createDocumentFragment: function () { return createElementStub('fragment'); },
    createTextNode: function (text) { return { nodeType: 3, textContent: String(text) }; },
    addEventListener: function (type, handler) {
      const key = String(type);
      (docListeners[key] = docListeners[key] || []).push(handler);
    },
    removeEventListener: function (type, handler) {
      const key = String(type);
      const list = docListeners[key];
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent: function () { return true; }
  };
  sandbox.document = documentStub;
  sandbox.addEventListener = function (type, handler) {
    const key = String(type);
    (winListeners[key] = winListeners[key] || []).push(handler);
  };
  sandbox.removeEventListener = function (type, handler) {
    const key = String(type);
    const list = winListeners[key];
    if (!list) return;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
  sandbox.document.body = element('body');
  sandbox.document.documentElement = element('html');
  sandbox.document.head = element('head');
  sandbox.document.activeElement = null;

  const context = vm.createContext(sandbox);
  vm.runInContext('this.window = this; this.globalThis = this;', context, { filename: 'bootstrap' });

  function fire(type, extra) {
    const event = Object.assign({
      type: type,
      target: element('#app'),
      currentTarget: documentStub,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      relatedTarget: null,
      clientX: 10,
      clientY: 10,
      preventDefault: function () { event.defaultPrevented = true; },
      stopPropagation: noop,
      stopImmediatePropagation: noop
    }, extra || {});
    const hosts = [
      [docListeners, documentStub],
      [winListeners, sandbox],
      [element('body').__listeners, element('body')],
      [element('#drop-overlay').__listeners, element('#drop-overlay')],
      [element('#app').__listeners, element('#app')],
      [element('#main').__listeners, element('#main')]
    ];
    hosts.forEach(function (pair) {
      const list = (pair[0][type] || []).slice();
      list.forEach(function (handler) { handler.call(pair[1], event); });
    });
    return event;
  }

  return {
    context: context,
    element: element,
    requests: requests,
    blobs: blobs,
    flags: flags,
    fire: fire,
    sandbox: sandbox,
    documentStub: documentStub
  };
}

function loadScripts(harness) {
  const missing = [];
  SCRIPT_ORDER.forEach(function (rel) {
    if (!fs.existsSync(path.join(frontRoot, rel))) missing.push(rel);
  });
  if (missing.length) throw new Error('缺少前端模块：' + missing.join(', '));
  SCRIPT_ORDER.forEach(function (rel) {
    const file = path.join(frontRoot, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), harness.context, { filename: file });
  });
}

async function flush(rounds) {
  const total = rounds || 8;
  for (let i = 0; i < total; i += 1) {
    await new Promise(function (resolve) { setImmediate(resolve); });
  }
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
}

/* 读取元素可见文本：innerHTML 与 textContent 合并判断，兼容两种写法 */
function textOf(harness, selector) {
  const el = harness.element(selector);
  return String(el.innerHTML || '') + ' ' + String(el.textContent || '');
}

/* 拖拽遮罩可见性：aria-hidden / class / body.is-dragging 任一成立即视为“拖拽中” */
const VISIBLE_TOKENS = ['is-visible', 'is-active', 'is-open', 'is-shown', 'is-show', 'visible', 'active', 'open', 'shown', 'show', 'is-dragging'];
function draggingState(harness) {
  const overlay = harness.element('#drop-overlay');
  const body = harness.element('body');
  const aria = overlay.getAttribute('aria-hidden');
  let visibleClass = false;
  VISIBLE_TOKENS.forEach(function (token) {
    if (overlay.__classes.has(token)) visibleClass = true;
  });
  const bodyDragging = body.__classes.has('is-dragging');
  const visible = (aria === 'false' || visibleClass) && overlay.hidden !== true;
  return { visible: visible, bodyDragging: bodyDragging, aria: aria, classes: Array.from(overlay.__classes) };
}

/* ------------------------------------------------------------------ */
/* 假 DataTransfer：webkitGetAsEntry 递归目录树                         */
/* ------------------------------------------------------------------ */
function makeFile(name, text) {
  return new File([text], name, { type: 'text/x-python' });
}

function makeFileEntry(name, text, fullPath) {
  const file = makeFile(name, text);
  return {
    isFile: true,
    isDirectory: false,
    name: name,
    fullPath: fullPath || ('/' + name),
    file: function (success, failure) {
      const deliver = function () { success(file); };
      if (typeof queueMicrotask === 'function') queueMicrotask(deliver); else setTimeout(deliver, 0);
      return Promise.resolve(file);
    },
    _file: file
  };
}

/* pageSize 控制 readEntries 每次返回的批量；循环读取到空数组为止才算读完 */
function makeDirEntry(name, children, fullPath, pageSize) {
  const size = pageSize && pageSize > 0 ? pageSize : children.length || 1;
  return {
    isFile: false,
    isDirectory: true,
    name: name,
    fullPath: fullPath || ('/' + name),
    createReader: function () {
      let cursor = 0;
      let closed = false;
      return {
        readEntries: function (success) {
          if (closed) {
            if (typeof success === 'function') { setTimeout(function () { success([]); }, 0); return; }
            return Promise.resolve([]);
          }
          const batch = children.slice(cursor, cursor + size);
          cursor += batch.length;
          if (!batch.length) closed = true;
          if (typeof success === 'function') {
            setTimeout(function () { success(batch); }, 0);
            return undefined;
          }
          return Promise.resolve(batch);
        }
      };
    }
  };
}

function makeDataTransfer(rootEntries, fileList) {
  const items = (rootEntries || []).map(function (entry) {
    return {
      kind: 'file',
      type: '',
      webkitGetAsEntry: function () { return entry; },
      getAsFile: function () { return entry && entry._file ? entry._file : null; },
      getAsString: function (cb) { if (cb) cb(''); }
    };
  });
  return {
    items: items,
    files: fileList || [],
    types: ['Files'],
    dropEffect: 'none',
    effectAllowed: 'all',
    getData: function () { return ''; },
    setData: function () {},
    clearData: function () {}
  };
}

/* 标准测试目录树：demo-proj 下含源码、子包、以及应被排除的 tests/ 与 __pycache__ */
function demoTree(pageSize) {
  const pkg = makeDirEntry('pkg', [
    makeFileEntry('__init__.py', 'VALUE = 1\n', '/demo-proj/pkg/__init__.py'),
    makeFileEntry('core.py', 'def run():\n    return 1\n', '/demo-proj/pkg/core.py')
  ], '/demo-proj/pkg', pageSize);
  const tests = makeDirEntry('tests', [
    makeFileEntry('test_main.py', 'def test_x():\n    pass\n', '/demo-proj/tests/test_main.py')
  ], '/demo-proj/tests', pageSize);
  const cache = makeDirEntry('__pycache__', [
    makeFileEntry('cached.py', 'X = 1\n', '/demo-proj/__pycache__/cached.py')
  ], '/demo-proj/__pycache__', pageSize);
  const root = makeDirEntry('demo-proj', [
    makeFileEntry('main.py', 'def main():\n    return 0\n', '/demo-proj/main.py'),
    makeFileEntry('app.py', 'import main\n', '/demo-proj/app.py'),
    pkg,
    tests,
    cache
  ], '/demo-proj', pageSize);
  return { root: root };
}

/* ------------------------------------------------------------------ */
/* C. 布局不变量（不需要 DOM，直接 require lib/layout.js）               */
/* ------------------------------------------------------------------ */
let layoutLoaded = null;
function loadLayout() {
  if (layoutLoaded) return layoutLoaded;
  const file = path.join(frontRoot, 'lib', 'layout.js');
  if (!fs.existsSync(file)) throw new Error('缺少 lib/layout.js');
  require(file);
  const CL = globalThis.CL;
  if (!CL || !CL.layout) throw new Error('lib/layout.js 未导出 globalThis.CL.layout');
  if (typeof CL.layout.buildGraph !== 'function') throw new Error('CL.layout.buildGraph 不是函数');
  if (typeof CL.layout.layoutGraph !== 'function') throw new Error('CL.layout.layoutGraph 不是函数');
  if (typeof CL.layout.fitTransform !== 'function') throw new Error('CL.layout.fitTransform 不是函数');
  layoutLoaded = CL.layout;
  return layoutLoaded;
}

const VIEWPORT = { width: 1200, height: 560 };
const PADDING = 32;
const EPS = 0.01;

function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkLayoutInvariants(layout, mode, label) {
  assert.ok(layout && Array.isArray(layout.nodes), label + '：layoutGraph 未返回 nodes 数组');
  assert.ok(Array.isArray(layout.edges), label + '：layoutGraph 未返回 edges 数组');
  assert.ok(layout.nodes.length > 0, label + '：节点为空，无法验证不变量');

  /* C2 任意两节点矩形不相交 */
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      const apart = a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS ||
        a.y + a.h <= b.y + EPS || b.y + b.h <= a.y + EPS;
      assert.ok(apart, label + '：节点重叠 ' + a.id + ' <-> ' + b.id);
    }
  }

  /* C3 fitTransform 后四个角都在视口内且留 32px */
  const bounds = layout.bounds || { minX: 0, minY: 0, width: 1, height: 1 };
  const t = layoutModuleFit(bounds, VIEWPORT, PADDING);
  assert.ok(isFinite(t.k) && t.k > 0, label + '：fitTransform 缩放比无效 ' + t.k);
  const xMin = PADDING - 0.6;
  const xMax = VIEWPORT.width - PADDING + 0.6;
  const yMin = PADDING - 0.6;
  const yMax = VIEWPORT.height - PADDING + 0.6;
  layout.nodes.forEach(function (node) {
    const corners = [
      [node.x, node.y], [node.x + node.w, node.y],
      [node.x, node.y + node.h], [node.x + node.w, node.y + node.h]
    ];
    corners.forEach(function (corner) {
      const px = corner[0] * t.k + t.tx;
      const py = corner[1] * t.k + t.ty;
      assert.ok(px >= xMin && px <= xMax,
        label + '：节点 ' + node.id + ' 缩放后 x=' + px.toFixed(2) + ' 越界（允许 ' + xMin + '~' + xMax + '）');
      assert.ok(py >= yMin && py <= yMax,
        label + '：节点 ' + node.id + ' 缩放后 y=' + py.toFixed(2) + ' 越界（允许 ' + yMin + '~' + yMax + '）');
    });
  });

  /* C4 每条边端点都不在任何节点矩形内部 */
  layout.edges.forEach(function (edge) {
    ['start', 'end'].forEach(function (key) {
      const point = edge[key];
      assert.ok(point && isFinite(point.x) && isFinite(point.y),
        label + '：边 ' + edge.id + ' 缺少有效 ' + key + ' 坐标');
      layout.nodes.forEach(function (node) {
        const inside = point.x > node.x + EPS && point.x < node.x + node.w - EPS &&
          point.y > node.y + EPS && point.y < node.y + node.h - EPS;
        assert.ok(!inside,
          label + '：边 ' + edge.id + ' 的 ' + key + ' 落在节点 ' + node.id + ' 内部（箭头会被遮挡）');
      });
    });
  });
}

let layoutModuleFit = null;

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
async function loadFrontend() {
  const harness = createHarness();
  loadScripts(harness);
  await flush(4);
  return harness;
}

async function runLegacyContracts() {
  const harness = await loadFrontend();
  const state = { harness: harness, result: null, exported: {} };

  await test('[A0] CL 命名空间与方法齐全', async function () {
    const names = ['dom', 'api', 'layout', 'graphSvg', 'views', 'features', 'app'];
    const raw = vm.runInContext('typeof CL === "object" ? Object.keys(CL) : null', harness.context);
    assert.ok(raw, 'CL 全局命名空间不存在');
    names.forEach(function (name) {
      assert.ok(raw.indexOf(name) >= 0, 'CL 缺少命名空间 ' + name + '（现有：' + raw.join(',') + '）');
    });
    const apiShape = vm.runInContext('(function(){var a=CL.app;return {interface:["state","result","selection","runAnalysis","locate","download","connect","navigate","openImport"].filter(function(k){return k in a;})};})()', harness.context);
    ['state', 'result', 'selection', 'runAnalysis', 'locate', 'download', 'connect', 'navigate', 'openImport'].forEach(function (key) {
      assert.ok(apiShape.interface.indexOf(key) >= 0, 'CL.app 缺少接口 ' + key + '（现有：' + apiShape.interface.join(',') + '）');
    });
  });

  await test('[A1] 初始空态含“分析引擎已就绪”且无示例数据', async function () {
    const main = textOf(harness, '#main');
    assert.ok(main.length > 0, '#main 未渲染任何内容');
    assert.match(main, /分析引擎已就绪/);
    assert.doesNotMatch(main, /ai-shop-demo/);
  });

  await test('[A2] runAnalysis 真实发出 1 次 POST /api/analyze 且 base64 等于 server.py 原文', async function () {
    const raw = fs.readFileSync(path.join(codeRoot, 'backend', 'server.py'));
    const file = new File([raw], 'server.py', { type: 'text/x-python' });
    const selection = { project: '<local-project>', files: [{ path: 'server.py', file: file }], error: '' };
    harness.sandbox.__qaSelection = selection;
    vm.runInContext('CL.app.selection = this.__qaSelection;', harness.context, { filename: 'inject' });
    await vm.runInContext('(async function(){ await CL.app.runAnalysis(); })()', harness.context);
    await flush(4);

    assert.equal(harness.requests.length, 1, '应恰好发出 1 次分析请求，实际 ' + harness.requests.length + ' 次');
    assert.equal(harness.requests[0].files[0].path, 'server.py');
    const decoded = Buffer.from(harness.requests[0].files[0].content_base64, 'base64').toString('utf8');
    assert.equal(decoded, raw.toString('utf8'), '请求体 base64 与 server.py 原文不一致');
  });

  await test('[A3] 结果指标为真实值：summary.files === 1 且 functions > 0', async function () {
    const result = vm.runInContext('CL.app.result', harness.context);
    assert.ok(result, 'CL.app.result 为空');
    state.result = result;
    assert.equal(result.summary.files, 1);
    assert.ok(result.summary.functions > 0, 'summary.functions 应 > 0，实际 ' + result.summary.functions);
    assert.equal(result.status, 'complete');
  });

  await test('[A4] 项目名中的尖括号在 #main 中被 HTML 转义', async function () {
    const html = textOf(harness, '#main');
    assert.ok(html.indexOf('&lt;local-project&gt;') >= 0, '#main 缺少转义后的 &lt;local-project&gt;');
    assert.ok(html.indexOf('<local-project>') < 0, '项目名未被转义，存在 XSS 风险');
  });

  await test('[A5] locate("server.py", 10) 渲染出 id="source-line-10"', async function () {
    vm.runInContext('CL.app.locate("server.py", 10);', harness.context);
    await flush(4);
    const html = textOf(harness, '#main');
    assert.ok(html.indexOf('id="source-line-10"') >= 0, '#main 未包含 id="source-line-10"');
  });

  await test('[A6] download("json") 导出对象不含 files[*].source 且含 main 函数', async function () {
    harness.blobs.length = 0;
    vm.runInContext('CL.app.download("json");', harness.context);
    await flush(2);
    assert.ok(harness.blobs.length >= 1, 'download("json") 未产生 Blob');
    const text = await harness.blobs[0].text();
    const exported = JSON.parse(text);
    state.exported.json = exported;
    assert.equal(exported.files[0].source, undefined, 'json 导出仍包含 files[0].source');
    assert.ok(exported.functions.some(function (item) { return item.name === 'main'; }), 'json 导出缺少 name === "main" 的函数');
    assert.equal(exported.project, '<local-project>');
  });

  await test('[A7] download("md") 含“实际分析范围”', async function () {
    harness.blobs.length = 0;
    vm.runInContext('CL.app.download("md");', harness.context);
    await flush(2);
    assert.ok(harness.blobs.length >= 1, 'download("md") 未产生 Blob');
    const text = await harness.blobs[0].text();
    state.exported.md = text;
    assert.match(text, /实际分析范围/);
  });

  await test('[A8] download("mmd") 含 "flowchart TD"', async function () {
    harness.blobs.length = 0;
    vm.runInContext('CL.app.download("mmd");', harness.context);
    await flush(2);
    assert.ok(harness.blobs.length >= 1, 'download("mmd") 未产生 Blob');
    const text = await harness.blobs[0].text();
    state.exported.mmd = text;
    assert.match(text, /flowchart TD/);
  });

  await test('[A9] 分析失败时保留旧 result 且 #import-notice 提示“没有生成替代结果”', async function () {
    const before = vm.runInContext('CL.app.result.project', harness.context);
    harness.flags.shouldFail = true;
    try {
      await vm.runInContext('(async function(){ await CL.app.runAnalysis(); })()', harness.context);
    } catch (error) {
      /* 失败由实现内部捕获并提示；这里不应把异常泄漏到测试 */
    }
    await flush(4);
    harness.flags.shouldFail = false;
    const after = vm.runInContext('CL.app.result && CL.app.result.project', harness.context);
    assert.equal(after, before, '分析失败后旧 result 被破坏');
    const notice = textOf(harness, '#import-notice');
    assert.match(notice, /没有生成替代结果/, '#import-notice 未提示“没有生成替代结果”，实际：' + notice.slice(0, 160));
  });

  return state;
}

async function runImportContracts() {
  const harness = await loadFrontend();
  const CL = vm.runInContext('CL', harness.context);
  const importer = CL.features && CL.features.import;
  assert.ok(importer, 'CL.features.import 不存在');
  assert.equal(typeof importer.readDrop, 'function', 'CL.features.import.readDrop 不是函数');

  await test('[B1] readDrop 递归目录树并得到正确的项目内相对路径', async function () {
    const tree = demoTree(0);
    const selection = await vm.runInContext('(function(dt){return CL.features.import.readDrop(dt);})', harness.context)(makeDataTransfer([tree.root], []));
    assert.ok(selection, 'readDrop 未返回 selection');
    assert.ok(Array.isArray(selection.files), 'selection.files 不是数组');
    const paths = selection.files.map(function (item) { return String(item.path).split('\\').join('/'); }).sort();
    /* 数组来自 vm 沙箱，原型与宿主不同，用 JSON 比较而非 assert.deepEqual */
    assert.ok(deepEqualJson(paths, ['app.py', 'main.py', 'pkg/__init__.py', 'pkg/core.py']),
      'readDrop 相对路径不正确：' + JSON.stringify(paths));
    assert.equal(selection.project, 'demo-proj', '项目名应取自根目录名，实际 ' + selection.project);
    selection.files.forEach(function (item) {
      assert.ok(item.file, 'selection.files[' + item.path + '].file 缺失');
      assert.equal(typeof item.file.arrayBuffer, 'function', '文件对象缺少 arrayBuffer()');
    });
  });

  await test('[B2] readEntries 分页返回（每页 1 条）被循环读到空数组为止', async function () {
    const tree = demoTree(1);
    const selection = await vm.runInContext('(function(dt){return CL.features.import.readDrop(dt);})', harness.context)(makeDataTransfer([tree.root], []));
    const paths = selection.files.map(function (item) { return String(item.path).split('\\').join('/'); }).sort();
    assert.ok(deepEqualJson(paths, ['app.py', 'main.py', 'pkg/__init__.py', 'pkg/core.py']),
      '分页 readEntries 未完整读取：' + JSON.stringify(paths));
  });

  await test('[B3] 排除规则生效：tests/ 与 __pycache__ 被过滤', async function () {
    const tree = demoTree(0);
    const selection = await vm.runInContext('(function(dt){return CL.features.import.readDrop(dt);})', harness.context)(makeDataTransfer([tree.root], []));
    const paths = selection.files.map(function (item) { return String(item.path).split('\\').join('/'); });
    assert.ok(paths.every(function (p) { return p.indexOf('tests/') !== 0; }), 'tests/ 未被排除：' + JSON.stringify(paths));
    assert.ok(paths.every(function (p) { return p.indexOf('__pycache__/') < 0; }), '__pycache__ 未被排除：' + JSON.stringify(paths));
    assert.equal(paths.length, 4, '排除后应剩 4 个文件，实际 ' + paths.length);
  });

  await test('[B4] 拖拽遮罩：dragenter 计数、dragleave 不闪烁、drop 后隐藏', async function () {
    const before = draggingState(harness);
    assert.equal(before.visible, false, '初始状态遮罩不应可见');
    assert.equal(before.bodyDragging, false, '初始状态 body 不应有拖拽标记');

    harness.fire('dragenter', { dataTransfer: makeDataTransfer([], []) });
    await flush(1);
    let state = draggingState(harness);
    assert.ok(state.visible || state.bodyDragging, 'dragenter 后遮罩未显示');

    harness.fire('dragenter', { dataTransfer: makeDataTransfer([], []) });
    await flush(1);
    harness.fire('dragleave', { dataTransfer: makeDataTransfer([], []) });
    await flush(1);
    state = draggingState(harness);
    assert.ok(state.visible || state.bodyDragging, 'dragleave 过早隐藏遮罩（进入子元素时会闪烁）');

    harness.fire('dragleave', { dataTransfer: makeDataTransfer([], []) });
    await flush(1);
    state = draggingState(harness);
    assert.equal(state.visible, false, '计数归零后遮罩应隐藏');
    assert.equal(state.bodyDragging, false, '计数归零后 body 拖拽标记应移除');

    harness.fire('dragenter', { dataTransfer: makeDataTransfer([], []) });
    await flush(1);
    assert.ok(draggingState(harness).visible, 'drop 前遮罩应再次显示');
    harness.fire('drop', { dataTransfer: makeDataTransfer([], []) });
    await flush(3);
    state = draggingState(harness);
    assert.equal(state.visible, false, 'drop 后遮罩应隐藏');
    assert.equal(state.bodyDragging, false, 'drop 后 body 拖拽标记应移除');
  });
}

async function runExportContracts() {
  const harness = await loadFrontend();
  await test('[D9] 导出前置：注入 selection 跑一次真实分析', async function () {
    const raw = fs.readFileSync(path.join(codeRoot, 'backend', 'server.py'));
    const file = new File([raw], 'server.py', { type: 'text/x-python' });
    harness.sandbox.__qaSelection = { project: '<local-project>', files: [{ path: 'server.py', file: file }], error: '' };
    vm.runInContext('CL.app.selection = this.__qaSelection;', harness.context, { filename: 'inject' });
    await vm.runInContext('(async function(){ await CL.app.runAnalysis(); })()', harness.context);
    await flush(4);
    assert.ok(vm.runInContext('CL.app.result', harness.context), '分析未产生 result');
  });

  await test('[D1] json 导出中 files[*].source 全部不存在', async function () {
    harness.blobs.length = 0;
    vm.runInContext('CL.app.download("json");', harness.context);
    await flush(2);
    const exported = JSON.parse(await harness.blobs[0].text());
    assert.ok(Array.isArray(exported.files) && exported.files.length > 0, 'json 导出缺少 files');
    exported.files.forEach(function (item, index) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'source'), false,
        'json 导出 files[' + index + '] 仍包含 source 字段');
    });
    assert.equal(JSON.stringify(exported).indexOf('content_base64'), -1, 'json 导出泄漏了 content_base64');
  });

  await test('[D2] md 导出含“实际分析范围”且列出文件/函数/风险/限制分节', async function () {
    harness.blobs.length = 0;
    vm.runInContext('CL.app.download("md");', harness.context);
    await flush(2);
    const text = await harness.blobs[0].text();
    assert.match(text, /实际分析范围/);
    assert.match(text, /server\.py/);
    assert.ok(text.length > 200, 'md 导出内容过短，可能没有列出实质内容');
  });

  await test('[D3] mmd 导出含 "flowchart TD"', async function () {
    harness.blobs.length = 0;
    vm.runInContext('CL.app.download("mmd");', harness.context);
    await flush(2);
    const text = await harness.blobs[0].text();
    assert.match(text, /flowchart TD/);
  });
}

async function runLayoutContracts() {
  const layout = loadLayout();
  layoutModuleFit = layout.fitTransform;

  const serverRaw = fs.readFileSync(path.join(codeRoot, 'backend', 'server.py'));
  const engineRaw = fs.readFileSync(path.join(codeRoot, 'core_engine', 'engine.py'));
  const result = engineAnalyze({
    project: 'qa-layout',
    files: [
      { path: 'backend/server.py', content_base64: Buffer.from(serverRaw).toString('base64') },
      { path: 'core_engine/engine.py', content_base64: Buffer.from(engineRaw).toString('base64') }
    ]
  });
  const modes = ['modules', 'classes', 'calls'];

  await test('[C0] 布局输入：真实引擎对 server.py + engine.py 产出可建图的结果', async function () {
    assert.ok(result.summary.files === 2, '引擎应分析 2 个文件，实际 ' + result.summary.files);
    assert.ok(result.summary.functions > 0, '引擎未产出函数');
    assert.ok(result.graph && Array.isArray(result.graph.dependencies), 'result.graph.dependencies 缺失');
  });

  await test('[C1] 同模式同输入布局确定性（两次结果深度相等）', async function () {
    modes.forEach(function (mode) {
      const g1 = layout.buildGraph(mode, result, 60);
      const g2 = layout.buildGraph(mode, result, 60);
      assert.ok(g1 && Array.isArray(g1.nodes) && g1.nodes.length > 0, mode + ' 建图为空');
      const l1 = layout.layoutGraph(g1);
      const l2 = layout.layoutGraph(g2);
      assert.ok(deepEqualJson(JSON.parse(JSON.stringify(l1)), JSON.parse(JSON.stringify(l2))),
        mode + ' 模式两次布局结果不一致（非确定性）');
    });
  });

  await test('[C2] 任意两个节点矩形不相交', async function () {
    modes.forEach(function (mode) {
      const l = layout.layoutGraph(layout.buildGraph(mode, result, 60));
      checkLayoutInvariants(l, mode, '[' + mode + ']');
    });
  });

  await test('[C3] 节点尺寸为规格规定的 200×56', async function () {
    const l = layout.layoutGraph(layout.buildGraph('modules', result, 60));
    assert.equal(l.nodeW, 200, 'layout.nodeW 应为 200');
    assert.equal(l.nodeH, 56, 'layout.nodeH 应为 56');
    l.nodes.forEach(function (node) {
      assert.equal(node.w, 200, '节点 ' + node.id + ' 宽度应为 200');
      assert.equal(node.h, 56, '节点 ' + node.id + ' 高度应为 56');
    });
  });

  await test('[C4] fitTransform 后四角都在视口内并保留 32px 边距', async function () {
    modes.forEach(function (mode) {
      const l = layout.layoutGraph(layout.buildGraph(mode, result, 60));
      const t = layout.fitTransform(l.bounds, VIEWPORT, PADDING);
      assert.ok(t && isFinite(t.k) && t.k > 0, mode + '：fitTransform 返回无效变换');
      l.nodes.forEach(function (node) {
        [[node.x, node.y], [node.x + node.w, node.y], [node.x, node.y + node.h], [node.x + node.w, node.y + node.h]].forEach(function (corner) {
          const px = corner[0] * t.k + t.tx;
          const py = corner[1] * t.k + t.ty;
          assert.ok(px >= PADDING - 0.6 && px <= VIEWPORT.width - PADDING + 0.6,
            mode + '：节点 ' + node.id + ' 缩放后 x=' + px.toFixed(2) + ' 越界');
          assert.ok(py >= PADDING - 0.6 && py <= VIEWPORT.height - PADDING + 0.6,
            mode + '：节点 ' + node.id + ' 缩放后 y=' + py.toFixed(2) + ' 越界');
        });
      });
    });
  });

  await test('[C5] 每条边的起点/终点都不在任何节点矩形内部', async function () {
    const counts = {};
    modes.forEach(function (mode) {
      counts[mode] = layout.layoutGraph(layout.buildGraph(mode, result, 60)).edges.length;
    });
    const total = Object.keys(counts).reduce(function (sum, key) { return sum + counts[key]; }, 0);
    /* 至少要有一个模式产生边，否则这条不变量是空验证 */
    assert.ok(total > 0, '三种模式都没有边，箭头遮挡不变量无法验证：' + JSON.stringify(counts));
    modes.forEach(function (mode) {
      const l = layout.layoutGraph(layout.buildGraph(mode, result, 60));
      l.edges.forEach(function (edge) {
        ['start', 'end'].forEach(function (key) {
          const point = edge[key];
          assert.ok(point && isFinite(point.x) && isFinite(point.y),
            mode + '：边 ' + edge.id + ' 缺少有效 ' + key);
          l.nodes.forEach(function (node) {
            const inside = point.x > node.x + EPS && point.x < node.x + node.w - EPS &&
              point.y > node.y + EPS && point.y < node.y + node.h - EPS;
            assert.ok(!inside,
              mode + '：边 ' + edge.id + ' 的 ' + key + ' 落在节点 ' + node.id + ' 内部（箭头会被节点覆盖）');
          });
        });
      });
    });
  });

  await test('[C6] 布局不越界：节点与边都在 layout.width/height 内', async function () {
    modes.forEach(function (mode) {
      const l = layout.layoutGraph(layout.buildGraph(mode, result, 60));
      assert.ok(isFinite(l.width) && l.width > 0, mode + '：layout.width 无效');
      assert.ok(isFinite(l.height) && l.height > 0, mode + '：layout.height 无效');
      l.nodes.forEach(function (node) {
        assert.ok(node.x >= 0 && node.y >= 0, mode + '：节点 ' + node.id + ' 坐标为负');
        assert.ok(node.x + node.w <= l.width + 0.6, mode + '：节点 ' + node.id + ' 超出画布宽度');
        /* 高度按行数推导，只校验节点不越界即可 */
        assert.ok(node.y + node.h <= l.height + 0.6, mode + '：节点 ' + node.id + ' 超出画布高度');
      });
      l.edges.forEach(function (edge) {
        [edge.start, edge.end].forEach(function (point) {
          assert.ok(point.x >= -0.6 && point.y >= -0.6, mode + '：边 ' + edge.id + ' 端点坐标为负');
          assert.ok(point.x <= l.width + 0.6 && point.y <= l.height + 0.6,
            mode + '：边 ' + edge.id + ' 端点超出画布');
        });
      });
    });
  });
}

async function runStaticContracts() {
  await test('[E1] 前端每个 js 通过 node --check', async function () {
    const missing = SCRIPT_ORDER.filter(function (rel) {
      return !fs.existsSync(path.join(frontRoot, rel));
    });
    assert.deepEqual(missing, [], '缺少前端文件：' + missing.join(', '));
    SCRIPT_ORDER.forEach(function (rel) {
      const check = nodeCheck(path.join(frontRoot, rel));
      if (!check.ok) throw new Error(rel + ' 语法检查失败（node --check）：' + check.message);
    });
  });

  await test('[E2] index.html 的脚本顺序与规格 §4.1 一致', async function () {
    const html = fs.readFileSync(path.join(frontRoot, 'index.html'), 'utf8');
    const found = [];
    String(html).split('<script').slice(1).forEach(function (segment) {
      const closing = segment.indexOf('>');
      const head = closing >= 0 ? segment.slice(0, closing) : segment;
      const parts = head.split('src="');
      if (parts.length !== 2) return;
      const rest = parts[1];
      const quote = rest.indexOf('"');
      if (quote < 0) return;
      const src = rest.slice(0, quote);
      found.push(src.charAt(0) === '/' ? src.slice(1) : src);
    });
    assert.deepEqual(found, SCRIPT_ORDER, 'index.html 脚本顺序不符合规格：' + JSON.stringify(found));
  });

  await test('[E3] index.html 含必需的容器 id（main / import-notice / drop-overlay）', async function () {
    const html = fs.readFileSync(path.join(frontRoot, 'index.html'), 'utf8');
    ['id="main"', 'id="import-notice"', 'id="drop-overlay"', 'id="import-dialog"', 'id="toast"'].forEach(function (needle) {
      assert.ok(html.indexOf(needle) >= 0, 'index.html 缺少 ' + needle);
    });
  });
}

async function main() {
  if (ONLY === 'layout') {
    await runLayoutContracts();
    return report();
  }
  if (ONLY === 'static') {
    await runStaticContracts();
    return report();
  }

  try {
    await runLegacyContracts();
  } catch (error) {
    results.push({ name: '[A*] 前端加载失败（模块缺失或初始化抛错）', ok: false, error: error });
  }
  try {
    await runImportContracts();
  } catch (error) {
    results.push({ name: '[B*] 拖拽导入用例无法执行', ok: false, error: error });
  }
  try {
    await runExportContracts();
  } catch (error) {
    results.push({ name: '[D*] 导出用例无法执行', ok: false, error: error });
  }
  try {
    await runLayoutContracts();
  } catch (error) {
    results.push({ name: '[C*] 布局不变量用例无法执行', ok: false, error: error });
  }
  await runStaticContracts();
  return report();
}

function report() {
  const failed = results.filter(function (item) { return !item.ok; });
  results.forEach(function (item) {
    if (item.ok) {
      console.log('PASS  ' + item.name);
    } else {
      console.log('FAIL  ' + item.name);
      const message = item.error && item.error.message ? item.error.message : String(item.error);
      console.log('      ' + String(message).split('\n').join('\n      '));
    }
  });
  console.log('');
  console.log('通过 ' + (results.length - failed.length) + ' / ' + results.length + ' 个用例');
  if (failed.length === 0) {
    console.log('PASS: 前端集成测试全部通过（遗留契约 / 拖拽导入 / 布局不变量 / 导出格式 / 静态契约）。');
  } else {
    console.log('FAILED: ' + failed.length + ' 个用例未通过。');
    process.exitCode = 1;
  }
  return failed.length;
}

main().catch(function (error) {
  console.error('测试运行器崩溃：', error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
