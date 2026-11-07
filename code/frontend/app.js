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
  const pages = {overview:'总览',structure:'项目结构',logic:'逻辑说明',metrics:'质量体检',solid:'设计检查',risks:'风险清单'};
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
  const state = {result:null,ready:false,connecting:true,token:'',version:'',aiCompatible:false,exportAi:true,exportSource:false,importing:true,busy:false,phase:'',read:0,error:[],ignored:{},route:'overview',file:'',fn:'',treeSearch:'',line:null,overOnly:false,expanded:new Set(),controller:null};
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
  function showHealthHelp(open) {
    const popup=$('#health-explanation'),button=$('[data-action="health-help"]');if(!popup||!button)return;
    button.setAttribute('aria-expanded',String(open));
    if(!open){popup.hidden=true;return;}
    popup.hidden=false;
    const anchor=button.getBoundingClientRect(),box=popup.getBoundingClientRect();
    const x=Math.max(8,Math.min(anchor.right+12,innerWidth-box.width-8));
    const y=Math.max(8,Math.min(anchor.bottom+12,innerHeight-box.height-8));
    popup.style.left=`${x}px`;popup.style.top=`${y}px`;
  }
  const functions = () => arr(state.result?.functions);
  const classes = () => arr(state.result?.classes);
  const files = () => arr(state.result?.files);
  const findings = () => arr(state.result?.findings);
  const rules = () => arr(state.result?.config?.rules);
  const functionId = f => typeof f==='string'?f:f?.id;
  const fileFor = id => files().find(f=>arr(f.functions).some(fn=>functionId(fn)===id));
  const fileLanguage = file => file?.language || (/\.py$/i.test(file?.path||'')?'Python':'源码');
  function toast(message, type='info') {
    const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;$('#toasts').append(node);setTimeout(()=>node.remove(),3000);
  }
  function modal(title, content, variant='') {
    const d=$('#detail-dialog');d.className=`wide-dialog${variant?' '+variant:''}`;d.innerHTML=`<div class="heading"><h2>${esc(title)}</h2>${button('关闭','close-dialog')}</div>${content}`;if(!d.open)d.showModal();
  }
  function openSourceEditor(file,focusLine=0) {
    if(!file?.source){toast('当前结果没有可显示的源码','warning');return;}
    const lines=file.source.split('\n');
    const source=lines.map((line,index)=>`<div class="source-line${index+1===focusLine?' highlight':''}" data-line="${index+1}"><span class="line-number">${index+1}</span><code>${esc(line)||' '}</code></div>`).join('');
    modal(`源码 · ${file.path}`,`<div class="source-editor" tabindex="0" aria-label="${esc(file.path)} 源码编辑器"><div class="source-editor__lines">${source}</div></div>`,'source-editor-dialog');
    requestAnimationFrame(()=>{const target=$(`.source-editor .source-line[data-line="${focusLine||1}"]`);target?.scrollIntoView({block:'center'});target?.querySelector('code')?.focus?.();});
  }
  async function copy(text) {
    try {await navigator.clipboard.writeText(text);toast('已复制到剪贴板','success');}
    catch {modal('请手动复制',`<p>无法访问剪贴板，请选中下方内容手动复制。</p><textarea aria-label="待复制内容" style="width:100%;min-height:220px">${esc(text)}</textarea>`);toast('复制失败，请手动复制','warning');}
  }
  function download(content, type, extension) {
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.setAttribute('aria-label','下载分析报告');a.download=`codelens-report.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已生成下载文件','success');
  }
  function reportData() {
    const r=state.result;
    const {graph,...report}=r;
    return {...report,files:files().map(f=>{const copy={...f};if(!state.exportSource)delete copy.source;return copy;}),ai_explanations:state.exportAi?[...aiLogic.cache.values()]:[]};
  }
  function reportAppendix(safe) {
    const r=state.result;
    const health=r.health;
    const special=arr(r.special_risks?.categories).map(category=>`### ${safe(category.label)}\n\n${safe(category.description)}\n\n${arr(category.items).map(item=>`- ${safe(item.file)}:${item.line??'—'} ${safe(item.message)}`).join('\n')||'未发现。'}`).join('\n\n')||'无';
    return `\n\n## 代码专项评估\n\n${special}\n\n## 健康度\n\n${health?`${safe(health.score)} · ${safe(health.grade)}\n\n${safe(health.formula)}`:'无'}\n\n## 类级指标\n\n${arr(r.class_metrics).map(c=>`- ${safe(c.id)}：WMC=${c.wmc} DIT=${c.dit??'未知'} CBO=${c.cbo} LCOM1=${c.lcom}`).join('\n')||'无'}\n\n## 结构重复\n\n${arr(r.duplicates).map(g=>'- '+g.occurrences.map(o=>`${safe(o.file)}:${o.line}`).join(' / ')).join('\n')||'无'}\n\n## AI 逻辑解读\n\n${state.exportAi?[...aiLogic.cache.values()].map(a=>`### ${safe(a.function||a.file)}\n\n模型：${safe(a.model)}；AI 生成内容，需人工复核。\n\n范围：${arr(a.context).map(c=>`${safe(c.file)}:${c.line}-${c.end_line}`).join('、')}\n\n${String(a.text).split('\n').map(safe).join('\n')}\n`).join('\n')||'本次尚未生成 AI 解读。':'用户选择不包含 AI 解读。'}\n`;
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
    const hash=location.hash.slice(1);state.route=Object.hasOwn(pages,hash)?hash:'overview';
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
    const views={overview:overviewView,structure:structureView,logic:logicView,metrics:metricsView,solid:solidView,risks:risksView};
    const exportMenu=`<details class="dropdown export-dropdown"><summary aria-label="导出报告">导出报告</summary><div class="dropdown-menu"><label><input type="checkbox" data-change="export-ai" ${state.exportAi?'checked':''}> 包含 AI 解读</label><label><input type="checkbox" data-change="export-source" ${state.exportSource?'checked':''}> JSON 包含源码</label>${['md','json','csv'].map(f=>button(f==='md'?'Markdown':f.toUpperCase(),'export',`data-format="${f}"`,'text')).join('')}</div></details>`;
    app.innerHTML=`<div class="workspace-shell"><header class="topbar"><div class="workspace-brand"><div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>CodeLens</span></div><h1>${pages[state.route]}</h1></div><div class="actions">${settingsButton()}<span class="project-name mono" title="${esc(state.result.project)}">${esc(state.result.project)}</span>${button('重新导入','reimport')}${exportMenu}</div></header><nav class="workspace-nav" aria-label="主导航"><div class="nav-visible">${navLinks}</div><details class="nav-more dropdown"><summary aria-label="更多导航页面">更多</summary><div class="dropdown-menu">${navLinks}</div></details></nav><main id="main" tabindex="-1" aria-label="主要内容" class="content" data-route="${state.route}">${views[state.route]()}</main></div>`;
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
      resetAiLogic();state.result=result;state.importing=false;state.file=result.files[0]?.path||'';state.fn='';state.line=null;state.treeSearch='';state.expanded.clear();go('overview');toast('分析完成','success');
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
    document.body.classList.add('modal-open');
    $('#settings-dialog').showModal();
  }
  function closeSettings() {
    document.body.classList.remove('modal-open');
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
  $('#settings-dialog').addEventListener('close',()=>{document.body.classList.remove('modal-open');$('#llm-settings-form').reset();});

  function overviewView() {
    const s=state.result.summary||{};const counts=Object.fromEntries(Object.keys(severity).map(k=>[k,findings().filter(f=>f.severity===k).length]));const highest=Object.keys(severity).find(k=>counts[k])||'info';
    const stat=(label,value,desc,route,cls='')=>`<button class="card stat" data-action="go" data-route="${route}" aria-label="${label}，查看${pages[route]}"><span class="muted">${label}</span><strong class="${cls}">${value}</strong><span class="muted">${desc} ▸</span></button>`;
    const stats=`<div class="stats overview-stats">${healthStat()}${stat('已解析文件',val(s.parsed),'查看项目结构','structure')}${stat('函数 / 类总数',s.functions==null||s.classes==null?'—':val(s.functions+s.classes),`${val(s.functions)} 个函数 · ${val(s.classes)} 个类`,'metrics')}${stat('风险条目',val(s.findings),'查看风险证据','risks',highest)}${stat('圈复杂度 · 平均 / 最大',`${val(s.average_cc)} <span class="muted">/</span> ${val(s.max_cc)}`,'查看函数指标','metrics',ccClass(s.max_cc))}</div>`;
    const ratio=Math.min(1,Math.max(0,Number(s.max_cc)/20));const arc=2*Math.PI*72*.75;
    const gauge=s.max_cc==null?placeholder('最大圈复杂度'):`<div class="chart-body"><svg viewBox="0 0 240 200" role="img" aria-label="最大圈复杂度 ${esc(s.max_cc)}，参考阈值 20"><circle cx="120" cy="96" r="72" fill="none" stroke="#eee7db" stroke-width="14" stroke-dasharray="${arc} ${2*Math.PI*72}" transform="rotate(135 120 96)"/><circle cx="120" cy="96" r="72" fill="none" stroke="${s.max_cc>20?colors.critical:s.max_cc>10?colors.warning:'#8b5e34'}" stroke-width="14" stroke-dasharray="${arc*ratio} ${2*Math.PI*72}" transform="rotate(135 120 96)"/><text x="120" y="103" text-anchor="middle" font-size="34" font-family="Consolas,monospace" fill="#292524">${val(s.max_cc)}</text><text x="120" y="128" text-anchor="middle" font-size="11" fill="#78716c">最大圈复杂度</text><text x="120" y="184" text-anchor="middle" font-size="12" fill="#78716c">参考阈值 20 · 超出部分不延长圆弧</text></svg><div><h3>${s.max_cc>20?'超过参考阈值':s.max_cc>10?'超过默认阈值 10':'未超过默认阈值 10'}</h3>${button('查看函数指标','go','data-route="metrics"','text')}</div></div>`;
    const total=Object.values(counts).reduce((a,b)=>a+b,0);let start=-Math.PI/2;
    const pie=Object.entries(counts).filter(([,n])=>n).map(([key,n])=>{const angle=n/total*Math.PI*2;const end=start+angle;const path=angle>=Math.PI*2-.0001?`<circle cx="100" cy="100" r="76" fill="${colors[key]}"/>`:`<path d="M100 100 L${100+76*Math.cos(start)} ${100+76*Math.sin(start)} A76 76 0 ${angle>Math.PI?1:0} 1 ${100+76*Math.cos(end)} ${100+76*Math.sin(end)} Z" fill="${colors[key]}"/>`;start=end;return path;}).join('');
    const dist=total?`<div class="chart-body"><svg viewBox="0 0 200 200" role="img" aria-label="风险严重度分布">${pie}</svg><div class="legend">${Object.keys(severity).map(k=>`<span><i class="swatch" style="background:${colors[k]}"></i>${severity[k]} <b class="number">${counts[k]}</b></span>`).join('')}</div></div>`:empty('当前分析没有风险条目','go','查看项目结构').replace('data-action="go"','data-action="go" data-route="structure"');
    return `${stats}<div class="split">${card('复杂度参考',gauge)}${card('风险分布',dist)}</div>`;
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
    for(const file of files()){const name=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')):'（根目录）';if(!packages.has(name))packages.set(name,{name,files:0,symbols:0});const row=packages.get(name);row.files++;row.symbols+=arr(file.functions).length+classes().filter(c=>c.file===file.path).length;}
    const rows=[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name));
    const selected=files().find(f=>f.path===state.file);
    const selectedStrip=selected?`<div class="selected-file"><span class="mono">${esc(selected.path)}</span><span>${esc(fileLanguage(selected))} · ${arr(selected.functions).length} 函数 · ${classes().filter(c=>c.file===selected.path).length} 类</span>${button('查看逻辑','file-logic',`data-path="${esc(selected.path)}"`,'text')}</div>`:'';
    const errors=[...arr(state.result.errors)];for(const f of files().filter(f=>f.status==='error'))if(!errors.some(e=>e.file===f.path))errors.push({file:f.path,line:typeof f.error==='object'?f.error?.line:null,type:typeof f.error==='object'?f.error?.type:null,message:typeof f.error==='object'?f.error?.message:f.error});
    const errorNote=errors.length?`<div class="parse-note" role="status">${errors.length} 个文件未能解析：${errors.slice(0,2).map(e=>`${esc(e.file)}${e.line?`:${e.line}`:''}`).join('、')}${errors.length>2?' 等':''}</div>`:'';
    return `<div class="structure-grid">${card('项目文件',treeView())}<section class="card structure-overview"><div class="heading"><h2>模块概览</h2><span class="muted">${files().length} 文件</span></div>${selectedStrip}${table(['包路径','文件数','符号数'],rows.map(x=>`<tr><td class="mono">${esc(x.name)}</td><td class="number">${x.files}</td><td class="number">${x.symbols}</td></tr>`).join(''))}${errorNote}</section></div>`;
  }
  const aiLogic = {cache:new Map(), busy:false, key:'', error:'', controller:null, batch:false, batchDone:0, batchTotal:0, batchCurrent:'', batchErrors:[]};
  function resetAiLogic() {
    aiLogic.controller?.abort();aiLogic.controller=null;aiLogic.busy=false;aiLogic.key='';aiLogic.error='';aiLogic.batch=false;aiLogic.batchDone=0;aiLogic.batchTotal=0;aiLogic.batchCurrent='';aiLogic.batchErrors=[];aiLogic.cache.clear();
  }
  const logicKey = () => JSON.stringify([state.file,state.fn]);
  async function requestExplanation(file,fn,controller,includeContext=true) {
    const configured=Boolean(llmSettings.baseUrl||llmSettings.model||llmSettings.apiKey);
    const payload={project:state.result.project,files:files().filter(f=>f.status==='ok').map(f=>({path:f.path,content:f.source})),include_context:includeContext,target:{file:file.path,function:fn||null}};
    if(configured)payload.provider={base_url:llmSettings.baseUrl,model:llmSettings.model,api_key:llmSettings.apiKey};
    const response=await fetch('/api/explain',{method:'POST',headers:{'Content-Type':'application/json','X-CodeLens-Token':state.token},body:JSON.stringify(payload),signal:controller.signal});
    const data=await response.json();if(!response.ok)throw Error(typeof data.error==='string'?data.error:'AI 解读失败，请重试');
    if(typeof data.text!=='string'||!data.text.trim())throw Error('模型未返回有效解读');
    return data;
  }
  async function explainLogic() {
    if(aiLogic.busy||!state.result)return;
    if(state.aiCompatible===false){toast('后台版本不兼容，请重启服务后刷新页面','warning');return;}
    const file=files().find(f=>f.path===state.file);if(!file||file.status!=='ok')return;
    const key=logicKey(),project=state.result,controller=new AbortController();
    aiLogic.busy=true;aiLogic.batch=false;aiLogic.key=key;aiLogic.error='';aiLogic.controller=controller;render();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},60000);
    try {
      const data=await requestExplanation(file,state.fn,controller,true);
      if(state.result===project&&aiLogic.controller===controller)aiLogic.cache.set(key,data);
    } catch(error) {
      if(aiLogic.controller===controller)aiLogic.error=error.name==='AbortError'?(timedOut?'解读超时，请缩小范围后重试。':'已取消本次解读。'):error instanceof TypeError?'无法连接解读服务，请检查本机服务后重试。':error.message;
    } finally {
      clearTimeout(timer);if(aiLogic.controller===controller){aiLogic.busy=false;aiLogic.controller=null;render();}
    }
  }
  async function explainAllFiles() {
    if(aiLogic.busy||!state.result)return;
    if(state.aiCompatible===false){toast('后台版本不兼容，请重启服务后刷新页面','warning');return;}
    const queue=files().filter(f=>f.status==='ok').map(f=>f);
    if(!queue.length){toast('当前没有可解读的文件','warning');return;}
    const controller=new AbortController();
    aiLogic.busy=true;aiLogic.batch=true;aiLogic.key='';aiLogic.error='';aiLogic.controller=controller;
    aiLogic.batchDone=0;aiLogic.batchTotal=queue.length;aiLogic.batchCurrent='';aiLogic.batchErrors=[];
    render();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},120000);
    async function worker(){
      while(queue.length&&!controller.signal.aborted){
        const file=queue.shift();
        aiLogic.batchCurrent=file.path;render();
        try {
          const data=await requestExplanation(file,'',controller,false);
          aiLogic.cache.set(JSON.stringify([file.path,'']),data);
        } catch(error) {
          if(error.name!=='AbortError')aiLogic.batchErrors.push(`${file.path}：${error.message||'解读失败'}`);
        } finally {
          aiLogic.batchDone++;render();
        }
      }
    }
    try {await Promise.all([worker(),worker()]);}
    finally {
      clearTimeout(timer);
      if(aiLogic.controller===controller){
        aiLogic.busy=false;aiLogic.controller=null;aiLogic.batchCurrent='';
        if(controller.signal.aborted)aiLogic.error=timedOut?'批量解读超时，请减少文件数量后重试。':'已取消批量解读。';
        render();
      }
    }
  }
  function renderExplanation(result) {
    const chars=Array.from(result.text);let cursor=0,html='';
    for(const citation of arr(result.citations)){
      html+=esc(chars.slice(cursor,citation.start).join(''));
      const label=chars.slice(citation.start,citation.end).join('');
      html+=citation.valid?button(label,'ai-citation',`data-path="${esc(citation.file)}" data-line="${citation.line}" data-end="${citation.end_line}"`,'text citation'):`<span class="citation-invalid" title="引用位置未通过校验">${esc(label)}（引用未验证）</span>`;
      cursor=citation.end;
    }
    return html+esc(chars.slice(cursor).join(''));
  }
  function logicView() {
    const file=files().find(f=>f.path===state.file)||files()[0];if(file)state.file=file.path;
    const list=functions().filter(f=>f.file===file?.path);
    if(state.fn&&!list.some(f=>f.id===state.fn))state.fn='';
    const key=logicKey(),result=aiLogic.cache.get(key),pending=aiLogic.busy&&!aiLogic.batch&&aiLogic.key===key;
    const selector=`<label for="ai-logic-target">解读范围</label><select id="ai-logic-target" data-change="ai-logic-target" aria-label="解读范围"><option value="">整个文件</option>${list.map(f=>`<option value="${esc(f.id)}" ${state.fn===f.id?'selected':''}>${esc(f.id)}</option>`).join('')}</select>`;
    const controls=`<div class="ai-logic-toolbar">${selector}<button class="primary" data-action="ai-explain" ${aiLogic.busy||file?.status!=='ok'||state.aiCompatible===false?'disabled':''}>${result?'重新生成解读':'生成 AI 解读'}</button><button data-action="ai-explain-all" ${aiLogic.busy||state.aiCompatible===false?'disabled':''}>一键解读所有文件</button>${aiLogic.busy?button('取消解读','ai-explain-cancel','','text'):''}${result?button('复制当前解读','ai-explain-copy','','text'):''}</div>`;
    const batchEntries=files().filter(f=>f.status==='ok').map(file=>[file,aiLogic.cache.get(JSON.stringify([file.path,'']))]).filter(([,entry])=>entry);
    const batchBody=`<div class="batch-analysis"><div class="batch-analysis__status"><strong>${aiLogic.batchDone} / ${aiLogic.batchTotal}</strong><span>${aiLogic.busy?`正在分析 ${esc(aiLogic.batchCurrent||'…')}`:'批量解读完成'}</span></div>${aiLogic.batchErrors.length?`<div class="error-box" role="alert">${aiLogic.batchErrors.map(esc).join('<br>')}</div>`:''}${batchEntries.length?`<div class="batch-analysis__results">${batchEntries.map(([entryFile,entry])=>`<section class="batch-result"><h3 class="mono">${esc(entryFile.path)}</h3><div class="ai-explanation">${renderExplanation(entry)}</div></section>`).join('')}</div>`:`<div class="ai-reading-state" role="status"><div class="skeleton"></div><p>AI 正在逐个读取文件…</p></div>`}</div>`;
    const body=aiLogic.batch?batchBody:pending?'<div class="ai-reading-state" role="status"><div class="skeleton"></div><p>AI 正在阅读源码…</p><small>最多等待 60 秒，可取消本次请求。</small></div>':result?`<div class="ai-explanation">${renderExplanation(result)}</div><p class="footnote">模型：${esc(result.model)} · ${esc(result.file)}:${val(result.line)}–${val(result.end_line)}</p>${result.omitted_context?'<p class="notice">部分依赖超过上下文上限，未发送。</p>':''}${result.truncated?'<p class="notice">模型输出达到长度限制，解读可能不完整。</p>':''}`:'<div class="ai-reading-state"><h3>尚未生成解读</h3><p>选择文件或函数后生成解读。</p></div>';
    const error=aiLogic.key===key&&aiLogic.error?`<div class="error-box" role="alert">${esc(aiLogic.error)}</div>`:'';
    const sourceAction=file?.source!=null?button('查看原始源码','source-editor',`data-path="${esc(file.path)}" data-line="${Number(state.line?.start)||1}"`,'text'):'';
    return `<div class="ai-logic-grid">${card('项目文件',treeView())}<section class="card ai-logic-reader"><div class="heading"><div><h2>AI 逻辑解读</h2><p class="mono muted">${esc(file?.path||'未选择文件')}</p></div><div class="actions">${sourceAction}${button('配置模型','settings-open','','text')}</div></div>${controls}${state.aiCompatible===false?'<div class="error-box" role="alert">后台版本不兼容，请重启服务后刷新页面。</div>':''}${error}<div class="ai-output-frame">${body}${aiLogic.busy&&!pending?'<p role="status">其他范围正在解读，请等待或取消。</p>':''}</div></section></div>`;
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
    const source=arr(report?.categories).length?report.categories:specialRiskDefs.map(([id,label,description])=>({id,label,description,count:0,items:[]}));
    const categories=source.map(category=>{
      const items=arr(category.items).filter(item=>item.severity==='critical'||item.severity==='warning');
      return {...category,items,count:items.length,severity:items.some(item=>item.severity==='critical')?'critical':'warning'};
    }).filter(category=>category.count);
    const flagged=categories.filter(c=>c.count).length;
    if(!flagged)return '<div class="empty"><p>未发现高影响风险</p></div>';
    const rows=categories.map(category=>{
      const label=`<span class="risk-row__label"><strong>${esc(category.label)}</strong><small>${category.count?`${category.count} 项`:'未发现'}</small></span>`;
      return `<details class="risk-row"><summary>${label}<span class="risk-row__meta">${tag(category.severity)}<span>展开</span></span></summary><div class="risk-row__body"><ul>${category.items.map(item=>`<li><button class="risk-location" data-action="source-location" data-path="${esc(item.file||'')}" data-line="${Number(item.line)||1}"><span class="mono">${esc(item.file||'')}:${val(item.line)}</span><span>${esc(item.message||'')}</span></button></li>`).join('')}</ul>${category.truncated?'<p class="footnote">仅展示前 30 条</p>':''}</div></details>`;
    }).join('');
    return `<div class="special-risk-summary"><strong>${flagged}</strong><span>类高影响风险</span></div><section class="card risk-report-list">${rows}</section>`;
  }
  const compareText=(a,b)=>String(a??'')<String(b??'')?-1:String(a??'')>String(b??'')?1:0;
  function functionFile(fn) {return fn?.file||fileFor(fn?.id)?.path||'';}
  function enclosingFunction(path,line) {
    // Only backend-provided ranges establish ownership; never parse or execute source here.
    const matches=functions().filter(f=>functionFile(f)===path&&Number.isFinite(f.line)&&Number.isFinite(f.end_line)&&f.line<=line&&line<=f.end_line);
    return matches.sort((a,b)=>(a.end_line-a.line)-(b.end_line-b.line)||compareText(a.id,b.id))[0];
  }
  function openFunction(id) {const file=fileFor(id);state.fn=id;state.file=file?.path||state.file;state.line=null;go('logic');}
  function locateFinding(id) {
    const f=findings().find(x=>x.id===id);if(!f)return;
    const file=files().find(x=>x.path===f.file);if(!file){toast(`目标位置：${f.file}:${f.line??'—'}，结果中没有对应源码`,'warning');return;}
    const ids=new Set(arr(file.functions).map(functionId));const candidates=functions().filter(fn=>ids.has(fn.id)&&arr(fn.statements).some(s=>s.line<=f.line&&s.end_line>=f.line));
    candidates.sort((a,b)=>a.length-b.length);state.file=file.path;state.fn=candidates[0]?.id||functionId(arr(file.functions)[0])||'';state.line={start:f.line,end:f.line,index:-1};go('logic');toast(`目标位置：${f.file}:${f.line??'—'}`);
  }
  document.addEventListener('click',event=>{
    if(!event.target.closest('.health-help'))showHealthHelp(false);
    const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
    const action=target.dataset.action;
    switch(action){
      case 'ai-citation': {const file=files().find(f=>f.path===target.dataset.path);if(file){modal('源码引用',`<p class="mono">${esc(file.path)}:${target.dataset.line}–${target.dataset.end}</p><div class="source">${file.source.split('\n').slice(Math.max(0,Number(target.dataset.line)-3),Number(target.dataset.end)+2).map((line,i)=>{const n=Math.max(1,Number(target.dataset.line)-2)+i;return `<div class="source-line ${n>=Number(target.dataset.line)&&n<=Number(target.dataset.end)?'highlight':''}"><span class="line-number">${n}</span><code>${esc(line)||' '}</code></div>`;}).join('')}</div>`);}break;}
      case 'ai-explain': explainLogic();break;
      case 'ai-explain-all': explainAllFiles();break;
      case 'ai-explain-cancel': aiLogic.controller?.abort();break;
      case 'ai-explain-copy': {const result=aiLogic.cache.get(logicKey());if(result)copy(result.text);break;}
      case 'source-editor': {const file=files().find(f=>f.path===target.dataset.path);if(file)openSourceEditor(file,Number(target.dataset.line)||1);break;}
      case 'settings-open': openSettings();break;
      case 'settings-close': closeSettings();break;
      case 'settings-clear': $('#llm-settings-form').reset();$('#settings-error').hidden=true;$('#llm-base-url').focus();break;
      case 'settings-key-toggle': {const input=$('#llm-api-key');const show=input.type==='password';input.type=show?'text':'password';target.textContent=show?'隐藏':'显示';target.setAttribute('aria-label',show?'隐藏 API Key':'显示 API Key');target.setAttribute('aria-pressed',String(show));break;}
      case 'health-help': showHealthHelp(true);break;
      case 'source-location': if(!files().some(f=>f.path===target.dataset.path)){toast('分析结果中没有该文件，无法定位源码','warning');break;}state.file=target.dataset.path;state.fn=enclosingFunction(state.file,Number(target.dataset.line))?.id||'';state.line={start:Number(target.dataset.line),end:Number(target.dataset.line),index:-1};go('logic');break;
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
      case 'logic-tab': state.logicTab=target.dataset.tab;render();break;
      case 'copy-id': copy(state.fn);break;
      case 'statement': {const f=functions().find(x=>x.id===state.fn);const s=arr(f?.statements)[Number(target.dataset.index)];if(s){state.line={start:s.line,end:s.end_line??s.line,index:Number(target.dataset.index)};$$('.statement').forEach(el=>el.classList.toggle('selected',el===target));highlightSource();}break;}
      case 'file-risks': go('risks');break;
      case 'expand-finding': state.expanded.has(target.dataset.id)?state.expanded.delete(target.dataset.id):state.expanded.add(target.dataset.id);render();break;
      case 'finding-risk': go('risks');break;
      case 'locate-code': locateFinding(target.dataset.id);break;
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;if(el.id==='folder-input'){analyze([...el.files]);return;}
    const key=el.dataset.change;if(!key)return;
    if(key==='export-ai'){state.exportAi=el.checked;return;}
    else if(key==='export-source'){state.exportSource=el.checked;return;}
    else if(key==='logic-sort')state.logicSort=el.value;
    else if(key==='over-only')state.overOnly=el.checked;
    else if(key==='ai-logic-target'){state.fn=el.value;state.line=null;aiLogic.batch=false;}
    render();
  });
  document.addEventListener('pointerover',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true);});
  document.addEventListener('pointerout',event=>{const help=event.target.closest('.health-help');if(help&&!help.contains(event.relatedTarget))showHealthHelp(false);});
  document.addEventListener('focusin',event=>{if(event.target.closest('[data-action="health-help"]'))showHealthHelp(true);});
  document.addEventListener('focusout',event=>{const help=event.target.closest('.health-help');if(help&&!help.contains(event.relatedTarget))showHealthHelp(false);});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')showHealthHelp(false);
    if(event.target.id==='tree-search'&&(event.key==='Enter'||event.key==='Escape')){event.preventDefault();state.treeSearch=event.key==='Escape'?'':event.target.value;render();$('#tree-search')?.focus();return;}
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"]:not(button),a')){if(event.target.matches('a')&&event.key==='Enter')return;event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
  });
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

