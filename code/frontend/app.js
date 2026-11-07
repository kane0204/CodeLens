export function mountLegacyWorkbench() {
  'use strict';
  if (globalThis.__CODELENS_WORKBENCH_MOUNTED__) {
    return () => {};
  }
  globalThis.__CODELENS_WORKBENCH_MOUNTED__ = true;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val = value => value == null ? '—' : esc(value);
  const arr = value => Array.isArray(value) ? value : [];
  const pages = {overview:'总览',structure:'项目结构',logic:'逻辑说明',graphs:'关系图谱',metrics:'质量体检',solid:'设计检查',risks:'风险清单'};
  const sourceExtensions=new Set(['.py','.c','.h','.cc','.cpp','.cxx','.hpp','.hh','.java','.cs','.kt','.kts','.js','.jsx','.ts','.tsx','.go','.rs','.rb','.php','.swift','.scala','.vue']);
  const ruleNames={'CC-01':'圈复杂度','LEN-01':'函数长度','DEPTH-01':'嵌套深度','A4':'硬编码密钥','A3-IO':'边界输入','CYCLE-01':'循环依赖','SRP-01':'单一职责','OCP-01':'开闭原则','LSP-01':'里氏替换','ISP-01':'接口隔离','DIP-01':'依赖倒置','A5-DEAD':'死代码','A8-DEFENSIVE':'过度防御','DUP-01':'结构重复','LANG-CC':'复杂度热点','EXC-01':'未处理异常','VAL-01':'假设未校验','CMT-01':'注释与实现不一致','DEP-01':'可疑依赖调用'};
  const ruleLabel=id=>Object.hasOwn(ruleNames,id)?ruleNames[id]:id;
  const specialRiskDefs=[
    ['suspicious-dependency','可疑依赖调用','无法确认目标或属于高风险系统 API 的调用。'],
    ['duplicate-implementation','重复实现','不同位置存在相同或高度相似的实现。'],
    ['unhandled-exception','未处理异常','I/O、外部调用或空异常分支缺少可恢复处理。'],
    ['hardcoded-secret','硬编码敏感信息','敏感字段直接使用字面量赋值。'],
    ['dead-code','死代码','当前分析范围内没有发现其他引用。'],
    ['unchecked-assumption','假设未校验','参数、下标或返回值被直接使用，但缺少显式校验。'],
    ['comment-mismatch','注释与实现不一致','未完成、临时或占位注释可能与当前实现冲突。'],
    ['excessive-defense','过度防御','异常被静默忽略，或防御代码没有提供有效恢复。']
  ];
  const severity = {critical:'高',warning:'中',info:'低'};
  const weight = {critical:3,warning:2,info:1};
  const colors = {critical:'#b91c1c',warning:'#c2410c',info:'#a8a29e'};
  const state = {result:null,ready:false,connecting:true,token:'',version:'',aiCompatible:false,exportAi:true,exportSource:false,importing:true,busy:false,phase:'',read:0,error:[],ignored:{},route:'overview',file:'',fn:'',treeSearch:'',logicSort:'cc',logicTab:'trace',line:null,graphTab:'calls',graph:null,drawer:null,graphEntry:'',chainEntry:'',graphLayoutMode:'layered',graphGranularity:'function',graphDirection:'TD',graphQuery:'',graphVisible:null,barsExpanded:false,metricSort:'cc',metricAsc:false,overOnly:false,packageSort:false,expanded:new Set(),risk:{severities:[],evidence:'',rule:'',file:'',query:'',page:1},controller:null};
  const app = $('#app');
  const placeholder = label => `<div class="placeholder">${label ? `<div>${esc(label)}</div>` : ''}引擎未产出此结果</div>`;
  const button = (label, action, data = '', cls = '') => `<button class="${cls}" data-action="${action}" ${data} aria-label="${esc(label)}">${esc(label)}</button>`;
  const empty = (text, action='reimport', label='重新导入') => `<div class="empty"><p>${esc(text)}</p>${button(label,action)}</div>`;
  const tag = level => `<span class="tag ${Object.hasOwn(severity,level)?level:'info'}">${esc(severity[level] || '未知')}</span>`;
  const evidence = value => `<span class="tag ${value==='inference'?'inference':''}">${value==='fact'?'事实':value==='inference'?'推断':'—'}</span>`;
  const ccClass = cc => cc>20?'critical':cc>10?'warning':'';
  const table = (headers, body) => `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  const card = (title, body, action='') => `<section class="card"><div class="heading"><h2>${title}</h2>${action}</div>${body}</section>`;
  // 得分与体检结论都来自后端的确定性计算（health.py），前端只负责展示，不重新计算。
  function healthCard() {
    const h=state.result?.health;
    if(!h||h.available===false)return card('质量体检结论',`<div class="empty"><p>${esc(h?.reason||'引擎未产出体检结论')}</p></div>`);
    const counts=h.distribution||{};
    const rows=[['优秀',counts.excellent],['良好',counts.good],['一般',counts.fair],['需关注',counts.poor]];
    return card('质量体检结论',`<div class="split"><div><p class="muted">项目平均分</p><p class="score-big">${val(h.score)}<small> ${val(h.grade)}</small></p></div><div>${table(['等级','函数数'],rows.map(([label,n])=>`<tr><td>${label}</td><td class="number">${val(n)}</td></tr>`).join(''))}</div></div>`,'<a href="#risks" aria-label="查看风险清单">查看风险清单 ▸</a>');
  }
  function healthStat() {
    const h=state.result?.health;
    return `<section class="card stat health-stat"><span class="muted">健康度总分</span><strong>${val(h?.score)}</strong><span class="muted">${val(h?.grade)}</span><div class="health-help"><button class="help-button" data-action="health-help" aria-label="显示健康度计算公式" aria-expanded="false" aria-controls="health-explanation">?</button><div id="health-explanation" class="health-popover" role="tooltip" hidden><code>${val(h?.formula)}</code></div></div></section>`;
  }
  function showHealthHelp(open,event) {
    const popup=$('#health-explanation'),button=$('[data-action="health-help"]');if(!popup||!button)return;
    button.setAttribute('aria-expanded',String(open));
    if(!open){popup.hidden=true;return;}
    popup.hidden=false;
    const anchor=button.getBoundingClientRect(),box=popup.getBoundingClientRect();
    const pointerX=event?.clientX||anchor.right,pointerY=event?.clientY||anchor.bottom;
    const x=Math.max(8,Math.min(pointerX+12,innerWidth-box.width-8));
    const y=Math.max(8,Math.min(pointerY+12,innerHeight-box.height-8));
    popup.style.left=`${x}px`;popup.style.top=`${y}px`;
  }
  const functions = () => arr(state.result?.functions);
  const classes = () => arr(state.result?.classes);
  const files = () => arr(state.result?.files);
  const findings = () => arr(state.result?.findings);
  const rules = () => arr(state.result?.config?.rules);
  const functionId = f => typeof f==='string'?f:f?.id;
  const fileFor = id => files().find(f=>arr(f.functions).some(fn=>functionId(fn)===id));
  const moduleName = path => String(path).replace(/\.py$/i,'').replace(/\/__init__$/,'').replaceAll('/','.');
  const fileLanguage = file => file?.language || (/\.py$/i.test(file?.path||'')?'Python':'源码');
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
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.setAttribute('aria-label','下载分析报告');a.download=`codelens-${extension==='svg'?'graph':'report'}.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已生成下载文件','success');
  }
  function reportData() {
    const r=state.result;
    return {...r,files:files().map(f=>{const copy={...f};if(!state.exportSource)delete copy.source;return copy;}),ai_explanations:state.exportAi?[...aiLogic.cache.values()]:[]};
  }
  function reportAppendix(safe) {
    const r=state.result;
    const health=r.health;
    const special=arr(r.special_risks?.categories).map(category=>`### ${safe(category.label)}\n\n${safe(category.description)}\n\n${arr(category.items).map(item=>`- ${safe(item.file)}:${item.line??'—'} ${safe(item.message)}`).join('\n')||'未发现。'}`).join('\n\n')||'无';
    return `\n\n## 代码专项评估\n\n${special}\n\n## 健康度\n\n${health?`${safe(health.score)} · ${safe(health.grade)}\n\n${safe(health.formula)}`:'无'}\n\n## 类级指标\n\n${arr(r.class_metrics).map(c=>`- ${safe(c.id)}：WMC=${c.wmc} DIT=${c.dit??'未知'} CBO=${c.cbo} LCOM1=${c.lcom}`).join('\n')||'无'}\n\n## 结构重复\n\n${arr(r.duplicates).map(g=>'- '+g.occurrences.map(o=>`${safe(o.file)}:${o.line}`).join(' / ')).join('\n')||'无'}\n\n## 类关系\n\n${arr(r.graph?.class_relations).map(e=>`- ${safe(e.source)} → ${safe(e.target)}：${safe(e.kind)}（${safe(e.file)}:${e.line}）`).join('\n')||'无'}\n\n## AI 逻辑解读\n\n${state.exportAi?[...aiLogic.cache.values()].map(a=>`### ${safe(a.function||a.file)}\n\n模型：${safe(a.model)}；AI 生成内容，需人工复核。\n\n范围：${arr(a.context).map(c=>`${safe(c.file)}:${c.line}-${c.end_line}`).join('、')}\n\n${String(a.text).split('\n').map(safe).join('\n')}\n`).join('\n')||'本次尚未生成 AI 解读。':'用户选择不包含 AI 解读。'}\n`;
  }
  function markdown() {
    const r=state.result,s=r.summary||{};
    const names={files:'文件数',parsed:'已解析',failed:'解析失败',excluded:'已排除',functions:'函数数',classes:'类数',code_lines:'代码行数',findings:'风险条目',average_cc:'平均圈复杂度',max_cc:'最大圈复杂度'};
    const safe=v=>String(v??'—').replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replaceAll('\n',' ');
    return `# CodeLens 分析报告\n\n## 项目概览\n\n项目：${safe(r.project)}\n\n引擎版本：${safe(r.engine_version)}\n\n${Object.entries(names).map(([k,n])=>`- ${n}：${s[k]??'—'}`).join('\n')}\n\n## 风险清单\n\n${findings().map(f=>`### ${safe(f.rule_id)} · ${severity[f.severity]||'—'}\n\n- 位置：${safe(f.file)}:${f.line??'—'}\n- 证据等级：${f.evidence_type==='fact'?'事实':'推断'}\n- 实际值 / 阈值：${safe(f.actual)} / ${safe(f.threshold)}\n- 置信度：${f.confidence??'—'}\n\n${safe(f.message)}\n\n复核建议：${safe(f.suggestion)}\n`).join('\n')||'没有风险条目。'}\n\n## 分析边界 / 未执行项\n\n${arr(r.limitations).map(x=>`- ${safe(x)}`).join('\n')||'引擎未提供分析边界说明。'}\n\n## SOLID 分析边界\n\n${arr(r.solid?.limitations).map(x=>`- ${safe(x)}`).join('\n')}\n\n${arr(r.solid?.coverage_gaps).map(x=>`- ${safe(x.class)}（${safe(x.file)}:${x.line}）：${safe(x.reason)}`).join('\n')}\n\n## 解析错误\n\n${arr(r.errors).map(x=>`- ${safe(x.file)}:${x.line??'—'} ${safe(x.message)}`).join('\n')||'无'}\n\n## 警告\n\n${arr(r.warnings).map(x=>`- ${safe(x.file)}:${x.line??'—'} ${safe(x.message)}`).join('\n')||'无'}\n${reportAppendix(safe)}`;
  }
  function csv() {
    const keys=['id','rule_id','severity','evidence_type','file','line','message','suggestion','actual','threshold','confidence'];
    const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    return '\uFEFF'+[keys,...findings().map(f=>keys.map(k=>f[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function exportReport(format) {
    if(!state.result)return;
    if(format==='json')download(JSON.stringify(reportData(),null,2),'application/json;charset=utf-8','json');
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
    return `<main id="main" tabindex="-1" aria-label="主要内容" class="import-page"><section class="import-card"><div class="import-settings">${settingsButton()}</div><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>CodeLens</span></div><h1>CodeLens 代码分析</h1><p class="muted">读取 Python、C/C++、Java、JavaScript、TypeScript、C#、Go、Rust 等常用源码。</p>${state.connecting?'<p role="status">正在连接分析服务…</p><div class="skeleton"></div>':!state.ready?`${errors}${button('重新连接','connect','', 'primary')}`:`<div id="dropzone" class="dropzone" aria-label="项目文件夹上传区">${state.busy?`<div class="progress-area" role="status"><p>${esc(state.phase)}</p><progress ${state.phase.startsWith('读取')?`value="${state.read}" max="200"`:''} aria-label="分析进度"></progress><p class="muted">${state.phase.startsWith('读取')?`已读 ${state.read}/200`:'分析中，最多等待 120 秒'}</p>${button('中止','abort','','danger')}</div>`:`<div class="drop-symbol" aria-hidden="true"></div><p>将项目文件夹拖到此处</p><small>源码只在本机服务内读取，不执行</small>${button('选择文件夹','choose','','primary')}`}${errors}</div><small>最多 200 个源码文件，单文件 1MB，总量 8MB</small>${stats?`<p class="footnote">未分析文件：${stats}</p>`:''}`}${state.result?`<p style="margin-top:16px">${button('查看上一次结果','return-result','','text')}</p>`:''}<div class="import-footer"><span>${state.ready?'<i class="status-dot"></i>本机服务已连接':'等待服务连接'}</span><span class="mono">${esc(state.version)}</span></div></section></main>`;
  }
  function render() {
    const focused=document.activeElement;
    if(state.importing||!state.result){app.className='';app.innerHTML=importView();return;}
    app.className='';
    const navLinks=Object.entries(pages).map(([key,label],index)=>`<a class="workspace-link nav-item-${index} ${state.route===key?'active':''}" href="#${key}" aria-label="${label}" ${state.route===key?'aria-current="page"':''}>${label}</a>`).join('');
    const views={overview:overviewView,structure:structureView,logic:logicView,graphs:graphsView,metrics:metricsView,solid:solidView,risks:risksView};
    const exportMenu=`<details class="dropdown export-dropdown"><summary aria-label="导出报告">导出报告</summary><div class="dropdown-menu"><label><input type="checkbox" data-change="export-ai" ${state.exportAi?'checked':''}> 包含 AI 解读</label><label><input type="checkbox" data-change="export-source" ${state.exportSource?'checked':''}> JSON 包含源码</label>${['md','json','csv'].map(f=>button(f==='md'?'Markdown':f.toUpperCase(),'export',`data-format="${f}"`,'text')).join('')}</div></details>`;
    app.innerHTML=`<div class="workspace-shell"><header class="topbar"><div class="workspace-brand"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>CodeLens</span></div><h1>${pages[state.route]}</h1></div><div class="actions">${settingsButton()}<span class="project-name mono" title="${esc(state.result.project)}">${esc(state.result.project)}</span>${button('重新导入','reimport')}${exportMenu}</div></header><nav class="workspace-nav" aria-label="主导航"><div class="nav-visible">${navLinks}</div><details class="nav-more dropdown"><summary aria-label="更多导航页面">更多</summary><div class="dropdown-menu">${navLinks}</div></details></nav><main id="main" tabindex="-1" aria-label="主要内容" class="content" data-route="${state.route}">${views[state.route]()}</main></div>${state.drawer?drawerView():''}`;
    if(state.route==='graphs')drawGraph();
    if(state.route==='logic')highlightSource();
    if(focused && focused!==document.body){const keys=['id','data-action','data-id','data-path','data-tab','data-key','data-change'];const identity=keys.filter(k=>focused.hasAttribute(k));if(identity.length){const replacement=$$('button,input,select,a,[role=tab]').find(el=>el.tagName===focused.tagName&&identity.every(k=>el.getAttribute(k)===focused.getAttribute(k)));replacement?.focus({preventScroll:true});}}
  }
  async function connect() {
    state.connecting=true;state.error=[];render();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
    try {const response=await fetch('/api/status',{signal:controller.signal});if(!response.ok)throw Error();const data=await response.json();if(!data.ready||!data.token)throw Error();state.ready=true;state.token=data.token;state.version=data.engine_version;state.aiCompatible=data.api_revision>=2&&arr(data.capabilities).includes('explain-context');}
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
      const excluded=new Set(['.git','.venv','venv','__pycache__','node_modules','build','dist','tests']);selected=selected.filter(x=>!x.path.replaceAll('\\','/').split('/').slice(0,-1).some(part=>excluded.has(part)));
      const sources=[];for(const item of selected){const match=item.file.name.match(/(\.[^.]+)$/);const ext=match?match[1].toLowerCase():'无扩展名';if(sourceExtensions.has(ext))sources.push(item);else state.ignored[ext]=(state.ignored[ext]||0)+1;}
      const errors=[];
      if(!sources.length)errors.push('所选目录没有可分析的源码文件');
      if(sources.length>200)errors.push(`共 ${sources.length} 个源码文件，超过 200 个限制。超出文件：${sources.slice(200).map(x=>x.path).join('、')}`);
      for(const x of sources)if(x.file.size>1024*1024)errors.push(`${x.path}：单文件 ${(x.file.size/1024/1024).toFixed(2)}MB，超过 1MB`);
      const total=sources.reduce((n,x)=>n+x.file.size,0);if(total>8*1024*1024)errors.push(`源码总量 ${(total/1024/1024).toFixed(2)}MB，超过 8MB；请缩小目录范围。`);
      if(errors.length){state.error=errors;return;}
      const roots=new Set(sources.map(x=>x.path.includes('/')?x.path.split('/')[0]:''));const root=roots.size===1?[...roots][0]:'';
      const payload={project:root||'所选项目',files:[]};
      for(const x of sources){if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');const bytes=new Uint8Array(await x.file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));payload.files.push({path:root?x.path.slice(root.length+1):x.path,content_base64:btoa(binary)});state.read++;render();}
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');state.phase='正在分析项目';render();
      timer=setTimeout(()=>{timedOut=true;controller.abort();},120000);
      const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','X-CodeLens-Token':state.token},body:JSON.stringify(payload),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||`分析请求失败（${response.status}）`);
      if(!result.summary||!Array.isArray(result.files)||!Array.isArray(result.findings))throw Error('分析服务返回的数据格式不完整，请重试。');
      resetAiLogic();state.result=result;state.importing=false;state.file=result.files[0]?.path||'';state.fn='';state.line=null;state.treeSearch='';state.graph=null;state.graphVisible=null;state.graphEntry='';state.chainEntry='';state.graphQuery='';state.barsExpanded=false;state.drawer=null;state.expanded.clear();state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};go('overview');toast('分析完成','success');
    } catch(error) {state.error=[error.name==='AbortError'?(timedOut?'分析超时，已超过 120 秒。请缩小项目范围后重试。':'已中止分析。'):error instanceof TypeError?'连接中断或分析服务未启动，请在项目根目录运行 python -B code/backend/server.py':error.message||'读取或分析失败，请重试。'];}
    finally {clearTimeout(timer);state.busy=false;state.controller=null;render();}
  }
  // Provider preferences are independent of analysis results. Secrets never enter storage or exports.
  const SETTINGS_KEY='codelens.llm.preferences.v1';
  let llmSettings={baseUrl:'',model:'',apiKey:''};
  try {
    const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
    if(saved && typeof saved==='object'){
      llmSettings.baseUrl=typeof saved.baseUrl==='string'?saved.baseUrl:'';
      llmSettings.model=typeof saved.model==='string'?saved.model:'';
    }
  } catch { /* Browser storage may be disabled; in-memory settings remain available. */ }
  function settingsButton() {
    return '<button type="button" class="settings-button" data-action="settings-open" aria-label="打开设置" title="设置"><span class="settings-gear" aria-hidden="true"></span></button>';
  }
  function openSettings() {
    $('#llm-base-url').value=llmSettings.baseUrl;
    $('#llm-model').value=llmSettings.model;
    $('#llm-api-key').value=llmSettings.apiKey;
    $('#llm-api-key').type='password';
    const toggle=$('[data-action="settings-key-toggle"]');toggle.textContent='显示';toggle.setAttribute('aria-label','显示 API Key');toggle.setAttribute('aria-pressed','false');
    $('#settings-error').hidden=true;
    $('#settings-dialog').showModal();
  }
  function closeSettings() {
    $('#settings-dialog').close();
    $('#llm-settings-form').reset();
  }
  function saveSettings(event) {
    event.preventDefault();
    const baseUrl=$('#llm-base-url').value.trim();
    const model=$('#llm-model').value.trim();
    const apiKey=$('#llm-api-key').value.trim();
    if(baseUrl){
      let valid=false;
      try {const url=new URL(baseUrl);valid=['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash;}catch {}
      if(!valid){const error=$('#settings-error');error.textContent='请输入 HTTP 或 HTTPS 基础地址，不要在地址中包含账号、密码、查询参数或片段。';error.hidden=false;$('#llm-base-url').focus();return;}
    }
    resetAiLogic();llmSettings={baseUrl,model,apiKey};
    let persisted=true;
    try {if(baseUrl||model)localStorage.setItem(SETTINGS_KEY,JSON.stringify({baseUrl,model}));else localStorage.removeItem(SETTINGS_KEY);}catch {persisted=false;}
    closeSettings();
    toast(persisted?'设置已保存，可在逻辑说明中生成 AI 解读':'浏览器无法保存设置，本次配置仅在当前页面有效',persisted?'success':'warning');
  }
  document.addEventListener('submit',event=>{if(event.target.id==='llm-settings-form')saveSettings(event);});
  // Escape closes a native dialog without saving draft values.
  $('#settings-dialog').addEventListener('close',()=>$('#llm-settings-form').reset());

  function overviewView() {
    const s=state.result.summary||{};const counts=Object.fromEntries(Object.keys(severity).map(k=>[k,findings().filter(f=>f.severity===k).length]));const highest=Object.keys(severity).find(k=>counts[k])||'info';
    const stat=(label,value,desc,route,cls='')=>`<button class="card stat" data-action="go" data-route="${route}" aria-label="${label}，查看${pages[route]}"><span class="muted">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${desc} ▸</span></button>`;
    const stats=`<div class="stats overview-stats">${healthStat()}${stat('已解析文件',val(s.parsed),'查看项目结构','structure')}${stat('函数 / 类总数',s.functions==null||s.classes==null?'—':val(s.functions+s.classes),`${val(s.functions)} 个函数 · ${val(s.classes)} 个类`,'metrics')}${stat('风险条目',val(s.findings),'查看风险证据','risks',highest)}${stat('圈复杂度 · 平均 / 最大',`${val(s.average_cc)} <span class="muted">/</span> ${val(s.max_cc)}`,'查看函数指标','metrics',ccClass(s.max_cc))}</div>`;
    const ratio=Math.min(1,Math.max(0,Number(s.max_cc)/20));const arc=2*Math.PI*72*.75;
    const gauge=s.max_cc==null?placeholder('最大圈复杂度'):`<div class="chart-body"><svg viewBox="0 0 240 200" role="img" aria-label="最大圈复杂度 ${esc(s.max_cc)}，参考阈值 20"><circle cx="120" cy="96" r="72" fill="none" stroke="#eee7db" stroke-width="14" stroke-dasharray="${arc} ${2*Math.PI*72}" transform="rotate(135 120 96)"/><circle cx="120" cy="96" r="72" fill="none" stroke="${s.max_cc>20?colors.critical:s.max_cc>10?colors.warning:'#8b5e34'}" stroke-width="14" stroke-dasharray="${arc*ratio} ${2*Math.PI*72}" transform="rotate(135 120 96)"/><text x="120" y="103" text-anchor="middle" font-size="34" font-family="Consolas,monospace" fill="#292524">${val(s.max_cc)}</text><text x="120" y="128" text-anchor="middle" font-size="11" fill="#78716c">最大圈复杂度</text><text x="120" y="184" text-anchor="middle" font-size="12" fill="#78716c">参考阈值 20 · 超出部分不延长圆弧</text></svg><div><h3>${s.max_cc>20?'超过参考阈值':s.max_cc>10?'超过默认阈值 10':'未超过默认阈值 10'}</h3>${button('查看函数指标','go','data-route="metrics"','text')}</div></div>`;
    const total=Object.values(counts).reduce((a,b)=>a+b,0);let start=-Math.PI/2;
    const pie=Object.entries(counts).filter(([,n])=>n).map(([key,n])=>{const angle=n/total*Math.PI*2;const end=start+angle;const path=angle>=Math.PI*2-.0001?`<circle cx="100" cy="100" r="76" fill="${colors[key]}"/>`:`<path d="M100 100 L${100+76*Math.cos(start)} ${100+76*Math.sin(start)} A76 76 0 ${angle>Math.PI?1:0} 1 ${100+76*Math.cos(end)} ${100+76*Math.sin(end)} Z" fill="${colors[key]}"/>`;start=end;return path;}).join('');
    const dist=total?`<div class="chart-body"><svg viewBox="0 0 200 200" role="img" aria-label="风险严重度分布">${pie}</svg><div class="legend">${Object.keys(severity).map(k=>`<span><i class="swatch" style="background:${colors[k]}"></i>${severity[k]} <b class="number">${counts[k]}</b></span>`).join('')}</div></div>`:empty('当前分析没有风险条目','go','查看项目结构').replace('data-action="go"','data-action="go" data-route="structure"');
    const top=[...functions()].sort((a,b)=>b.cc-a.cc).slice(0,10);
    return `${stats}<div class="split">${card('复杂度参考',gauge)}${card('风险分布',dist)}</div>${card('Top 10 圈复杂度最高函数',top.length?table(['排名','函数 ID','文件位置','圈复杂度','操作'],top.map((f,i)=>`<tr><td class="number">${i+1}</td><td class="mono">${esc(f.id)}</td><td class="mono">${esc(fileFor(f.id)?.path||'—')}</td><td class="number ${ccClass(f.cc)}">${val(f.cc)}</td><td>${button('查看详情','function',`data-id="${esc(f.id)}"`,'text')}</td></tr>`).join('')):empty('当前结果没有函数数据'),'<a href="#risks" aria-label="查看全部风险">查看全部 ▸</a>')}`;
  }
  function treeView() {
    const groups=new Map();
    const query=state.treeSearch.toLowerCase();
    for(const file of files().filter(f=>f.path.toLowerCase().includes(query))){
      const parts=file.path.split('/');
      const group=parts.length>1?parts.slice(0,-1).join('/'):'/';
      if(!groups.has(group))groups.set(group,[]);
      groups.get(group).push(file);
    }
    const rows=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([group,items])=>`<section class="tree-group"><div class="tree-dir"><span class="mono">${esc(group)}</span><small>${items.length} 个文件</small></div><div class="tree-files">${items.map(f=>`<button class="tree-file ${state.file===f.path?'selected':''}" data-action="file" data-path="${esc(f.path)}" aria-label="${esc(f.path)}，${f.status==='error'?'解析失败':'已解析'}" title="${esc(f.path)}"><span class="file-name mono ${f.status==='error'?'critical':''}">${f.status==='error'?'! ':''}${esc(f.path.split('/').pop())}</span><small>${esc(fileLanguage(f))} · ${arr(f.functions).length} 函数 / ${classes().filter(c=>c.file===f.path).length} 类</small></button>`).join('')}</div></section>`).join('');
    return `<div class="tree tree--flat"><label class="visually-hidden" for="tree-search">文件筛选</label><input id="tree-search" type="search" placeholder="搜索文件…" value="${esc(state.treeSearch)}" aria-label="搜索文件名">${rows||'<p class="muted">没有匹配的文件</p>'}</div>`;
  }
  function classList(path) {
    const list=classes().filter(c=>c.file===path);
    return list.length?table(['类名','类 ID','定义位置','操作'],list.map(c=>`<tr><td>${esc(c.name||c.id)}</td><td class="mono">${esc(c.id)}</td><td class="mono">${esc(c.file)}:${val(c.line)}</td><td>${button('查看源码','source-location',`data-path="${esc(c.file)}" data-line="${Number(c.line)||1}"`,'text')}</td></tr>`).join('')):'<p class="muted">此文件没有类定义</p>';
  }
  function structureView() {
    const packages=new Map();
    for(const file of files()){const name=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')):'（根目录）';if(!packages.has(name))packages.set(name,{name,files:0,symbols:0,dependencies:0});const row=packages.get(name);row.files++;row.symbols+=arr(file.functions).length+classes().filter(c=>c.file===file.path).length;}
    for(const edge of arr(state.result.graph?.dependencies)){const target=moduleFile(edge.target);if(target){const name=target.path.includes('/')?target.path.slice(0,target.path.lastIndexOf('/')):'（根目录）';if(packages.has(name))packages.get(name).dependencies++;}}
    const rows=[...packages.values()].sort((a,b)=>state.packageSort?b.dependencies-a.dependencies:a.name.localeCompare(b.name));
    const selected=files().find(f=>f.path===state.file);
    const selectedStrip=selected?`<div class="selected-file"><span class="mono">${esc(selected.path)}</span><span>${esc(fileLanguage(selected))} · ${arr(selected.functions).length} 函数 · ${classes().filter(c=>c.file===selected.path).length} 类</span>${button('查看逻辑','file-logic',`data-path="${esc(selected.path)}"`,'text')}</div>`:'';
    const errors=[...arr(state.result.errors)];for(const f of files().filter(f=>f.status==='error'))if(!errors.some(e=>e.file===f.path))errors.push({file:f.path,line:typeof f.error==='object'?f.error?.line:null,type:typeof f.error==='object'?f.error?.type:null,message:typeof f.error==='object'?f.error?.message:f.error});
    const errorNote=errors.length?`<div class="parse-note" role="status">${errors.length} 个文件未能解析：${errors.slice(0,2).map(e=>`${esc(e.file)}${e.line?`:${e.line}`:''}`).join('、')}${errors.length>2?' 等':''}</div>`:'';
    return `<div class="structure-grid">${card('项目文件',treeView())}<section class="card structure-overview"><div class="heading"><h2>模块概览</h2><span class="muted">${files().length} 文件</span></div>${selectedStrip}${table(['包路径','文件数','符号数',button('被依赖','package-sort','','text')],rows.map(x=>`<tr><td class="mono">${esc(x.name)}</td><td class="number">${x.files}</td><td class="number">${x.symbols}</td><td class="number">${x.dependencies}</td></tr>`).join(''))}${errorNote}</section></div>`;
  }
  function tabs(items, active, action) { return `<div class="tabs" role="tablist" aria-label="视图切换">${items.map(([key,label])=>`<button role="tab" aria-selected="${active===key}" aria-label="${label}" data-action="${action}" data-tab="${key}">${label}</button>`).join('')}</div>`; }
  const aiLogic = {cache:new Map(), busy:false, key:'', error:'', controller:null};
  function resetAiLogic() {
    aiLogic.controller?.abort();aiLogic.controller=null;aiLogic.busy=false;aiLogic.key='';aiLogic.error='';aiLogic.cache.clear();
  }
  const logicKey = () => JSON.stringify([state.file,state.fn]);
  async function explainLogic() {
    if(aiLogic.busy||!state.result)return;
    if(state.aiCompatible===false){toast('后台版本不兼容，请重启服务后刷新页面','warning');return;}
    const file=files().find(f=>f.path===state.file);if(!file||file.status!=='ok')return;
    const key=logicKey(),project=state.result,controller=new AbortController();
    aiLogic.busy=true;aiLogic.key=key;aiLogic.error='';aiLogic.controller=controller;render();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},60000);
    try {
      const configured=Boolean(llmSettings.baseUrl||llmSettings.model||llmSettings.apiKey);
      const payload={project:project.project,files:files().filter(f=>f.status==='ok').map(f=>({path:f.path,content:f.source})),include_context:true,target:{file:file.path,function:state.fn||null}};
      if(configured)payload.provider={base_url:llmSettings.baseUrl,model:llmSettings.model,api_key:llmSettings.apiKey};
      const response=await fetch('/api/explain',{method:'POST',headers:{'Content-Type':'application/json','X-CodeLens-Token':state.token},body:JSON.stringify(payload),signal:controller.signal});
      const data=await response.json();if(!response.ok)throw Error(typeof data.error==='string'?data.error:'AI 解读失败，请重试');
      if(typeof data.text!=='string'||!data.text.trim())throw Error('模型未返回有效解读');
      if(state.result===project&&aiLogic.controller===controller)aiLogic.cache.set(key,data);
    } catch(error) {
      if(aiLogic.controller===controller)aiLogic.error=error.name==='AbortError'?(timedOut?'解读超时，请缩小范围后重试。':'已取消本次解读。'):error instanceof TypeError?'无法连接解读服务，请检查本机服务后重试。':error.message;
    } finally {
      clearTimeout(timer);if(aiLogic.controller===controller){aiLogic.busy=false;aiLogic.controller=null;render();}
    }
  }
  function renderExplanation(result) {
    const chars=Array.from(result.text);let cursor=0,html='';
    for(const citation of arr(result.citations)){
      html+=esc(chars.slice(cursor,citation.start).join(''));
      const label=chars.slice(citation.start,citation.end).join('');
      html+=citation.valid?button(label,'ai-citation',`data-path="${esc(citation.file)}" data-line="${citation.line}" data-end="${citation.end_line}"`,'text citation'):`<span class="citation-invalid" title="引用超出已发送的源码范围">${esc(label)}（引用未验证）</span>`;
      cursor=citation.end;
    }
    return html+esc(chars.slice(cursor).join(''));
  }
  function logicView() {
    const file=files().find(f=>f.path===state.file)||files()[0];if(file)state.file=file.path;
    const list=functions().filter(f=>f.file===file?.path);
    if(state.fn&&!list.some(f=>f.id===state.fn))state.fn='';
    const key=logicKey(),result=aiLogic.cache.get(key),pending=aiLogic.busy&&aiLogic.key===key;
    const selector=`<label for="ai-logic-target">解读范围</label><select id="ai-logic-target" data-change="ai-logic-target" aria-label="解读范围"><option value="">整个文件</option>${list.map(f=>`<option value="${esc(f.id)}" ${state.fn===f.id?'selected':''}>${esc(f.id)}</option>`).join('')}</select>`;
    const controls=`<div class="ai-logic-toolbar">${selector}<button class="primary" data-action="ai-explain" ${aiLogic.busy||file?.status!=='ok'||state.aiCompatible===false?'disabled':''}>${result?'重新生成解读':'生成 AI 解读'}</button>${aiLogic.busy?button('取消解读','ai-explain-cancel','','text'):''}${result?button('复制解读','ai-explain-copy','','text'):''}</div>`;
    const body=pending?'<div class="ai-reading-state" role="status"><div class="skeleton"></div><p>AI 正在阅读源码…</p><small>最多等待 60 秒，可取消本次请求。</small></div>':result?`<div class="ai-explanation">${renderExplanation(result)}</div><p class="footnote">模型：${esc(result.model)} · ${esc(result.file)}:${val(result.line)}–${val(result.end_line)}</p>${arr(result.context).length?`<details class="ai-context"><summary>源码范围（${result.context.length} 段）</summary><ul>${result.context.map(c=>`<li class="mono">${esc(c.file)}:${c.line}–${c.end_line}</li>`).join('')}</ul></details>`:''}${result.omitted_context?'<p class="notice">部分依赖超过上下文上限，未发送。</p>':''}${result.truncated?'<p class="notice">模型输出达到长度限制，解读可能不完整。</p>':''}`:'<div class="ai-reading-state"><h3>尚未生成解读</h3><p>选择文件或函数后生成解读。</p></div>';
    const error=aiLogic.key===key&&aiLogic.error?`<div class="error-box" role="alert">${esc(aiLogic.error)}</div>`:'';
    const source=file?.source!=null?`<details class="ai-source" ${state.line?'open':''}><summary>查看原始源码 · ${esc(file.path)}</summary><div class="source" tabindex="0" aria-label="${esc(file.path)} 源码">${file.source.split('\n').map((line,i)=>`<div class="source-line" data-line="${i+1}"><span class="line-number">${i+1}</span><code>${esc(line)||' '}</code></div>`).join('')}</div></details>`:'';
    return `<div class="ai-logic-grid">${card('项目文件',treeView())}<section class="card ai-logic-reader"><div class="heading"><div><h2>AI 逻辑解读</h2><p class="mono muted">${esc(file?.path||'未选择文件')}</p></div>${button('配置模型','settings-open','','text')}</div>${controls}${state.aiCompatible===false?'<div class="error-box" role="alert">后台版本不兼容，请重启服务后刷新页面。</div>':''}${error}${body}${aiLogic.busy&&!pending?'<p role="status">其他范围正在解读，请等待或取消。</p>':''}${source}</section></div>`;
  }
  function highlightSource() {
    if(!state.line)return;
    $$('.source-line').forEach(el=>el.classList.toggle('highlight',Number(el.dataset.line)>=state.line.start&&Number(el.dataset.line)<=state.line.end));
    const line=$(`.source-line[data-line="${Number(state.line.start)}"]`);if(line){const source=$('.source');source.scrollTop=line.offsetTop-60;}
  }
  function groupedFindings() {const map=new Map();for(const f of findings()){if(!map.has(f.rule_id))map.set(f.rule_id,[]);map.get(f.rule_id).push(f);}return [...map.entries()];}
  function metricsView() {
    const groups=groupedFindings().map(([key,hits])=>[key,state.overOnly?hits.filter(f=>typeof f.actual==='number'&&typeof f.threshold==='number'&&f.actual>f.threshold):hits]).filter(([,hits])=>hits.length);
    const riskGroups=groups.length?`<div class="rule-groups">${groups.map(([key,hits])=>{const strongest=[...hits].sort((a,b)=>weight[b.severity]-weight[a.severity])[0];return `<details class="rule-group"><summary><span class="rule-group__title"><strong>${esc(ruleLabel(key))}</strong><small class="mono">${esc(key)}</small></span><span class="rule-group__meta">${tag(strongest.severity)} <b>${hits.length}</b> 条</span></summary><div class="rule-group__body">${table(['位置','描述','证据','操作'],hits.map(f=>`<tr><td class="mono">${esc(f.file)}:${val(f.line)}</td><td>${esc(f.message)}</td><td>${evidence(f.evidence_type)}</td><td>${button('定位','locate-code',`data-id="${esc(f.id)}"`,'text')}</td></tr>`).join(''))}</div></details>`;}).join('')}</div>`:'<p class="muted">当前条件下没有规则命中</p>';
    return `<div class="heading"><label><input type="checkbox" aria-label="只看超阈值" data-change="over-only" ${state.overOnly?'checked':''}> 只看超阈值</label></div>${healthCard()}<section class="card"><div class="heading"><h2>规则命中汇总</h2><span class="muted">${groups.length} 类</span></div>${riskGroups}</section>`;
  }
  function findingDetail(f,solid=false) {
    return `<div class="detail-grid"><div><h3>实际值 vs 阈值</h3><dl><dt>实际值</dt><dd class="mono">${val(f.actual)}</dd><dt>阈值</dt><dd class="mono">${val(f.threshold)}</dd><dt>置信度</dt><dd class="mono">${f.confidence==null?'—':val(f.confidence)}</dd></dl></div><div><h3>详细信息</h3><p>${esc(f.message)}</p><h3>人工复核建议</h3><p>${val(f.suggestion)}</p>${solid?button('定位风险','finding-risk',`data-id="${esc(f.id)}"`,'text'):button('定位代码','locate-code',`data-id="${esc(f.id)}"`,'text')}</div></div>`;
  }
  function solidView() {
    const executed=rules().filter(r=>/(?:SRP|OCP|LSP|ISP|DIP)/i.test(r));const hits=findings().filter(f=>executed.includes(f.rule_id));
    if(!executed.length)return card('设计检查','<div class="empty">未执行 SOLID 检查</div>');
    const cards=executed.map(id=>{const n=hits.filter(f=>f.rule_id===id).length;return `<section class="card"><h3 class="mono">${esc(id)}</h3>${n?`<span class="tag warning">命中 ${n}</span>`:'<span class="success">未发现静态风险</span>'}</section>`;}).join('');
    const missing=['SRP','OCP','LSP','ISP','DIP'].filter(p=>!executed.some(r=>r.toUpperCase().includes(p)));
    const gaps=arr(state.result.solid?.coverage_gaps);const coverage=gaps.length?`<div class="notice notice--warning" role="status">部分代码因外部基类、多继承、动态装饰器或无法静态推导的签名而未检查${gaps.length>1?`，共 ${gaps.length} 处`:''}。</div>`:'';
    return `${coverage}<div class="rule-cards">${cards}</div>${missing.length?`<p class="muted">${missing.map(x=>`${x}：未执行`).join(' · ')}</p>`:''}${card('设计规则命中',hits.length?table(['规则','位置','严重度','证据','描述','操作'],hits.map(f=>`<tr><td>${esc(ruleLabel(f.rule_id))}</td><td class="mono">${esc(f.file)}:${val(f.line)}</td><td>${tag(f.severity)}</td><td>${evidence(f.evidence_type)}</td><td>${esc(f.message)}</td><td>${button(state.expanded.has(f.id)?'收起':'详情','expand-finding',`data-id="${esc(f.id)}" aria-expanded="${state.expanded.has(f.id)}"`,'text')}</td></tr>${state.expanded.has(f.id)?`<tr class="detail-row"><td colspan="6">${findingDetail(f,true)}</td></tr>`:''}`).join('')):'<p class="success">已执行的设计规则没有命中条目</p>')}`;
  }
  function risksView() {
    const report=state.result.special_risks;
    const categories=arr(report?.categories).length?report.categories:specialRiskDefs.map(([id,label,description])=>({id,label,description,severity:'info',count:0,items:[]}));
    const flagged=categories.filter(c=>c.count).length;
    const rows=categories.map(category=>{
      const label=`<span class="risk-row__label"><strong>${esc(category.label)}</strong><small>${category.count?`${category.count} 项`:'未发现'}</small></span>`;
      if(!category.count)return `<div class="risk-row risk-row--clear">${label}<span class="risk-row__state">无问题</span></div>`;
      return `<details class="risk-row"><summary>${label}<span class="risk-row__meta">${tag(category.severity)}<span>展开</span></span></summary><div class="risk-row__body"><ul>${category.items.map(item=>`<li><button class="risk-location" data-action="source-location" data-path="${esc(item.file||'')}" data-line="${Number(item.line)||1}"><span class="mono">${esc(item.file||'')}:${val(item.line)}</span><span>${esc(item.message||'')}</span></button></li>`).join('')}</ul>${category.truncated?'<p class="footnote">仅展示前 30 条</p>':''}</div></details>`;
    }).join('');
    return `<div class="special-risk-summary"><strong>${flagged}</strong><span>/ ${categories.length} 类发现证据</span></div><section class="card risk-report-list">${rows}</section>`;
  }
  const compareText=(a,b)=>String(a??'')<String(b??'')?-1:String(a??'')>String(b??'')?1:0;
  const compareEdges=(a,b)=>compareText(a.file,b.file)||(Number(a.line)||0)-(Number(b.line)||0)||compareText(a.source,b.source)||compareText(a.target,b.target)||compareText(a.expression,b.expression);
  function functionFile(fn) {return fn?.file||fileFor(fn?.id)?.path||'';}
  function fileModule(path) {const file=files().find(f=>f.path===path);return file?.module||moduleName(path);}
  function definitionFile(id) {
    const fn=functions().find(f=>f.id===id),cls=classes().find(c=>c.id===id);
    return functionFile(fn)||cls?.file||files().find(f=>f.path===id)?.path||moduleFile(id)?.path||'';
  }
  function enclosingFunction(path,line) {
    // Only backend-provided ranges establish ownership; never parse or execute source here.
    const matches=functions().filter(f=>functionFile(f)===path&&Number.isFinite(f.line)&&Number.isFinite(f.end_line)&&f.line<=line&&line<=f.end_line);
    return matches.sort((a,b)=>(a.end_line-a.line)-(b.end_line-b.line)||compareText(a.id,b.id))[0];
  }
  function graphData() {return arr(state.result.graph?.[state.graphTab==='chain'?'calls':state.graphTab==='inheritance'?'class_relations':state.graphTab]);}
  function selectedEntry(key) {return functions().find(f=>f.id===state[key])||functions()[0];}
  function entrySelector(key,label) {
    const current=selectedEntry(key);
    return `<label>${label}<select data-change="${key==='chainEntry'?'chain-entry':'graph-entry'}" aria-label="${label}" ${functions().length?'':'disabled'}>${functions().map(f=>`<option value="${esc(f.id)}" ${f.id===current?.id?'selected':''}>${esc(f.id)}</option>`).join('')||'<option value="">没有函数</option>'}</select></label>`;
  }
  function callChain() {
    const entry=selectedEntry('chainEntry');if(!entry)return [];
    const start=fileModule(functionFile(entry));if(!start)return [];
    const resolved=arr(state.result.graph?.calls).filter(e=>e.status==='resolved'&&e.target).map(e=>({...e,moduleSource:e.file?fileModule(e.file):e.source}));
    const visited=new Set([start]);let frontier=[start];const steps=[];
    for(let depth=1;depth<=6&&frontier.length;depth++){
      const layer=resolved.filter(e=>frontier.includes(e.moduleSource)).sort(compareEdges);const next=[];
      for(const edge of layer){
        steps.push({...edge,depth});
        const targetFile=definitionFile(edge.target);const nextModule=targetFile?fileModule(targetFile):edge.target;
        if(!visited.has(nextModule)){visited.add(nextModule);next.push(nextModule);}
      }
      frontier=next.sort(compareText);
    }
    return steps;
  }
  function callChainView() {
    const steps=callChain();
    return `<div class="graph-controls">${entrySelector('chainEntry','入口函数')}</div>${steps.length?`<ol class="call-chain">${steps.map(step=>`<li><span class="tag">第 ${step.depth} 层</span><button class="text chain-location" data-action="source-location" data-path="${esc(step.file)}" data-line="${Number(step.line)||1}" aria-label="查看 ${esc(step.target)} 在 ${esc(step.file)} 第 ${val(step.line)} 行的调用"><span class="mono">${esc(step.target)}</span><span class="mono muted">${esc(step.file)}:${val(step.line)}</span></button></li>`).join('')}</ol>`:empty('当前入口所在模块没有可达的已解析调用边。','graph-raw','查看原始调用数据')}`;
  }
  function graphModel() {
    const type=state.graphTab;const nodes=new Map();const edges=[];
    const add=(id,file='',kind='')=>{if(!id)return;if(!nodes.has(id))nodes.set(id,{id,file,kind});};
    const fileLevel=type==='calls'&&state.graphGranularity==='file';
    for(const raw of [...graphData()].sort(compareEdges)){
      if(!raw.source||!raw.target||(type==='calls'&&raw.status!=='resolved'))continue;
      let source=raw.source,target=raw.target;let sourceFile=raw.file||definitionFile(source),targetFile=definitionFile(target);let unmatched=false;
      if(type==='calls'){
        const owner=enclosingFunction(raw.file,Number(raw.line));
        const known=functions().find(f=>f.id===raw.source);
        source=owner?.id||known?.id||(raw.file?fileModule(raw.file):raw.source);unmatched=!owner&&!known;
        if(fileLevel){source=sourceFile||source;target=targetFile||target;}
      }
      add(source,sourceFile,fileLevel?'文件':type==='dependencies'?'模块':type==='inheritance'?'类':unmatched?'模块（调用者未定位）':'函数');
      add(target,targetFile,fileLevel&&targetFile?'文件':type==='dependencies'?'模块':type==='inheritance'||classes().some(c=>c.id===target)?'类':'函数');
      edges.push({...raw,source,target,sourceFile,targetFile,rawSource:raw.source,rawTarget:raw.target});
    }
    if(type==='inheritance')for(const cls of classes())add(cls.id,cls.file,'类');
    if(type==='calls')for(const fn of functions()){const file=functionFile(fn);add(fileLevel?(file||fn.id):fn.id,file,fileLevel?'文件':'函数');}
    const entryFn=selectedEntry('graphEntry');const entry=type==='calls'?(fileLevel?functionFile(entryFn):entryFn?.id):null;
    return {nodes:[...nodes.values()].sort((a,b)=>compareText(a.id,b.id)),edges,entry:entry||nodes.keys().next().value||''};
  }
  function neighborhood(model) {
    const visible=new Set(model.entry?[model.entry]:[]);
    for(const reverse of [false,true]){
      let frontier=[model.entry];const visited=new Set(frontier);
      for(let depth=0;depth<2;depth++){
        const next=[];
        for(const e of model.edges){const from=reverse?e.target:e.source,to=reverse?e.source:e.target;if(frontier.includes(from)&&!visited.has(to)){visited.add(to);visible.add(to);next.push(to);}}
        frontier=next;
      }
    }
    return visible;
  }
  function graphLayout() {
    const full=graphModel();const isCall=state.graphTab==='calls';
    if(isCall&&!state.graphVisible)state.graphVisible=neighborhood(full);
    const query=state.graphQuery.trim().toLowerCase();
    const selected=full.nodes.filter(n=>!isCall||state.graphVisible.has(n.id)||(query&&n.id.toLowerCase().includes(query)));
    const ids=new Set(selected.map(n=>n.id));const edges=full.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
    const adjacent=new Map(selected.map(n=>[n.id,[]])),indegree=new Map(selected.map(n=>[n.id,0]));
    for(const e of edges){adjacent.get(e.source).push(e.target);indegree.set(e.target,indegree.get(e.target)+1);}
    const levels=new Map();const queue=selected.filter(n=>indegree.get(n.id)===0).map(n=>n.id);
    for(const id of queue)levels.set(id,0);
    const bfs=()=>{for(let i=0;i<queue.length;i++)for(const target of adjacent.get(queue[i])||[])if(!levels.has(target)){levels.set(target,levels.get(queue[i])+1);queue.push(target);}};
    bfs();for(const n of selected)if(!levels.has(n.id)){levels.set(n.id,0);queue.push(n.id);bfs();}
    const radial=isCall&&state.graphLayoutMode==='radial';
    if(radial){
      levels.clear();const seed=ids.has(full.entry)?full.entry:selected[0]?.id;
      const pending=seed?[seed]:[];if(seed)levels.set(seed,0);
      for(let i=0;i<pending.length;i++)for(const e of edges){const next=e.source===pending[i]?e.target:e.target===pending[i]?e.source:null;if(next&&!levels.has(next)){levels.set(next,levels.get(pending[i])+1);pending.push(next);}}
      const outer=Math.max(0,...levels.values())+1;for(const n of selected)if(!levels.has(n.id))levels.set(n.id,outer);
    }
    const layers=new Map();for(const n of selected){const level=levels.get(n.id);if(!layers.has(level))layers.set(level,[]);layers.get(level).push(n.id);}
    const count=Math.max(1,...[...layers.values()].map(v=>v.length)),depth=Math.max(0,...levels.values())+1;
    const horizontal=!radial&&state.graphDirection==='LR';
    let width=Math.max(800,horizontal?depth*240+120:count*200+100),height=Math.max(400,horizontal?count*80+100:depth*120+100);
    const radii=new Map([[0,0]]);if(radial){let last=0;for(const level of [...layers.keys()].sort((a,b)=>a-b)){if(level===0)continue;last=Math.max(last+180,layers.get(level).length*190/(Math.PI*2));radii.set(level,last);}width=Math.max(800,Math.ceil(last*2+260));height=Math.max(500,Math.ceil(last*2+140));}
    const nodes=selected.map((node,index)=>{
      const level=levels.get(node.id),layer=layers.get(level),slot=layer.indexOf(node.id);let x,y;
      if(radial){const angle=-Math.PI/2+slot/layer.length*Math.PI*2,radius=radii.get(level)||0;x=width/2+Math.cos(angle)*radius-75;y=height/2+Math.sin(angle)*radius-18;}
      else if(horizontal){x=60+level*240;y=(height-layer.length*80)/2+slot*80;}
      else{x=(width-layer.length*200)/2+slot*200;y=50+level*120;}
      const hiddenChildren=isCall?[...new Set(full.edges.filter(e=>e.source===node.id&&!ids.has(e.target)).map(e=>e.target))]:[];
      return {...node,index,x,y,hiddenChildren,matched:!!query&&node.id.toLowerCase().includes(query)};
    });
    return {nodes,edges,width,height,radial,horizontal,cycles:arr(state.result.graph?.cycles).filter(Array.isArray)};
  }
  function graphsView() {
    const isCall=state.graphTab==='calls';const select=(action,label,options,current,disabled=false)=>`<label>${label}<select data-change="${action}" aria-label="${label}" ${disabled?'disabled':''}>${options.map(([key,text])=>`<option value="${key}" ${key===current?'selected':''}>${text}</option>`).join('')}</select></label>`;
    return `<section class="card graph-page">${tabs([['calls','函数调用图'],['dependencies','模块依赖图'],['inheritance','类与继承图'],['chain','调用链']],state.graphTab,'graph-tab')}${state.graphTab==='chain'?callChainView():`<div class="graph-controls">${isCall?entrySelector('graphEntry','图谱入口函数'):''}<label>节点搜索<input id="graph-search" type="search" value="${esc(state.graphQuery)}" placeholder="输入节点名…" aria-label="搜索图谱节点"></label>${select('graph-layout','布局',isCall?[['layered','分层'],['radial','放射']]:[['layered','分层']],isCall?state.graphLayoutMode:'layered')}${isCall?select('graph-granularity','粒度',[['function','函数级'],['file','文件级']],state.graphGranularity):''}${select('graph-direction','方向',[['TD','TD（从上到下）'],['LR','LR（从左到右）']],state.graphDirection,isCall&&state.graphLayoutMode==='radial')}</div><div class="actions graph-actions">${button('导出 SVG','graph-export')}${button('复制图数据','graph-copy')}${button('全屏','graph-fullscreen')}${button('重置布局','graph-reset')}</div><p id="graph-search-status" class="footnote" role="status" aria-live="polite"></p><div id="graph-host"></div><details class="graph-legend"><summary aria-label="展开图例说明">图例说明</summary><p class="footnote">import：棕色；call：灰色；inherit：绿色。循环边为红色，跨文件调用为虚线。</p></details>`}</section>`;
  }
  function edgeInCycle(edge,cycles) {
    return cycles.some(group=>{
      if(group.includes(edge.source)&&group.includes(edge.target))return true;
      if(group.includes(edge.rawSource)&&group.includes(edge.rawTarget))return true;
      const source=edge.sourceFile?fileModule(edge.sourceFile):edge.source,target=edge.targetFile?fileModule(edge.targetFile):edge.target;
      return source!==target&&group.includes(source)&&group.includes(target);
    });
  }
  function graphSVG(model,scope='main') {
    const prefix=`arrow-${state.graphTab}-${scope}`,positions=new Map(model.nodes.map(n=>[n.id,n]));
    const base=state.graphTab==='dependencies'?'#8b5e34':state.graphTab==='inheritance'?'#15803d':'#78716c';
    const cycleNodes=new Set(model.edges.filter(e=>edgeInCycle(e,model.cycles)).flatMap(e=>[e.source,e.target]));
    const paths=model.edges.map((e,i)=>{
      const a=positions.get(e.source),b=positions.get(e.target);let path;
      if(a===b)path=`M ${a.x+45} ${a.y} C ${a.x+20} ${a.y-38}, ${a.x+130} ${a.y-38}, ${a.x+105} ${a.y}`;
      else if(model.radial){
        const dx=b.x-a.x,dy=b.y-a.y,scale=Math.min(75/Math.max(Math.abs(dx),.001),18/Math.max(Math.abs(dy),.001));
        const sx=a.x+75+dx*scale,sy=a.y+18+dy*scale,tx=b.x+75-dx*scale,ty=b.y+18-dy*scale;
        path=`M ${sx} ${sy} C ${sx+(tx-sx)/3} ${sy+(ty-sy)/3}, ${sx+2*(tx-sx)/3} ${sy+2*(ty-sy)/3}, ${tx} ${ty}`;
      } else if(model.horizontal){
        if(b.x>a.x&&b.x-a.x<=260){const mid=(a.x+150+b.x)/2;path=`M ${a.x+150} ${a.y+18} C ${mid} ${a.y+18}, ${mid} ${b.y+18}, ${b.x} ${b.y+18}`;}
        else {const lane=model.height-20-(i%5)*5;path=`M ${a.x+75} ${a.y+36} C ${a.x+75} ${lane}, ${b.x+75} ${lane}, ${b.x+75} ${b.y+36}`;}
      } else if(Math.abs(b.y-a.y)<40){const top=Math.min(a.y,b.y)-45;path=`M ${a.x+75} ${a.y} C ${a.x+75} ${top}, ${b.x+75} ${top}, ${b.x+75} ${b.y}`;}
      else if(b.y>a.y&&b.y-a.y<=150){const mid=(a.y+36+b.y)/2;path=`M ${a.x+75} ${a.y+36} C ${a.x+75} ${mid}, ${b.x+75} ${mid}, ${b.x+75} ${b.y}`;}
      else {const right=model.width+20+(i%6)*8,exit=a.y+66,entry=b.y-30;path=`M ${a.x+75} ${a.y+36} C ${a.x+75} ${exit}, ${right} ${exit}, ${right} ${exit} C ${right} ${exit}, ${right} ${entry}, ${right} ${entry} C ${right} ${entry}, ${b.x+75} ${entry}, ${b.x+75} ${b.y}`;}
      const cycle=edgeInCycle(e,model.cycles),cross=state.graphTab==='calls'&&e.targetFile&&e.sourceFile!==e.targetFile;
      const label=e.kind?`${e.kind}: ${e.rawSource} → ${e.rawTarget}`:e.expression||`${e.rawSource} → ${e.rawTarget}`;
      return `<path class="graph-edge ${cycle?'cycle':''} ${cross?'cross':''}" d="${path}" stroke="${cycle?'#b91c1c':base}" marker-end="url(#${prefix}${cycle?'-red':''})" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></path>`;
    }).join('');
    const name=state.graphTab==='calls'?'函数调用图':state.graphTab==='inheritance'?'类与继承图':'模块依赖图';
    return `<svg class="graph-canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.width+80} ${model.height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${name}"><style>.graph-edge{fill:none;stroke-width:1.5}.graph-edge.cross{stroke-dasharray:5 4}.graph-edge:hover,.graph-edge:focus{stroke-width:3}.graph-node rect{fill:#faf7f2;stroke:#cbbba5}.graph-node.cycle rect{fill:#fef2f2;stroke:#b91c1c}.graph-node.matched rect{fill:#f3ead9;stroke:#8b5e34;stroke-width:3}.graph-node text{font:11px Consolas,monospace;fill:#292524}.graph-node:focus rect{stroke:#8b5e34;stroke-width:3}.graph-expand rect{fill:#8b5e34}.graph-expand text{fill:white;font:11px Consolas,monospace}.graph-expand:focus rect{stroke:#292524;stroke-width:2}</style><defs>${[[prefix,base],[prefix+'-red','#b91c1c']].map(([id,color])=>`<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${color}"/></marker>`).join('')}</defs>${paths}${model.nodes.map(n=>`<g class="graph-node ${cycleNodes.has(n.id)?'cycle':''} ${n.matched?'matched':''}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="查看节点 ${esc(n.id)}" data-action="graph-node" data-node="${n.index}"><title>${esc(n.id)} · ${esc(n.kind)}</title><rect width="150" height="36" rx="4"/><text x="75" y="23" text-anchor="middle">${esc(n.id.length>19?n.id.slice(0,18)+'…':n.id)}</text></g>${n.hiddenChildren.length?`<g class="graph-expand" transform="translate(${n.x+152} ${n.y+7})" tabindex="0" role="button" data-action="graph-expand" data-node="${n.index}" aria-label="展开 ${esc(n.id)} 的 ${n.hiddenChildren.length} 个子节点"><rect width="36" height="22" rx="4"/><text x="18" y="15" text-anchor="middle">+${n.hiddenChildren.length}</text></g>`:''}`).join('')}</svg>`;
  }
  function updateGraphSearch(center=true) {
    const matches=state.graph?.nodes.filter(n=>n.matched)||[];const status=$('#graph-search-status');
    if(status)status.textContent=state.graphQuery.trim()?`匹配 ${matches.length} 个节点`:'';
    if(center&&matches.length){const stage=$('#graph-host .graph-stage');const target=$('#graph-host .graph-node[data-node="'+matches[0].index+'"]');if(stage&&target){const box=target.getBoundingClientRect(),frame=stage.getBoundingClientRect();stage.scrollLeft+=box.left-frame.left+box.width/2-stage.clientWidth/2;stage.scrollTop+=box.top-frame.top+box.height/2-stage.clientHeight/2;}}
  }
  function drawGraph() {
    const host=$('#graph-host');if(!host)return;
    if(!state.graph)state.graph=graphLayout();
    host.innerHTML=state.graph.nodes.length?`<div class="graph-stage" tabindex="0" aria-label="关系图谱画布" data-scope="main">${graphSVG(state.graph)}</div>`:empty('没有可绘制的关系数据','graph-raw','查看原始数据');
    updateGraphSearch();
  }
  function redrawGraphs() {$$('.graph-stage').forEach(stage=>stage.innerHTML=graphSVG(state.graph,stage.dataset.scope||'main'));}
  function drawerView() {
    const node=state.graph?.nodes.find(n=>n.id===state.drawer);if(!node)return '';
    const edges=state.graph.edges.filter(e=>e.source===node.id||e.target===node.id);
    return `<aside class="drawer" role="dialog" aria-modal="false" aria-label="节点详情"><div class="heading"><h2>节点详情</h2>${button('关闭','drawer-close')}</div><h2 class="mono">${esc(node.id)}</h2><dl><dt class="muted">类型</dt><dd>${esc(node.kind)}</dd><dt class="muted">所在文件</dt><dd class="mono">${val(node.file||null)}</dd></dl><h3>关联条目</h3><ul class="raw-list">${edges.map(e=>`<li class="mono">${esc(e.source)} → ${esc(e.target)}<br><small>${esc(e.expression)} · ${esc(e.file)}:${val(e.line)}</small></li>`).join('')}</ul>${button('查看逻辑','node-logic',`data-id="${esc(node.id)}" data-path="${esc(node.file)}"`,'text')}</aside>`;
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
    if(!event.target.closest('.health-help'))showHealthHelp(false);
    const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
    const action=target.dataset.action;
    if(action==='graph-node'&&suppressClick){suppressClick=false;return;}
    switch(action){
      case 'ai-citation': {const file=files().find(f=>f.path===target.dataset.path);if(file){modal('源码引用',`<p class="mono">${esc(file.path)}:${target.dataset.line}–${target.dataset.end}</p><div class="source">${file.source.split('\n').slice(Math.max(0,Number(target.dataset.line)-3),Number(target.dataset.end)+2).map((line,i)=>{const n=Math.max(1,Number(target.dataset.line)-2)+i;return `<div class="source-line ${n>=Number(target.dataset.line)&&n<=Number(target.dataset.end)?'highlight':''}"><span class="line-number">${n}</span><code>${esc(line)||' '}</code></div>`;}).join('')}</div>`);}break;}
      case 'ai-explain': explainLogic();break;
      case 'ai-explain-cancel': aiLogic.controller?.abort();break;
      case 'ai-explain-copy': {const result=aiLogic.cache.get(logicKey());if(result)copy(result.text);break;}
      case 'settings-open': openSettings();break;
      case 'settings-close': closeSettings();break;
      case 'settings-clear': $('#llm-settings-form').reset();$('#settings-error').hidden=true;$('#llm-base-url').focus();break;
      case 'settings-key-toggle': {const input=$('#llm-api-key');const show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'隐藏':'显示';target.setAttribute('aria-label',show?'隐藏 API Key':'显示 API Key');target.setAttribute('aria-pressed',String(show));break;}
      case 'health-help': showHealthHelp(true,event);break;
      case 'source-location': if(!files().some(f=>f.path===target.dataset.path)){toast('分析结果中没有该文件，无法定位源码','warning');break;}state.file=target.dataset.path;state.fn=enclosingFunction(state.file,Number(target.dataset.line))?.id||'';state.line={start:Number(target.dataset.line),end:Number(target.dataset.line),index:-1};state.logicTab='trace';go('logic');break;
      case 'choose': $('#folder-input').value='';$('#folder-input').click();break;
      case 'connect': connect();break;
      case 'abort': state.controller?.abort();break;
      case 'return-result': state.controller?.abort();state.importing=false;go(state.route);break;
      case 'reimport': $('#confirm-dialog').showModal();break;
      case 'confirm-import': $('#confirm-dialog').close();state.importing=true;state.error=[];state.ignored={};render();connect();break;
      case 'close-dialog': target.closest('dialog')?.close();break;
      case 'go': go(target.dataset.route||'overview');break;
      case 'export': exportReport(target.dataset.format);break;
      case 'function': openFunction(target.dataset.id);break;
      case 'select-function': state.fn=target.dataset.id;state.line=null;render();break;
      case 'file': state.file=target.dataset.path;state.fn='';state.line=null;render();break;
      case 'file-logic': state.file=target.dataset.path;state.fn='';state.line=null;go('logic');break;
      case 'package-sort': state.packageSort=!state.packageSort;render();break;
      case 'logic-tab': state.logicTab=target.dataset.tab;render();break;
      case 'copy-id': copy(state.fn);break;
      case 'statement': {const f=functions().find(x=>x.id===state.fn);const s=arr(f?.statements)[Number(target.dataset.index)];if(s){state.line={start:s.line,end:s.end_line??s.line,index:Number(target.dataset.index)};$$('.statement').forEach(el=>el.classList.toggle('selected',el===target));highlightSource();}break;}
      case 'file-risks': go('risks');break;
      case 'expand-finding': state.expanded.has(target.dataset.id)?state.expanded.delete(target.dataset.id):state.expanded.add(target.dataset.id);render();break;
      case 'finding-risk': go('risks');break;
      case 'locate-code': locateFinding(target.dataset.id);break;
      case 'graph-tab': state.graphTab=target.dataset.tab;state.graph=null;state.graphVisible=null;state.drawer=null;state.graphQuery='';render();break;
      case 'graph-expand': {const node=state.graph?.nodes[Number(target.dataset.node)];if(node){for(const id of node.hiddenChildren)state.graphVisible.add(id);state.graph=null;render();redrawGraphs();const current=state.graph.nodes.find(n=>n.id===node.id);const scope=$('#detail-dialog').open?'#detail-dialog':'#graph-host';$(scope+' .graph-node[data-node="'+current.index+'"]')?.focus({preventScroll:true});}break;}
      case 'graph-reset': state.graphVisible=null;state.graphQuery='';state.graph=null;state.drawer=null;render();break;
      case 'graph-raw': modal('原始图数据',`<pre tabindex="0" aria-label="原始图数据">${esc(JSON.stringify(graphData(),null,2))}</pre>`);break;
      case 'graph-copy': copy(JSON.stringify(graphData(),null,2));break;
      case 'graph-export': {const svg=$('#graph-host svg');if(svg)download(new XMLSerializer().serializeToString(svg),'image/svg+xml;charset=utf-8','svg');else toast('没有可导出的关系图','warning');break;}
      case 'graph-fullscreen': if(state.graph?.nodes.length)modal('关系图谱',`<div class="graph-stage" tabindex="0" aria-label="放大关系图谱画布" data-scope="full">${graphSVG(state.graph,'full')}</div>`);else toast('没有可放大的关系图','warning');break;
      case 'graph-node': openNode(Number(target.dataset.node));break;
      case 'drawer-close': state.drawer=null;$('.drawer')?.remove();$('.graph-node')?.focus();break;
      case 'node-logic': {const file=files().find(f=>f.path===target.dataset.path)||nodeFile(target.dataset.id);if(!file){toast('结果中没有对应文件，无法定位逻辑','warning');break;}$('#detail-dialog').close();state.file=file.path;state.fn=functions().some(f=>f.id===target.dataset.id)?target.dataset.id:'';state.line=null;state.drawer=null;go('logic');break;}
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;if(el.id==='folder-input'){analyze([...el.files]);return;}
    const key=el.dataset.change;if(!key)return;
    if(key==='export-ai'){state.exportAi=el.checked;return;}
    else if(key==='export-source'){state.exportSource=el.checked;return;}
    else if(key==='logic-sort')state.logicSort=el.value;
    else if(key==='over-only')state.overOnly=el.checked;
    else if(key==='chain-entry')state.chainEntry=el.value;
    else if(key.startsWith('graph-')){const keys={'graph-entry':'graphEntry','graph-layout':'graphLayoutMode','graph-granularity':'graphGranularity','graph-direction':'graphDirection'};if(keys[key])state[keys[key]]=el.value;state.graph=null;state.drawer=null;if(key==='graph-entry'||key==='graph-granularity')state.graphVisible=null;}
    else if(key==='ai-logic-target'){state.fn=el.value;state.line=null;}
    render();
  });
  document.addEventListener('input',event=>{if(event.target.id==='graph-search'){state.graphQuery=event.target.value;state.graph=null;drawGraph();}});
  document.addEventListener('pointerover',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true,event);});
  document.addEventListener('pointermove',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true,event);});
  document.addEventListener('pointerout',event=>{const help=event.target.closest('.health-help');if(help&&!help.contains(event.relatedTarget))showHealthHelp(false);});
  document.addEventListener('focusin',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true,event);});
  document.addEventListener('focusout',event=>{const help=event.target.closest('.health-help');if(help&&!help.contains(event.relatedTarget))showHealthHelp(false);});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')showHealthHelp(false);
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
  return () => {};
}

