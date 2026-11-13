/* Agent management is a workspace page. Catalog reads are cached; remote
   commands run only after an explicit diagnostic action. */
(() => {
  'use strict';
  const page = document.getElementById('agentCenterPage');
  if (!page) return;
  const icon = name => window.AgentHubIcons.svg(name);
  const keyOf = (agent, hostId) => JSON.stringify([hostId || 'local', agent]);
  const state = { open: false, generation: 0, data: null, selected: '', query: '', host: '', tab: 'config',
    layout: 'overview', all: true, limit: 80, statusFilter: 'all', showHidden: false, lastSsh: '', request: 0,
    drafts: new Map(), task: null, pending: new Set(), legacy: false, extended: false, returnRefresh: false };
  const parse = key => { try { const [host,agent] = JSON.parse(key); return {agent,hostId:host==='local'?'':host}; } catch { return {}; } };
  const current = () => parse(state.selected);
  const active = generation => state.open && state.generation === generation;
  const meta = id => (state.data?.agents || S.agents || []).find(a => a.id === id);
  const providers = () => state.data?.providers || S.providers || [];
  const hostName = id => !id ? '本机' : id==='wsl' ? 'WSL' : ((state.data?.hosts || S.hosts).find(h=>h.id===id)?.name || (state.data?.hosts || S.hosts).find(h=>h.id===id)?.host || '已移除的主机');
  const targets = () => [{id:'',name:'本机'}, ...(S.wsl?.available ? [{id:'wsl',name:'WSL'}] : []), ...(state.data?.hosts || S.hosts || []).map(h=>({id:h.id,name:'SSH · '+(h.name||h.host)}))];
  const raw = (agent,hostId) => state.data?.configurations?.[hostId||'local']?.[agent] || {};
  const supported = (a,hostId) => agentSupportsEnvironment(a,hostId);
  function draft(agent,hostId) {
    const key=keyOf(agent,hostId);
    if (!state.drafts.has(key)) state.drafts.set(key,{...raw(agent,hostId),dirty:false,revision:0});
    return state.drafts.get(key);
  }
  const nativeConnection=agent=>isAcpAgent(agent)||['gemini','opencode'].includes(agent)||meta(agent)?.sharedModels===false;
  function resolved(agent,hostId,cfg=raw(agent,hostId)) {
    if(nativeConnection(agent))return {providerId:'',provider:null,model:cfg.model||'',effort:hostId?'':cfg.effort||'',permMode:cfg.permMode||'',source:'执行器自身配置'};
    const global=state.data?.modelDefaults || S.settings?.modelDefaults || {};
    const explicit=state.data?.routes?.[agent] || {};
    const sameGlobal=!explicit.providerId||explicit.providerId===global.providerId;
    const base={providerId:explicit.providerId||global.providerId||S.settings?.currentProvider?.[agent]||'',model:explicit.model||(sameGlobal?global.model:'')||'',effort:explicit.effort||(sameGlobal?global.effort:'')||''};
    const same=!cfg.providerId || cfg.providerId===base.providerId;
    const providerId=cfg.providerId || base.providerId || '';
    const provider=providers().find(p=>p.id===providerId);
    return {providerId,provider,model:cfg.model || (same?base.model:'') || provider?.model || '',
      effort:cfg.effort || (same?base.effort:'') || provider?.effort || '',permMode:cfg.permMode||'',
      ...(agent==='dsh'?{dshPermission:cfg.dshPermission||'default'}:{}),
      source:cfg.model || cfg.providerId ? hostName(hostId)+'配置' : base.model || base.providerId ? (global.providerId && base.providerId===global.providerId ? '全局默认' : 'Agent 默认') : 'CLI / 应用默认'};
  }
  function status(agent,hostId) {
    const check=state.data?.checks?.[keyOf(agent,hostId)],a=meta(agent);
    if(state.pending.has(keyOf(agent,hostId)))return {text:'检测中…',tone:'warn'};
    if(check?.host==='failed')return {text:'连接失败',tone:'error'};
    if(check?.cli==='missing')return {text:'未安装',tone:'muted'};
    if(check?.cli==='failed')return {text:'启动失败',tone:'error'};
    if(check?.cli==='unverified')return {text:'版本未确认',tone:'warn'};
    if(check?.cli==='ready')return {text:'CLI 可用',tone:'ok'};
    if(check?.cli==='not-required')return {text:'内置服务',tone:'ok'};
    if(check?.cli==='managed')return {text:'ACP 接入',tone:'muted'};
    if(!hostId && ['builtin','chatgpt-web'].includes(agent))return {text:'内置服务',tone:'ok'};
    if(!hostId && a?.probePending)return {text:'正在检测',tone:'warn'};
    if(!hostId && (!raw(agent,hostId).command||raw(agent,hostId).command===a?.configuredCommand||raw(agent,hostId).command===a?.bin)){
      if(a?.acp&&agentIsReady(a))return {text:'已发现 · ACP',tone:'ok'};
      if(a?.ready===true&&a?.version)return {text:'CLI 可用',tone:'ok'};
      if(a?.probeError)return {text:'启动异常',tone:'error'};
      if(a?.pathFound===false||a?.found===false&&!a?.custom)return {text:'未安装',tone:'muted'};
    }
    if(!hostId && (a?.custom||a?.id.startsWith('acp:')) && agentIsReady(a))return {text:'已发现',tone:'muted'};
    if(!hostId && !raw(agent,hostId).command && agentIsReady(a))return {text:'已发现',tone:'muted'};
    if(Object.keys(raw(agent,hostId)).length)return {text:'待检测',tone:'warn'};
    return {text:'未检测',tone:'muted'};
  }
  function notice(text,tone='error') {
    const box=page.querySelector('#acNotice'); if(!box)return;
    box.hidden=!text;box.className='ac-notice '+tone;box.textContent=text;
    box.setAttribute('role',tone==='error'?'alert':'status');
  }
  function markNavigation() {
    document.getElementById('btnAgentCenter')?.classList.toggle('active',state.open&&state.layout!=='environments');
    document.getElementById('btnEnvironments')?.classList.toggle('active',state.open&&state.layout==='environments');
  }
  function close() {
    if(!state.open)return;
    setCatalogOpen(false);
    state.open=false;state.returnRefresh=false;++state.generation;page.hidden=true;document.body.classList.remove('agent-center-open');markNavigation();
  }
  function setCatalogOpen(open) {
    page.classList.toggle('ac-catalog-open',open);
    page.querySelector('[data-ac-action="catalog"]')?.setAttribute('aria-expanded',String(open));
  }
  async function load(generation,refresh=false) {
    const request=++state.request;
    let data,legacy=false;
    try { data=await api('/api/agent-center'+(refresh?'?refresh=1':'')); }
    catch(error) {
      if(!active(generation))return;
      if(error.message!=='404')throw error;
      legacy=true;
      data={agents:S.agents,hosts:S.hosts,configurations:S.settings?.agentTargets||{},routes:S.settings?.agentRoutes||{},checks:{}};
    }
    if(!active(generation)||request!==state.request)return;
    state.legacy=legacy;
    state.extended=Number(data.version)>=2;
    state.data=data;
    for(const [key,value]of state.drafts)if(!value.dirty&&!value.saving&&!(key===state.selected&&page.querySelector('#acConfigForm'))){
      const {agent,hostId}=parse(key);state.drafts.set(key,{...raw(agent,hostId),dirty:false,revision:value.revision,editing:value.editing});
    }
    window.AgentHubIdentity?.setAgents(data.agents);
    if(!meta(current().agent))state.selected=keyOf(data.agents.find(a=>a.id===S.curAgent)?.id || data.agents[0]?.id || 'claude','');
    const editing=!!page.querySelector('#acConfigForm');
    renderRows();if(!editing)renderDetail();renderFilters();
    if(state.legacy)notice('新版 Agent 管理需要重启后端。当前可浏览目录；配置保存与环境检测在重启后启用。','warn');
    else if(!state.extended)notice('常用整理、启停和工具开关需要重启后端；页面样式、总览和会话入口已可使用。','warn');
    else notice('');
    if(state.layout==='agents')autoProbeSelection();
  }
  const pref = agent => state.data?.preferences?.[agent] || S.settings?.agentPreferences?.[agent] || {};
  const enabled = agent => pref(agent).enabled !== false;
  const writable = () => !S.readOnly && !state.legacy && state.extended;
  const effortText = value => ({minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'超高',max:'最大',ultra:'极高'})[value] || value || '跟随模型';
  const permissionText=(value,agent=current().agent)=>window.AgentHubAgentControls.modes(agent).find(o=>o.value===value)?.label||'继承默认';
  function agentMark(a, large=false) {
    const kind=['claude','codex','builtin','dsh','zcode'].includes(a.id)?a.id:'other';
    return `<span class="ac-agent-icon ac-mark-${kind}${large?' is-large':''}">${window.AgentHubIcons.agent(a.id)}</span>`;
  }
  async function open(options={}) {
    window.AgentHubFeatures?.suspendBrowser?.();
    window.AgentHubManagement?.suspendSession();
    if(window.AgentHubManagement)window.AgentHubManagement.dismissDialogs();
    else while(!document.getElementById('overlay').classList.contains('hidden'))closeDlg();
    window.AgentHubManagement?.close();
    if(innerWidth<=900)toggleSidebar(false);
    ++openSessionSeq;
    state.open=true;const generation=++state.generation;
    state.layout=options.layout || (options.agent?'agents':'overview');
    if(options.tab||options.model)state.tab=options.tab||'config';
    if(options.agent){state.selected=keyOf(options.agent,options.hostId||'');state.host='';}
    state.task=null;setCatalogOpen(false);page.hidden=false;document.body.classList.add('agent-center-open');markNavigation();
    page.dataset.acView=state.layout;
    page.innerHTML=`<div class="ac-shell"><aside class="ac-catalog" aria-label="Agent 目录"><header class="ac-catalog-heading"><h1>Agent 管理</h1><button type="button" class="btn-mini" data-ac-action="directory" aria-label="添加 Agent" ${S.readOnly?'disabled':''}>${icon('plus')}</button></header><p class="ac-catalog-sub">选择 Agent · 对话与设置</p><label class="ac-search">${icon('search')}<input id="acSearch" type="search" aria-label="搜索 Agent" placeholder="搜索 Agent…" value="${esc(state.query)}"></label><button type="button" class="ac-overview-link" data-ac-action="overview">${icon('grid')}<span>全部 Agent<small>运行状态与配置总览</small></span><b id="acCount">—</b></button><div class="ac-catalog-scroll ac-list"><div class="ac-catalog-label"><span>我的 Agent</span><button type="button" data-ac-action="organize" ${writable()?'':'disabled'}>整理</button></div><div id="acRows"><div class="ac-empty">正在读取目录…</div></div></div><footer class="ac-catalog-footer"><button type="button" class="btn ghost" data-ac-action="directory" ${S.readOnly?'disabled':''}>${icon('plus')}添加 Agent</button><button type="button" class="ac-back-link" data-ac-action="back">${icon('chevronLeft')}返回工作台</button></footer></aside><section class="ac-stage"><div class="ac-stage-bar"><button type="button" class="btn-mini ac-catalog-toggle" data-ac-action="catalog" aria-label="打开 Agent 目录" aria-expanded="false">${icon('list')}目录</button><span id="acBreadcrumb">全部 Agent</span><div><button type="button" class="btn-mini" data-ac-action="refresh" aria-label="刷新 Agent 目录">${icon('refresh')}</button><button type="button" class="btn-mini" data-ac-action="back" aria-label="关闭 Agent 管理">${icon('close')}</button></div></div><div id="acNotice" class="ac-notice" hidden></div><div id="acHostToolbar" class="ac-toolbar" hidden><select id="acHostFilter" aria-label="筛选运行环境"></select><label class="ac-show-all"><input id="acShowAll" type="checkbox" ${state.all?'checked':''}>显示未配置的环境</label><button type="button" class="btn ghost" data-ac-action="ssh" ${S.readOnly?'disabled':''}>${icon('server')}管理 SSH 主机</button></div><div class="ac-workspace"><section id="acOverview" class="ac-overview" aria-label="Agent 总览"></section><section id="acDetail" class="ac-detail" aria-label="Agent 配置详情" hidden></section></div></section></div>`;
    if(window.AgentHubManagement){const links=document.createElement('div');links.innerHTML=window.AgentHubManagement.navigation('agents');page.querySelector('.ac-catalog-footer').insertBefore(links,page.querySelector('.ac-back-link'));}
    page.querySelector('#acSearch').addEventListener('input',event=>{state.query=event.target.value;state.limit=80;renderRows();});
    page.querySelector('#acShowAll').addEventListener('change',event=>{state.all=event.target.checked;state.limit=80;renderRows();});
    renderFilters();
    if(state.data){renderRows();renderDetail();}
    try{await load(generation);if(options.model&&active(generation)){assignModel(options);renderRows();renderDetail();}}
    catch(error){if(active(generation))notice(error.message);}
  }
  function renderFilters() {
    const select=page.querySelector('#acHostFilter');if(!select)return;
    select.innerHTML='<option value="all">全部环境</option>'+targets().map(t=>`<option value="${esc(t.id||'local')}">${esc(t.name)}</option>`).join('');
    if(state.host&&!targets().some(t=>(t.id||'local')===state.host))state.host='';
    select.value=state.host||'all';
    select.onchange=()=>{state.host=select.value==='all'?'':select.value;renderRows();};
    enhanceDialogSelects(select.parentElement);select.syncControl?.();
    page.querySelector('#acHostToolbar').hidden=state.layout!=='environments';
    page.querySelector('[data-ac-action="organize"]').disabled=!writable();
  }
  function entries(ignoreQuery=false) {
    const query=ignoreQuery?'':state.query.trim().toLowerCase(),result=[];
    const usedKeys=new Set(S.sessions.map(s=>keyOf(s.agent,s.remoteHostId||'')));
    for(const target of targets())for(const a of state.data?.agents||[]) {
      if(!supported(a,target.id) || state.layout==='environments'&&state.host&&(target.id||'local')!==state.host)continue;
      const key=keyOf(a.id,target.id),cfg=raw(a.id,target.id),r=resolved(a.id,target.id),p=pref(a.id);
      const configured=Object.keys(cfg).length || usedKeys.has(key) || state.data.checks?.[key] || !target.id&&(agentIsReady(a)||a.custom||p.enabled===true||p.enabled===false);
      if(!configured && !(state.all&&state.layout==='environments') && !(state.layout==='agents'&&state.selected===key))continue;
      if(query&&!`${a.name} ${target.name} ${r.model} ${r.provider?.name||''}`.toLowerCase().includes(query))continue;
      result.push({a,target,key,cfg,r});
    }
    return result;
  }
  function inventory(all=entries(true)) {
    const grouped=new Map();for(const entry of all){if(!grouped.has(entry.a.id))grouped.set(entry.a.id,[]);grouped.get(entry.a.id).push(entry);}
    return [...grouped].map(([id,items])=>{
      const a=items[0].a,p=pref(id),preferred=items.find(item=>!item.target.id)||items[0];
      const ready=enabled(id)&&items.some(item=>{
        const s=status(id,item.target.id);
        return s.tone==='ok' && (!['builtin','chatgpt-web'].includes(id)||!!item.r.provider);
      });
      const attention=enabled(id)&&items.some(item=>{
        const s=status(id,item.target.id);
        return s.tone==='error'||s.text==='未安装'||['builtin','chatgpt-web'].includes(id)&&!item.r.provider;
      });
      return {id,a,p,items,preferred,ready:ready&&!attention,attention,running:items.reduce((n,item)=>n+(state.runningCounts?.get(item.key)||0),0)};
    }).sort((a,b)=>Number(!!b.p.pinned)-Number(!!a.p.pinned)||(a.p.order??10000)-(b.p.order??10000)||(state.data.agents||[]).findIndex(agent=>agent.id===a.id)-(state.data.agents||[]).findIndex(agent=>agent.id===b.id));
  }
  function inventoryStatus(item) {
    if(!enabled(item.id))return ['disabled','已停用'];
    if(item.attention)return ['attention','需要处理'];
    if(item.ready)return ['ready',['builtin','chatgpt-web'].includes(item.id)?'连接已配置':item.a.acp?'适配器已发现':'CLI 已验证'];
    return ['pending',item.a.probePending?'正在检测':item.a.acp?'已发现 · ACP':'未验证'];
  }
  function versionText(agent,hostId=''){
    const check=state.data?.checks?.[keyOf(agent,hostId)],a=meta(agent);
    if(['builtin','chatgpt-web'].includes(agent))return '内置引擎';
    return check?.version||(!hostId&&/\d+\.\d+/.test(a?.version||'')?a.version:'')||(!hostId&&a?.pathFound===false?'未安装':'版本未提供');
  }
  function matchesAgent(item) {
    const query=state.query.trim().toLowerCase();
    return !query||`${item.a.name} ${item.items.map(entry=>`${entry.target.name} ${entry.r.model} ${entry.r.provider?.name||''}`).join(' ')}`.toLowerCase().includes(query);
  }
  function catalogItem(item) {
    const [tone,label]=inventoryStatus(item),selected=state.layout==='agents'&&current().agent===item.id;
    return `<button type="button" class="ac-catalog-item ${selected?'selected':''}" data-ac-select="${esc(item.preferred.key)}" aria-pressed="${selected}">${agentMark(item.a)}<span class="ac-catalog-copy"><strong>${esc(item.a.name)}${item.p.pinned?`<span class="ac-pin">${icon('pin')}</span>`:''}</strong><small>${!enabled(item.id)?'已停用':item.preferred.r.model?esc(item.preferred.r.model):esc(label)}${state.dirtyAgents?.has(item.id)?' · 未保存':''}</small></span>${item.running?`<span class="ac-catalog-count">${item.running}</span>`:`<i class="ac-state-dot ${tone}"></i>`}</button>`;
  }
  function renderRows() {
    const list=page.querySelector('#acRows');if(!list||!state.data)return;
    state.runningCounts=new Map();
    state.dirtyAgents=new Set([...state.drafts].filter(([,value])=>value.dirty).map(([key])=>parse(key).agent));
    for(const s of S.sessions)if(S.running.has(s.id)){const key=keyOf(s.agent,s.remoteHostId||'');state.runningCounts.set(key,(state.runningCounts.get(key)||0)+1);}
    const all=inventory();
    const visible=all.filter(item=>(!item.p.hidden||state.showHidden)&&matchesAgent(item));
    const common=visible.filter(item=>enabled(item.id)&&!item.attention),attention=visible.filter(item=>enabled(item.id)&&item.attention),disabled=visible.filter(item=>!enabled(item.id));
    list.innerHTML=common.map(catalogItem).join('')+(attention.length?'<div class="ac-catalog-label">需要处理<span>'+attention.length+'</span></div>'+attention.map(catalogItem).join(''):'')+(disabled.length?'<div class="ac-catalog-label">已停用</div>'+disabled.map(catalogItem).join(''):'');
    if(!visible.length)list.innerHTML='<div class="ac-empty">没有匹配的 Agent</div>';
    window.OrbitCellLayout.bind(list,{key:'agents',selector:'.ac-catalog-item',id:el=>parse(el.dataset.acSelect).agent,group:el=>{const item=all.find(a=>a.id===parse(el.dataset.acSelect).agent);return !enabled(item.id)?'disabled':item.attention?'attention':'common';},disabled:!writable(),onChange:window.OrbitCellLayout.saveAgents});
    const hidden=all.filter(item=>item.p.hidden).length;
    if(hidden)list.insertAdjacentHTML('beforeend',`<button type="button" class="ac-hidden-link" data-ac-action="show-hidden">${state.showHidden?'收起已隐藏项':'显示已隐藏项'} · ${hidden}</button>`);
    page.querySelector('#acCount').textContent=all.filter(item=>enabled(item.id)).length;
    page.querySelector('.ac-overview-link').classList.toggle('selected',state.layout!=='agents');
    if(state.layout!=='agents')renderOverview();
  }
  function overviewRow(item) {
    const [tone,label]=inventoryStatus(item),environments=[...new Set(item.items.map(e=>e.target.name))];
    const version=versionText(item.id,item.preferred.target.id),shortVersion=version.match(/\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?/)?.[0]||version;
    return `<article class="ac-agent-card" data-ac-agent="${esc(item.id)}"><div class="ac-agent-card-head">${agentMark(item.a)}<div><h3 title="${esc(item.a.name)}">${esc(item.a.name)}</h3><div class="ac-card-meta"><span class="ac-inventory-state ${tone}"><i class="ac-state-dot ${tone}"></i>${label}</span><small class="ac-card-version" title="${esc(version)}">${esc(shortVersion)}</small></div></div><button type="button" class="ac-card-settings" data-ac-select="${esc(item.preferred.key)}" aria-label="设置 ${esc(item.a.name)}" title="设置 Agent">${icon('gear')}</button></div><div class="ac-card-model" title="${esc(item.preferred.r.model||'使用 Agent 原生模型')}">${icon('cube')}<span>${esc(item.preferred.r.model||'使用 Agent 原生模型')}</span></div><footer class="ac-card-footer"><span title="${esc(environments.join(' · '))}">${icon('monitor')}${esc(environments[0]||'本机')}${environments.length>1?' +'+(environments.length-1):''}</span><button type="button" class="ac-card-start" data-ac-start="${esc(item.preferred.key)}" ${!enabled(item.id)||S.readOnly?'disabled':''}>开始对话 ${icon('arrowRight')}</button></footer></article>`;
  }
  function additionalAgents(candidates=inventory().map(item=>item.a)) {
    const query=state.query.trim().toLowerCase();
    return (window.AgentHubAgentCatalog||[]).filter(item=>!candidates.some(agent=>{
      const identity=(agent.id+' '+agent.name).toLowerCase();
      return agent.id===item.id||String(agent.name).toLowerCase()===item.name.toLowerCase()||item.aliases.some(alias=>identity.includes(alias));
    })&&(!query||(item.name+' '+item.description).toLowerCase().includes(query)));
  }
  function plannedCard(item) {
    const mark=window.AgentHubIdentity.agent('catalog:'+item.id,'',{brand:item.brand});
    return `<article class="ac-planned-card" data-ac-planned="${esc(item.id)}" data-search="${esc((item.name+' '+item.description).toLowerCase())}"><span class="ac-agent-icon">${mark}</span><div class="ac-planned-copy"><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p></div><span class="ac-planned-state">待接入</span><div class="ac-planned-footer"><span>接入后可开始对话</span><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(item.name)} 官方页面">官网 ${icon('external')}</a></div></article>`;
  }
  function plannedSection() {
    if(state.layout==='environments'||!['all','planned'].includes(state.statusFilter))return '';
    const items=additionalAgents();if(!items.length)return state.statusFilter==='planned'?'<div class="ac-empty">没有匹配的待接入 Agent</div>':'';
    return `<section class="ac-planned-section" aria-label="待接入 Agent"><header><h3>更多 Agent <span>${items.length}</span></h3><p>待接入的 Agent，可前往官网了解。</p><button type="button" class="btn-mini" data-ac-planned-order>调整顺序</button></header><div class="ac-planned-grid">${items.map(plannedCard).join('')}</div></section>`;
  }
  function probeLabel(agent) { return ['builtin','chatgpt-web'].includes(agent)||isAcpAgent(agent)?'查看接入状态':'检测环境'; }
  function environmentRow(entry) {
    const {a,target,key,r}=entry,s=status(a.id,target.id),pending=state.pending.has(key),check=state.data.checks?.[key];
    return `<div class="ac-environment-row"><button type="button" class="ac-environment-select" data-ac-select="${esc(key)}" aria-label="配置 ${esc(a.name)} · ${esc(target.name)}">${agentMark(a)}<span class="ac-inventory-copy"><strong>${esc(a.name)}</strong><small>${esc(check?.version||commandFor(a.id,target.id))}</small></span><span class="ac-inventory-model">${esc(r.model||'跟随执行器配置')}</span><span class="ac-inventory-state ${s.tone}">${esc(s.text)}</span>${icon('chevronRight')}</button><button type="button" class="btn-mini ac-environment-probe" data-ac-probe="${esc(key)}" aria-label="${probeLabel(a.id)} · ${esc(a.name)} · ${esc(target.name)}" ${S.readOnly||state.legacy||pending?'disabled':''}>${pending?'检测中…':probeLabel(a.id)}</button></div>`;
  }
  function renderOverview() {
    const root=page.querySelector('#acOverview');if(!root||!state.data)return;
    root.hidden=false;page.querySelector('#acDetail').hidden=true;page.dataset.acView=state.layout;
    page.querySelector('#acBreadcrumb').textContent=state.layout==='environments'?'运行环境':'全部 Agent';
    const all=inventory(),shown=all.filter(item=>(state.statusFilter==='hidden'?item.p.hidden:!item.p.hidden)&&matchesAgent(item));
    const filtered=shown.filter(item=>state.statusFilter==='planned'?false:state.statusFilter==='ready'?item.ready:state.statusFilter==='attention'?item.attention:state.statusFilter==='disabled'?!enabled(item.id):true);
    const readyEnvironments=new Set();for(const item of all)if(enabled(item.id))for(const entry of item.items)if(state.data.checks?.[entry.key]?.cli==='ready')readyEnvironments.add(entry.target.id||'local');
    const enabledCount=all.filter(item=>enabled(item.id)).length,attentionCount=all.filter(item=>item.attention).length;
    const body=state.layout==='environments'?targets().map(target=>{
      const group=entries().filter(entry=>entry.target.id===target.id&&(!pref(entry.a.id).hidden||state.showHidden));if(!group.length)return '';
      return `<section class="ac-environment-group"><h3>${icon(target.id?'server':'monitor')}${esc(target.name)}</h3>${group.map(environmentRow).join('')}</section>`;
    }).join(''):filtered.slice(0,state.limit).map(overviewRow).join('');
    root.innerHTML=`<header class="ac-overview-heading"><div><h2>${state.layout==='environments'?'运行环境，一目了然':'选择 Agent，开始对话'}</h2><p>${state.layout==='environments'?'命令、版本与默认模型按电脑分别保存。':'选择一个 Agent 进入对话，或在设置中管理模型、权限和运行环境。'}</p></div><button type="button" class="btn" data-ac-action="directory" ${S.readOnly?'disabled':''}>${icon('plus')}添加 Agent</button></header><div class="ac-inventory-toolbar"><h3>${state.layout==='environments'?'按电脑分组':'全部 Agent'}</h3><div class="ac-inventory-actions"><button type="button" class="btn-mini" data-ac-order ${S.readOnly?'disabled':''}>调整顺序</button>${state.layout==='environments'?'':`<div class="ac-status-filters" aria-label="Agent 状态筛选">${[['all','全部'],['ready','已就绪'],['planned','待接入'],['attention','需要处理'],['disabled','已停用'],['hidden','已隐藏']].map(([id,label])=>`<button type="button" data-ac-filter="${id}" aria-pressed="${state.statusFilter===id}">${label}</button>`).join('')}</div>`}</div></div>${state.statusFilter==='planned'?'':`<div class="ac-inventory">${body||'<div class="ac-empty">当前筛选下没有 Agent</div>'}</div>`}${filtered.length>state.limit&&state.layout!=='environments'?'<button type="button" class="btn ghost ac-more" data-ac-action="more">显示更多</button>':''}${plannedSection()}<div class="ac-callout">${icon('info')}<span>未安装、未使用的执行器可从目录添加。停用与隐藏都不会删除历史会话。</span><button type="button" data-ac-action="directory">浏览 Agent 目录 ${icon('arrowRight')}</button></div>`;
    root.querySelector('[data-ac-order]').onclick=window.OrbitCellLayout.openAgents;
    window.OrbitCellLayout.bind(root.querySelector('.ac-inventory'),{key:'agents',selector:'.ac-agent-card',id:el=>el.dataset.acAgent,disabled:!writable(),onChange:window.OrbitCellLayout.saveAgents});
    root.querySelector('[data-ac-planned-order]')?.addEventListener('click',()=>window.OrbitCellLayout.open({key:'planned-agents',title:'调整待接入 Agent 顺序',items:additionalAgents((state.data?.agents||S.agents).filter(a=>!a.unavailable)).map(a=>({id:a.id,name:a.name,detail:a.description,icon:window.AgentHubIdentity.agent('catalog:'+a.id,'',{brand:a.brand})}))}));
    window.OrbitCellLayout.bind(root.querySelector('.ac-planned-grid'),{key:'planned-agents',selector:'.ac-planned-card',id:el=>el.dataset.acPlanned});
    root.querySelectorAll('.ac-environment-group').forEach(group=>window.OrbitCellLayout.bind(group,{key:'agents',selector:'.ac-environment-row',id:el=>parse(el.querySelector('[data-ac-select]').dataset.acSelect).agent,disabled:!writable(),onChange:window.OrbitCellLayout.saveAgents}));
  }
  async function savePreference(agent,change) {
    if(!writable())throw Error('请重启后端以启用 Agent 整理与工具偏好。');
    const result=await api('/api/agent-center/preferences',{method:'PATCH',body:{agent,preferences:change}});
    state.data.preferences ||= {};state.data.preferences[agent]=result.preferences;
    S.settings.agentPreferences=state.data.preferences;
    renderRows();if(state.layout==='agents'&&(!page.querySelector('#acConfigForm')||Object.prototype.hasOwnProperty.call(change,'enabled')))renderDetail();
  }
  function openOrganization() {
    if(!writable())return;
    openDlg('整理 Agent',`<div class="ac-organization"><p class="ac-help">固定的 Agent 优先显示；同组可以调整顺序。隐藏只收起目录项，历史会话仍可访问。</p><div id="acOrganizationRows"></div></div>`);
    const guard=dialogGuard();
    const draw=()=>{
      if(!guard())return;const items=inventory();
      const root=document.getElementById('acOrganizationRows');
      root.innerHTML=items.map((item,index)=>`<div class="ac-organization-row">${agentMark(item.a)}<span>${esc(item.a.name)}</span><button type="button" class="btn-mini" data-org="pin" data-agent="${esc(item.id)}" aria-pressed="${!!item.p.pinned}">${icon('pin')}${item.p.pinned?'取消固定':'固定'}</button><button type="button" class="btn-mini" data-org="up" data-agent="${esc(item.id)}" aria-label="上移 ${esc(item.a.name)}" ${index===0||!!items[index-1].p.pinned!==!!item.p.pinned?'disabled':''}>${icon('arrowUp')}</button><button type="button" class="btn-mini" data-org="down" data-agent="${esc(item.id)}" aria-label="下移 ${esc(item.a.name)}" ${index===items.length-1||!!items[index+1].p.pinned!==!!item.p.pinned?'disabled':''}>${icon('arrowDown')}</button><button type="button" class="btn-mini" data-org="hide" data-agent="${esc(item.id)}">${item.p.hidden?'显示':'隐藏'}</button></div>`).join('');
      root.onclick=event=>{const b=event.target.closest('[data-org]');if(!b||b.disabled)return;
        withPendingButton(b,async()=>{
          const id=b.dataset.agent,p=pref(id);
          try{
            if(b.dataset.org==='pin')await savePreference(id,{pinned:!p.pinned});
            else if(b.dataset.org==='hide')await savePreference(id,{hidden:!p.hidden});
            else {const ids=items.map(item=>item.id),index=ids.indexOf(id),next=index+(b.dataset.org==='up'?-1:1);[ids[index],ids[next]]=[ids[next],ids[index]];const result=await api('/api/agent-center/order',{method:'PUT',body:{agents:ids}});state.data.preferences=result.preferences;S.settings.agentPreferences=result.preferences;renderRows();}
            draw();
          }catch(error){toast(error.message,'err');}
        },'保存中…');
      };
    };draw();
  }
  function openDirectory() {
    if(S.readOnly)return;
    if(!state.data){toast('目录尚未加载，请先刷新。','err');return;}
    const candidates=state.data?.agents||S.agents;
    const available=candidates.filter(a=>!a.unavailable),planned=additionalAgents(available);
    openDlg('添加 Agent',`<div class="ac-directory-dialog"><p class="ac-help">选择已支持的执行器进行配置，也可浏览待接入的 Agent。</p>
      <label class="ac-search">${icon('search')}<input id="acDirectorySearch" type="search" aria-label="搜索 Agent 目录" placeholder="搜索 Agent 或协议…"></label>
      <section class="ac-directory-section"><h3>可配置的 Agent</h3><div class="ac-directory-grid">${available.map(a=>`<button type="button" class="ac-directory-item" data-ac-directory="${esc(a.id)}" data-search="${esc((a.name+' '+(a.acp?'ACP':'CLI')).toLowerCase())}">${agentMark(a)}<span><strong>${esc(a.name)}</strong><small>${!enabled(a.id)?'已停用 · 可重新启用':agentIsReady(a)?'已发现 · 配置运行环境':a.acp?'ACP 适配器 · 配置后接入':'配置 CLI 路径或远程环境'}</small></span>${icon('plus')}</button>`).join('')}</div></section>
      ${planned.length?`<section class="ac-directory-section ac-directory-planned"><h3>待接入 <small>暂不可在此开始对话</small></h3><div class="ac-planned-grid">${planned.map(plannedCard).join('')}</div></section>`:''}
      <div id="acDirectoryEmpty" class="ac-empty" hidden>没有匹配的预设，可填写自定义命令。</div><button type="button" class="ac-custom-entry" id="acDirectoryCustom">${icon('tools')}自定义 CLI / ACP<span>填写命令与协议</span>${icon('chevronRight')}</button><p class="ac-help">添加只保存配置，不会自动安装软件。</p></div>`);
    const guard=dialogGuard();
    const orderDirectory=()=>{window.OrbitCellLayout.bind(document.querySelector('.ac-directory-grid'),{key:'agents',selector:'[data-ac-directory]',id:el=>el.dataset.acDirectory,disabled:!writable(),onChange:window.OrbitCellLayout.saveAgents});window.OrbitCellLayout.bind(document.querySelector('.ac-directory-dialog .ac-planned-grid'),{key:'planned-agents',selector:'.ac-planned-card',id:el=>el.dataset.acPlanned});};orderDirectory();
    document.getElementById('acDirectorySearch').oninput=event=>{const q=event.target.value.trim().toLowerCase();let visible=0;document.querySelectorAll('.ac-directory-dialog [data-search]').forEach(item=>{item.hidden=!item.dataset.search.includes(q);if(!item.hidden)visible++;});document.querySelectorAll('.ac-directory-section').forEach(section=>section.hidden=![...section.querySelectorAll('[data-search]')].some(item=>!item.hidden));document.getElementById('acDirectoryEmpty').hidden=visible>0;orderDirectory();};
    document.querySelectorAll('[data-ac-directory]').forEach(button=>button.onclick=()=>withPendingButton(button,async()=>{
      try{const id=button.dataset.acDirectory;if(state.extended)await savePreference(id,{enabled:true,hidden:false});if(!guard())return;closeDlg();await open({agent:id,hostId:'',tab:'config'});if(!state.open)return;draft(id,'').editing=true;renderDetail();}
      catch(error){toast(error.message,'err');}
    },'添加中…'));
    document.getElementById('acDirectoryCustom').onclick=()=>{closeDlg();addDialog(true);};
  }

  function modelItems(agent,providerId) {
    const provider=providers().find(p=>p.id===providerId);
    return (provider?window.AgentHubProviderModels.selected(provider):meta(agent)?.models||[]).map(m=>typeof m==='string'?{id:m,name:m}:m).filter(m=>m?.id);
  }
  function renderNativeControls(form,agent,hostId,d,result){
    const root=form.querySelector('#acNativeSettings');if(!root)return;
    const control=window.AgentHubAgentControls.nativeControls(result);
    const chosen=control.field==='acpConfig'?d.acpConfig?.[control.id]||'':d.acpMode||'';
    root.innerHTML=`<div class="fld"><label for="acNativeMode">${esc(control.label)} · ${esc(meta(agent).name)}</label><select id="acNativeMode"><option value="">跟随 Agent 默认</option>${control.options.map(o=>`<option value="${esc(o.value)}" ${chosen===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select><small>${control.options.length?'由此 Agent 的原生协议返回，不套用其他 Agent 的模式。':esc(result.controlsError||'此 Agent 未声明可切换模式，使用原生默认配置。')}</small></div>`;
    const select=root.querySelector('select');select.disabled=!control.options.length;
    select.onchange=()=>{if(control.field==='acpConfig'){d.acpConfig={...(d.acpConfig||{})};if(select.value)d.acpConfig[control.id]=select.value;else delete d.acpConfig[control.id];}else d.acpMode=select.value;d.dirty=true;++d.revision;form.querySelector('#acDirtyState').textContent='有未保存的修改';renderRows();};
    const approval=form.querySelector('#acPerm');if(approval){const value=d.permMode||'';approval.innerHTML=[['','继承 OrbitCell 审批'],['auto','自动批准权限请求'],['ask','逐次确认权限请求']].map(([id,label])=>`<option value="${id}" ${value===id?'selected':''}>${label}</option>`).join('');approval.closest('.fld').querySelector('label').textContent='OrbitCell 审批';approval.syncControl?.();}
    enhanceDialogSelects(root);
  }
  function commandFor(agent,hostId) {
    return raw(agent,hostId).command || (!hostId ? meta(agent)?.bin || '自动检测' : state.data.commands?.[agent]?.remoteBin || state.data.commands?.[agent]?.wslBin || S.settings?.customAgents?.find(a=>a.id===agent)?.bin || agent);
  }
  function fields(agent,hostId,d,section='config') {
    if(section==='research' && Number(state.data.version)<3)return '<div class="ac-notice warn" role="status">联网设置需要加载新版后端。重启 OrbitCell 后即可保存并使用。</div>';
    const allowed=state.data.providerIds?.[agent],available=providers().filter(p=>!allowed||allowed.includes(p.id));
    const r=resolved(agent,hostId,d),advanced=section==='advanced';
    const choices=(items,value)=>items.map(([id,label])=>`<option value="${id}" ${value===id?'selected':''}>${label}</option>`).join('');
    const research=section==='research';
    const runtimeFields=research?'<div class="ac-form-section"><h3>联网与对话</h3><p>按需搜索，优先使用已有资料；重复请求和连续失败会提前结束检索。</p></div><div class="fld"><label for="acWebMode">联网策略</label><select id="acWebMode" data-ac-field="webMode">'+choices([['auto','按需联网'],['off','关闭网页搜索与读取']],d.webMode||'auto')+'</select><small>解释、计算、改写等普通问题直接回答；需要最新资料时再检索。</small></div>'+ (agent==='chatgpt-web'?'<div class="fld"><label for="acWebCalls">每轮网页请求预算</label><select id="acWebCalls" data-ac-field="webMaxCalls" data-ac-number>'+choices([['6','轻量 · 6 次'],['12','标准 · 12 次'],['24','深入 · 24 次'],['48','扩展 · 48 次']],String(d.webMaxCalls||12))+'</select><small>搜索与网页读取合计；达到预算后整理回答，不再以超限结束聊天。</small></div>':'')+'<div class="ac-field-pair"><div class="fld"><label for="acWebTimeout">单次联网超时</label><select id="acWebTimeout" data-ac-field="webTimeoutMs" data-ac-number>'+choices([['5000','5 秒'],['10000','10 秒'],['15000','15 秒'],['30000','30 秒']],String(d.webTimeoutMs||15000))+'</select></div><div class="fld"><label for="acHistoryMessages">历史消息条数</label><select id="acHistoryMessages" data-ac-field="historyMessages" data-ac-number>'+choices([['8','8 条'],['16','16 条'],['32','32 条'],['64','64 条'],['100','100 条']],String(d.historyMessages||16))+'</select><small>每条最多保留 6,000 字；更多历史会增加输入用量。</small></div></div>':'';
    let body=research?runtimeFields:advanced?`<div class="fld"><label for="acCommand">${hostId?'目标电脑上的命令':'本机 CLI 路径'}</label><input id="acCommand" data-ac-field="command" value="${esc(d.command||'')}" placeholder="${esc(commandFor(agent,hostId))}" spellcheck="false"><small>${hostId?'在选中的电脑上执行，不沿用本机路径。':'留空时使用已有路径设置或自动检测。'}</small></div><div class="fld"><label for="acUpgradeCommand">版本不兼容时的升级命令</label><input id="acUpgradeCommand" data-ac-field="upgradeCommand" value="${esc(d.upgradeCommand||'')}" placeholder="使用执行器自带的升级方式" spellcheck="false" ${state.extended?'':'disabled'}><small>只保存到此环境；保存和检测不会执行升级。</small></div>`:`<div class="fld"><label for="acProvider">供应商</label><select id="acProvider" data-ac-field="providerId"><option value="">使用继承的供应商</option>${available.map(p=>`<option value="${esc(p.id)}" ${d.providerId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}${d.providerId&&!available.some(p=>p.id===d.providerId)?`<option value="${esc(d.providerId)}" selected>当前连接不可用</option>`:''}</select></div><div class="fld"><label for="acModel">默认模型</label><input id="acModel" data-ac-field="model" autocomplete="off" placeholder="${esc(r.model||'继承默认；可搜索或输入模型 ID')}" value="${esc(d.model||'')}"></div><div class="ac-field-pair"><div class="fld"><label for="acEffort">推理强度</label>${reasoningModeSupported(agent,hostId)?`<select id="acEffort" data-ac-field="effort">${choices([['','继承默认'],['none','关闭'],['minimal','最低'],['low','低'],['medium','中'],['high','高'],['xhigh','超高'],['max','最大'],['ultra','极高']],d.effort||'')}</select>`:'<input id="acEffort" readonly value="使用 Agent 原生默认">'}</div><div class="fld"><label for="acPerm">权限</label>${permissionModeSupported(agent,hostId)?`<select id="acPerm" data-ac-field="${agent==='dsh'?'dshPermission':'permMode'}">${choices(permissionDefaultChoices(agent,hostId),agent==='dsh'?d.dshPermission||'default':d.permMode||'')}</select>`:'<input id="acPerm" readonly value="由 Agent 自身管理">'}</div></div>`;
    if(!advanced&&!research&&nativeConnection(agent)) {
      body='<div class="fld"><label>模型连接</label><input readonly value="由 Agent 自身配置管理"><small>使用该 CLI 的原生连接与登录状态。</small></div>'
        +`<div class="fld"><label for="acModel">默认原生模型 ID</label><input id="acModel" data-ac-field="model" value="${esc(d.model||'')}" placeholder="留空使用 Agent 默认模型"><small>使用 Agent 声明的模型 ID。</small></div>`
        +(reasoningModeSupported(agent,hostId)&&!hostId?`<div class="fld"><label for="acEffort">推理强度</label><select id="acEffort" data-ac-field="effort">${choices([['','继承默认']],d.effort||'')}</select><small>读取原生目录后显示此模型的可调档位。</small></div>`:'')
        +(permissionModeSupported(agent,hostId)?`<div class="fld"><label for="acPerm">权限</label><select id="acPerm" data-ac-field="permMode">${choices(permissionDefaultChoices(agent,hostId),d.permMode||'')}</select></div>`:'');
    }
    return `<div class="ac-effective"><span>${research?'联网与对话 · 下一次发送生效':advanced?'启动配置预览':'新会话默认 · 保存后生效'}</span><strong>${esc(advanced?d.command||commandFor(agent,hostId):r.model||'跟随 CLI / 应用配置')}</strong><small>${advanced?esc(hostName(hostId))+' · 升级命令仅在后续版本兼容处理中使用':esc(r.provider?.name||'CLI / 应用默认连接')+' · 来源：'+esc(r.source)}</small>${!advanced&&!research&&!nativeConnection(agent)?`<button type="button" class="btn-mini" data-ac-action="inherit-model" ${S.readOnly||state.legacy?'disabled':''}>恢复全局默认</button>`:''}</div><form id="acConfigForm" data-section="${section}" class="ac-form">${body}${!advanced&&!research&&nativeAcpControls(agent)?'<div id="acNativeSettings" class="ac-native-settings"><p class="ac-help">正在读取此 Agent 的原生模式…</p></div>':''}<p class="ac-help">${research?'此 Agent 单独保存。关闭联网会隐藏并拒绝执行网页工具。':'保存后用于新会话，已有会话保留原设置。'}</p><div class="ac-save-bar"><span id="acDirtyState" role="status">${d.dirty?'有未保存的修改':'此 Agent 与此环境独立保存'}</span><button type="submit" class="btn" ${S.readOnly||state.legacy?'disabled':''}>${advanced?'保存高级设置':'保存配置'}</button>${advanced?`<button type="submit" class="btn ghost" data-save-probe ${S.readOnly||state.legacy?'disabled':''}>保存并检测</button>`:''}</div></form>`;
  }
  function environmentCards(agent,hostId) {
    const a=meta(agent),remoteAllowed=supported(a,'wsl'),family=!hostId?'local':hostId==='wsl'?'wsl':'ssh';
    const cards=[['local','本机','monitor',!hostId&&agentIsReady(a)?a.version||'已发现执行器':'本机运行环境']];
    if(remoteAllowed)cards.push(['wsl','WSL','terminal',S.wsl?.available?S.wsl.distros?.[0]||'已发现 WSL':'尚未检测到 WSL'],['ssh','SSH 主机','server',(state.data.hosts||[]).length+' 台已配置主机']);
    const check=state.data.checks?.[keyOf(agent,hostId)],s=status(agent,hostId);
    const detail=!hostId?check?.version||a.version||(['builtin','chatgpt-web'].includes(agent)?'内置引擎，无需外部进程':'本机 CLI 尚未检测'):check?.cli==='ready'?check.version||'CLI 检测通过':'此环境尚未验证 CLI，点击检测后查看结果';
    return `<section class="ac-section"><div class="ac-section-heading"><h3>运行环境</h3><span>按电脑独立配置</span></div><div class="ac-environment-surface"><div class="ac-env-grid">${cards.map(([id,name,glyph,description])=>`<button type="button" class="ac-env-card ${family===id?'selected':''}" data-ac-env="${id}" aria-pressed="${family===id}" ${id==='wsl'&&!S.wsl?.available?'disabled':''}><span class="ac-env-icon">${icon(glyph)}</span><span><strong>${name}</strong><small>${esc(description)}</small></span><i>${family===id?icon('check'):''}</i></button>`).join('')}</div>${family==='ssh'?`<label class="ac-ssh-picker">SSH 主机<select id="acDetailHost" aria-label="Agent 配置的运行环境">${(state.data.hosts||[]).map(h=>`<option value="${esc(h.id)}" ${h.id===hostId?'selected':''}>${esc(h.name||h.host)}</option>`).join('')}</select></label>`:''}<div class="ac-env-detail"><div><span class="ac-status-line"><i class="ac-state-dot ${s.tone==='ok'?'ready':s.tone==='error'?'attention':'pending'}"></i>${esc(s.text)} · ${esc(detail)}</span><code>${esc(commandFor(agent,hostId))}</code></div><div><button type="button" class="btn-mini" data-ac-action="probe" ${S.readOnly||state.legacy||state.pending.has(state.selected)?'disabled':''}>${state.pending.has(state.selected)?'检测中…':probeLabel(agent)}</button><button type="button" class="btn-mini" data-ac-action="diagnostics">查看结果</button>${!['builtin','chatgpt-web'].includes(agent)&&!agent.startsWith('acp:')?'<button type="button" class="btn-mini" data-ac-action="manage-env">管理环境 '+icon('chevronRight')+'</button>':''}</div></div></div></section>`;
  }
  function recentSessions(agent,hostId) {
    const sessions=S.sessions.filter(s=>s.agent===agent&&(s.remoteHostId||'')===hostId).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,3);
    return `<section class="ac-section"><div class="ac-section-heading"><h3>最近会话</h3><button type="button" class="btn-mini" data-ac-action="all-sessions">查看全部 ${icon('arrowRight')}</button></div><div class="ac-recent-list">${sessions.length?sessions.map(s=>`<button type="button" class="ac-recent-item" data-ac-session="${esc(s.id)}"><i class="ac-state-dot ${S.running.has(s.id)?'ready':''}"></i><span><strong>${esc(s.title||'未命名会话')}</strong><small>${esc(meta(agent).name)}<em>${esc(s.cwd?baseName(s.cwd):'默认工作区')}</em></small></span><time>${esc(typeof fmtTime==='function'?fmtTime(s.updatedAt):new Date(s.updatedAt).toLocaleString())}</time>${icon('chevronRight')}</button>`).join(''):'<div class="ac-empty">还没有此环境的会话，配置好后即可新建任务。</div>'}</div></section>`;
  }
  function toolSwitch(feature,name,description,agent,canManage=true,gate=true) {
    const value=gate&&pref(agent).tools?.[feature]!==false;
    return `<div class="ac-setting-row"><div><strong>${name}</strong><small>${esc(description)}</small></div>${canManage?`<button type="button" class="ac-toggle" role="switch" aria-label="${name}" aria-checked="${value}" data-ac-feature="${feature}" ${!writable()||!gate?'disabled':''}><span></span></button>`:'<span class="ac-managed-note">由 Agent 自身管理</span>'}</div>`;
  }
  function toolsView(agent,hostId) {
    const a=meta(agent),local=!hostId,native=['claude','codex'].includes(agent),acp=a.acp||isAcpAgent(agent),builtin=agent==='builtin';
    const supportsMcp=local&&(native||acp||builtin),supportsInjected=local&&(native||builtin),r=resolved(agent,hostId),counts=state.data.toolCounts?.[agent]||{};
    const policy=state.data.toolPolicy||{},permissionSupported=permissionModeSupported(agent,hostId);
    const mcpDescription=hostId?'使用目标环境自己的 MCP 配置，本机计数不适用于此环境。':state.extended?`${counts.servers||0} 个已配置服务器${counts.tools?' · 上次检测 '+counts.tools+' 个工具':''}${counts.untested?' · '+counts.untested+' 个待检测':''}${pref(agent).tools?.mcpServers===false?' · 已暂停向此 Agent 接入':''}`:'重启后端后读取服务器与工具数量';
    return `<div class="ac-page-intro"><h3>工具与集成</h3><p>管理此 Agent 接入的工具、技能和 MCP 服务器。</p></div><div class="ac-integration-note">${icon('lock')}<span>新会话的权限与推理强度在“对话设置”中管理。</span><button type="button" class="btn-mini" data-ac-tab="config">前往设置 ${icon('arrowRight')}</button></div><section class="ac-settings-section"><h3>可用工具</h3><p>${hostId?'远程 CLI 的自有 MCP 配置在目标电脑管理。':'开关用于 OrbitCell 提供的接入；MCP 的更改对新会话生效。'}</p>${['claude','codex','zcode','builtin'].includes(agent)?toolSwitch('permissionMemory','记住项目权限','记住此 Agent 在当前项目中已获允许的操作。',agent,true):''}${supportsMcp?toolSwitch('mcpServers','第三方 MCP 服务器',mcpDescription,agent,true):''}${local&&native?toolSwitch('browserTools','受控浏览器','打开网页、读取页面和截图；全局浏览器设置仍然有效。',agent,true,policy.browserTools!==false&&policy.agenthubTools!==false):''}${supportsInjected?toolSwitch('agenthubTools','OrbitCell 工具',(counts.injected||0)+' 个可配置工具；遵循全局工具设置。',agent,true,policy.agenthubTools!==false):'<p class="ac-native-tool-note">此 Agent 的工具和登录状态由其自身管理。请在原生配置中修改。</p>'}<div class="ac-setting-row"><div><strong>技能</strong><small>在技能库集中管理，再按项目或任务选择。</small></div><button type="button" class="btn-mini" data-ac-action="skills">打开技能库 ${icon('external')}</button></div><div class="ac-setting-row"><div><strong>MCP 连接</strong><small>配置连接、查看真实工具目录与检测结果。</small></div><button type="button" class="btn-mini" data-ac-action="mcp">管理服务器 ${icon('external')}</button></div></section><div class="ac-callout">${icon('info')}<span>助手负责系统提示词和行为偏好，无需复制新的 Agent。</span><button type="button" data-ac-action="assistants">管理助手 ${icon('arrowRight')}</button></div>`;
  }
  function advancedView(agent,hostId,d) {
    const a=meta(agent),f=!hostId&&(!raw(agent,hostId).command||raw(agent,hostId).command===a.bin)?a.features||{}:{};
    const labels=[['appServer','原生 app-server'],['streamBridge','流式会话'],['permBridge','网页审批'],['partial','增量输出'],['tools','工具调用']].filter(([id])=>f[id]).map(([,label])=>label);
    if(['builtin','chatgpt-web'].includes(agent))labels.push('内置引擎');
    if(a.acp||isAcpAgent(agent))labels.push('ACP · 启动时协商');
    const external=!['builtin','chatgpt-web'].includes(agent)&&!agent.startsWith('acp:');
    return `<div class="ac-page-intro"><h3>高级设置</h3><p>协议、路径与诊断信息，日常使用时无需修改。</p></div><section class="ac-settings-section"><h3>适配能力</h3><p>${hostId?'目标环境的协议能力在实际启动时探测，不沿用本机结果。':'以下能力来自本机适配器与检测结果。'}</p><div class="ac-capabilities">${labels.length?labels.map(label=>`<span>${label}</span>`).join(''):'<span>尚无此环境的协议能力记录</span>'}</div><label class="ac-id-field">稳定 Agent ID<input value="${esc(agent)}" readonly></label></section><section class="ac-settings-section"><h3>运行环境高级配置</h3><p>${esc(hostName(hostId))} · 命令与升级方式分别保存</p>${external?fields(agent,hostId,d,'advanced'):'<p class="ac-help">启动方式由内置适配器管理。</p>'}</section><div class="ac-callout">${icon('info')}<span>停用只影响新任务，历史会话仍可继续使用。</span><button type="button" data-ac-action="toggle-enabled" ${writable()?'':'disabled'}>${enabled(agent)?'停用':'启用'} ${esc(a.name)}</button></div>`;
  }
  function renderDetail() {
    if(state.layout!=='agents'){renderOverview();return;}
    const root=page.querySelector('#acDetail');if(!root||!state.data)return;
    const {agent,hostId}=current(),a=meta(agent);if(!a)return;
    root.hidden=false;page.querySelector('#acOverview').hidden=true;page.dataset.acView='agents';
    page.querySelector('#acBreadcrumb').textContent=a.name+' / '+hostName(hostId);
    const d=draft(agent,hostId),s=status(agent,hostId),running=S.sessions.filter(session=>session.agent===agent&&S.running.has(session.id)).length;
    const tabs=[['config','对话设置'],...(['builtin','chatgpt-web'].includes(agent)?[['research','联网与对话']]:[]),['tools','工具与集成'],['appearance','页面偏好'],['imports','会话导入'],['advanced','运行与高级'],...(state.tab==='diagnostics'?[['diagnostics','运行诊断']]:[])];
    root.innerHTML=`<header class="ac-detail-head"><button type="button" class="ac-identity-button" data-ac-action="icon" aria-label="更换 ${esc(a.name)} 图标" title="更换图标">${agentMark(a,true)}<i>${icon('image')}</i></button><div class="ac-detail-title"><h2>${esc(a.name)}<span class="ac-health ${!enabled(agent)?'disabled':s.tone}">${enabled(agent)?s.text:'已停用'}</span></h2><p>${esc(a.acp||isAcpAgent(agent)?'ACP 适配器':a.style==='api'?'内置运行引擎':a.style==='chat'?'普通聊天':'CLI 执行器')} · ${esc(versionText(agent,hostId))}${running?' · '+running+' 个任务进行中':''}</p></div><div class="ac-header-actions"><button type="button" class="btn ghost" data-ac-action="probe" ${S.readOnly||state.legacy||state.pending.has(state.selected)?'disabled':''}>${icon('refresh')}${state.pending.has(state.selected)?'检测中…':probeLabel(agent)}</button><button type="button" class="btn" data-ac-action="new-task" ${S.readOnly||state.legacy||!enabled(agent)||!!state.task?'disabled':''}>${icon('plus')}开始对话</button></div></header><nav class="ac-detail-tabs" role="tablist" aria-label="Agent 详情分区">${tabs.map(([id,label])=>`<button type="button" role="tab" id="acTab-${id}" data-ac-tab="${id}" aria-selected="${state.tab===id}" tabindex="${state.tab===id?0:-1}" aria-controls="acDetailBody">${label}</button>`).join('')}</nav><div id="acDetailBody" class="ac-detail-body" role="tabpanel" aria-labelledby="acTab-${state.tab}"></div>`;
    root.querySelector('.ac-detail-tabs').onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
      const index=tabs.findIndex(([id])=>id===state.tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;
      state.tab=tabs[next][0];state.task=null;renderDetail();root.querySelector('#acTab-'+state.tab).focus();
    };
    const body=root.querySelector('#acDetailBody');
    if(state.task?.key===state.selected)renderTask(body,agent,hostId);
    else if(state.tab==='config')body.innerHTML=`<details class="ac-env-chooser"><summary><span>${icon('monitor')}运行环境</span><b>${esc(hostName(hostId))}</b>${icon('chevronDown')}</summary>${environmentCards(agent,hostId)}</details>`+fields(agent,hostId,d);
    else if(state.tab==='research')body.innerHTML=fields(agent,hostId,d,'research');
    else if(state.tab==='tools')body.innerHTML=toolsView(agent,hostId);
    else if(state.tab==='appearance')window.AgentHubAgentPagePreferences.render(body,agent);
    else if(state.tab==='imports')window.AgentHubAgentSessionImport.mount(body,{agent,hostId});
    else if(state.tab==='advanced')body.innerHTML=environmentCards(agent,hostId)+advancedView(agent,hostId,d);
    else renderDiagnostics(body,agent,hostId);
    const host=root.querySelector('#acDetailHost');if(host)host.onchange=()=>selectEnvironment(host.value);
    const permission=root.querySelector('#acToolPerm');
    if(permission)permission.onchange=async()=>{
      const field=agent==='dsh'?'dshPermission':'permMode';
      if(d.dirty){permission.value=raw(agent,hostId)[field]||'';permission.syncControl?.();notice('请先保存或取消当前未保存的配置。','warn');return;}
      const previous=d[field]||'';d[field]=permission.value;d.dirty=true;++d.revision;permission.disabled=true;permission.syncControl?.();
      try{await save(agent,hostId,d);}catch(error){d[field]=previous;d.dirty=false;renderDetail();notice(error.message);}
    };
    bindEditor(root,agent,hostId,d);
    enhanceDialogSelects(root);
  }
  function bindEditor(root,agent,hostId,d) {
    const form=root.querySelector('#acConfigForm');if(!form)return;
    const advanced=form.dataset.section==='advanced';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='btn ghost';cancel.textContent='取消';
    cancel.onclick=()=>{if(d.saving)return;++d.revision;state.drafts.set(keyOf(agent,hostId),{...raw(agent,hostId),dirty:false,revision:d.revision,editing:false});renderRows();renderDetail();};
    form.querySelector('.ac-save-bar').insertBefore(cancel,form.querySelector('[type=submit]'));
    const providerField=form.querySelector('#acProvider')?.closest('.fld'),modelField=form.querySelector('#acModel')?.closest('.fld');
    if(providerField&&modelField){const pair=document.createElement('div');pair.className='ac-field-pair';providerField.before(pair);pair.append(providerField,modelField);}
    let nativeRows=[],nativeReasoning=null,nativeForModel='';
    const updateEffort=()=>{
      const select=form.querySelector('#acEffort');if(!select)return;
      const route=resolved(agent,hostId,d),policy=window.AgentHubModelPicker.policy({agent,style:meta(agent)?.style,model:route.model,providerId:route.providerId,providerCatalog:composerModelCatalog.rows,nativeReasoning:nativeForModel===route.model?nativeReasoning:null,agentCatalog:nativeRows.length&&nativeForModel===route.model?nativeRows:meta(agent)?.modelCatalog||[]});
      const levels=policy.levels,option=nativeForModel===route.model?nativeReasoning:null,raw=option&&(d.acpConfig?.[option.id]||''),value=d.effort||(raw==='off'?'none':raw)||'';
      const offered=option?option.options.map(item=>[item.value==='off'?'none':item.value,item.name||item.value]):levels.map(level=>[level,level+' · '+window.AgentHubModelPicker.label(level)]);
      select.innerHTML=[['','继承默认'],...offered,...(value&&!offered.some(([id])=>id===value)?[[value,value+' · 已保存的自定义档位']]:[])].map(([id,label])=>'<option value="'+esc(id)+'" '+(id===value?'selected':'')+'>'+esc(label)+'</option>').join('');
      let note=form.querySelector('[data-ac-effort-note]');if(!note){note=document.createElement('small');note.dataset.acEffortNote='';select.after(note);}note.textContent=offered.length?'按所选模型公布的原生档位显示。':policy.note;
    };
    updateEffort();loadComposerModelCatalog().then(()=>{if(form.isConnected)updateEffort();});
    form.querySelectorAll('[data-ac-field]').forEach(input=>input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{
      d[input.dataset.acField]=input.hasAttribute('data-ac-number')?Number(input.value):input.value;d.dirty=true;++d.revision;notice('');
      if(input.dataset.acField==='providerId'){d.model='';nativeRows=[];form.querySelector('#acModel').value='';}
      if(input.id==='acEffort'&&nativeReasoning&&nativeForModel===resolved(agent,hostId,d).model){const value=input.value,choice=nativeReasoning.options.find(item=>(item.value==='off'?'none':item.value)===value);d.acpConfig={...(d.acpConfig||{}),[nativeReasoning.id]:choice?.value||nativeReasoning.currentValue};d.effort=window.AgentHubModelPicker.order.includes(value)?value:'';}
      if(['providerId','model'].includes(input.dataset.acField))updateEffort();
      const r=resolved(agent,hostId,d),preview=root.querySelector('.ac-effective');
      preview.querySelector('strong').textContent=advanced?d.command||commandFor(agent,hostId):r.model||'跟随 CLI / 应用配置';
      if(!advanced)preview.querySelector('small').textContent=(r.provider?.name||'CLI / 应用默认连接')+' · 来源：'+r.source;
      root.querySelector('#acDirtyState').textContent='有未保存的修改';renderRows();
    }));
    form.onsubmit=event=>{
      event.preventDefault();if(d.saving)return;d.saving=true;cancel.disabled=true;
      const button=event.submitter||form.querySelector('[type=submit]'),check=button.hasAttribute('data-save-probe');
      withPendingButton(button,async()=>{await save(agent,hostId,d);if(check&&current().agent===agent&&current().hostId===hostId)await probe();},'保存中…').catch(error=>notice(error.message)).finally(()=>{d.saving=false;if(cancel.isConnected)cancel.disabled=false;});
    };
    const model=form.querySelector('#acModel');
    if(model){
      const modelField=model.closest('.fld');
      enhanceModelInput(model,()=>nativeRows.length?nativeRows:modelItems(agent,resolved(agent,hostId,d).providerId));
      const button=document.createElement('button');button.type='button';button.className='btn-mini ac-model-refresh';button.textContent=nativeConnection(agent)?'获取原生模型':'管理模型';
      const status=document.createElement('small');status.setAttribute('role','status');
      const label=modelField.querySelector('label'),heading=document.createElement('div');heading.className='ac-model-label-row';label.before(heading);heading.append(label,button);status.className='ac-model-status';modelField.append(status);
      button.onclick=()=>withPendingButton(button,async()=>{
        try{
          const providerId=resolved(agent,hostId,d).providerId,requestedModel=resolved(agent,hostId,d).model||'';
          if(nativeConnection(agent)||!providerId){
            const result=await api('/api/agents/'+encodeURIComponent(agent)+'/models?'+new URLSearchParams({hostId,model:requestedModel,refresh:'1'}),{timeoutMs:26000});
            nativeRows=result.models||[];nativeReasoning=result.reasoning||null;nativeForModel=requestedModel;updateEffort();renderNativeControls(form,agent,hostId,d,result);if(status.isConnected)status.textContent=nativeRows.length?'已读取 '+nativeRows.length+' 个模型；点击输入框选择。':result.note||'此 Agent 未公布模型目录，可填写原生模型 ID。';
          }else{
            const provider=providers().find(p=>p.id===providerId);if(!provider)throw Error('请先选择一个供应商。');
            const onSaved=async()=>{await refreshData();const next=await api('/api/agent-center');if(!form.isConnected)return;state.data.providers=next.providers;await loadComposerModelCatalog(true);updateEffort();status.textContent='模型已更新，点击输入框选择。';};
            if(provider.managed===false&&provider.source!=='magpie')window.AgentHubConnectionEditor.open(provider,{onSaved});
            else window.AgentHubProviderModelPicker.open(provider,{onSaved});
          }
        }catch(error){if(status.isConnected)status.textContent=error.message;}
      },'读取中…');
      if(nativeConnection(agent)&&!hostId&&!S.readOnly&&!state.legacy)button.onclick();
    }
    if(S.readOnly||state.legacy)form.querySelectorAll('input,select,button').forEach(input=>input.disabled=true);
  }
  function selectEnvironment(hostId) {
    const {agent}=current();if(!supported(meta(agent),hostId))return;
    if(hostId&&hostId!=='wsl')state.lastSsh=hostId;
    state.selected=keyOf(agent,hostId);state.task=null;if(state.extended)notice('');renderRows();renderDetail();autoProbeSelection();
  }
  function selectTarget(key) {
    const {agent,hostId}=parse(key);if(!meta(agent)||!supported(meta(agent),hostId))return;
    state.selected=key;state.layout='agents';state.tab='config';state.task=null;setCatalogOpen(false);
    if(hostId&&hostId!=='wsl')state.lastSsh=hostId;
    if(state.extended)notice('');
    renderRows();renderFilters();renderDetail();markNavigation();page.querySelector('.ac-workspace').scrollTop=0;autoProbeSelection();
  }
  function autoProbeSelection(){
    const {agent,hostId}=current();if(!agent||!state.extended||S.readOnly||draft(agent,hostId).dirty)return;
    const check=state.data.checks?.[state.selected],command=raw(agent,hostId).command,a=meta(agent);
    if(check&&Date.now()-check.checkedAt<60000)return;
    if(!hostId&&(!command||command===a?.configuredCommand))return;
    probe(state.selected,false).catch(error=>notice(error.message));
  }

  function renderDiagnostics(root,agent,hostId) {
    const check=state.data.checks?.[keyOf(agent,hostId)],a=meta(agent),r=resolved(agent,hostId);
    const cli=check?({ready:'检测通过'+(check.version?' · '+check.version:''),missing:'未找到 CLI',failed:'启动失败',unverified:'命令已运行，版本未确认','not-required':'内置，无需安装',managed:'ACP 适配器管理；连接在会话启动时验证'}[check.cli]||'未完成检测'):!hostId&&agentIsReady(a)?a.version||'已发现启动路径':'尚未检测';
    root.innerHTML=`<dl class="ac-diagnostics"><div><dt>运行环境</dt><dd>${esc(!hostId?'本机':check?.host==='ready'?'SSH / WSL 连接正常':check?.host==='failed'?'连接失败':'尚未检测')}</dd></div><div><dt>CLI</dt><dd>${esc(cli)}</dd></div><div><dt>模型连接</dt><dd>${esc(r.provider?.name||'CLI / 应用默认')}<small>环境检测不会调用模型 API；认证状态需通过实际请求或连接管理确认。</small></dd></div><div><dt>最近环境检测</dt><dd>${check?esc(new Date(check.checkedAt).toLocaleString()):'尚未执行'}</dd></div></dl>${state.pending.has(keyOf(agent,hostId))?'<p class="ac-help" role="status">正在检查所选环境的启动命令与版本…</p>':''}${check?.error?`<div class="ac-notice error" role="alert">${esc(check.error)}</div>`:check?.note?`<p class="ac-help">${esc(check.note)}</p>`:''}<div class="ac-link-actions"><button type="button" class="btn ghost" data-ac-action="connections">管理模型连接</button>${hostId&&hostId!=='wsl'?'<button type="button" class="btn ghost" data-ac-action="ssh">管理 SSH 主机</button>':''}</div>`;
  }
  async function save(agent,hostId,d) {
    const generation=state.generation,revision=d.revision;
    const config=Object.fromEntries(['command','upgradeCommand','providerId','model','effort','permMode',...(agent==='dsh'?['dshPermission']:[]),...(['builtin','chatgpt-web'].includes(agent)?['webMode','webMaxCalls','webTimeoutMs','historyMessages']:[])].map(k=>[k,d[k]??'']));
    if(nativeConnection(agent)){delete config.providerId;if(nativeAcpControls(agent)){config.acpConfig=d.acpConfig||{};config.acpMode=d.acpMode||'';}}
    if(!reasoningModeSupported(agent,hostId))delete config.effort;
    const result=await api('/api/agent-center/config',{method:'PUT',body:{agent,hostId,config}});
    if(!state.data.configurations[hostId||'local'])state.data.configurations[hostId||'local']={};
    state.data.configurations[hostId||'local'][agent]=result.config;
    delete state.data.checks[keyOf(agent,hostId)];
    if(d.revision===revision){d.dirty=false;d.editing=false;}
    if(!S.settings)S.settings={};S.settings.agentTargets=state.data.configurations;if(curSession()?.agent===agent)renderHeader(curSession());
    if(!curSession()&&S.curAgent===agent&&(document.getElementById('selRemote').value||'')===hostId)applyAgentDefaultsToComposer(hostId);
    if(active(generation)){renderRows();if(current().agent===agent&&current().hostId===hostId)renderDetail();notice('已保存：'+hostName(hostId)+' · '+meta(agent).name,'ok');}
  }
  async function probe(key=state.selected,showDetails=true) {
    if(S.readOnly||state.legacy)return;
    const {agent,hostId}=parse(key);
    if(!meta(agent))return;
    if(state.pending.has(key))return;
    if(draft(agent,hostId).dirty){notice('先保存当前配置，再检测实际生效的启动命令。','warn');return;}
    state.pending.add(key);
    if(showDetails){state.tab='diagnostics';state.task=null;renderDetail();}
    renderRows();
    try{const result=await api('/api/agent-center/probe',{method:'POST',body:{agent,hostId},timeoutMs:60000});
      if(state.open&&!result.stale)state.data.checks[key]=result;
      else if(state.open&&result.stale&&state.selected===key)notice('检测期间配置已更改，请重新检测。','warn');}
    finally{
      state.pending.delete(key);
      if(state.open){
        renderRows();
        if(state.selected===key){
          const form=page.querySelector('#acConfigForm'),editing=draft(agent,hostId);
          if(!form||!editing.dirty&&!form.contains(document.activeElement))renderDetail();
          else page.querySelectorAll('[data-ac-action="probe"]').forEach(button=>{button.disabled=!!(S.readOnly||state.legacy);button.textContent=probeLabel(agent);});
        }
      }
    }
  }
  function renderTask(root,agent,hostId) {
    const task=state.task,r=resolved(agent,hostId),hostOptions=targets().filter(target=>supported(meta(agent),target.id));
    const projects=[...new Set(S.sessions.filter(s=>(s.remoteHostId||'')===hostId&&s.cwd).map(s=>s.cwd))].slice(0,30);
    root.innerHTML=`<div class="ac-page-intro"><h3>新建任务</h3><p>沿用所选环境的默认值，确认后再发送任务描述。</p></div><form id="acTaskForm" class="ac-form"><div class="ac-field-pair"><div class="fld"><label>Agent</label><input value="${esc(meta(agent).name)}" readonly></div><div class="fld"><label for="acTaskHost">运行环境</label><select id="acTaskHost">${hostOptions.map(target=>`<option value="${esc(target.id||'local')}" ${target.id===hostId?'selected':''}>${esc(target.name)}</option>`).join('')}</select></div></div>${projects.length?`<div class="fld"><label for="acTaskProject">常用项目</label><select id="acTaskProject"><option value="">选择项目或填写其他目录</option>${projects.map((cwd,index)=>`<option value="${index}">${esc(baseName(cwd))} · ${esc(cwd)}</option>`).join('')}</select></div>`:''}<div class="fld"><label for="acTaskCwd">项目目录</label><div class="ac-directory"><input id="acTaskCwd" value="${esc(task.cwd||'')}" placeholder="${hostId?'选择目标电脑上的目录':'留空使用默认工作区'}"><button type="button" class="btn ghost" data-ac-action="browse" aria-label="选择任务目录">${icon('folder')}</button></div></div><div class="fld"><label for="acTaskPrompt">要做什么？</label><textarea id="acTaskPrompt" maxlength="32000" placeholder="例如：审查最近的改动并补充测试">${esc(task.prompt||'')}</textarea><small>描述将填入新会话，点击发送后才会开始运行。</small></div><div class="ac-effective"><span>本次将使用</span><strong>${esc(meta(agent).name)} · ${esc(hostName(hostId))}</strong><small>${esc(r.model||'CLI / 应用默认模型')} · ${esc(r.provider?.name||'默认连接')} · 推理 ${esc(effortText(r.effort))} · 权限 ${permissionModeSupported(agent,hostId)?esc(agent==='dsh'?dshPermissionOptions.find(([value])=>value===r.dshPermission)?.[1]||'Agent 默认':permissionText(r.permMode)):'由 Agent 自身管理'}</small></div><div class="ac-save-bar"><button type="button" class="btn ghost" data-ac-action="cancel-task">返回配置</button><button type="submit" class="btn">${icon('plus')}创建会话</button></div></form>`;
    root.querySelector('#acTaskCwd').oninput=event=>{task.cwd=event.target.value;};
    root.querySelector('#acTaskPrompt').oninput=event=>{task.prompt=event.target.value;};
    const project=root.querySelector('#acTaskProject');if(project)project.onchange=()=>{if(project.value!==''){task.cwd=projects[Number(project.value)];root.querySelector('#acTaskCwd').value=task.cwd;}};
    root.querySelector('#acTaskHost').onchange=event=>{
      const next=event.target.value==='local'?'':event.target.value;
      state.selected=keyOf(agent,next);state.task={key:state.selected,cwd:'',prompt:task.prompt||''};renderRows();renderDetail();
    };
    root.querySelector('#acTaskForm').onsubmit=event=>{
      event.preventDefault();withPendingButton(event.currentTarget.querySelector('[type=submit]'),async()=>{
        const generation=state.generation,body={agent,remoteHostId:hostId,cwd:task.cwd||'',providerId:r.providerId,model:r.model,effort:r.effort,...(agent==='dsh'?{dshPermission:r.dshPermission||'default'}:{})};
        if(r.permMode)body.permMode=r.permMode;
        const session=await api('/api/sessions',{method:'POST',body});S.sessions.unshift(session);renderSessions();
        if(active(generation)&&state.task===task){state.task=null;await openSession(session.id);if(task.prompt){const input=document.getElementById('inpText');input.value=task.prompt;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}}
      },'创建中…').catch(error=>notice(error.message));
    };
  }

  function assignModel(options) {
    const {agent,hostId}=current(),d=draft(agent,hostId);
    d.providerId=options.providerId||'';d.model=options.model;d.dirty=true;++d.revision;state.tab='config';
    if(!state.legacy)notice('模型已填入，保存后用于所选环境的新会话。','ok');
  }
  async function chooseModel(model,contextGuard) {
    return window.AgentHubModelCenter.usage(model,contextGuard);
  }
  function addDialog(forceCustom=false) {
    openDlg('添加 Agent',`<form id="acAddForm" class="ac-add-form"><div class="fld"><label for="acAddType">Agent 类型</label><select id="acAddType">${(state.data.agents||[]).filter(a=>!a.unavailable).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}<option value="@custom">自定义 CLI / ACP Agent</option></select></div><div class="fld"><label for="acAddHost">运行环境</label><select id="acAddHost">${targets().map(t=>`<option value="${esc(t.id||'local')}">${esc(t.name)}</option>`).join('')}</select></div><div id="acCustomFields" hidden><div class="fld"><label for="acCustomName">名称</label><input id="acCustomName" maxlength="120" placeholder="给 Agent 起个名字"></div><div class="fld"><label for="acCustomBin">启动命令</label><input id="acCustomBin" maxlength="2048" placeholder="可执行文件路径或命令"></div><div class="fld"><label for="acCustomArgs">参数</label><input id="acCustomArgs" maxlength="4096" placeholder="启动参数（可选）"></div><label class="ac-show-all"><input id="acCustomAcp" type="checkbox">使用 ACP 协议</label></div><p class="ac-help">选择已安装的执行器，或填写自定义命令。添加后可分别设置模型、权限与启动路径。</p><div class="dialog-actions"><button type="submit" class="btn">继续配置</button></div><div id="acAddError" role="alert"></div></form>`);
    const guard=dialogGuard(),form=document.getElementById('acAddForm'),type=form.querySelector('#acAddType');
    type.onchange=()=>{form.querySelector('#acCustomFields').hidden=type.value!=='@custom';};
    form.onsubmit=e=>{e.preventDefault();withPendingButton(form.querySelector('[type=submit]'),async()=>{
      let agent=type.value;const host=form.querySelector('#acAddHost').value,hostId=host==='local'?'':host;
      if(agent==='@custom'){
        if(hostId&&form.querySelector('#acCustomAcp').checked)throw Error('ACP Agent 目前在本机接入，请先选择本机环境。');
        const result=await api('/api/agent-center/custom',{method:'POST',body:{name:form.querySelector('#acCustomName').value,bin:form.querySelector('#acCustomBin').value,args:form.querySelector('#acCustomArgs').value,acp:form.querySelector('#acCustomAcp').checked}});
        const c=result.agent;
        const added={...c,custom:true,ready:false,found:false,probePending:true,features:{},models:[],style:'raw'};
        state.data.agents.push(added);if(!S.agents.some(item=>item.id===c.id))S.agents.push(added);renderAgents();
        S.settings.customAgents=[...(S.settings.customAgents||[]),c];
        if(hostId){const target=draft(c.id,hostId);target.command=c.bin;target.dirty=true;++target.revision;}
        agent=c.id;
      }
      if(!supported(meta(agent),hostId))throw Error('此 Agent 目前仅支持本机，请选择本机环境。');
      if(!guard())return;await open({agent,hostId,tab:'config'});if(!state.open)return;draft(agent,hostId).editing=true;renderRows();renderDetail();
    },'添加中…').catch(error=>{if(guard())form.querySelector('#acAddError').textContent=error.message;});};
    if((state.data.agents||[]).some(agent=>agent.id===S.curAgent))type.value=S.curAgent;
    if(forceCustom){type.value='@custom';type.onchange();}
    enhanceDialogSelects(form);
    type.syncControl?.();
  }
  function refreshActivity() {
    if(!state.open||state.activityFrame)return;
    const {agent,hostId}=current(),recent=state.layout==='agents'?S.sessions.filter(s=>s.agent===agent&&(s.remoteHostId||'')===hostId).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,3):[];
    const signature=JSON.stringify([state.layout,state.selected,S.sessions.length,[...S.running].sort(),recent.map(s=>[s.id,s.title,s.cwd,Math.floor((s.updatedAt||0)/60000)])]);
    if(signature===state.activityKey)return;state.activityKey=signature;
    state.activityFrame=requestAnimationFrame(()=>{
      state.activityFrame=0;if(!state.open)return;renderRows();
      if(state.layout==='agents'&&!page.querySelector('#acConfigForm')&&!state.task)renderDetail();
    });
  }
  async function startConversation(key) {
    const entry=entries().find(item=>item.key===key);if(!entry)throw Error('Agent 配置已变更，请刷新后重试。');
    const id=entry.a.id,target=entry.target.id||'';
    if(!enabled(id))throw Error('请先启用此 Agent。');
    if(draft(id,target).dirty)throw Error('请先保存或取消当前设置，再开始对话。');
    await switchAgent(id);
    S.agentSelection=[id];S.agentFilter=id;storageSet('ah.agentSelection',JSON.stringify([id]));storageSet('ah.agentFilter',id);
    const remote=document.getElementById('selRemote');if(remote){remote.value=target;remote.dataset.cwdHost=target;remote.syncControl?.();applyAgentDefaultsToComposer(target);}
    renderAgents();renderSessions();document.getElementById('inpText')?.focus();
  }
  page.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    const filter=button.dataset.acFilter;
    if(filter){state.statusFilter=filter;state.limit=80;renderOverview();return;}
    if(button.dataset.acSelect){
      selectTarget(button.dataset.acSelect);return;
    }
    if(button.dataset.acStart){startConversation(button.dataset.acStart).catch(error=>notice(error.message));return;}
    if(button.dataset.acProbe){probe(button.dataset.acProbe,false).catch(error=>notice(error.message));return;}
    if(button.dataset.acSession){openSession(button.dataset.acSession).catch(error=>notice(error.message));return;}
    if(button.dataset.acTab){state.tab=button.dataset.acTab;state.task=null;renderDetail();page.querySelector('#acTab-'+state.tab).focus({preventScroll:true});return;}
    if(button.dataset.acEnv){
      const family=button.dataset.acEnv;
      if(family==='ssh'){
        const hosts=state.data.hosts||[];
        if(!hosts.length){state.returnRefresh=true;showSSH();return;}
        selectEnvironment(hosts.some(h=>h.id===state.lastSsh)?state.lastSsh:hosts[0].id);
      }else selectEnvironment(family==='local'?'':'wsl');
      return;
    }
    if(button.dataset.acFeature){
      const feature=button.dataset.acFeature,{agent}=current();
      withPendingButton(button,()=>savePreference(agent,{tools:{[feature]:pref(agent).tools?.[feature]===false}}),'保存中…').catch(error=>notice(error.message));return;
    }
    if(!button.dataset.acAction)return;
    Promise.resolve().then(async()=>{
      switch(button.dataset.acAction){
        case 'back':close();window.AgentHubManagement?.resumeSession();break;
        case 'catalog':setCatalogOpen(!page.classList.contains('ac-catalog-open'));break;
        case 'overview':state.layout='overview';state.host='';state.task=null;setCatalogOpen(false);renderRows();renderFilters();renderDetail();markNavigation();break;
        case 'directory':openDirectory();break;
        case 'icon':window.AgentHubIdentity?.edit({scope:'agent',id:current().agent,label:meta(current().agent).name});break;
        case 'organize':openOrganization();break;
        case 'show-hidden':state.showHidden=!state.showHidden;renderRows();break;
        case 'add':addDialog();break;
        case 'more':state.limit+=80;renderRows();break;
        case 'refresh':await withPendingButton(button,()=>load(state.generation,true),'刷新中…');break;
        case 'probe':await probe();break;
        case 'diagnostics':state.tab='diagnostics';state.task=null;renderDetail();break;
        case 'manage-env':state.tab='advanced';state.task=null;renderDetail();break;
        case 'edit':draft(current().agent,current().hostId).editing=true;state.tab='config';renderDetail();break;
        case 'inherit-model':await withPendingButton(button,async()=>{
          const {agent,hostId}=current(),key=state.selected,generation=state.generation;
          if(draft(agent,hostId).dirty)throw Error('请先保存或取消未保存的配置。');
          const result=await api('/api/agent-center/inherit-model',{method:'POST',body:{agent,hostId}});
          state.data.configurations[hostId||'local']||={};state.data.configurations[hostId||'local'][agent]=result.config;
          state.data.routes[agent]={providerId:'',model:'',effort:''};state.drafts.delete(key);
          S.settings.agentTargets=state.data.configurations;S.settings.agentRoutes=state.data.routes;
          if(S.settings.currentProvider)delete S.settings.currentProvider[agent];
          if(active(generation)){renderRows();if(state.selected===key)renderDetail();notice('已恢复全局默认；其他环境的单独配置继续保留。','ok');}
        },'恢复中…');break;
        case 'toggle-enabled':await withPendingButton(button,()=>savePreference(current().agent,{enabled:!enabled(current().agent)}),'保存中…');break;
        case 'new-task':await startConversation(state.selected);break;
        case 'cancel-task':state.task=null;renderDetail();break;
        case 'browse':{const task=state.task,{hostId}=current();showWorkspacePicker({hostId,path:task.cwd||'',onPick:dir=>{if(state.open&&state.task===task&&state.selected===task.key){task.cwd=dir;renderDetail();}}});break;}
        case 'all-sessions':{const {agent}=current();S.agentFilter=agent;storageSet('ah.agentFilter',agent);renderAgents();renderSessions();close();if(innerWidth<=900)toggleSidebar(true);break;}
        case 'models':window.AgentHubFeatures.modelCenter('models');break;
        case 'connections':window.AgentHubFeatures.modelCenter('connections');break;
        case 'ssh':state.returnRefresh=true;await showSSH();break;
        case 'mcp':await window.AgentHubCapabilities.open('mcp',{...current(),cwd:state.task?.cwd||''});break;
        case 'skills':await window.AgentHubCapabilities.open('skills',{...current(),cwd:state.task?.cwd||''});break;
        case 'assistants':await showSettings('settings-assistants');break;
      }
    }).catch(error=>notice(error.message));
  });

  document.addEventListener('orbitcell:order-changed',event=>{if(state.open&&state.data&&event.detail.key==='agents'){state.data.preferences=S.settings.agentPreferences;renderRows();}});
  window.AgentHubAgentCenter={open,close,refreshActivity,chooseModel,assignModel:options=>open(options)};
  document.getElementById('btnAgentCenter')?.addEventListener('click',()=>open());
  document.getElementById('btnEnvironments')?.addEventListener('click',()=>open({layout:'environments'}));
  for(const entry of document.querySelectorAll('#btnAgentCenter,#btnEnvironments')){entry.disabled=false;entry.removeAttribute('aria-busy');}
  document.getElementById('btnWorkbench')?.addEventListener('click',close,{capture:true});
  const brand=document.querySelector('.brand-logo');if(brand)brand.innerHTML=window.AgentHubIdentity?.brand()||icon('brand');
  const overlay=document.getElementById('overlay');
  if(overlay)new MutationObserver(()=>{
    if(state.open&&state.returnRefresh&&overlay.classList.contains('hidden')){state.returnRefresh=false;load(state.generation).catch(error=>notice(error.message));}
  }).observe(overlay,{attributes:true,attributeFilter:['class']});
  for(const button of document.querySelectorAll('#btnAgentCenter [data-ui-icon],#btnEnvironments [data-ui-icon]'))button.innerHTML=icon(button.dataset.uiIcon);
})();
