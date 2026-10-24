(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val = value => value == null ? '—' : esc(value);
  const arr = value => Array.isArray(value) ? value : [];
  const pages = {overview:'总览',structure:'项目结构',logic:'逻辑说明',graphs:'结构视图',metrics:'质量体检',solid:'设计检查',risks:'风险清单',export:'导出报告'};
  const severity = {critical:'高',warning:'中',info:'低'};
  const weight = {critical:3,warning:2,info:1};
  const colors = {critical:'#b91c1c',warning:'#c2410c',info:'#a8a29e'};
  const state = {result:null,ready:false,connecting:true,token:'',version:'',importing:true,busy:false,phase:'',read:0,error:[],ignored:{},collapsed:false,route:'overview',file:'',fn:'',treeSearch:'',logicSort:'cc',logicTab:'trace',line:null,graphTab:'inheritance',graph:null,drawer:null,metricsTab:'functions',metricSort:'cc',metricAsc:false,overOnly:false,packageSort:false,expanded:new Set(),risk:{severities:[],evidence:'',rule:'',file:'',query:'',page:1},controller:null};
  const app = $('#app');
  const placeholder = label => `<div class="placeholder">${label ? `<div>${esc(label)}</div>` : ''}引擎未产出此结果</div>`;
  const button = (label, action, data = '', cls = '') => `<button class="${cls}" data-action="${action}" ${data} aria-label="${esc(label)}">${esc(label)}</button>`;
  const empty = (text, action='reimport', label='重新导入') => `<div class="empty"><p>${esc(text)}</p>${button(label,action)}</div>`;
  const tag = level => `<span class="tag ${Object.hasOwn(severity,level)?level:'info'}">${esc(severity[level] || '未知')}</span>`;
  const evidence = value => `<span class="tag ${value==='inference'?'inference':''}">${value==='fact'?'事实':value==='inference'?'推断':'—'}</span>`;
  const ccClass = cc => cc>20?'critical':cc>10?'warning':'';
  const table = (headers, body) => `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const card = (title, body, action='') => `<section class="card"><div class="heading"><h2>${title}</h2>${action}</div>${body}</section>`;
  const functions = () => arr(state.result?.functions);
  const files = () => arr(state.result?.files);
  const findings = () => arr(state.result?.findings);
  const rules = () => arr(state.result?.config?.rules);
  const functionId = f => typeof f==='string'?f:f?.id;
  const fileFor = id => files().find(f=>arr(f.functions).some(fn=>functionId(fn)===id));
  const moduleName = path => String(path).replace(/\.py$/i,'').replace(/\/__init__$/,'').replaceAll('/','.');
  const moduleFile = id => files().filter(f=>id===moduleName(f.path)||String(id).startsWith(moduleName(f.path)+'.')).sort((a,b)=>b.path.length-a.path.length)[0];
  function nodeFile(id) { return fileFor(id) || moduleFile(id); }
  function toast(message, type='info') {
    const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;$('#toasts').append(node);setTimeout(()=>node.remove(),3000);
  }
  function modal(title, content) {
    const d=$('#detail-dialog');d.innerHTML=`<div class="heading"><h2>${esc(title)}</h2>${button('关闭','close-dialog')}</div>${content}`;if(!d.open)d.showModal();
  }
  async function copy(text) {
    try {await navigator.clipboard.writeText(text);toast('已复制到剪贴板','success');}
    catch {modal('请手动复制',`<p>无法访问剪贴板，请选中下方内容手动复制。</p><textarea aria-label="待复制内容" style="width:100%;min-height:220px">${esc(text)}</textarea>`);toast('复制失败，请手动复制','warning');}
  }
  function download(content, type, extension) {
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`codelens-${extension==='svg'?'graph':'report'}.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已生成下载文件','success');
  }
  function markdown() {
    const r=state.result,s=r.summary||{};
    const names={files:'文件数',parsed:'已解析',failed:'解析失败',excluded:'已排除',functions:'函数数',classes:'类数',code_lines:'代码行数',findings:'风险条目',average_cc:'平均圈复杂度',max_cc:'最大圈复杂度'};
    const safe=v=>String(v??'—').replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replaceAll('\n',' ');
    return `# CodeLens 分析报告\n\n## 项目概览\n\n项目：${safe(r.project)}\n\n引擎版本：${safe(r.engine_version)}\n\n${Object.entries(names).map(([k,n])=>`- ${n}：${s[k]??'—'}`).join('\n')}\n\n## 风险清单\n\n${findings().map(f=>`### ${safe(f.rule_id)} · ${severity[f.severity]||'—'}\n\n- 位置：${safe(f.file)}:${f.line??'—'}\n- 证据等级：${f.evidence_type==='fact'?'事实':'推断'}\n- 实际值 / 阈值：${safe(f.actual)} / ${safe(f.threshold)}\n- 置信度：${f.confidence??'—'}\n\n${safe(f.message)}\n\n复核建议：${safe(f.suggestion)}\n`).join('\n')||'没有风险条目。'}\n\n## 分析边界 / 未执行项\n\n${arr(r.limitations).map(x=>`- ${safe(x)}`).join('\n')||'引擎未提供分析边界说明。'}\n\n## 解析错误\n\n${arr(r.errors).map(x=>`- ${safe(x.file)}:${x.line??'—'} ${safe(x.message)}`).join('\n')||'无'}\n\n## 警告\n\n${arr(r.warnings).map(x=>`- ${safe(x.file)}:${x.line??'—'} ${safe(x.message)}`).join('\n')||'无'}\n`;
  }
  function csv() {
    const keys=['id','rule_id','severity','evidence_type','file','line','message','suggestion','actual','threshold','confidence'];
    const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    return '\uFEFF'+[keys,...findings().map(f=>keys.map(k=>f[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function exportReport(format) {
    if(!state.result)return;
    if(format==='json')download(JSON.stringify(state.result,null,2),'application/json;charset=utf-8','json');
    if(format==='csv')download(csv(),'text/csv;charset=utf-8','csv');
    if(format==='md')download(markdown(),'text/markdown;charset=utf-8','md');
    $$('.dropdown[open]').forEach(x=>x.open=false);
  }
  function go(route) { if(location.hash===`#${route}`){state.route=route;render();}else location.hash=route; }
  function route() {
    if(!state.result){history.replaceState(null,'',location.pathname+location.search);state.importing=true;render();return;}
    if(location.hash==='#main'){document.querySelector('#main')?.focus();return;}
    const hash=location.hash.slice(1);state.route=Object.hasOwn(pages,hash)?hash:'overview';state.drawer=null;state.graph=null;
    if(!Object.hasOwn(pages,hash))history.replaceState(null,'','#overview');render();
  }
  function importView() {
    const errors=state.error.length?`<div class="error-box" role="alert"><ul>${state.error.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'';
    const stats=Object.entries(state.ignored).map(([k,v])=>`${esc(k)}：${v}`).join('；');
    return `<main id="main" tabindex="-1" class="import-page"><section class="import-card"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>CodeLens</span></div><h1>CodeLens 代码分析</h1><p class="muted">检查 Python 项目的结构、逻辑与代码风险，依据分析结果进行复核。</p>${state.connecting?'<p role="status">正在连接分析服务</p><div class="skeleton"></div>':!state.ready?`${errors}${button('重新连接','connect','', 'primary')}`:`<div id="dropzone" class="dropzone" aria-label="项目文件夹上传区">${state.busy?`<div class="progress-area" role="status"><p>${esc(state.phase)}</p><progress ${state.phase.startsWith('读取')?`value="${state.read}" max="200"`:''} aria-label="分析进度"></progress><p class="muted">${state.phase.startsWith('读取')?`已读 ${state.read}/200`:'分析中，最多等待 120 秒'}</p>${button('中止','abort','','danger')}</div>`:`<div class="drop-symbol" aria-hidden="true"></div><p>将项目文件夹拖到此处</p><small>读取 Python 源码，由本机服务完成静态分析</small>${button('选择文件夹','choose','','primary')}`}${errors}</div><small>最多 200 个 .py 文件，单文件 1MB，总量 8MB</small>${stats?`<p class="footnote">其他类型文件（未上传）：${stats}</p>`:''}`}${state.result?`<p style="margin-top:16px">${button('查看上一次结果','return-result','','text')}</p>`:''}<div class="import-footer"><span>${state.ready?'<i class="status-dot"></i>本机服务已连接':'等待服务连接'}</span><span class="mono">${esc(state.version)}</span></div></section></main>`;
  }
  function render() {
    const focused=document.activeElement;
    if(state.importing||!state.result){app.className='';app.innerHTML=importView();return;}
    app.className=state.collapsed?'collapsed':'';
    const nav=Object.entries(pages).filter(([k])=>k!=='export').map(([k,v],i)=>`<a class="nav-link ${state.route===k?'active':''}" href="#${k}" aria-label="${v}" ${state.route===k?'aria-current="page"':''}><span class="nav-index">0${i+1}</span><span class="nav-label">${v}</span></a>`).join('');
    const views={overview:overviewView,structure:structureView,logic:logicView,graphs:graphsView,metrics:metricsView,solid:solidView,risks:risksView,export:exportView};
    app.innerHTML=`<aside class="sidebar" aria-label="主导航"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-text">CodeLens</span></div><div class="nav-caption">代码审查工作台</div><nav>${nav}</nav><footer class="sidebar-footer"><small>分析引擎 <span class="mono">${esc(state.result.engine_version)}</span><br>结果仅保留在当前页面</small>${button(state.collapsed?'展开导航':'折叠导航','collapse','','text')}</footer></aside><div class="shell"><header class="topbar"><div><small class="muted">CODELENS / WORKSPACE</small><h1>${pages[state.route]}</h1></div><div class="actions"><span class="project-name mono" title="${esc(state.result.project)}">${esc(state.result.project)}</span>${button('重新导入','reimport')}<details class="dropdown"><summary aria-label="导出报告">导出报告</summary><div class="dropdown-menu">${['md','json','csv'].map(f=>button(f==='md'?'Markdown':f.toUpperCase(),'export',`data-format="${f}"`,'text')).join('')}<a href="#export" aria-label="查看报告预览">查看报告预览</a></div></details></div></header><main id="main" tabindex="-1" class="content">${views[state.route]()}</main></div>${state.drawer?drawerView():''}`;
    if(state.route==='graphs')drawGraph();
    if(state.route==='logic')highlightSource();
    if(focused && focused!==document.body){const keys=['id','data-action','data-id','data-path','data-tab','data-key','data-change'];const identity=keys.filter(k=>focused.hasAttribute(k));if(identity.length){const replacement=$$('button,input,select,a,[role=tab]').find(el=>el.tagName===focused.tagName&&identity.every(k=>el.getAttribute(k)===focused.getAttribute(k)));replacement?.focus({preventScroll:true});}}
  }
  async function connect() {
    state.connecting=true;state.error=[];render();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
    try {const response=await fetch('/api/status',{signal:controller.signal});if(!response.ok)throw Error();const data=await response.json();if(!data.ready||!data.token)throw Error();state.ready=true;state.token=data.token;state.version=data.engine_version;}
    catch {state.ready=false;state.error=['分析服务未连接，请在项目根目录运行 python -B code/backend/server.py'];}
    finally {clearTimeout(timer);state.connecting=false;render();}
  }
  async function entries(entry,prefix='',signal) {
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(entry.isFile){const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));return [{file,path:prefix+entry.name}];}
    if(!entry.isDirectory)return [];
    const reader=entry.createReader();const result=[];
    while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;for(const child of batch)result.push(...await entries(child,prefix+entry.name+'/',signal));}return result;
  }
  async function analyze(input, dropped=false) {
    if(state.busy||!state.ready)return;
    state.busy=true;state.error=[];state.ignored={};state.read=0;state.phase='读取项目文件';state.controller=new AbortController();const controller=state.controller;let timer;let timedOut=false;render();
    try {
      let selected=[];
      if(dropped){for(const item of input){if(item.entry)selected.push(...await entries(item.entry,'',controller.signal));else if(item.file)selected.push({file:item.file,path:item.file.name});}}
      else selected=input.map(file=>({file,path:file.webkitRelativePath||file.name}));
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      const py=[];for(const item of selected){if(/\.py$/i.test(item.path))py.push(item);else {const ext=item.file.name.includes('.')?'.'+item.file.name.split('.').pop().toLowerCase():'无扩展名';state.ignored[ext]=(state.ignored[ext]||0)+1;}}
      const errors=[];
      if(!py.length)errors.push('所选目录没有未被排除的 .py 文件');
      if(py.length>200)errors.push(`共 ${py.length} 个 .py 文件，超过 200 个限制。超出文件：${py.slice(200).map(x=>x.path).join('、')}`);
      for(const x of py)if(x.file.size>1024*1024)errors.push(`${x.path}：单文件 ${(x.file.size/1024/1024).toFixed(2)}MB，超过 1MB`);
      const total=py.reduce((n,x)=>n+x.file.size,0);if(total>8*1024*1024)errors.push(`Python 文件总量 ${(total/1024/1024).toFixed(2)}MB，超过 8MB；请缩小目录范围。`);
      if(errors.length){state.error=errors;return;}
      const roots=new Set(py.map(x=>x.path.includes('/')?x.path.split('/')[0]:''));const root=roots.size===1?[...roots][0]:'';
      const payload={project:root||'所选项目',files:[]};
      for(const x of py){if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');const bytes=new Uint8Array(await x.file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));payload.files.push({path:root?x.path.slice(root.length+1):x.path,content_base64:btoa(binary)});state.read++;render();}
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');state.phase='正在分析项目';render();
      timer=setTimeout(()=>{timedOut=true;controller.abort();},120000);
      const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','X-CodeLens-Token':state.token},body:JSON.stringify(payload),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||`分析请求失败（${response.status}）`);
      if(!result.summary||!Array.isArray(result.files)||!Array.isArray(result.findings))throw Error('分析服务返回的数据格式不完整，请重试。');
      state.result=result;state.importing=false;state.file=result.files[0]?.path||'';state.fn='';state.line=null;state.treeSearch='';state.graph=null;state.drawer=null;state.expanded.clear();state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};go('overview');toast('分析完成','success');
    } catch(error) {state.error=[error.name==='AbortError'?(timedOut?'分析超时，已超过 120 秒。请缩小项目范围后重试。':'已中止分析。'):error instanceof TypeError?'连接中断或分析服务未启动，请在项目根目录运行 python -B code/backend/server.py':error.message||'读取或分析失败，请重试。'];}
    finally {clearTimeout(timer);state.busy=false;state.controller=null;render();}
  }
  function overviewView() {
    const s=state.result.summary||{};const counts=Object.fromEntries(Object.keys(severity).map(k=>[k,findings().filter(f=>f.severity===k).length]));const highest=Object.keys(severity).find(k=>counts[k])||'info';
    const stat=(label,value,desc,route,cls='')=>`<button class="card stat" data-action="go" data-route="${route}" aria-label="${label}，查看${pages[route]}"><span class="muted">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${desc} ▸</span></button>`;
    const stats=`<div class="stats">${stat('已解析文件',val(s.parsed),'查看项目结构','structure')}${stat('函数 / 类总数',s.functions==null||s.classes==null?'—':val(s.functions+s.classes),`${val(s.functions)} 个函数 · ${val(s.classes)} 个类`,'metrics')}${stat('风险条目',val(s.findings),'查看风险证据','risks',highest)}${stat('圈复杂度 · 平均 / 最大',`${val(s.average_cc)} <span class="muted">/</span> ${val(s.max_cc)}`,'查看函数指标','metrics',ccClass(s.max_cc))}</div>`;
    const ratio=Math.min(1,Math.max(0,Number(s.max_cc)/20));const arc=2*Math.PI*72*.75;
    const gauge=s.max_cc==null?placeholder('最大圈复杂度'):`<div class="chart-body"><svg viewBox="0 0 240 200" role="img" aria-label="最大圈复杂度 ${esc(s.max_cc)}，参考阈值 20"><circle cx="120" cy="96" r="72" fill="none" stroke="#eee7db" stroke-width="14" stroke-dasharray="${arc} ${2*Math.PI*72}" transform="rotate(135 120 96)"/><circle cx="120" cy="96" r="72" fill="none" stroke="${s.max_cc>20?colors.critical:s.max_cc>10?colors.warning:'#8b5e34'}" stroke-width="14" stroke-dasharray="${arc*ratio} ${2*Math.PI*72}" transform="rotate(135 120 96)"/><text x="120" y="103" text-anchor="middle" font-size="34" font-family="Consolas,monospace" fill="#292524">${val(s.max_cc)}</text><text x="120" y="128" text-anchor="middle" font-size="11" fill="#78716c">最大圈复杂度</text><text x="120" y="184" text-anchor="middle" font-size="12" fill="#78716c">参考阈值 20 · 超出部分不延长圆弧</text></svg><div><h3>${s.max_cc>20?'超过参考阈值':s.max_cc>10?'超过默认阈值 10':'未超过默认阈值 10'}</h3><p class="muted">基于函数圈复杂度的最大值。<br>此图不代表项目健康度评分。</p>${button('查看函数指标','go','data-route="metrics"','text')}</div></div>`;
    const total=Object.values(counts).reduce((a,b)=>a+b,0);let start=-Math.PI/2;
    const pie=Object.entries(counts).filter(([,n])=>n).map(([key,n])=>{const angle=n/total*Math.PI*2;const end=start+angle;const path=angle>=Math.PI*2-.0001?`<circle cx="100" cy="100" r="76" fill="${colors[key]}"/>`:`<path d="M100 100 L${100+76*Math.cos(start)} ${100+76*Math.sin(start)} A76 76 0 ${angle>Math.PI?1:0} 1 ${100+76*Math.cos(end)} ${100+76*Math.sin(end)} Z" fill="${colors[key]}"/>`;start=end;return path;}).join('');
    const dist=total?`<div class="chart-body"><svg viewBox="0 0 200 200" role="img" aria-label="风险严重度分布">${pie}</svg><div class="legend">${Object.keys(severity).map(k=>`<span><i class="swatch" style="background:${colors[k]}"></i>${severity[k]} <b class="number">${counts[k]}</b></span>`).join('')}</div></div>`:empty('当前分析没有风险条目','go','查看项目结构').replace('data-action="go"','data-action="go" data-route="structure"');
    const top=[...functions()].sort((a,b)=>b.cc-a.cc).slice(0,10);
    return `<p class="page-intro">从结构与复杂度开始，逐项核对分析证据。</p>${stats}<div class="split">${card('复杂度参考',gauge)}${card('风险分布',dist)}</div>${card('Top 10 圈复杂度最高函数',top.length?table(['排名','函数 ID','文件位置','圈复杂度','操作'],top.map((f,i)=>`<tr><td class="number">${i+1}</td><td class="mono">${esc(f.id)}</td><td class="mono">${esc(fileFor(f.id)?.path||'—')}</td><td class="number ${ccClass(f.cc)}">${val(f.cc)}</td><td>${button('查看详情','function',`data-id="${esc(f.id)}"`,'text')}</td></tr>`).join('')):empty('当前结果没有函数数据'),'<a href="#risks" aria-label="查看全部风险">查看全部 ▸</a>')}${arr(state.result.warnings).length?card('分析警告',`<ul class="raw-list">${state.result.warnings.map(w=>`<li><span class="mono">${esc(w.file)}:${val(w.line)}</span> ${esc(w.message)}</li>`).join('')}</ul>`):''}`;
  }
  function treeView() {
    const root={dirs:new Map(),files:[]};
    for(const file of files().filter(f=>f.path.toLowerCase().includes(state.treeSearch.toLowerCase()))){const parts=file.path.split('/');let node=root;for(const part of parts.slice(0,-1)){if(!node.dirs.has(part))node.dirs.set(part,{dirs:new Map(),files:[]});node=node.dirs.get(part);}node.files.push(file);}
    const walk=node=>[...node.dirs.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,child])=>`<details open><summary aria-label="展开或折叠 ${esc(name)}"><span class="mono">${esc(name)}</span></summary>${walk(child)}</details>`).join('')+node.files.map(f=>`<button class="tree-file ${state.file===f.path?'selected':''}" data-action="file" data-path="${esc(f.path)}" aria-label="${esc(f.path)}，${f.status==='error'?'解析失败':'已解析'}" title="${esc(f.path)}"><span class="file-name mono ${f.status==='error'?'critical':''}">${f.status==='error'?'! ':''}${esc(f.path.split('/').pop())}</span><small class="number">${arr(f.functions).length} 函数</small></button>`).join('');
    return `<div class="tree"><label class="muted" for="tree-search">文件筛选</label><input id="tree-search" type="search" placeholder="搜索文件名，回车生效" value="${esc(state.treeSearch)}" aria-label="搜索文件名">${walk(root)||'<p class="muted">没有匹配的文件</p>'}<p class="footnote">类数量：引擎未产出此结果</p></div>`;
  }
  function structureView() {
    const packages=new Map();
    for(const file of files()){const name=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')):'（根目录）';if(!packages.has(name))packages.set(name,{name,files:0,symbols:0,dependencies:0});const row=packages.get(name);row.files++;row.symbols+=arr(file.functions).length;}
    for(const edge of arr(state.result.graph?.dependencies)){const target=moduleFile(edge.target);if(target){const name=target.path.includes('/')?target.path.slice(0,target.path.lastIndexOf('/')):'（根目录）';if(packages.has(name))packages.get(name).dependencies++;}}
    const rows=[...packages.values()].sort((a,b)=>state.packageSort?b.dependencies-a.dependencies:a.name.localeCompare(b.name));
    const selected=files().find(f=>f.path===state.file);const symbols=selected?card(`文件符号 <span class="mono">${esc(selected.path)}</span>`,`${table(['函数 ID','操作'],arr(selected.functions).map(f=>`<tr><td class="mono">${esc(functionId(f))}</td><td>${button('查看逻辑','function',`data-id="${esc(functionId(f))}"`,'text')}</td></tr>`).join(''))}${arr(selected.functions).length?'':'<p class="muted">此文件没有函数定义</p>'}<h3 style="margin-top:16px">类名列表</h3>${placeholder()}<p class="footnote">classes[] 的结构未定义，类清单和类数量暂不展示。</p>`,button('查看文件逻辑','file-logic',`data-path="${esc(selected.path)}"`,'text')):'';
    const errors=[...arr(state.result.errors)];for(const f of files().filter(f=>f.status==='error'))if(!errors.some(e=>e.file===f.path))errors.push({file:f.path,line:typeof f.error==='object'?f.error?.line:null,type:typeof f.error==='object'?f.error?.type:null,message:typeof f.error==='object'?f.error?.message:f.error});
    return `<p class="page-intro">按文件检查分析范围、模块依赖与解析异常。</p><div class="structure-grid">${card('项目文件',treeView())}<div>${card('模块 / 包结构',table(['包路径','文件数','符号数（仅函数）',button('被依赖次数','package-sort','','text')],rows.map(x=>`<tr><td class="mono">${esc(x.name)}</td><td class="number">${x.files}</td><td class="number">${x.symbols}</td><td class="number">${x.dependencies}</td></tr>`).join(''))+'<p class="footnote">被依赖次数按依赖目标所属包聚合；类符号计数：引擎未产出此结果。</p>')}${symbols}${card('解析异常',errors.length?table(['文件路径','错误行号','错误类型','证据等级','说明'],errors.map(e=>`<tr><td class="mono">${esc(e.file)}</td><td class="number">${val(e.line)}</td><td>${val(e.type)}</td><td>${evidence('fact')}</td><td>${val(e.message)}</td></tr>`).join('')):files().length?'<p class="success">全部文件解析成功</p>':empty('当前结果没有文件'))}</div></div>`;
  }
  function tabs(items, active, action) { return `<div class="tabs" role="tablist" aria-label="视图切换">${items.map(([key,label])=>`<button role="tab" aria-selected="${active===key}" aria-label="${label}" data-action="${action}" data-tab="${key}">${label}</button>`).join('')}</div>`; }
  function logicView() {
    let file=files().find(f=>f.path===state.file)||files()[0];if(file)state.file=file.path;
    const ids=new Set(arr(file?.functions).map(functionId));let list=functions().filter(f=>ids.has(f.id));
    if(state.logicSort==='cc')list.sort((a,b)=>b.cc-a.cc);else if(state.logicSort==='length')list.sort((a,b)=>b.length-a.length);else {const order=arr(file?.functions).map(functionId);list.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));}
    let fn=list.find(f=>f.id===state.fn)||list[0];state.fn=fn?.id||'';
    const fnList=`<label class="muted" for="logic-sort">排序</label><select id="logic-sort" data-change="logic-sort" aria-label="函数排序">${[['cc','圈复杂度'],['length','函数长度'],['order','定义顺序']].map(([k,v])=>`<option value="${k}" ${state.logicSort===k?'selected':''}>${v}</option>`).join('')}</select><div class="function-list">${list.map(f=>`<button class="function-item ${f.id===state.fn?'selected':''}" data-action="select-function" data-id="${esc(f.id)}" aria-label="查看函数 ${esc(f.id)}"><span class="mono">${esc(f.id)}</span><span class="tag ${ccClass(f.cc)}">${val(f.cc)}</span></button>`).join('')||'<p class="empty">此文件没有函数定义</p>'}</div>`;
    const trace=fn?table(['行号','AST 类型','语句说明'],arr(fn.statements).map((s,i)=>`<tr class="statement ${state.line?.index===i?'selected':''}" tabindex="0" role="button" aria-label="定位源码第 ${esc(s.line)} 行" data-action="statement" data-index="${i}"><td class="number">${val(s.line)}${s.end_line!==s.line?`–${val(s.end_line)}`:''}</td><td><span class="tag mono">${esc(s.ast_type)}</span></td><td class="mono">${esc(s.description)}</td></tr>`).join('')):'';
    const source=file?.source!=null?`<div class="source" tabindex="0" aria-label="${esc(file.path)} 源码">${file.source.split('\n').map((line,i)=>`<div class="source-line" data-line="${i+1}"><span class="line-number">${i+1}</span><code>${esc(line)||' '}</code></div>`).join('')}</div>`:placeholder();
    const detail=`${fn?`<h2 class="logic-title">${esc(fn.id)}</h2><p class="mono muted">${esc(file.path)}</p><div class="actions"><span class="tag">圈复杂度 <span class="number">${val(fn.cc)}</span></span><span class="tag">函数长度 <span class="number">${val(fn.length)}</span></span>${button('复制 ID','copy-id','','text')}${button('定位风险','file-risks',`data-path="${esc(file.path)}"`,'text')}</div>${tabs([['trace','语句轨迹'],['cfg','控制流图'],['dataflow','数据流'],['exceptions','异常与假设']],state.logicTab,'logic-tab')}<div role="tabpanel">${state.logicTab==='trace'?trace:placeholder()}</div>`:empty('当前文件没有可展示的函数')}<div class="heading" style="margin-top:20px"><h2>源码</h2><small class="mono">${esc(file?.path)}</small></div>${source}`;
    return `<div class="logic-grid">${card('项目文件',treeView())}${card('函数列表',fnList)}<section class="card logic-detail">${detail}</section></div>`;
  }
  function highlightSource() {
    if(!state.line)return;
    $$('.source-line').forEach(el=>el.classList.toggle('highlight',Number(el.dataset.line)>=state.line.start&&Number(el.dataset.line)<=state.line.end));
    const line=$(`.source-line[data-line="${Number(state.line.start)}"]`);if(line){const source=$('.source');source.scrollTop=line.offsetTop-60;}
  }
  function groupedFindings() {const map=new Map();for(const f of findings()){if(!map.has(f.rule_id))map.set(f.rule_id,[]);map.get(f.rule_id).push(f);}return [...map.entries()];}
  function metricsView() {
    let fs=functions();if(state.overOnly)fs=fs.filter(f=>f.cc>10||f.length>50||f.nesting>4);
    const overFiles=new Set(fs.map(f=>fileFor(f.id)?.path));const listed=files().filter(f=>f.status==='ok'&&(!state.overOnly||overFiles.has(f.path)));const max=Math.max(1,...listed.map(f=>Number(f.code_lines)||0));
    const bars=listed.map(f=>`<div class="bar-row"><span class="mono truncate" title="${esc(f.path)}">${esc(f.path)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Number(f.code_lines)||0)/max*100}%"></div><span class="bar-value">${val(f.code_lines)}</span></div></div>`).join('')||empty('当前条件下没有文件','metrics-reset','显示全部');
    fs=[...fs].sort((a,b)=>(Number(a[state.metricSort])-Number(b[state.metricSort]))*(state.metricAsc?1:-1));
    const header=(key,label)=>`<button class="text" data-action="metric-sort" data-key="${key}" aria-label="按${label}排序">${label}${state.metricSort===key?(state.metricAsc?' ▴':' ▾'):''}</button>`;
    const metrics=table(['函数 ID','文件',header('cc','圈复杂度'),header('length','函数长度'),header('nesting','最大 nesting'),'得分'],fs.map(f=>`<tr><td class="mono">${button(f.id,'function',`data-id="${esc(f.id)}"`,'text mono')}</td><td class="mono">${esc(fileFor(f.id)?.path||'—')}</td><td class="number ${f.cc>10?'over':''}">${val(f.cc)}</td><td class="number ${f.length>50?'over':''}">${val(f.length)}</td><td class="number ${f.nesting>4?'over':''}">${val(f.nesting)}</td><td>${placeholder()}</td></tr>`).join(''));
    const groups=groupedFindings().map(([key,hits])=>[key,state.overOnly?hits.filter(f=>typeof f.actual==='number'&&typeof f.threshold==='number'&&f.actual>f.threshold):hits]).filter(([,hits])=>hits.length);
    const summary=table(['规则 ID','命中次数','涉及文件数','最高严重度','位置'],groups.map(([key,hits])=>`<tr><td class="mono">${esc(key)}</td><td class="number">${hits.length}</td><td class="number">${new Set(hits.map(f=>f.file)).size}</td><td>${tag([...hits].sort((a,b)=>weight[b.severity]-weight[a.severity])[0].severity)}</td><td><details><summary aria-label="展开规则 ${esc(key)} 命中位置">展开位置</summary><ul>${hits.map(f=>`<li class="mono">${esc(f.file)}:${val(f.line)}</li>`).join('')}</ul></details></td></tr>`).join(''));
    return `<div class="heading"><p class="muted">依据有效代码行数和函数指标检查复杂区域。</p><label><input type="checkbox" data-change="over-only" ${state.overOnly?'checked':''}> 只看超阈值</label></div>${card('文件有效代码行数',bars+'<p class="footnote">超阈值筛选显示含 cc &gt; 10、length &gt; 50 或 nesting &gt; 4 函数的文件；文件行数未设阈值。</p>')}<section class="card">${tabs([['functions','函数级指标'],['classes','类级指标']],state.metricsTab,'metrics-tab')}${state.metricsTab==='classes'?placeholder('类级指标 WMC / DIT / CBO / LCOM'):fs.length?metrics:empty('当前条件下没有函数','metrics-reset','显示全部')}<p class="footnote">红色数值 = 超出默认阈值，阈值可在配置中调整</p></section>${card('规则命中汇总',groups.length?summary:'<p class="muted">当前条件下没有规则命中</p>')}`;
  }
  function findingDetail(f,solid=false) {
    return `<div class="detail-grid"><div><h3>实际值 vs 阈值</h3><dl><dt>实际值</dt><dd class="mono">${val(f.actual)}</dd><dt>阈值</dt><dd class="mono">${val(f.threshold)}</dd><dt>置信度</dt><dd class="mono">${f.confidence==null?'—':val(f.confidence)}</dd></dl></div><div><h3>详细信息</h3><p>${esc(f.message)}</p><h3>人工复核建议</h3><p>${val(f.suggestion)}</p>${solid?button('定位风险','finding-risk',`data-id="${esc(f.id)}"`,'text'):button('定位代码','locate-code',`data-id="${esc(f.id)}"`,'text')}</div></div>`;
  }
  function solidView() {
    const executed=rules().filter(r=>/(?:SRP|OCP|DIP)/i.test(r));const hits=findings().filter(f=>executed.includes(f.rule_id));
    if(!executed.length)return '<div class="notice">SOLID 判定基于启发式规则，结论为推断，需人工确认</div>'+card('设计检查','<div class="empty">未执行 SOLID 检查</div>');
    const cards=executed.map(id=>{const n=hits.filter(f=>f.rule_id===id).length;return `<section class="card"><h3 class="mono">${esc(id)}</h3>${n?`<span class="tag warning">命中 ${n}</span>`:'<span class="success">通过</span>'}</section>`;}).join('');
    const missing=['SRP','OCP','DIP'].filter(p=>!executed.some(r=>r.toUpperCase().includes(p)));
    return `<div class="notice">SOLID 判定基于启发式规则，结论为推断，需人工确认</div><div class="rule-cards">${cards}</div>${missing.length?`<p class="muted">${missing.map(x=>`${x}：未执行`).join(' · ')}</p>`:''}${card('设计规则命中',hits.length?table(['规则 ID','位置','严重度','证据等级','描述','操作'],hits.map(f=>`<tr><td class="mono">${esc(f.rule_id)}</td><td class="mono">${esc(f.file)}:${val(f.line)}</td><td>${tag(f.severity)}</td><td>${evidence(f.evidence_type)}</td><td>${esc(f.message)}</td><td>${button(state.expanded.has(f.id)?'收起':'详情','expand-finding',`data-id="${esc(f.id)}" aria-expanded="${state.expanded.has(f.id)}"`,'text')}</td></tr>${state.expanded.has(f.id)?`<tr class="detail-row"><td colspan="6">${findingDetail(f,true)}</td></tr>`:''}`).join('')):'<p class="success">已执行的设计规则没有命中条目</p>')}`;
  }
  function filteredRisks() {
    const r=state.risk;return findings().filter(f=>(!r.severities.length||r.severities.includes(f.severity))&&(!r.evidence||f.evidence_type===r.evidence)&&(!r.rule||f.rule_id===r.rule)&&(!r.file||f.file===r.file)&&(!r.query||`${f.message} ${f.file}`.toLowerCase().includes(r.query.toLowerCase()))).sort((a,b)=>(weight[b.severity]||0)-(weight[a.severity]||0));
  }
  function risksView() {
    const r=state.risk;const list=filteredRisks();const pagesCount=Math.max(1,Math.ceil(list.length/10));r.page=Math.min(r.page,pagesCount);const visible=list.slice((r.page-1)*10,r.page*10);
    const options=(items,selected)=>'<option value="">全部</option>'+items.map(([value,label])=>`<option value="${esc(value)}" ${selected===value?'selected':''}>${esc(label)}</option>`).join('');
    const filters=`<div class="filters"><details class="dropdown"><summary aria-label="严重度多选">严重度${r.severities.length?' · '+r.severities.map(x=>severity[x]).join('/'):' · 全部'}</summary><div class="dropdown-menu">${Object.keys(severity).map(k=>`<label><input type="checkbox" data-change="risk-severity" value="${k}" ${r.severities.includes(k)?'checked':''}> ${severity[k]}</label>`).join('')}</div></details><label>证据等级<select data-change="risk-evidence" aria-label="筛选证据等级">${options([['fact','事实'],['inference','推断']],r.evidence)}</select></label><label>规则类型<select data-change="risk-rule" aria-label="筛选规则类型">${options(rules().map(x=>[x,x]),r.rule)}</select></label><label>文件<select data-change="risk-file" aria-label="筛选文件">${options(files().map(x=>[x.path,x.path]),r.file)}</select></label><label>关键字<input id="risk-query" type="search" placeholder="搜索描述或文件路径" value="${esc(r.query)}" aria-label="搜索描述或文件路径"></label>${button('重置','risk-reset','','text')}<div class="filter-stats">${Object.keys(severity).map(k=>`<span class="tag ${k}">${severity[k]} ${list.filter(f=>f.severity===k).length}</span>`).join('')}</div></div>`;
    const body=visible.map(f=>`<tr id="finding-${findings().indexOf(f)}"><td><span class="tag mono">${esc(f.rule_id)}</span></td><td>${tag(f.severity)}</td><td>${evidence(f.evidence_type)}</td><td class="mono truncate" title="${esc(f.file)}:${val(f.line)}">${esc(f.file)}:${val(f.line)}</td><td>${esc(f.message)}</td><td class="number">${f.evidence_type==='inference'&&f.confidence!=null?`${Number.isFinite(Number(f.confidence))?Math.round(Number(f.confidence)*100):'—'}%`:'—'}</td><td>${button(state.expanded.has(f.id)?'收起':'详情','expand-finding',`data-id="${esc(f.id)}" aria-expanded="${state.expanded.has(f.id)}"`,'text')}</td></tr>${state.expanded.has(f.id)?`<tr class="detail-row"><td colspan="7">${findingDetail(f)}</td></tr>`:''}`).join('');
    return `<div class="heading"><p class="muted">按证据复核风险，推断条目需要人工确认。</p><div class="actions">${button('导出 JSON','export','data-format="json"')}${button('导出 CSV','export','data-format="csv"')}</div></div><section class="card">${filters}${visible.length?table(['规则 ID','严重度','证据等级','位置','描述','置信度','操作'],body):empty('当前筛选条件下没有命中的风险条目','risk-reset','重置筛选')}<div class="pagination"><span class="muted">共 <span class="number">${list.length}</span> 条 · 每页 10 条</span>${button('上一页','risk-page',`data-page="${r.page-1}" ${r.page<=1?'disabled':''}`)}<span class="number">${r.page} / ${pagesCount}</span>${button('下一页','risk-page',`data-page="${r.page+1}" ${r.page>=pagesCount?'disabled':''}`)}</div></section>`;
  }
  function exportView() {
    return `<div class="notice">报告由当前分析结果生成，未包含引擎未产出的项目</div><div class="split">${card('Markdown 报告预览',`<pre class="report" tabindex="0" aria-label="Markdown 报告预览">${esc(markdown())}</pre>`)}${card('下载报告',[['md','Markdown','项目概览、全部风险、解析错误与分析边界。'],['json','JSON','完整分析结果，保留 API 返回的数据和源码。'],['csv','CSV','全部风险条目，包含位置、证据等级与复核建议。']].map(([format,label,description])=>`<div class="export-option">${button('导出 '+label,'export',`data-format="${format}"`,format==='md'?'primary':'')}<p>${description}</p></div>`).join(''))}</div>`;
  }
  function graphData() {return arr(state.result.graph?.[state.graphTab]);}
  function graphLayout() {
    const raw=graphData();const edges=raw.filter(e=>e.source&&e.target&&(state.graphTab!=='calls'||e.status==='resolved')).map(e=>({...e}));
    const names=[...new Set(edges.flatMap(e=>[e.source,e.target]))].sort();const indegree=new Map(names.map(n=>[n,0]));const adjacent=new Map(names.map(n=>[n,[]]));
    for(const e of edges){indegree.set(e.target,indegree.get(e.target)+1);adjacent.get(e.source).push(e.target);}
    const levels=new Map();const queue=names.filter(n=>indegree.get(n)===0);queue.forEach(n=>levels.set(n,0));
    const traverse=()=>{for(let i=0;i<queue.length;i++){const source=queue[i];for(const target of adjacent.get(source)){if(!levels.has(target)){levels.set(target,levels.get(source)+1);queue.push(target);}}}};
    traverse();for(const name of names)if(!levels.has(name)){levels.set(name,0);queue.push(name);traverse();}
    const layers=new Map();for(const name of names){const level=levels.get(name);if(!layers.has(level))layers.set(level,[]);layers.get(level).push(name);}
    const width=Math.max(800,...[...layers.values()].map(xs=>xs.length*160+80));const height=Math.max(400,(Math.max(0,...levels.values())+1)*120+80);
    const nodes=names.map((name,index)=>{const layer=layers.get(levels.get(name));const x=(width-layer.length*160)/2+layer.indexOf(name)*160;return {id:name,index,x,y:50+levels.get(name)*120};});
    const cycles=arr(state.result.graph?.cycles).filter(Array.isArray);return {nodes,edges,cycles,width,height};
  }
  function graphsView() {
    return `<p class="page-intro">仅展示引擎返回的关系；未解析的调用保留在原始数据中。</p><section class="card">${tabs([['inheritance','继承关系图'],['dependencies','模块依赖图'],['calls','函数调用图']],state.graphTab,'graph-tab')}<div class="heading"><span class="muted">拖动节点调整位置；聚焦节点后可用方向键移动</span><div class="actions">${button('导出 SVG','graph-export')}${button('复制图数据','graph-copy')}${button('全屏','graph-fullscreen')}${button('重置布局','graph-reset')}</div></div><div id="graph-host"></div><details style="margin-top:16px"><summary aria-label="展开图例说明">图例说明</summary><p class="footnote">箭头：source → target。实线：依赖、继承或同文件调用；虚线：跨文件调用。红色节点与连线：引擎报告的循环依赖。未解析的调用不绘制目标节点。</p></details></section>${state.graphTab==='inheritance'?card('其他类关系',placeholder('组合 / 关联 / 依赖关系')):''}${card('时序图',placeholder())}`;
  }
  function graphSVG(model) {
    const marker= `arrow-${state.graphTab}`;const positions=new Map(model.nodes.map(n=>[n.id,n]));
    const inCycle=(id)=>state.graphTab==='dependencies'&&model.cycles.some(c=>c.includes(id));
    const paths=model.edges.map((e,i)=>{const a=positions.get(e.source),b=positions.get(e.target);let path;
      if(a===b){path=`M ${a.x+45} ${a.y} C ${a.x+20} ${a.y-38}, ${a.x+130} ${a.y-38}, ${a.x+105} ${a.y}`;}
      else if(Math.abs(b.y-a.y)<40){const top=Math.min(a.y,b.y)-45;path=`M ${a.x+75} ${a.y} C ${a.x+75} ${top}, ${b.x+75} ${top}, ${b.x+75} ${b.y}`;}
      else if(b.y>a.y && b.y-a.y<=150){const mid=(a.y+36+b.y)/2;path=`M ${a.x+75} ${a.y+36} C ${a.x+75} ${mid}, ${b.x+75} ${mid}, ${b.x+75} ${b.y}`;}
      else {const right=model.width+20+(i%6)*8;const exit=a.y+66,entry=b.y-30;path=`M ${a.x+75} ${a.y+36} C ${a.x+75} ${exit}, ${right} ${exit}, ${right} ${exit} C ${right} ${exit}, ${right} ${entry}, ${right} ${entry} C ${right} ${entry}, ${b.x+75} ${entry}, ${b.x+75} ${b.y}`;}
      const cycle=state.graphTab==='dependencies'&&model.cycles.some(c=>c.includes(e.source)&&c.includes(e.target));const sourceFile=nodeFile(e.source)?.path||e.file;const targetFile=nodeFile(e.target)?.path;const cross=state.graphTab==='calls'&&targetFile&&sourceFile!==targetFile;
      return `<path class="graph-edge ${cycle?'cycle':''} ${cross?'cross':''}" d="${path}" marker-end="url(#${marker}${cycle?'-red':''})"><title>${esc(e.source)} → ${esc(e.target)}</title></path>`;
    }).join('');
    return `<svg class="graph-canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.width+80} ${model.height}" width="${model.width+80}" height="${model.height}" role="img" aria-label="${state.graphTab==='inheritance'?'继承关系图':state.graphTab==='calls'?'函数调用图':'模块依赖图'}"><style>.graph-edge{fill:none;stroke:#a8a29e;stroke-width:1.5}.graph-edge.cycle{stroke:#b91c1c}.graph-edge.cross{stroke-dasharray:5 4}.graph-node rect{fill:#faf7f2;stroke:#cbbba5}.graph-node.cycle rect{fill:#fef2f2;stroke:#b91c1c}.graph-node text{font:11px Consolas,monospace;fill:#292524}.graph-node:focus rect{stroke:#8b5e34;stroke-width:3}</style><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#a8a29e"/></marker><marker id="${marker}-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#b91c1c"/></marker></defs>${paths}${model.nodes.map(n=>`<g class="graph-node ${inCycle(n.id)?'cycle':''}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="查看节点 ${esc(n.id)}" data-action="graph-node" data-node="${n.index}"><title>${esc(n.id)}</title><rect width="150" height="36" rx="4"/><text x="75" y="23" text-anchor="middle">${esc(n.id.length>19?n.id.slice(0,18)+'…':n.id)}</text></g>`).join('')}</svg>`;
  }
  function drawGraph() {
    if(!state.graph)state.graph=graphLayout();const host=$('#graph-host');if(!host)return;
    host.innerHTML=state.graph.nodes.length?`<div class="graph-stage">${graphSVG(state.graph)}</div>`:empty('没有可绘制的关系数据','graph-raw','查看原始数据');
  }
  function redrawGraphs() { $$('.graph-stage').forEach(stage=>stage.innerHTML=graphSVG(state.graph)); }
  function drawerView() {
    const name=state.drawer;const file=nodeFile(name);const edges=graphData().filter(e=>e.source===name||e.target===name);
    return `<aside class="drawer" role="dialog" aria-modal="false" aria-label="节点详情"><div class="heading"><h2>节点详情</h2>${button('关闭','drawer-close')}</div><h2 class="mono">${esc(name)}</h2><dl><dt class="muted">类型</dt><dd>${state.graphTab==='dependencies'?'模块':state.graphTab==='inheritance'?'类':'调用节点'}</dd><dt class="muted">所在文件</dt><dd class="mono">${esc(file?.path||'引擎未产出此结果')}</dd></dl><h3>关联条目</h3><ul class="raw-list">${edges.map(e=>`<li class="mono">${esc(e.source)} → ${e.target?esc(e.target):esc(e.expression)+'（未解析）'}<br><small>${esc(e.file)}:${val(e.line)}</small></li>`).join('')}</ul>${button('查看逻辑','node-logic',`data-id="${esc(name)}"`,'text')}</aside>`;
  }
  function openNode(index) {
    if(document.querySelector('#detail-dialog').open)document.querySelector('#detail-dialog').close();
    state.drawer=state.graph?.nodes[index]?.id||null;
    $('.drawer')?.remove();if(state.drawer){app.insertAdjacentHTML('beforeend',drawerView());$('.drawer button')?.focus();}
  }
  function openFunction(id) {const file=fileFor(id);state.fn=id;state.file=file?.path||state.file;state.line=null;state.logicTab='trace';go('logic');}
  function locateFinding(id) {
    const f=findings().find(x=>x.id===id);if(!f)return;
    const file=files().find(x=>x.path===f.file);if(!file){toast(`目标位置：${f.file}:${f.line??'—'}，结果中没有对应源码`,'warning');return;}
    const ids=new Set(arr(file.functions).map(functionId));const candidates=functions().filter(fn=>ids.has(fn.id)&&arr(fn.statements).some(s=>s.line<=f.line&&s.end_line>=f.line));
    candidates.sort((a,b)=>a.length-b.length);state.file=file.path;state.fn=candidates[0]?.id||functionId(arr(file.functions)[0])||'';state.line={start:f.line,end:f.line,index:-1};state.logicTab='trace';go('logic');toast(`目标位置：${f.file}:${f.line??'—'}`);
  }
  let suppressClick=false;
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
    const action=target.dataset.action;
    if(action==='graph-node'&&suppressClick){suppressClick=false;return;}
    switch(action){
      case 'choose': $('#folder-input').value='';$('#folder-input').click();break;
      case 'connect': connect();break;
      case 'abort': state.controller?.abort();break;
      case 'return-result': state.controller?.abort();state.importing=false;go(state.route);break;
      case 'reimport': $('#confirm-dialog').showModal();break;
      case 'confirm-import': $('#confirm-dialog').close();state.importing=true;state.error=[];state.ignored={};render();connect();break;
      case 'close-dialog': target.closest('dialog')?.close();break;
      case 'collapse': state.collapsed=!state.collapsed;render();break;
      case 'go': go(target.dataset.route||'overview');break;
      case 'export': exportReport(target.dataset.format);break;
      case 'function': openFunction(target.dataset.id);break;
      case 'select-function': state.fn=target.dataset.id;state.line=null;render();break;
      case 'file': state.file=target.dataset.path;state.fn='';state.line=null;render();break;
      case 'file-logic': state.file=target.dataset.path;state.fn='';state.line=null;go('logic');break;
      case 'package-sort': state.packageSort=!state.packageSort;render();break;
      case 'logic-tab': state.logicTab=target.dataset.tab;render();break;
      case 'metrics-tab': state.metricsTab=target.dataset.tab;render();break;
      case 'copy-id': copy(state.fn);break;
      case 'statement': {const f=functions().find(x=>x.id===state.fn);const s=arr(f?.statements)[Number(target.dataset.index)];if(s){state.line={start:s.line,end:s.end_line??s.line,index:Number(target.dataset.index)};$$('.statement').forEach(el=>el.classList.toggle('selected',el===target));highlightSource();}break;}
      case 'file-risks': state.risk={severities:[],evidence:'',rule:'',file:target.dataset.path,query:'',page:1};go('risks');break;
      case 'expand-finding': state.expanded.has(target.dataset.id)?state.expanded.delete(target.dataset.id):state.expanded.add(target.dataset.id);render();break;
      case 'finding-risk': {state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};const index=filteredRisks().findIndex(f=>f.id===target.dataset.id);state.risk.page=Math.floor(Math.max(0,index)/10)+1;state.expanded.add(target.dataset.id);go('risks');break;}
      case 'locate-code': locateFinding(target.dataset.id);break;
      case 'risk-reset': state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};render();break;
      case 'risk-page': state.risk.page=Number(target.dataset.page);render();break;
      case 'metric-sort': state.metricAsc=state.metricSort===target.dataset.key?!state.metricAsc:false;state.metricSort=target.dataset.key;render();break;
      case 'metrics-reset': state.overOnly=false;render();break;
      case 'graph-tab': state.graphTab=target.dataset.tab;state.graph=null;state.drawer=null;render();break;
      case 'graph-reset': state.graph=graphLayout();redrawGraphs();break;
      case 'graph-raw': modal('原始图数据',`<pre tabindex="0">${esc(JSON.stringify(graphData(),null,2))}</pre>`);break;
      case 'graph-copy': copy(JSON.stringify(graphData(),null,2));break;
      case 'graph-export': {const svg=$('#graph-host svg');if(svg)download(new XMLSerializer().serializeToString(svg),'image/svg+xml;charset=utf-8','svg');else toast('没有可导出的关系图','warning');break;}
      case 'graph-fullscreen': if(state.graph?.nodes.length)modal('结构视图',`<div class="graph-stage">${graphSVG(state.graph)}</div>`);else toast('没有可放大的关系图','warning');break;
      case 'graph-node': openNode(Number(target.dataset.node));break;
      case 'drawer-close': state.drawer=null;$('.drawer')?.remove();$('.graph-node')?.focus();break;
      case 'node-logic': {const file=nodeFile(target.dataset.id);if(!file){toast('结果中没有对应文件，无法定位逻辑','warning');break;}$('#detail-dialog').close();state.file=file.path;state.fn=functions().some(f=>f.id===target.dataset.id)?target.dataset.id:'';state.line=null;state.drawer=null;go('logic');break;}
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;if(el.id==='folder-input'){analyze([...el.files]);return;}
    const key=el.dataset.change;if(!key)return;
    if(key==='logic-sort')state.logicSort=el.value;
    else if(key==='over-only')state.overOnly=el.checked;
    else if(key==='risk-severity'){state.risk.severities=el.checked?[...state.risk.severities,el.value]:state.risk.severities.filter(x=>x!==el.value);state.risk.page=1;}
    else if(key.startsWith('risk-')){state.risk[key.slice(5)]=el.value;state.risk.page=1;}
    render();
    if(key==='risk-severity'){const details=$('.filters details');if(details){details.open=true;$(`input[value="${el.value}"]`,details)?.focus();}}
  });
  document.addEventListener('input',event=>{if(event.target.id==='risk-query'){const el=event.target;const start=el.selectionStart;state.risk.query=el.value;state.risk.page=1;render();const next=$('#risk-query');next.focus();next.setSelectionRange(start,start);}});
  document.addEventListener('keydown',event=>{
    if(event.target.id==='tree-search'&&(event.key==='Enter'||event.key==='Escape')){event.preventDefault();state.treeSearch=event.key==='Escape'?'':event.target.value;render();$('#tree-search')?.focus();return;}
    const node=event.target.closest('.graph-node');
    if(node&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const n=state.graph.nodes[Number(node.dataset.node)];n.x=Math.max(5,Math.min(state.graph.width-150,n.x+(event.key==='ArrowLeft'?-10:event.key==='ArrowRight'?10:0)));n.y=Math.max(5,Math.min(state.graph.height-36,n.y+(event.key==='ArrowUp'?-10:event.key==='ArrowDown'?10:0)));redrawGraphs();$(`.graph-node[data-node="${n.index}"]`)?.focus();return;}
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"]:not(button),a')){if(event.target.matches('a')&&event.key==='Enter')return;event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
    if(event.key==='Escape'&&state.drawer){state.drawer=null;$('.drawer')?.remove();$('.graph-node')?.focus();}
    if(event.target.getAttribute('role')==='tab'&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const list=$$('button',event.target.parentElement);let index=list.indexOf(event.target);index=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowRight'?1:-1)+list.length)%list.length;const key=list[index].dataset.tab;list[index].click();$(`[role="tab"][data-tab="${key}"]`)?.focus();}
  });
  let drag=null;
  document.addEventListener('pointerdown',event=>{const el=event.target.closest('.graph-node');if(!el||event.button!==0)return;const svg=el.closest('svg');const n=state.graph.nodes[Number(el.dataset.node)];const box=svg.getBoundingClientRect();drag={index:n.index,x:n.x,y:n.y,clientX:event.clientX,clientY:event.clientY,scale:svg.viewBox.baseVal.width/box.width,moved:false};});
  document.addEventListener('pointermove',event=>{if(!drag)return;const dx=(event.clientX-drag.clientX)*drag.scale,dy=(event.clientY-drag.clientY)*drag.scale;if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;if(!drag.moved)return;const n=state.graph.nodes[drag.index];n.x=Math.max(5,Math.min(state.graph.width-150,drag.x+dx));n.y=Math.max(5,Math.min(state.graph.height-36,drag.y+dy));redrawGraphs();});
  document.addEventListener('pointerup',()=>{if(drag?.moved){suppressClick=true;setTimeout(()=>suppressClick=false,100);}drag=null;});
  document.addEventListener('pointercancel',()=>drag=null);
  let dragDepth=0;
  document.addEventListener('dragenter',event=>{if(!state.importing)return;event.preventDefault();if(event.target.closest('#dropzone')){dragDepth++;$('#dropzone')?.classList.add('dragging');}});
  document.addEventListener('dragover',event=>{if(state.importing){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=state.busy?'none':'copy';}});
  document.addEventListener('dragleave',event=>{if(event.target.closest('#dropzone')){dragDepth--;if(dragDepth<=0)$('#dropzone')?.classList.remove('dragging');}});
  document.addEventListener('drop',event=>{
    event.preventDefault();dragDepth=0;$('#dropzone')?.classList.remove('dragging');if(!state.importing||!event.target.closest('#dropzone')||state.busy)return;
    const items=[...event.dataTransfer.items].filter(i=>i.kind==='file').map(item=>({entry:item.webkitGetAsEntry?.(),file:item.getAsFile()}));
    if(!items.length)items.push(...[...event.dataTransfer.files].map(file=>({file})));analyze(items,true);
  });
  window.addEventListener('hashchange',route);
  route();connect();
})();

