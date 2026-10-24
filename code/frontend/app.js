(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val = value => value == null ? '—' : esc(value);
  const arr = value => Array.isArray(value) ? value : [];
  const pages = {overview:'总览',structure:'项目结构',logic:'逻辑说明',graphs:'关系图谱',metrics:'质量体检',solid:'设计检查',risks:'风险清单',export:'导出报告'};
  const ruleNames={'CC-01':'圈复杂度','LEN-01':'函数长度','DEPTH-01':'嵌套深度','A4':'硬编码密钥','A3-IO':'边界输入','CYCLE-01':'循环依赖','SRP-01':'单一职责','OCP-01':'开闭原则','DIP-01':'依赖倒置','A5-DEAD':'死代码','A8-DEFENSIVE':'过宽异常捕获'};
  const ruleLabel=id=>Object.hasOwn(ruleNames,id)?ruleNames[id]:id;
  const severity = {critical:'高',warning:'中',info:'低'};
  const weight = {critical:3,warning:2,info:1};
  const colors = {critical:'#b91c1c',warning:'#c2410c',info:'#a8a29e'};
  const state = {result:null,ready:false,connecting:true,token:'',version:'',importing:true,busy:false,phase:'',read:0,error:[],ignored:{},route:'overview',file:'',fn:'',treeSearch:'',logicSort:'cc',logicTab:'trace',line:null,graphTab:'calls',graph:null,drawer:null,graphEntry:'',chainEntry:'',graphLayoutMode:'layered',graphGranularity:'function',graphDirection:'TD',graphQuery:'',graphVisible:null,barsExpanded:false,metricSort:'cc',metricAsc:false,overOnly:false,packageSort:false,expanded:new Set(),risk:{severities:[],evidence:'',rule:'',file:'',query:'',page:1},controller:null};
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
    return `<section class="card stat health-stat"><span class="muted">健康度总分</span><strong>${val(h?.score)}</strong><span class="muted">${val(h?.grade)}</span><div class="health-help"><button class="help-button" data-action="health-help" aria-label="查看健康度计算方式" aria-expanded="false" aria-controls="health-explanation" aria-describedby="health-explanation">?</button><div id="health-explanation" class="health-popover" role="tooltip" hidden><h3>健康度计算方式</h3><p><b>公式</b><br>${val(h?.formula)}</p><p><b>口径</b><br>${val(h?.basis)}</p><ul>${arr(h?.notes).map(note=>`<li>${esc(note)}</li>`).join('')}</ul></div></div></section>`;
  }
  function showHealthHelp(open) {
    const popup=$('#health-explanation');if(!popup)return;
    popup.hidden=!open;$('[data-action="health-help"]').setAttribute('aria-expanded',String(open));
  }
  const functions = () => arr(state.result?.functions);
  const classes = () => arr(state.result?.classes);
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
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.setAttribute('aria-label','下载分析报告');a.download=`codelens-${extension==='svg'?'graph':'report'}.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已生成下载文件','success');
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
    return `<main id="main" tabindex="-1" aria-label="主要内容" class="import-page"><section class="import-card"><div class="import-settings">${settingsButton()}</div><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>CodeLens</span></div><h1>CodeLens 代码分析</h1><p class="muted">检查 Python 项目的结构、逻辑与代码风险，依据分析结果进行复核。</p>${state.connecting?'<p role="status">正在连接分析服务</p><div class="skeleton"></div>':!state.ready?`${errors}${button('重新连接','connect','', 'primary')}`:`<div id="dropzone" class="dropzone" aria-label="项目文件夹上传区">${state.busy?`<div class="progress-area" role="status"><p>${esc(state.phase)}</p><progress ${state.phase.startsWith('读取')?`value="${state.read}" max="200"`:''} aria-label="分析进度"></progress><p class="muted">${state.phase.startsWith('读取')?`已读 ${state.read}/200`:'分析中，最多等待 120 秒'}</p>${button('中止','abort','','danger')}</div>`:`<div class="drop-symbol" aria-hidden="true"></div><p>将项目文件夹拖到此处</p><small>读取 Python 源码，由本机服务完成静态分析</small>${button('选择文件夹','choose','','primary')}`}${errors}</div><small>最多 200 个 .py 文件，单文件 1MB，总量 8MB</small>${stats?`<p class="footnote">其他类型文件（未上传）：${stats}</p>`:''}`}${state.result?`<p style="margin-top:16px">${button('查看上一次结果','return-result','','text')}</p>`:''}<p class="footnote">源码仅在本机内存中解析，不上传、不保存副本。</p><div class="import-footer"><span>${state.ready?'<i class="status-dot"></i>本机服务已连接':'等待服务连接'}</span><span class="mono">${esc(state.version)}</span></div></section></main>`;
  }
  function render() {
    const focused=document.activeElement;
    if(state.importing||!state.result){app.className='';app.innerHTML=importView();return;}
    app.className='';
    const navLinks=Object.entries(pages).map(([key,label],index)=>`<a class="workspace-link nav-item-${index} ${state.route===key?'active':''}" href="#${key}" aria-label="${label}" ${state.route===key?'aria-current="page"':''}>${label}</a>`).join('');
    const views={overview:overviewView,structure:structureView,logic:logicView,graphs:graphsView,metrics:metricsView,solid:solidView,risks:risksView,export:exportView};
    app.innerHTML=`<div class="workspace-shell"><header class="topbar"><div class="workspace-brand"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>CodeLens</span></div><h1>${pages[state.route]}</h1></div><div class="actions">${settingsButton()}<span class="project-name mono" title="${esc(state.result.project)}">${esc(state.result.project)}</span>${button('重新导入','reimport')}<details class="dropdown"><summary aria-label="导出报告">导出报告</summary><div class="dropdown-menu">${['md','json','csv'].map(f=>button(f==='md'?'Markdown':f.toUpperCase(),'export',`data-format="${f}"`,'text')).join('')}<a href="#export" aria-label="查看报告预览">查看报告预览</a></div></details></div></header><nav class="workspace-nav" aria-label="主导航"><div class="nav-visible">${navLinks}</div><details class="nav-more dropdown"><summary aria-label="更多导航页面">更多</summary><div class="dropdown-menu">${navLinks}</div></details></nav><main id="main" tabindex="-1" aria-label="主要内容" class="content">${views[state.route]()}</main></div>${state.drawer?drawerView():''}`;
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
      state.result=result;state.importing=false;state.file=result.files[0]?.path||'';state.fn='';state.line=null;state.treeSearch='';state.graph=null;state.graphVisible=null;state.graphEntry='';state.chainEntry='';state.graphQuery='';state.barsExpanded=false;state.drawer=null;state.expanded.clear();state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};go('overview');toast('分析完成','success');
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
    llmSettings={baseUrl,model,apiKey};
    let persisted=true;
    try {if(baseUrl||model)localStorage.setItem(SETTINGS_KEY,JSON.stringify({baseUrl,model}));else localStorage.removeItem(SETTINGS_KEY);}catch {persisted=false;}
    closeSettings();
    toast(persisted?'设置已保存，尚未调用模型':'浏览器无法保存设置，本次配置仅在当前页面有效',persisted?'success':'warning');
  }
  document.addEventListener('submit',event=>{if(event.target.id==='llm-settings-form')saveSettings(event);});
  // Escape closes a native dialog without saving draft values.
  $('#settings-dialog').addEventListener('close',()=>$('#llm-settings-form').reset());

  function overviewView() {
    const s=state.result.summary||{};const counts=Object.fromEntries(Object.keys(severity).map(k=>[k,findings().filter(f=>f.severity===k).length]));const highest=Object.keys(severity).find(k=>counts[k])||'info';
    const stat=(label,value,desc,route,cls='')=>`<button class="card stat" data-action="go" data-route="${route}" aria-label="${label}，查看${pages[route]}"><span class="muted">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${desc} ▸</span></button>`;
    const stats=`<div class="stats overview-stats">${healthStat()}${stat('已解析文件',val(s.parsed),'查看项目结构','structure')}${stat('函数 / 类总数',s.functions==null||s.classes==null?'—':val(s.functions+s.classes),`${val(s.functions)} 个函数 · ${val(s.classes)} 个类`,'metrics')}${stat('风险条目',val(s.findings),'查看风险证据','risks',highest)}${stat('圈复杂度 · 平均 / 最大',`${val(s.average_cc)} <span class="muted">/</span> ${val(s.max_cc)}`,'查看函数指标','metrics',ccClass(s.max_cc))}</div>`;
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
    const walk=node=>[...node.dirs.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,child])=>`<details open><summary aria-label="展开或折叠 ${esc(name)}"><span class="mono">${esc(name)}</span></summary>${walk(child)}</details>`).join('')+node.files.map(f=>`<button class="tree-file ${state.file===f.path?'selected':''}" data-action="file" data-path="${esc(f.path)}" aria-label="${esc(f.path)}，${f.status==='error'?'解析失败':'已解析'}" title="${esc(f.path)}"><span class="file-name mono ${f.status==='error'?'critical':''}">${f.status==='error'?'! ':''}${esc(f.path.split('/').pop())}</span><small class="number">${arr(f.functions).length} 函数 / ${classes().filter(c=>c.file===f.path).length} 类</small></button>`).join('');
    return `<div class="tree"><label class="muted" for="tree-search">文件筛选</label><input id="tree-search" type="search" placeholder="搜索文件名，回车生效" value="${esc(state.treeSearch)}" aria-label="搜索文件名">${walk(root)||'<p class="muted">没有匹配的文件</p>'}<p class="footnote">类数量：${classes().length}</p></div>`;
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
    const selected=files().find(f=>f.path===state.file);const symbols=selected?card(`文件符号 <span class="mono">${esc(selected.path)}</span>`,`${table(['函数 ID','操作'],arr(selected.functions).map(f=>`<tr><td class="mono">${esc(functionId(f))}</td><td>${button('查看逻辑','function',`data-id="${esc(functionId(f))}"`,'text')}</td></tr>`).join(''))}${arr(selected.functions).length?'':'<p class="muted">此文件没有函数定义</p>'}<h3 style="margin-top:16px">类名列表</h3>${classList(selected.path)}`,button('查看文件逻辑','file-logic',`data-path="${esc(selected.path)}"`,'text')):'';
    const errors=[...arr(state.result.errors)];for(const f of files().filter(f=>f.status==='error'))if(!errors.some(e=>e.file===f.path))errors.push({file:f.path,line:typeof f.error==='object'?f.error?.line:null,type:typeof f.error==='object'?f.error?.type:null,message:typeof f.error==='object'?f.error?.message:f.error});
    return `<p class="page-intro">按文件检查分析范围、模块依赖与解析异常。</p><div class="structure-grid">${card('项目文件',treeView())}<div>${card('模块 / 包结构',table(['包路径','文件数','符号数（函数 / 类）',button('被依赖次数','package-sort','','text')],rows.map(x=>`<tr><td class="mono">${esc(x.name)}</td><td class="number">${x.files}</td><td class="number">${x.symbols}</td><td class="number">${x.dependencies}</td></tr>`).join(''))+'<p class="footnote">被依赖次数按依赖目标所属包聚合；符号数包含函数与类。</p>')}${symbols}${card('解析异常',errors.length?table(['文件路径','错误行号','错误类型','证据等级','说明'],errors.map(e=>`<tr><td class="mono">${esc(e.file)}</td><td class="number">${val(e.line)}</td><td>${val(e.type)}</td><td>${evidence('fact')}</td><td>${val(e.message)}</td></tr>`).join('')):files().length?'<p class="success">全部文件解析成功</p>':empty('当前结果没有文件'))}</div></div>`;
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
    const overFiles=new Set(fs.map(f=>fileFor(f.id)?.path));
    const listed=files().filter(f=>f.status==='ok'&&(!state.overOnly||overFiles.has(f.path)));
    const max=Math.max(1,...listed.map(f=>Number(f.code_lines)||0));
    const shown=state.barsExpanded?listed:listed.slice(0,8);
    const bars=shown.map(f=>`<div class="bar-row"><span class="mono bar-label" title="${esc(f.path)}">${esc(f.path)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Number(f.code_lines)||0)/max*100}%"></div><span class="bar-value">${val(f.code_lines)}</span></div></div>`).join('')||empty('当前条件下没有文件','metrics-reset','显示全部');
    fs=[...fs].sort((a,b)=>(Number(a[state.metricSort])-Number(b[state.metricSort]))*(state.metricAsc?1:-1));
    const header=(key,label)=>`<button class="text" data-action="metric-sort" data-key="${key}" aria-label="按${label}排序">${label}${state.metricSort===key?(state.metricAsc?' ▴':' ▾'):''}</button>`;
    const metrics=table(['函数 ID','文件',header('cc','圈复杂度'),header('length','函数长度'),header('nesting','最大 nesting')],fs.map(f=>`<tr><td class="mono">${button(f.id,'function',`data-id="${esc(f.id)}"`,'text mono')}</td><td class="mono">${esc(fileFor(f.id)?.path||'—')}</td><td class="number ${f.cc>10?'over':''}">${val(f.cc)}</td><td class="number ${f.length>50?'over':''}">${val(f.length)}</td><td class="number ${f.nesting>4?'over':''}">${val(f.nesting)}</td></tr>`).join(''));
    const groups=groupedFindings().map(([key,hits])=>[key,state.overOnly?hits.filter(f=>typeof f.actual==='number'&&typeof f.threshold==='number'&&f.actual>f.threshold):hits]).filter(([,hits])=>hits.length);
    const summary=table(['规则 ID','命中次数','涉及文件数','最高严重度','位置'],groups.map(([key,hits])=>`<tr><td class="mono">${esc(key)}</td><td class="number">${hits.length}</td><td class="number">${new Set(hits.map(f=>f.file)).size}</td><td>${tag([...hits].sort((a,b)=>weight[b.severity]-weight[a.severity])[0].severity)}</td><td><details><summary aria-label="展开规则 ${esc(key)} 命中位置">展开位置</summary><ul>${hits.map(f=>`<li class="mono">${esc(f.file)}:${val(f.line)}</li>`).join('')}</ul></details></td></tr>`).join(''));
    return `<div class="heading"><p class="muted">依据有效代码行数和函数指标检查复杂区域。</p><label><input type="checkbox" aria-label="只看超阈值" data-change="over-only" ${state.overOnly?'checked':''}> 只看超阈值</label></div>${healthCard()}${card('文件有效代码行数',`<div class="file-bars">${bars}</div>${listed.length>8?button(state.barsExpanded?'收起':'展开全部','bars-toggle',`aria-expanded="${state.barsExpanded}"`,'text'):''}<p class="footnote">超阈值筛选显示含 cc &gt; 10、length &gt; 50 或 nesting &gt; 4 函数的文件；文件行数未设阈值。</p>`)}<details class="card rule-summary" ${groups.length?'open':''}><summary aria-label="展开或折叠规则命中汇总">规则命中汇总</summary>${groups.length?summary:'<p class="muted">当前条件下没有规则命中</p>'}</details>${card('函数级指标',fs.length?metrics:empty('当前条件下没有函数','metrics-reset','显示全部'))}<p class="footnote">红色数值 = 超出默认阈值，阈值可在配置中调整</p><p class="footnote">未执行：类级指标 WMC / DIT / CBO / LCOM。</p>`;
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
    const filters=`<div class="filters"><details class="dropdown"><summary aria-label="严重度多选">严重度${r.severities.length?' · '+r.severities.map(x=>severity[x]).join('/'):' · 全部'}</summary><div class="dropdown-menu">${Object.keys(severity).map(k=>`<label><input type="checkbox" data-change="risk-severity" aria-label="筛选${severity[k]}严重度" value="${k}" ${r.severities.includes(k)?'checked':''}> ${severity[k]}</label>`).join('')}</div></details><label>证据等级<select data-change="risk-evidence" aria-label="筛选证据等级">${options([['fact','事实'],['inference','推断']],r.evidence)}</select></label><label>规则类型<select data-change="risk-rule" aria-label="筛选规则类型">${options(rules().map(x=>[x,ruleLabel(x)]),r.rule)}</select></label><label>文件<select data-change="risk-file" aria-label="筛选文件">${options(files().map(x=>[x.path,x.path]),r.file)}</select></label><label>关键字<input id="risk-query" type="search" placeholder="搜索描述或文件路径" value="${esc(r.query)}" aria-label="搜索描述或文件路径"></label>${button('重置','risk-reset','','text')}<div class="filter-stats">${Object.keys(severity).map(k=>`<span class="tag ${k}">${severity[k]} ${list.filter(f=>f.severity===k).length}</span>`).join('')}</div></div>`;
    const body=visible.map(f=>`<tr id="finding-${findings().indexOf(f)}"><td><span class="tag mono">${esc(ruleLabel(f.rule_id))}</span></td><td>${tag(f.severity)}</td><td>${evidence(f.evidence_type)}</td><td class="mono truncate" title="${esc(f.file)}:${val(f.line)}">${esc(f.file)}:${val(f.line)}</td><td>${esc(f.message)}</td><td class="number">${f.evidence_type==='inference'&&f.confidence!=null?`${Number.isFinite(Number(f.confidence))?Math.round(Number(f.confidence)*100):'—'}%`:'—'}</td><td>${button(state.expanded.has(f.id)?'收起':'详情','expand-finding',`data-id="${esc(f.id)}" aria-expanded="${state.expanded.has(f.id)}"`,'text')}</td></tr>${state.expanded.has(f.id)?`<tr class="detail-row"><td colspan="7">${findingDetail(f)}</td></tr>`:''}`).join('');
    return `<div class="heading"><p class="muted">按证据复核风险，推断条目需要人工确认。</p><div class="actions">${button('导出 JSON','export','data-format="json"')}${button('导出 CSV','export','data-format="csv"')}</div></div><section class="card">${filters}${visible.length?table(['规则类型','严重度','证据等级','位置','描述','置信度','操作'],body):empty('当前筛选条件下没有命中的风险条目','risk-reset','重置筛选')}<div class="pagination"><span class="muted">共 <span class="number">${list.length}</span> 条 · 每页 10 条</span>${button('上一页','risk-page',`data-page="${r.page-1}" ${r.page<=1?'disabled':''}`)}<span class="number">${r.page} / ${pagesCount}</span>${button('下一页','risk-page',`data-page="${r.page+1}" ${r.page>=pagesCount?'disabled':''}`)}</div></section>`;
  }
  function exportView() {
    const limits=arr(state.result.limitations);
    const preview=card('Markdown 报告预览',`<pre class="report" tabindex="0" aria-label="Markdown 报告预览">${esc(markdown())}</pre>`);
    const limitations=card('分析限制',limits.length?`<ul class="raw-list">${limits.map(note=>`<li>${esc(note)}</li>`).join('')}</ul>`:'<p class="muted">引擎未提供分析限制说明。</p>');
    const downloads=card('下载报告',[['md','Markdown','项目概览、全部风险、解析错误与分析边界。'],['json','JSON','完整分析结果，保留 API 返回的数据和源码。'],['csv','CSV','全部风险条目，包含位置、证据等级与复核建议。']].map(([format,label,description])=>`<div class="export-option">${button('导出 '+label,'export',`data-format="${format}"`,format==='md'?'primary':'')}<p>${description}</p></div>`).join(''));
    return `<div class="notice">报告由当前分析结果生成，未包含引擎未产出的项目</div><div class="split"><div>${preview}${limitations}</div><div>${downloads}</div></div>`;
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
  function graphData() {return arr(state.result.graph?.[state.graphTab==='chain'?'calls':state.graphTab]);}
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
    return `<div class="graph-controls">${entrySelector('chainEntry','入口函数')}</div><p class="footnote">从入口函数所在模块开始，仅遍历已解析边，最多 6 层；同一模块不重复展开。位置为调用发生的文件与行号。</p>${steps.length?`<ol class="call-chain">${steps.map(step=>`<li><span class="tag">第 ${step.depth} 层</span><button class="text chain-location" data-action="source-location" data-path="${esc(step.file)}" data-line="${Number(step.line)||1}" aria-label="查看 ${esc(step.target)} 在 ${esc(step.file)} 第 ${val(step.line)} 行的调用"><span class="mono">${esc(step.target)}</span><span class="mono muted">${esc(step.file)}:${val(step.line)}</span></button></li>`).join('')}</ol>`:empty('当前入口所在模块没有可达的已解析调用边。','graph-raw','查看原始调用数据')}`;
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
    return `<div class="notice">静态调用链表示可能的调用顺序，非实际执行顺序。</div><section class="card">${tabs([['calls','函数调用图'],['dependencies','模块依赖图'],['inheritance','类与继承图'],['chain','调用链']],state.graphTab,'graph-tab')}${state.graphTab==='chain'?callChainView():`<div class="graph-controls">${isCall?entrySelector('graphEntry','图谱入口函数'):''}<label>节点搜索<input id="graph-search" type="search" value="${esc(state.graphQuery)}" placeholder="输入节点名" aria-label="搜索图谱节点"></label>${select('graph-layout','布局',isCall?[['layered','分层'],['radial','放射']]:[['layered','分层']],isCall?state.graphLayoutMode:'layered')}${isCall?select('graph-granularity','粒度',[['function','函数级'],['file','文件级']],state.graphGranularity):''}${select('graph-direction','方向',[['TD','TD（从上到下）'],['LR','LR（从左到右）']],state.graphDirection,isCall&&state.graphLayoutMode==='radial')}</div><div class="heading"><span class="muted">${isCall?'入口展开：默认显示上下游各 2 层；点击 +N 展开下一层。':'拖动节点调整位置；聚焦节点后可用方向键移动。'}</span><div class="actions">${button('导出 SVG','graph-export')}${button('复制图数据','graph-copy')}${button('全屏','graph-fullscreen')}${button('重置布局','graph-reset')}</div></div><p id="graph-search-status" class="footnote" role="status" aria-live="polite"></p><div id="graph-host"></div><details class="graph-legend"><summary aria-label="展开图例说明">图例说明</summary><p class="footnote">import：棕色；call：灰色；inherit：绿色。循环边优先显示红色。虚线表示跨文件调用。悬停或聚焦连线可查看调用表达式；未解析调用不绘制目标节点。</p></details>`}</section><p class="footnote">未执行：类图的组合/关联/依赖关系、规范时序图（静态分析无法确定执行顺序，以调用链替代）。</p>`;
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
      const label=e.expression||`${e.rawSource} → ${e.rawTarget}`;
      return `<path class="graph-edge ${cycle?'cycle':''} ${cross?'cross':''}" d="${path}" stroke="${cycle?'#b91c1c':base}" marker-end="url(#${prefix}${cycle?'-red':''})" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></path>`;
    }).join('');
    const name=state.graphTab==='calls'?'函数调用图':state.graphTab==='inheritance'?'类与继承图':'模块依赖图';
    return `<svg class="graph-canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${model.width+80} ${model.height}" width="${model.width+80}" height="${model.height}" role="group" aria-label="${name}"><style>.graph-edge{fill:none;stroke-width:1.5}.graph-edge.cross{stroke-dasharray:5 4}.graph-edge:hover,.graph-edge:focus{stroke-width:3}.graph-node rect{fill:#faf7f2;stroke:#cbbba5}.graph-node.cycle rect{fill:#fef2f2;stroke:#b91c1c}.graph-node.matched rect{fill:#f3ead9;stroke:#8b5e34;stroke-width:3}.graph-node text{font:11px Consolas,monospace;fill:#292524}.graph-node:focus rect{stroke:#8b5e34;stroke-width:3}.graph-expand rect{fill:#8b5e34}.graph-expand text{fill:white;font:11px Consolas,monospace}.graph-expand:focus rect{stroke:#292524;stroke-width:2}</style><defs>${[[prefix,base],[prefix+'-red','#b91c1c']].map(([id,color])=>`<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${color}"/></marker>`).join('')}</defs>${paths}${model.nodes.map(n=>`<g class="graph-node ${cycleNodes.has(n.id)?'cycle':''} ${n.matched?'matched':''}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="查看节点 ${esc(n.id)}" data-action="graph-node" data-node="${n.index}"><title>${esc(n.id)} · ${esc(n.kind)}</title><rect width="150" height="36" rx="4"/><text x="75" y="23" text-anchor="middle">${esc(n.id.length>19?n.id.slice(0,18)+'…':n.id)}</text></g>${n.hiddenChildren.length?`<g class="graph-expand" transform="translate(${n.x+152} ${n.y+7})" tabindex="0" role="button" data-action="graph-expand" data-node="${n.index}" aria-label="展开 ${esc(n.id)} 的 ${n.hiddenChildren.length} 个子节点"><rect width="36" height="22" rx="4"/><text x="18" y="15" text-anchor="middle">+${n.hiddenChildren.length}</text></g>`:''}`).join('')}</svg>`;
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
      case 'settings-open': openSettings();break;
      case 'settings-close': closeSettings();break;
      case 'settings-clear': $('#llm-settings-form').reset();$('#settings-error').hidden=true;$('#llm-base-url').focus();break;
      case 'settings-key-toggle': {const input=$('#llm-api-key');const show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'隐藏':'显示';target.setAttribute('aria-label',show?'隐藏 API Key':'显示 API Key');target.setAttribute('aria-pressed',String(show));break;}
      case 'health-help': showHealthHelp(true);break;
      case 'bars-toggle': state.barsExpanded=!state.barsExpanded;render();break;
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
      case 'file-risks': state.risk={severities:[],evidence:'',rule:'',file:target.dataset.path,query:'',page:1};go('risks');break;
      case 'expand-finding': state.expanded.has(target.dataset.id)?state.expanded.delete(target.dataset.id):state.expanded.add(target.dataset.id);render();break;
      case 'finding-risk': {state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};const index=filteredRisks().findIndex(f=>f.id===target.dataset.id);state.risk.page=Math.floor(Math.max(0,index)/10)+1;state.expanded.add(target.dataset.id);go('risks');break;}
      case 'locate-code': locateFinding(target.dataset.id);break;
      case 'risk-reset': state.risk={severities:[],evidence:'',rule:'',file:'',query:'',page:1};render();break;
      case 'risk-page': state.risk.page=Number(target.dataset.page);render();break;
      case 'metric-sort': state.metricAsc=state.metricSort===target.dataset.key?!state.metricAsc:false;state.metricSort=target.dataset.key;render();break;
      case 'metrics-reset': state.overOnly=false;render();break;
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
    if(key==='logic-sort')state.logicSort=el.value;
    else if(key==='over-only')state.overOnly=el.checked;
    else if(key==='chain-entry')state.chainEntry=el.value;
    else if(key.startsWith('graph-')){const keys={'graph-entry':'graphEntry','graph-layout':'graphLayoutMode','graph-granularity':'graphGranularity','graph-direction':'graphDirection'};if(keys[key])state[keys[key]]=el.value;state.graph=null;state.drawer=null;if(key==='graph-entry'||key==='graph-granularity')state.graphVisible=null;}
    else if(key==='risk-severity'){state.risk.severities=el.checked?[...state.risk.severities,el.value]:state.risk.severities.filter(x=>x!==el.value);state.risk.page=1;}
    else if(key.startsWith('risk-')){state.risk[key.slice(5)]=el.value;state.risk.page=1;}
    render();
    if(key==='risk-severity'){const details=$('.filters details');if(details){details.open=true;$(`input[value="${el.value}"]`,details)?.focus();}}
  });
  document.addEventListener('input',event=>{if(event.target.id==='graph-search'){state.graphQuery=event.target.value;state.graph=null;drawGraph();return;}if(event.target.id==='risk-query'){const el=event.target;const start=el.selectionStart;state.risk.query=el.value;state.risk.page=1;render();const next=$('#risk-query');next.focus();next.setSelectionRange(start,start);}});
  document.addEventListener('pointerover',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true);});
  document.addEventListener('focusin',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true);});
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
})();

