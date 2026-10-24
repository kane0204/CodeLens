/* lib/api.js — 与本机 127.0.0.1 服务通讯：仅本机、带令牌、超时可控。 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  var STATUS_TIMEOUT = 5000;
  var ANALYZE_TIMEOUT = 120000;
  var B64_CHUNK = 0x8000;

  var api = {
    connected: false,
    token: null,
    version: null
  };

  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error(message || '请求超时'));
      }, ms);
      promise.then(function (value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function connect() {
    if (typeof fetch !== 'function') {
      api.connected = false;
      return Promise.resolve(false);
    }
    var req = fetch('/api/status', { method: 'GET', cache: 'no-store' }).then(function (res) {
      if (!res || !res.ok) throw new Error('服务未就绪');
      return res.json();
    }).then(function (data) {
      api.token = data && data.token ? data.token : null;
      api.version = data && data.engine_version ? String(data.engine_version) : null;
      api.connected = !!api.token;
      return api.connected;
    }).catch(function () {
      api.connected = false;
      api.token = null;
      return false;
    });
    return withTimeout(req, STATUS_TIMEOUT, '连接本机引擎超时');
  }

  function toBase64(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += B64_CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK));
    }
    return btoa(binary);
  }

  function readFile(file) {
    if (!file) return Promise.resolve('');
    if (typeof file.arrayBuffer === 'function') {
      return Promise.resolve(file.arrayBuffer()).then(toBase64);
    }
    if (typeof FileReader === 'function') {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(toBase64(reader.result)); };
        reader.onerror = function () { reject(new Error('文件读取失败')); };
        reader.readAsArrayBuffer(file);
      });
    }
    return Promise.reject(new Error('当前浏览器不支持读取本地文件'));
  }

  function payload(selection, encoded) {
    var files = (selection && selection.files) || [];
    return {
      project: (selection && selection.project) || 'local-project',
      files: files.map(function (item, index) {
        return { path: item.path, content_base64: encoded[index] };
      })
    };
  }

  function analyze(selection, onProgress) {
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    var files = (selection && selection.files) || [];
    if (!files.length) return Promise.reject(new Error('未选择任何 Python 文件'));
    if (typeof fetch !== 'function') return Promise.reject(new Error('当前环境不支持本机服务通讯'));

    report({ phase: 'read', done: 0, total: files.length });
    var chain = Promise.resolve([]);
    files.forEach(function (item, index) {
      chain = chain.then(function (acc) {
        return readFile(item.file).then(function (b64) {
          acc.push(b64);
          report({ phase: 'read', done: index + 1, total: files.length });
          return acc;
        });
      });
    });

    return chain.then(function (encoded) {
      report({ phase: 'upload', done: files.length, total: files.length });
      return fetch('/api/analyze', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CodeLens-Token': api.token || ''
        },
        body: JSON.stringify(payload(selection, encoded))
      });
    }).then(function (res) {
      if (!res) throw new Error('本机服务没有响应');
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error((data && data.error) || '分析失败');
        }
        return data;
      });
    }).then(function (data) {
      report({ phase: 'done', done: files.length, total: files.length });
      return data;
    });
  }

  api.connect = connect;
  api.analyze = analyze;
  api.toBase64 = toBase64;
  CL.api = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
