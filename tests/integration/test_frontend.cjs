// Controller integration tests. DOM is stubbed; analysis uses the real Python engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const repoRoot = path.resolve(__dirname, '../..');
const codeRoot = path.join(repoRoot, 'code');

async function main() {
  const elements = new Map();
  const element = key => {
    if (key.includes(' .')) return null;
    if (!elements.has(key)) elements.set(key, {innerHTML:'',textContent:'',disabled:false,
      classList:{add(){},remove(){},toggle(){}},addEventListener(){},close(){},showModal(){},
      setAttribute(){},removeAttribute(){},append(){},click(){},remove(){}});
    return elements.get(key);
  };
  const requests=[], blobs=[];
  let shouldFail=false;
  const context = vm.createContext({console,Buffer,Blob,AbortController,setTimeout,clearTimeout,
    location:{protocol:'http:',hash:''},requestAnimationFrame:fn=>fn(),btoa:s=>Buffer.from(s,'binary').toString('base64'),
    URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},
    document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){},createElement:()=>element('anchor'),body:element('body')},
    window:{addEventListener(){},scrollTo(){}},
    fetch:async (url,options)=>{
      if(url==='/api/status')return{ok:true,json:async()=>({ready:true,token:'test-only',engine_version:'0.2.0'})};
      requests.push(JSON.parse(options.body));
      if(shouldFail)throw Error('connection failed');
      const output=execFileSync('python',['-B','-c',
        'import json,sys; from core_engine.engine import analyze; print(json.dumps(analyze(json.load(sys.stdin)),ensure_ascii=True))'],
        {cwd:codeRoot,input:options.body,encoding:'utf8'});
      return{ok:true,json:async()=>JSON.parse(output)};
    }
  });
  vm.runInContext(fs.readFileSync(path.join(codeRoot,'frontend','app.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(element('#main').innerHTML,/分析引擎已就绪/);
  assert.doesNotMatch(element('#main').innerHTML,/ai-shop-demo/);
  const raw=fs.readFileSync(path.join(codeRoot,'backend','server.py'));
  context.inputSelection={project:'<local-project>',files:[{path:'server.py',file:{arrayBuffer:async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)}}],error:''};
  await vm.runInContext('(async()=>{selection=inputSelection; await runAnalysis();})()',context);
  assert.equal(requests.length,1);
  assert.equal(requests[0].files[0].path,'server.py');
  assert.equal(Buffer.from(requests[0].files[0].content_base64,'base64').toString('utf8'),raw.toString('utf8'));
  assert.equal(vm.runInContext('result.summary.files',context),1);
  assert.ok(vm.runInContext('result.summary.functions',context)>0);
  assert.match(element('#main').innerHTML,/&lt;local-project&gt;/);
  vm.runInContext("locate('server.py', 10)",context);
  assert.match(element('#main').innerHTML,/id="source-line-10"/);
  vm.runInContext("download('json')",context);
  const exported=JSON.parse(await blobs[0].text());
  assert.equal(exported.project,'<local-project>');
  assert.equal(exported.files[0].source,undefined);
  assert.ok(exported.functions.some(f=>f.name==='main'));
  vm.runInContext("download('md'); download('mmd')",context);
  assert.match(await blobs[1].text(),/实际分析范围/);
  assert.match(await blobs[2].text(),/flowchart TD/);
  shouldFail=true;
  await vm.runInContext('runAnalysis()',context);
  assert.equal(vm.runInContext('result.project',context),'<local-project>');
  assert.match(element('#import-notice').textContent,/没有生成替代结果/);
  console.log('PASS: empty startup, real file request, actual metrics, HTML escaping, source location, JSON/MD/Mermaid exports, failure preserves previous result.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
