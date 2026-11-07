// Real Chromium workflow, no npm packages. Node 22+ supplies WebSocket.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,label){for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;}catch{}await delay(100);}throw Error('Timed out: '+label);}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'codelens-browser-'));
  const fixture=path.join(work,'project'),downloads=path.join(work,'downloads');fs.mkdirSync(fixture);fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(fixture,'a.py'),'from dep import increment, Worker\ndef run(x):\n    return increment(x)\nclass Pipeline:\n    def __init__(self): self.worker = Worker()\n');
  fs.writeFileSync(path.join(fixture,'dep.py'),'def increment(x):\n    return x + 1\nclass Worker:\n    def work(self): return 1\n');
  fs.writeFileSync(path.join(fixture,'Worker.java'),'class Worker {\n  static int work(int value) {\n    if (value > 0) { return value + 1; }\n    return 0;\n  }\n}\n');
  let mode='ok',modelCalls=0,lastPrompt='';
  const model=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
    modelCalls++;lastPrompt=JSON.parse(body).messages[1].content;
    if(mode==='error'){res.writeHead(401);res.end('{}');return;}
    const finish=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'先调用 increment，再返回计算结果。[a.py:L2-L3]\n依赖加一。[dep.py:L1-L2]\n不存在的行：[a.py:L999]'},finish_reason:'stop'}]}));};
    if(mode==='slow')setTimeout(finish,1000);else finish();
  });});
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const port=await freePort(),debug=await freePort();
  const browser=process.env.CODELENS_BROWSER||['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
  if(!browser)throw Error('Chromium/Edge required. Set CODELENS_BROWSER to its executable.');
  const app=spawn(process.env.PYTHON||'python',['-B','code/backend/server.py','--port',String(port)],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,CODELENS_AI_ENDPOINT:`http://127.0.0.1:${model.address().port}/v1/chat/completions`,CODELENS_AI_MODEL:'browser-test',CODELENS_AI_KEY:'test-only'}});
  let chrome,ws;
  try{
    await poll(async()=>{const r=await fetch(`http://127.0.0.1:${port}/api/status`);return r.ok;},'application start');
    chrome=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions',`--remote-debugging-port=${debug}`,`--user-data-dir=${path.join(work,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const tabs=await poll(async()=>{const r=await fetch(`http://127.0.0.1:${debug}/json`);const a=await r.json();return a.find(t=>t.type==='page');},'browser');
    ws=new WebSocket(tabs.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
    let sequence=0;const pending=new Map(),errors=[];
    ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}}else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);};
    function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
    async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const text=()=>evaluate('document.body.innerText');
    await cdp('Runtime.enable');await cdp('Page.enable');
    await cdp('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await cdp('Page.navigate',{url:`http://127.0.0.1:${port}`});
    await poll(()=>evaluate(`!!document.querySelector('[data-action="choose"]')`),'import page');
    const doc=await cdp('DOM.getDocument');const input=await cdp('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#folder-input'});
    await cdp('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[fixture]});
    try{await poll(async()=>(await text()).includes('健康度总分'),'real directory import');}catch(e){console.log(await text());console.log('runtime',errors,'files',await evaluate('Array.from(document.querySelector("#folder-input").files).map(f=>({name:f.name,path:f.webkitRelativePath}))'));throw e;}
    await click('a[href="#logic"]');
    await poll(async()=>(await text()).includes('AI 逻辑解读'),'logic page');
    await click('[data-action="settings-open"]');
    await evaluate(`document.querySelector('#llm-base-url').value=${JSON.stringify(`http://127.0.0.1:${model.address().port}/v1`)};document.querySelector('#llm-model').value='browser-test';document.querySelector('#llm-api-key').value='browser-secret';document.querySelector('#llm-settings-form').requestSubmit();`);
    assert.ok(!(await evaluate('JSON.stringify(localStorage)')).includes('browser-secret'));
    await evaluate(`document.querySelector('#ai-logic-target').value='a.run';document.querySelector('#ai-logic-target').dispatchEvent(new Event('change',{bubbles:true}));`);
    await click('[data-action="ai-explain"]');
    await poll(async()=>(await text()).includes('先调用 increment'),'model explanation');
    assert.ok(lastPrompt.includes('def increment'),'cross-file context missing');
    assert.equal(await evaluate('document.querySelectorAll("[data-action=ai-citation]").length'),2);
    assert.ok((await text()).includes('引用未验证'));
    await click('[data-action="ai-citation"][data-path="dep.py"]');
    assert.ok((await text()).includes('return x + 1'));
    await click('#detail-dialog [data-action="close-dialog"]');
    for(const format of ['json','md','csv']){
      await evaluate('document.querySelector(".export-dropdown").open=true');await delay(50);
      await click(`[data-action="export"][data-format="${format}"]`);
    }
    await poll(()=>['json','md','csv'].every(ext=>fs.existsSync(path.join(downloads,`codelens-report.${ext}`))),'downloads');
    const report=JSON.parse(fs.readFileSync(path.join(downloads,'codelens-report.json'),'utf8'));
    assert.equal(report.ai_explanations.length,1);assert.ok(report.files.every(f=>!('source'in f)));assert.ok(report.health);assert.ok(Array.isArray(report.class_metrics));
    assert.ok(fs.readFileSync(path.join(downloads,'codelens-report.md'),'utf8').includes('先调用 increment'));
    await evaluate('document.querySelector(".export-dropdown").open=true');
    await click('[data-change="export-ai"]');await click('[data-change="export-source"]');
    fs.unlinkSync(path.join(downloads,'codelens-report.json'));
    await evaluate('document.querySelector(".export-dropdown").open=true');
    await click('[data-action="export"][data-format="json"]');
    await poll(()=>fs.existsSync(path.join(downloads,'codelens-report.json')),'optional source export');
    const withoutAi=JSON.parse(fs.readFileSync(path.join(downloads,'codelens-report.json'),'utf8'));
    assert.equal(withoutAi.ai_explanations.length,0);assert.ok(withoutAi.files.every(f=>typeof f.source==='string'));
    await click('a[href="#solid"]');assert.ok((await text()).includes('ISP-01'));
    await click('a[href="#metrics"]');assert.ok((await text()).includes('规则命中汇总'));
    assert.ok(!(await text()).includes('LCOM1'));assert.ok(!(await text()).includes('结构重复'));
    assert.equal(await evaluate('document.querySelectorAll(".rule-group[open]").length'),0);
    await click('a[href="#risks"]');
    for(const label of ['可疑依赖调用','重复实现','未处理异常','硬编码敏感信息','死代码','假设未校验','注释与实现不一致','过度防御'])assert.ok((await text()).includes(label),label);
    assert.equal(await evaluate('document.querySelectorAll(".risk-row[open]").length'),0);
    await evaluate('document.querySelector(".risk-row > summary").click()');
    assert.equal(await evaluate('document.querySelectorAll(".risk-row[open]").length'),1);
    await click('a[href="#graphs"]');await click('[data-action="graph-tab"][data-tab="inheritance"]');
    assert.ok(await evaluate('Array.from(document.querySelectorAll(".graph-edge title")).some(e=>e.textContent.includes("composition"))'));
    await click('a[href="#logic"]');mode='error';await click('[data-action="ai-explain"]');
    await poll(async()=>(await text()).includes('HTTP 401'),'provider error');
    mode='slow';await click('[data-action="ai-explain"]');await click('[data-action="ai-explain-cancel"]');
    await poll(async()=>(await text()).includes('已取消'),'cancel');
    await delay(1100);assert.ok((await text()).includes('已取消'));
    // Real drop event with paged directory entries and excluded tests folder.
    await click('[data-action="reimport"]');await click('[data-action="confirm-import"]');await delay(150);
    await evaluate(`(()=>{
      const file=(name,content)=>({name,isFile:true,isDirectory:false,file:ok=>queueMicrotask(()=>ok(new File([content],name)))});
      const dir=(name,children)=>({name,isDirectory:true,isFile:false,createReader(){let i=0;return {readEntries(ok){queueMicrotask(()=>ok(i<children.length?[children[i++]]:[]));}};}});
      const root=dir('dropped',[file('a.py','from dep import increment\\ndef run(x):\\n    return increment(x)\\n'),file('dep.py','def increment(x):\\n    return x + 1\\n'),file('Worker.java','class Worker { static int work(int value) { if (value > 0) { return value + 1; } return 0; } }\\n'),dir('tests',[file('excluded.py','def never_import(): pass')])]);
      const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{items:[{kind:'file',webkitGetAsEntry:()=>root,getAsFile:()=>null}],files:[]}});document.querySelector('#dropzone').dispatchEvent(event);
    })()`);
    await poll(async()=>(await text()).includes('健康度总分'),'paged drag import');
    await click('a[href="#structure"]');assert.ok((await text()).includes('Worker.java'));assert.ok(!(await text()).includes('excluded.py'));
    await click('a[href="#logic"]');
    // Simulate old backend status, using real page reconnect flow.
    await evaluate(`window.realFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.realFetch(...args);if(args[0]==='/api/status'){const d=await r.json();delete d.api_revision;delete d.capabilities;return new Response(JSON.stringify(d));}return r;};`);
    await click('[data-action="reimport"]');await click('[data-action="confirm-import"]');await delay(250);await click('[data-action="return-result"]');
    await poll(async()=>(await text()).includes('后台版本不兼容'),'old backend warning');
    assert.equal(await evaluate('document.querySelector("[data-action=ai-explain]").disabled'),true);
    assert.equal(errors.length,0,'Browser runtime errors: '+errors.join(','));
    console.log('PASS real browser: directory/paged drag import and exclusions → analysis → contextual AI → verified source links → Markdown/JSON/CSV exports → SOLID/metrics → failure/cancel/version mismatch');
  }finally{
    if(ws)ws.close();if(chrome)chrome.kill();app.kill();model.closeAllConnections();await new Promise(r=>model.close(r));
    // Keep temporary artifacts for inspection; do not delete browser profile recursively.
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
