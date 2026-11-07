// Current UI end-to-end coverage plus retained graph layout invariants.
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
    console.log('PASS: 前端集成测试全部通过（真实浏览器主流程 / 布局不变量 / 当前静态契约）。');
  } else {
    console.log('FAILED: ' + failed.length + ' 个用例未通过。');
    process.exitCode = 1;
  }
  return failed.length;
}


(async()=>{
  await runLayoutContracts();
  const appCheck=nodeCheck(path.join(frontRoot,'app.js'));assert.ok(appCheck.ok,appCheck.message);
  const html=fs.readFileSync(path.join(frontRoot,'index.html'),'utf8');
  assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]),['/app.js']);
  for(const id of ['app','folder-input','settings-dialog','detail-dialog'])assert.ok(html.includes('id="'+id+'"'));
  const browser=spawnSync(process.execPath,[path.join(__dirname,'test_browser.cjs')],{cwd:repoRoot,stdio:'inherit',windowsHide:true,timeout:120000});
  assert.equal(browser.status,0,'Real browser workflow failed');
  report();
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
