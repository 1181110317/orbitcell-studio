/* Shared connections and global defaults live here. Agent management owns
   explicit Agent/environment overrides. */
(() => {
  'use strict';
  const icon=name=>window.AgentHubIcons.svg(name);
  const nav=[['connections','供应商','network'],['models','已添加模型','cube'],['profiles','高级预设','list']];
  const nativeAgents=['claude','codex','zcode','dsh','builtin','chatgpt-web'];
  const effortOptions=[['','跟随模型'],['none','关闭'],['minimal','最低'],['low','低'],['medium','中'],['high','高'],['xhigh','超高'],['max','最大'],['ultra','极高']];
  let controller=null;
  const capacity=n=>Number(n)>0?(n>=1000000?+(n/1000000).toFixed(2)+'M':+(n/1000).toFixed(1)+'K'):'未标注';
  const sourceName=p=>p.source==='magpie'?'本机来源':p.source==='imported'?'外部配置':p.managed===false?'外部配置':'OrbitCell';
  const canEdit=p=>p.managed!==false||p.source==='magpie';
  const endpoint=p=>{try{const u=new URL(p.baseUrl);u.username='';u.password='';u.search='';u.hash='';return u.href.replace(/\/$/,'');}catch{return '未填写 API 地址';}};
  async function modelUsage(model,contextGuard=()=>true) {
    if(!model||!contextGuard())return;
    openDlg('模型使用设置',`<div class="management-editor model-usage-editor"><div class="model-usage-heading"><i class="managed-model-mark">${icon('cube')}</i><div><strong>${esc(model.name||model.id)}</strong><small>${esc(model.providerName||'共享连接')} · ${esc(model.id)}</small></div></div><div class="model-usage-intro"><div><b>默认共享，无需逐个分配</b><p>兼容的 Agent 可直接选择此连接。这里仅管理例外和新会话默认值。</p></div><button type="button" class="btn-mini" id="muDefault" ${S.readOnly?'disabled':''}>设为全局默认</button></div><div class="model-usage-toolbar"><span>可用 Agent</span><button type="button" class="btn-mini" id="muAllowAll" ${S.readOnly?'disabled':''}>启用所有兼容 Agent</button></div><form id="modelUsageForm"><div id="muAgents" class="model-usage-list" aria-live="polite"><p class="manage-loading">正在读取 Agent…</p></div><div id="muNotice" class="manage-notice" hidden role="status"></div><div class="dialog-actions"><button type="button" class="btn ghost" id="muClose">关闭</button><button type="submit" class="btn" id="muSave" disabled>保存使用设置</button></div></form></div>`);
    const guard=dialogGuard(),form=document.getElementById('modelUsageForm');
    document.getElementById('muClose').onclick=closeDlg;
    const report=(message,kind='error')=>window.AgentHubManagement.notice(document.getElementById('muNotice'),message,kind);
    const refresh=async()=>{await refreshData();if(controller?.host.active())await controller.load();};
    document.getElementById('muDefault').onclick=()=>withPendingButton(document.getElementById('muDefault'),async()=>{
      try{await api('/api/model-defaults',{method:'PUT',body:{providerId:model.providerId,model:model.id,effort:''}});await refresh();if(guard())report('已设为全局默认，继承全局设置的 Agent 新会话立即使用。','ok');}catch(error){if(guard())report(error.message);}
    },'保存中…');
    let entries=[];
    try{
      const data=await api('/api/model-center/connections/'+encodeURIComponent(model.providerId)+'/agents');
      if(!guard())return;entries=data.agents||[];
      document.getElementById('muAgents').innerHTML=entries.map((agent,index)=>{
        const o=agent.override||{};
        return `<section class="model-usage-agent" data-mu-row="${index}"><div class="model-usage-agent-main">${agent.supported?`<input type="checkbox" data-mu-enabled aria-label="允许 ${esc(agent.name)} 使用此连接" ${agent.enabled?'checked':''} ${S.readOnly?'disabled':''}>`:`<span class="model-usage-native">${icon('lock')}</span>`}<span class="model-usage-agent-icon">${window.AgentHubIcons.agent(agent.id)}</span><div class="model-usage-agent-copy"><b>${esc(agent.name)}</b><small>${agent.supported?(agent.ready?'已就绪 · 共享连接':'未安装或未就绪 · 可预设模型'):esc(agent.note||'原生模型目录 · 使用执行器自身的连接')}</small></div>${agent.supported?`<button type="button" class="btn-mini" data-mu-default ${S.readOnly?'disabled':''}>设为默认</button><button type="button" class="btn-mini" data-mu-toggle aria-expanded="false">自定义 ${icon('chevronDown')}</button>`:`<button type="button" class="btn-mini" data-mu-manage>管理 Agent ${icon('arrowRight')}</button>`}</div>${agent.supported?`<div class="model-usage-overrides" hidden><p>仅覆盖 ${esc(agent.name)}，其他 Agent 继续使用连接的原设置。</p><div class="management-editor-grid"><div class="fld"><label for="muProtocol-${index}">请求协议</label><select id="muProtocol-${index}" data-mu-protocol aria-label="${esc(agent.name)} 请求协议"><option value="">跟随连接（自动适配）</option><option value="openai" ${o.protocol==='openai'?'selected':''}>OpenAI 兼容</option><option value="anthropic" ${o.protocol==='anthropic'?'selected':''}>Anthropic Messages</option></select></div><div class="fld"><label for="muBase-${index}">专用 API 地址</label><input id="muBase-${index}" data-mu-base aria-label="${esc(agent.name)} 专用 API 地址" value="${esc(o.baseUrl||'')}" placeholder="留空跟随连接地址" maxlength="2048" spellcheck="false"><small>沿用此连接的密钥，只在需要专用通道时填写。</small></div></div></div>`:''}</section>`;
      }).join('');
      enhanceDialogSelects(form);
      document.getElementById('muSave').disabled=!!S.readOnly;
      window.OrbitCellLayout.bind(document.getElementById('muAgents'),{key:'agents',selector:'[data-mu-row]',id:el=>entries[+el.dataset.muRow].id,disabled:S.readOnly,onChange:window.OrbitCellLayout.saveAgents});
      form.querySelectorAll('[data-mu-row]').forEach(row=>{
        const agent=entries[+row.dataset.muRow];
        row.querySelector('[data-mu-toggle]')?.addEventListener('click',event=>{const fields=row.querySelector('.model-usage-overrides'),button=event.currentTarget;fields.hidden=!fields.hidden;button.setAttribute('aria-expanded',String(!fields.hidden));});
        row.querySelector('[data-mu-manage]')?.addEventListener('click',()=>{closeDlg();window.AgentHubAgentCenter.open({agent:agent.id,tab:'config'});});
        row.querySelector('[data-mu-default]')?.addEventListener('click',event=>withPendingButton(event.currentTarget,async()=>{
          try{
            if(!row.querySelector('[data-mu-enabled]').checked)throw Error('请先启用此 Agent 并保存使用设置');
            const configData=await api('/api/agent-center'),config={...(configData.configurations?.local?.[agent.id]||{}),providerId:model.providerId,model:model.id,effort:''};
            await api('/api/agent-center/config',{method:'PUT',body:{agent:agent.id,hostId:'',config}});await refresh();
            if(guard())report('已保存为 '+agent.name+' 本机新会话的默认模型。','ok');
          }catch(error){if(guard())report(error.message);}
        },'保存中…'));
      });
    }catch(error){if(guard()){document.getElementById('muAgents').innerHTML='<p class="manage-empty">Agent 列表读取失败，请关闭后重试。</p>';report(error.message);}}
    document.getElementById('muAllowAll').onclick=()=>form.querySelectorAll('[data-mu-enabled]').forEach(input=>input.checked=true);
    form.onsubmit=event=>{event.preventDefault();withPendingButton(document.getElementById('muSave'),async()=>{
      try{
        const next={};form.querySelectorAll('[data-mu-row]').forEach(row=>{const agent=entries[+row.dataset.muRow];if(!agent.supported){if(Object.keys(agent.override||{}).length)next[agent.id]=agent.override;return;}const item={};if(!row.querySelector('[data-mu-enabled]').checked)item.enabled=false;for(const [field,name]of [['protocol','protocol'],['baseUrl','base']]){const value=row.querySelector('[data-mu-'+name+']').value.trim();if(value)item[field]=value;}if(Object.keys(item).length)next[agent.id]=item;});
        await api('/api/model-center/connections/'+encodeURIComponent(model.providerId)+'/agents',{method:'PUT',body:{agents:next}});await refresh();if(guard())report('使用设置已保存；未设置例外的兼容 Agent 均可使用。','ok');
      }catch(error){if(guard())report(error.message);}
    },'保存中…');};
  }
  async function modelCenter(initial='connections') {
    if(initial==='agents'){window.AgentHubManagement.close();return window.AgentHubAgentCenter.open();}
    if(controller?.host.active())return controller.select(initial);
    const host=window.AgentHubManagement.open('models','模型管理');
    const state={view:nav.some(n=>n[0]===initial)?initial:'connections',data:null,query:'',connection:'',capability:'',limit:80,request:0};
    const active=host.active;
    const report=error=>window.AgentHubManagement.notice(host.body.querySelector('#mcNotice'),error.message||String(error));
    const action=(selector,fn,label='处理中…')=>{const button=host.body.querySelector(selector);if(button)button.onclick=()=>withPendingButton(button,async()=>{try{if(active())await fn();}catch(error){if(active())report(error);}},label);};
    const ctrl={host,load,refreshOrder:draw,select(view){if(!active())return;state.view=nav.some(n=>n[0]===view)?view:'connections';state.connection='';state.query='';state.limit=80;window.AgentHubManagement.setMenu(false);draw();}};
    controller=ctrl;
    async function load(force=false) {
      const request=++state.request;
      const data=await api('/api/model-center'+(force?'?refresh=1':''));
      if(!active()||request!==state.request)return;
      state.data=data;
      const count=document.getElementById('footModelCount');if(count)count.textContent=new Set(data.catalog.map(model=>model.id)).size||'';
      await refreshData();if(!active()||request!==state.request)return;
      if(state.connection&&!data.providers.some(p=>p.id===state.connection))state.connection='';
      draw();
    }
    function draw() {
      if(!active()||!state.data)return;
      const data=state.data,current=nav.find(n=>n[0]===state.view);
      host.body.innerHTML=`<div class="manage-layout" id="modelCenter"><aside class="manage-sidebar"><div class="manage-brand"><div><strong>模型管理</strong><small>添加供应商，再选择要使用的模型</small></div><button type="button" id="mcSideAdd" aria-label="添加供应商" ${S.readOnly?'disabled':''}>${icon('plus')}</button></div><nav class="manage-nav" aria-label="模型管理分区">${nav.map(([id,label,glyph])=>`<button type="button" data-mc-tab="${id}" class="${state.view===id?'active':''}" aria-current="${state.view===id?'page':'false'}">${icon(glyph)}<span>${label}</span>${id==='models'?`<small>${new Set(data.catalog.map(m=>m.id)).size}</small>`:''}</button>`).join('')}</nav><div class="manage-nav-caption">已添加供应商</div><div class="manage-source-list"><button type="button" class="manage-source-button ${state.view==='models'&&!state.connection?'active':''}" data-mc-source=""><i></i><span>全部供应商</span><small>${data.providers.length}</small></button>${data.providers.map(p=>`<button type="button" class="manage-source-button ${state.view==='connections'&&state.connection===p.id?'active':''}" data-mc-source="${esc(p.id)}"><i class="manage-source-brand">${window.AgentHubIcons.provider(p)}</i><span>${esc(p.name)}</span><small>${data.catalog.filter(m=>m.providerId===p.id).length}</small></button>`).join('')}</div>${window.AgentHubManagement.sidebarEnd('models')}</aside><main class="manage-workspace">${window.AgentHubManagement.context('模型管理 / '+current[1],'mcRefresh','刷新')}<div class="manage-scroll"><header class="manage-heading"><div><h2>${current[1]}</h2><p>${({models:'已添加的模型可在兼容 Agent 的对话中直接选择。',connections:'每个供应商只需配置一次 API，在这里选择和管理它的模型。',profiles:'保存 Agent 专属覆盖预设；未覆盖的 Agent 继续继承全局默认。'})[state.view]}</p></div><button type="button" class="btn" id="mcPrimary" ${S.readOnly?'disabled':''}>${icon('plus')}${state.view==='profiles'?'新建预设':state.view==='connections'&&state.connection?'添加模型':'添加供应商'}</button></header><div id="mcNotice" class="manage-notice" hidden role="status"></div><div id="mcContent"></div></div></main></div>`;
      host.body.querySelectorAll('[data-mc-tab]').forEach(button=>button.onclick=()=>ctrl.select(button.dataset.mcTab));
      host.body.querySelectorAll('[data-mc-source]').forEach(button=>button.onclick=()=>{state.connection=button.dataset.mcSource;state.view='connections';state.query='';state.limit=80;window.AgentHubManagement.setMenu(false);draw();});
      window.OrbitCellLayout.bind(host.body.querySelector('.manage-source-list'),{key:'providers',selector:'[data-mc-source]:not([data-mc-source=""])',id:el=>el.dataset.mcSource,allIds:()=>state.data.providers.map(p=>p.id)});
      action('#mcRefresh',()=>load(),'刷新中…');
      action('#mcSideAdd',()=>connectionEditor(null));
      action('#mcPrimary',()=>state.view==='profiles'?profileEditor():state.view==='connections'&&state.connection?manageProviderModels(state.data.providers.find(p=>p.id===state.connection)):connectionEditor(null));
      ({models,connections,profiles})[state.view]();
      if(data.error)report(Error(data.error));
      else if(data.magpie?.enabled&&data.magpie.error)report(Error('本机来源同步失败，当前保留已缓存目录：'+data.magpie.error));
    }
    function models() {
      const data=state.data;
      host.body.querySelector('#mcContent').innerHTML=`<div class="manage-toolbar"><label class="manage-search">${icon('search')}<input id="mcSearch" type="search" aria-label="搜索模型" placeholder="搜索模型、连接或路由分组" value="${esc(state.query)}"></label><select id="mcProviderFilter" aria-label="模型来源"><option value="">全部连接</option>${data.providers.map(p=>`<option value="${esc(p.id)}" ${state.connection===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><select id="mcCapability" aria-label="模型能力">${[['','全部能力'],['image','已标注图片输入'],['reasoning','已标注推理'],['group','路由分组']].map(([id,label])=>`<option value="${id}" ${state.capability===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="manage-list-header" aria-hidden="true"><span>模型</span><span>连接与能力</span><span>上下文</span><span></span></div><div id="mcModelList"></div><div id="mcResultCount" class="manage-result"></div>`;
      enhanceDialogSelects(host.body.querySelector('.manage-toolbar'));
      for(const [id,key]of [['mcSearch','query'],['mcProviderFilter','connection'],['mcCapability','capability']])host.body.querySelector('#'+id).addEventListener(id==='mcSearch'?'input':'change',event=>{state[key]=event.target.value;state.limit=80;modelRows();});
      modelRows();
    }
    function modelRows() {
      host.body.querySelectorAll('[data-mc-source]').forEach(button=>button.classList.toggle('active',button.dataset.mcSource===state.connection));
      const query=state.query.trim().toLowerCase(),data=state.data;
      const list=data.catalog.filter(model=>(!state.connection||model.providerId===state.connection)&&(!query||[model.id,model.name,model.providerName,model.owner].join(' ').toLowerCase().includes(query))&&(!state.capability||(state.capability==='image'?model.imageInput:state.capability==='reasoning'?model.reasoning:model.group)));
      host.body.querySelector('#mcModelList').innerHTML=list.slice(0,state.limit).map(model=>`<article class="managed-model-row" data-catalog-model="${esc(model.id)}"><div class="managed-model-title"><i class="managed-model-mark">${icon(model.group?'workflow':'cube')}</i><span><b>${esc(model.name)}</b><code title="${esc(model.id)}">${esc(model.id)}</code></span></div><div class="managed-model-source">${esc(model.providerName)}<small>${[model.imageInput?'图片':'',model.reasoning?'推理':'',model.group?'路由分组':''].filter(Boolean).join(' · ')||'能力未标注'}</small></div><span class="managed-model-capacity">${capacity(model.context)}</span><div class="managed-model-actions"><button type="button" class="btn-mini" data-mc-model-edit="${data.catalog.indexOf(model)}" ${S.readOnly?'disabled':''}>管理</button><button type="button" class="btn-mini" data-mc-assign="${data.catalog.indexOf(model)}" ${S.readOnly?'disabled':''}>使用设置</button><button type="button" class="btn-mini" data-mc-detail="${data.catalog.indexOf(model)}">详情</button></div></article>`).join('')||`<div class="manage-empty">${icon('cube')}<strong>${data.catalog.length?'没有匹配的模型':'还没有模型目录'}</strong><p>${data.catalog.length?'调整搜索或筛选条件。':'添加供应商，再勾选要使用的模型。'}</p><button type="button" class="btn ghost" id="mcGoConnections">管理供应商</button></div>`;
      host.body.querySelector('#mcResultCount').innerHTML=`${list.length} 个已添加模型${list.length>state.limit?'<button type="button" class="btn-mini" id="mcMore">显示更多</button>':''}`;
      window.OrbitCellLayout.bind(host.body.querySelector('#mcModelList'),{key:'models',selector:'.managed-model-row',id:el=>{const m=data.catalog[+el.querySelector('[data-mc-model-edit]').dataset.mcModelEdit];return JSON.stringify([m.providerId,m.id]);},allIds:()=>data.catalog.map(m=>JSON.stringify([m.providerId,m.id]))});
      action('#mcGoConnections',()=>ctrl.select('connections'));
      action('#mcMore',()=>{state.limit+=80;modelRows();});
      host.body.querySelectorAll('[data-mc-model-edit]').forEach(button=>button.onclick=()=>editModel(data.catalog[+button.dataset.mcModelEdit]));
      host.body.querySelectorAll('[data-mc-assign]').forEach(button=>button.onclick=()=>withPendingButton(button,()=>modelUsage(data.catalog[+button.dataset.mcAssign],active),'读取 Agent…').catch(error=>active()&&report(error)));
      host.body.querySelectorAll('[data-mc-detail]').forEach(button=>button.onclick=()=>modelDetail(data.catalog[+button.dataset.mcDetail]));
    }
    function editModel(model) {
      const provider=state.data.providers.find(p=>p.id===model.providerId);if(!provider)return;
      state.view='connections';state.connection=provider.id;state.query='';draw();manageProviderModels(provider);
    }

    function modelDetail(model) {
      const provider=state.data.providers.find(p=>p.id===model.providerId),session=curSession();
      const usable=!!session&&!S.running.has(session.id)&&!S.readOnly&&nativeAgents.includes(session.agent)&&providersFor(session.agent).some(p=>p.id===model.providerId);
      openDlg('模型详情',`<div class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${icon('cube')}</i><div><strong>${esc(model.name)}</strong><p>${esc(model.providerName)}</p></div></div><div class="model-detail-facts"><div><small>上下文</small><b>${capacity(model.context)}</b></div><div><small>图片输入</small><b>${model.imageInput?'已标注支持':'未标注'}</b></div><div><small>推理</small><b>${model.reasoning?'已标注支持':'未标注'}</b></div></div><dl><div><dt>模型 ID</dt><dd><code>${esc(model.id)}</code></dd></div><div><dt>连接地址</dt><dd><code>${esc(endpoint(provider||{}))}</code></dd></div><div><dt>推理档位</dt><dd>${esc(model.efforts?.join(' / ')||'跟随模型或执行器')}</dd></div></dl><div class="dialog-actions"><button type="button" class="btn ghost" id="mcDetailClose">关闭</button><button type="button" class="btn ghost" id="mcDetailEdit" ${S.readOnly?'disabled':''}>管理此供应商的模型</button><button type="button" class="btn ghost" id="mcUseCurrent" ${usable?'':'disabled'} title="${usable?'切换当前空闲会话的模型':'需要一个支持此连接的空闲会话'}">用于当前会话</button><button type="button" class="btn" id="mcDetailAssign" ${S.readOnly?'disabled':''}>使用设置</button></div></div>`);
      const guard=dialogGuard();document.getElementById('mcDetailClose').onclick=closeDlg;
      document.getElementById('mcDetailEdit').onclick=()=>{closeDlg();editModel(model);};
      document.getElementById('mcDetailAssign').onclick=()=>withPendingButton(document.getElementById('mcDetailAssign'),()=>modelUsage(model,guard),'读取 Agent…').catch(error=>toast(error.message,'err'));
      document.getElementById('mcUseCurrent').onclick=()=>withPendingButton(document.getElementById('mcUseCurrent'),async()=>{
        try{if(!usable||!guard()||S.running.has(session.id))throw Error('当前会话暂时不能切换模型');await saveSessionPatch(session,{providerId:model.providerId,model:model.id});
          if(guard()&&active()&&curSession()?.id===session.id){closeDlg();window.AgentHubManagement.close();renderComposer(session);renderHeader(session);toast('当前会话已切换模型','ok');}}
        catch(error){if(guard())toast(error.message,'err');}
      },'切换中…');
    }
    function connections() {
      const provider=state.data.providers.find(p=>p.id===state.connection);
      if(provider)return providerPage(provider);
      const global=state.data.modelDefaults||{},current=state.data.providers.find(p=>p.id===global.providerId);
      host.body.querySelector('#mcContent').innerHTML=`<div class="provider-default-bar"><span>${icon('star')}新对话默认</span><strong>${esc(current?.name||'尚未设置')}<small>${esc(global.model||current?.model||'跟随供应商默认模型')}</small></strong><button type="button" class="btn ghost" id="mcChooseDefault" ${S.readOnly?'disabled':''}>修改默认</button></div><div class="manage-toolbar"><label class="manage-search">${icon('search')}<input id="mcConnectionSearch" type="search" placeholder="搜索供应商" aria-label="搜索供应商" value="${esc(state.query)}"></label><span class="provider-count">${state.data.providers.length} 个供应商</span><button type="button" class="btn-mini" id="mcDiscovery">本机模型来源</button></div><div id="mcConnections" class="provider-grid"></div>`;
      host.body.querySelector('#mcConnectionSearch').oninput=event=>{state.query=event.target.value;connectionRows();};
      action('#mcDiscovery',discoveryEditor);
      host.body.querySelector('#mcChooseDefault').onclick=()=>chooseGlobalDefault(current||state.data.providers.find(p=>p.shared!==false));
      connectionRows();
    }
    function manageProviderModels(provider) {
      if(!provider)return;
      if(!canEdit(provider))return connectionEditor(provider);
      return window.AgentHubProviderModelPicker.open(provider,{onSaved:async()=>{if(active())await load();}});
    }
    function providerPage(provider) {
      const heading=host.body.querySelector('.manage-heading');heading.querySelector('h2').textContent=provider.name;
      heading.querySelector('p').textContent='管理此供应商的模型与连接设置';
      const all=window.AgentHubProviderModels.available(provider),selected=window.AgentHubProviderModels.selected(provider);
      host.body.querySelector('#mcContent').innerHTML=`<button type="button" class="btn-mini provider-back" id="mcProviderBack">${icon('chevronLeft')}全部供应商</button><section class="provider-detail-summary"><i class="managed-model-mark">${window.AgentHubIcons.provider(provider)}</i><div><h3>${esc(provider.name)}</h3><code>${esc(endpoint(provider))}</code><p>${selected.length} 个已添加 · 目录共 ${all.length} 个 · ${provider.protocol==='anthropic'?'Anthropic Messages':provider.protocol==='openai'?'OpenAI 兼容':'自动识别协议'}</p></div><div class="provider-summary-actions"><button type="button" class="btn ghost" id="mcProviderSettings">${icon('gear')}连接设置</button><button type="button" class="btn-mini" id="mcProviderMore" aria-label="供应商更多设置">${icon('more')}</button></div></section><section id="mcProviderQuota" aria-label="供应商账户额度"></section><div class="provider-model-heading"><h3>已添加模型 <small>${selected.length}</small></h3><button type="button" class="btn-mini" id="mcProviderSelect">选择更多模型 ${icon('plus')}</button></div><div id="mcModelList"></div><div id="mcResultCount" class="manage-result"></div>`;
      action('#mcProviderBack',()=>ctrl.select('connections'));
      action('#mcProviderSettings',()=>connectionEditor(provider));
      action('#mcProviderMore',()=>connectionDetail(provider));
      action('#mcProviderSelect',()=>manageProviderModels(provider));
      window.OrbitCellQuota?.panel(host.body.querySelector('#mcProviderQuota'),provider);
      modelRows();
    }
    function chooseGlobalDefault(provider) {
      if(!provider)return toast('请先添加供应商和模型','err');
      const defaults=state.data.modelDefaults||{},same=defaults.providerId===provider.id;
      openDlg('设置全局默认模型',`<form id="mcDefaultForm" class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${icon('defaultSettings')}</i><div><strong>支持共享 API 的 Agent 继承默认</strong><p>支持共享 API 的 Agent 新会话使用这里的设置；ACP、Gemini 等沿用原生连接，已有会话保留配置。</p></div></div><div class="management-editor-grid"><div class="fld full"><label for="mcDefaultProvider">共享连接</label><select id="mcDefaultProvider">${state.data.providers.filter(p=>p.shared!==false&&p.scope!=='agent').map(p=>`<option value="${esc(p.id)}" ${p.id===(provider?.id||defaults.providerId)?'selected':''}>${esc(p.name)} · ${esc(p.model||'跟随连接模型')}</option>`).join('')}</select></div><div class="fld"><label for="mcDefaultModel">默认模型（可选）</label><input id="mcDefaultModel" maxlength="256" value="${esc(same?defaults.model||'':'')}" placeholder="跟随连接模型"></div><div class="fld"><label for="mcDefaultEffort">默认推理强度</label><select id="mcDefaultEffort">${effortOptions.map(([id,label])=>`<option value="${id}" ${(same?defaults.effort||'':'')===id?'selected':''}>${label}</option>`).join('')}</select></div></div><div id="mcDefaultError" class="manage-notice" hidden></div><div class="dialog-actions"><button type="button" class="btn ghost" id="mcDefaultCancel">取消</button><button type="submit" class="btn" id="mcDefaultSave">保存全局默认</button></div></form>`);
      const guard=dialogGuard(),form=document.getElementById('mcDefaultForm');enhanceDialogSelects(form);enhanceModelInput(form.querySelector('#mcDefaultModel'),()=>state.data.catalog.filter(m=>m.providerId===form.querySelector('#mcDefaultProvider').value));document.getElementById('mcDefaultCancel').onclick=closeDlg;
      form.querySelector('#mcDefaultProvider').onchange=event=>{const p=state.data.providers.find(item=>item.id===event.target.value);form.querySelector('#mcDefaultModel').value='';form.querySelector('#mcDefaultModel').placeholder=p?.model||'跟随连接模型';form.querySelector('#mcDefaultEffort').value='';form.querySelector('#mcDefaultEffort').syncControl?.();};
      form.onsubmit=event=>{event.preventDefault();return withPendingButton(document.getElementById('mcDefaultSave'),async()=>{try{await api('/api/model-defaults',{method:'PUT',body:{providerId:form.querySelector('#mcDefaultProvider').value,model:form.querySelector('#mcDefaultModel').value.trim(),effort:form.querySelector('#mcDefaultEffort').value}});if(guard())closeDlg();if(active()){await load();toast('已更新兼容 Agent 的全局默认','ok');}}catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('mcDefaultError'),error.message);}},'保存中…');};
    }
    function connectionRows() {
      const query=state.query.trim().toLowerCase(),list=state.data.providers.filter(p=>!query||[p.name,p.baseUrl].join(' ').toLowerCase().includes(query));
      host.body.querySelector('#mcConnections').innerHTML=list.map(provider=>{
        const count=window.AgentHubProviderModels.selected(provider).length,total=window.AgentHubProviderModels.available(provider).length;
        return `<article class="provider-card" data-provider-id="${esc(provider.id)}"><button type="button" class="provider-card-main" data-provider-open="${state.data.providers.indexOf(provider)}"><i class="managed-model-mark">${window.AgentHubIcons.provider(provider)}</i><span><strong>${esc(provider.name)}${provider.isGlobalDefault?'<em>默认</em>':''}</strong><code>${esc(endpoint(provider))}</code></span>${icon('chevronRight')}</button><div data-provider-quota="${esc(provider.id)}"></div><div class="provider-card-footer"><span><b>${count}</b> 个已添加 <small>${provider.modelSync?.error?'· 目录接口未返回列表':'/ '+total+' 个目录模型'}</small></span><button type="button" class="btn-mini" data-provider-models="${state.data.providers.indexOf(provider)}">${icon('plus')}添加模型</button></div></article>`;
      }).join('')||'<div class="manage-empty"><strong>添加你的第一个供应商</strong><p>填写一次 API 后，即可批量选择需要的模型。</p><button type="button" class="btn" id="mcEmptyAdd">添加供应商</button></div>';
      host.body.querySelectorAll('[data-provider-open]').forEach(button=>button.onclick=()=>{state.connection=state.data.providers[+button.dataset.providerOpen].id;state.query='';draw();});
      host.body.querySelectorAll('[data-provider-models]').forEach(button=>button.onclick=()=>manageProviderModels(state.data.providers[+button.dataset.providerModels]));
      action('#mcEmptyAdd',()=>connectionEditor(null));
      host.body.querySelectorAll('[data-provider-quota]').forEach(el=>{const provider=state.data.providers.find(p=>p.id===el.dataset.providerQuota);if(provider)window.OrbitCellQuota?.mount(el,provider);});
      window.OrbitCellLayout.bind(host.body.querySelector('#mcConnections'),{key:'providers',selector:'.provider-card',id:el=>el.dataset.providerId,allIds:()=>state.data.providers.map(p=>p.id)});
    }
    function connectionDetail(provider) {
      openDlg('供应商详情',`<div class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${icon('network')}</i><div><strong>${esc(provider.name)}</strong><p>${sourceName(provider)} · ${esc(provider.protocol||'自动判断协议')}</p></div></div><dl><div><dt>API 地址</dt><dd><code>${esc(endpoint(provider))}</code></dd></div><div><dt>默认模型</dt><dd>${esc(provider.model||'跟随 Agent 配置')}</dd></div><div><dt>密钥</dt><dd>${provider.apiKey||provider.maskedKey?'已配置，界面不显示原文':'未设置'}</dd></div><div><dt>模型入口</dt><dd>${state.data.catalog.filter(model=>model.providerId===provider.id).length}</dd></div></dl><div id="mcConnectionNotice" class="manage-notice" hidden></div><div class="dialog-actions"><button type="button" class="btn-mini" id="mcConnectionLimit" ${S.readOnly?'disabled':''}>额度与限额</button><button type="button" class="btn-mini" id="mcConnectionQuota" ${S.readOnly||provider.managed===false?'disabled':''}>额度接口</button><button type="button" class="btn-mini" id="mcConnectionTest" ${S.readOnly||provider.managed===false?'disabled':''}>检查连接</button><button type="button" class="btn ghost" id="mcConnectionDelete" ${S.readOnly||provider.managed===false?'disabled':''}>删除</button><button type="button" class="btn" id="mcConnectionEdit" ${S.readOnly?'disabled':''}>${canEdit(provider)?'连接设置':'复制配置'}</button></div></div>`);
      const guard=dialogGuard();
      document.getElementById('mcConnectionLimit').onclick=()=>openLimitDialog(provider.id);
      document.getElementById('mcConnectionQuota').onclick=()=>window.OrbitCellQuota.settings(provider,()=>load());
      document.getElementById('mcConnectionEdit').onclick=()=>{closeDlg();connectionEditor(provider);};
      document.getElementById('mcConnectionTest').onclick=()=>withPendingButton(document.getElementById('mcConnectionTest'),async()=>{try{const result=await api('/api/providers/'+encodeURIComponent(provider.id)+'/health',{method:'POST',body:{mode:'models'},timeoutMs:35000});if(guard())window.AgentHubManagement.notice(document.getElementById('mcConnectionNotice'),result.ok?'连接检查通过 · '+result.ms+' ms':result.error||'连接检查未通过',result.ok?'ok':'error');}catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('mcConnectionNotice'),error.message);}},'检查中…');
      document.getElementById('mcConnectionDelete').onclick=()=>withPendingButton(document.getElementById('mcConnectionDelete'),async()=>{try{if(!await uiConfirm('删除连接“'+provider.name+'”？使用此连接的新请求将需要重新选择。',{title:'删除供应商',okLabel:'删除',danger:true}))return;if(!guard())return;await api('/api/providers/'+encodeURIComponent(provider.id),{method:'DELETE'});if(guard())closeDlg();await load();}catch(error){if(guard())toast(error.message,'err');}},'删除中…');
    }
    function connectionEditor(original) {
      return window.AgentHubConnectionEditor.open(original,{onSaved:async(provider,{syncError})=>{
        if(!active())return;
        state.view='connections';state.connection=provider.id;state.query='';
        await load();
        if(syncError)report(Error('连接已保存，模型目录暂未取得：'+syncError+'。可重试获取，或编辑连接手动添加模型。'));
        else toast('供应商已保存，可在此添加与管理模型','ok');
      }});
    }
    function discoveryEditor() {
      const gateway=state.data.magpie;
      openDlg('本机模型来源',`<form id="modelDiscoveryForm" class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${icon('server')}</i><div><strong>Magpie 模型来源</strong><p>可选的本机目录来源；其他 API 使用普通模型连接管理。</p></div></div><div class="management-editor-grid"><label class="setting-check full"><input type="checkbox" id="mcGatewayEnabled" ${gateway.enabled?'checked':''} ${S.readOnly?'disabled':''}>自动读取此来源的模型目录</label><div class="fld full"><label for="mcGatewayUrl">API 地址</label><input id="mcGatewayUrl" value="${esc(gateway.baseUrl||'http://127.0.0.1:3425/v1')}" ${S.readOnly?'readonly':''}></div><div class="fld full"><label for="mcGatewayKey">访问密钥</label><input id="mcGatewayKey" type="password" autocomplete="new-password" placeholder="留空保留已保存密钥" ${S.readOnly?'readonly':''}></div></div><p class="dialog-note">${gateway.connected?'上次目录同步成功':gateway.error?esc(gateway.error):'尚未同步目录'}${gateway.cached?'，当前保留上次目录。':''}</p><div id="mcDiscoveryError" class="manage-notice" hidden></div><div class="dialog-actions"><button type="button" class="btn ghost" id="mcGatewayCancel">关闭</button><button type="submit" class="btn" id="mcGatewaySave" ${S.readOnly?'disabled':''}>保存并同步</button></div></form>`);
      const guard=dialogGuard();document.getElementById('mcGatewayCancel').onclick=closeDlg;
      document.getElementById('modelDiscoveryForm').onsubmit=event=>{event.preventDefault();withPendingButton(document.getElementById('mcGatewaySave'),async()=>{try{const key=document.getElementById('mcGatewayKey').value;await api('/api/model-center/magpie',{method:'PUT',body:{enabled:document.getElementById('mcGatewayEnabled').checked,baseUrl:document.getElementById('mcGatewayUrl').value,...(key?{apiKey:key}:{})}});if(guard())closeDlg();await load(true);}catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('mcDiscoveryError'),error.message);}},'同步中…');};
    }
    function profiles() {
      const list=state.data.profiles;
      host.body.querySelector('#mcContent').innerHTML=`${list.map(profile=>`<article class="managed-profile"><div class="managed-profile-head"><h3>${esc(profile.name)}</h3><span>${Object.keys(profile.routes).length} 个 Agent 覆盖</span></div><div class="managed-profile-models">${Object.entries(profile.routes).map(([agent,route])=>`<div><small>${esc(agentMeta(agent).name)}</small><code>${esc(route.model||'跟随共享默认')}</code></div>`).join('')}</div><div class="managed-profile-actions"><button type="button" class="btn ghost" data-mc-profile-delete="${esc(profile.id)}" ${S.readOnly?'disabled':''}>删除</button><button type="button" class="btn ghost" data-mc-profile-edit="${esc(profile.id)}" ${S.readOnly?'disabled':''}>编辑</button><button type="button" class="btn ghost" data-mc-profile-copy="${esc(profile.id)}" ${S.readOnly?'disabled':''}>复制预设</button><button type="button" class="btn" data-mc-profile-apply="${esc(profile.id)}" ${S.readOnly?'disabled':''}>应用覆盖</button></div></article>`).join('')||`<div class="manage-empty">${icon('list')}<strong>保存一组 Agent 覆盖配置</strong><p>只为需要特殊模型的 Agent 保存覆盖，其余继续继承全局默认。</p><button type="button" class="btn ghost" id="mcCreateProfile" ${S.readOnly?'disabled':''}>新建覆盖预设</button></div>`}<div class="manage-footnote">${icon('info')}<span>覆盖预设只修改选中的 Agent。清除 Agent 覆盖后，它会重新继承共享连接的全局默认。</span></div>`;
      action('#mcCreateProfile',profileEditor);
      host.body.querySelectorAll('[data-mc-profile-edit]').forEach(button=>button.onclick=()=>profileEditor(list.find(profile=>profile.id===button.dataset.mcProfileEdit)));
      host.body.querySelectorAll('[data-mc-profile-copy]').forEach(button=>button.onclick=()=>profileEditor(list.find(profile=>profile.id===button.dataset.mcProfileCopy),true));
      host.body.querySelectorAll('[data-mc-profile-apply]').forEach(button=>button.onclick=()=>withPendingButton(button,async()=>{try{await api('/api/model-center/profiles/'+encodeURIComponent(button.dataset.mcProfileApply)+'/apply',{method:'POST',body:{}});await load();if(active())toast('覆盖预设已应用','ok');}catch(error){if(active())report(error);}},'应用中…'));
      host.body.querySelectorAll('[data-mc-profile-delete]').forEach(button=>button.onclick=()=>withPendingButton(button,async()=>{const profile=list.find(p=>p.id===button.dataset.mcProfileDelete);try{if(!await uiConfirm('删除覆盖预设“'+profile.name+'”？',{title:'删除模型预设',okLabel:'删除',danger:true}))return;if(!active())return;await api('/api/model-center/profiles/'+encodeURIComponent(profile.id),{method:'DELETE'});await load();}catch(error){if(active())report(error);}},'删除中…'));
    }
    function profileEditor(original,copy=false) {
      if(S.readOnly)return;
      const editing=!!original&&!copy,routes=structuredClone(original?.routes||state.data.routes||{});
      openDlg(editing?'编辑覆盖预设':original?'复制覆盖预设':'新建覆盖预设',`<form id="mcProfileForm" class="management-editor"><div class="fld"><label for="mcProfileName">预设名称</label><input id="mcProfileName" value="${esc(original?original.name+(copy?' · 副本':''):'')}" required maxlength="80" placeholder="例如：日常开发"></div><p class="dialog-note">选择要保存的 Agent。未选择的 Agent 不会被预设修改。</p>${nativeAgents.map(agent=>{const route=routes[agent]||{};return `<section class="profile-editor-row" data-profile-agent="${agent}"><label class="setting-check"><input type="checkbox" data-profile-enabled ${(original?Object.hasOwn(routes,agent):route.providerId||route.model)?'checked':''}><i class="profile-agent-icon">${window.AgentHubIcons.agent(agent)}</i>${esc(agentMeta(agent).name)}</label><div class="profile-editor-fields"><div class="fld"><label for="profileProvider-${agent}">连接</label><select id="profileProvider-${agent}" data-profile-provider><option value="">跟随执行器配置</option>${providersFor(agent).map(p=>`<option value="${esc(p.id)}" ${route.providerId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}${route.providerId&&!providersFor(agent).some(p=>p.id===route.providerId)?`<option value="${esc(route.providerId)}" selected>当前连接不可用</option>`:''}</select></div><div class="fld"><label for="profileModel-${agent}">模型</label><input id="profileModel-${agent}" data-profile-model maxlength="256" value="${esc(route.model||'')}" placeholder="模型 ID"></div><div class="fld"><label for="profileEffort-${agent}">推理</label><select id="profileEffort-${agent}" data-profile-effort>${effortOptions.map(([id,label])=>`<option value="${id}" ${route.effort===id?'selected':''}>${label}</option>`).join('')}</select></div></div></section>`;}).join('')}<div id="mcProfileError" class="manage-notice" hidden></div><div class="dialog-actions"><button type="button" class="btn ghost" id="mcProfileCancel">取消</button><button type="submit" class="btn" id="mcSaveProfile">保存预设</button></div></form>`);
      const guard=dialogGuard(),form=document.getElementById('mcProfileForm');enhanceDialogSelects(form);document.getElementById('mcProfileCancel').onclick=closeDlg;
      form.querySelectorAll('[data-profile-agent]').forEach(row=>{const provider=row.querySelector('[data-profile-provider]'),model=row.querySelector('[data-profile-model]');enhanceModelInput(model,()=>state.data.catalog.filter(m=>m.providerId===provider.value));provider.addEventListener('change',()=>{model.value='';row.querySelector('[data-profile-enabled]').checked=true;});});
      form.onsubmit=event=>{event.preventDefault();withPendingButton(document.getElementById('mcSaveProfile'),async()=>{try{const selected={};form.querySelectorAll('[data-profile-agent]').forEach(row=>{if(row.querySelector('[data-profile-enabled]').checked)selected[row.dataset.profileAgent]={providerId:row.querySelector('[data-profile-provider]').value,model:row.querySelector('[data-profile-model]').value.trim(),effort:row.querySelector('[data-profile-effort]').value};});if(!Object.keys(selected).length)throw Error('至少选择一个 Agent');await api('/api/model-center/profiles'+(editing?'/'+encodeURIComponent(original.id):''),{method:editing?'PUT':'POST',body:{name:document.getElementById('mcProfileName').value.trim(),routes:selected}});if(guard())closeDlg();await load();}catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('mcProfileError'),error.message);}},'保存中…');};
    }
    try{await load();}catch(error){if(active())host.body.innerHTML=`<div class="manage-empty"><strong>模型管理读取失败</strong><p>${esc(error.message||'请检查服务状态')}</p><button type="button" class="btn ghost" id="mcRetry">重试</button><button type="button" class="btn-mini" data-manage-close>返回工作台</button></div>`;host.body.querySelector('#mcRetry')?.addEventListener('click',()=>{controller=null;modelCenter(initial);});}
  }
  Object.assign(AgentHubFeatures,{modelCenter,modelRoutes:()=>modelCenter('agents')});
  window.AgentHubModelCenter=Object.freeze({open:modelCenter,usage:modelUsage,refresh:()=>controller?.host.active()?controller.load():Promise.resolve()});
  document.addEventListener('orbitcell:order-changed',event=>{if(['providers','models'].includes(event.detail.key)&&controller?.host.active())controller.refreshOrder();});
  const entry=document.getElementById('btnModelCenter');
  if(entry){entry.addEventListener('click',()=>modelCenter());entry.disabled=false;entry.removeAttribute('aria-busy');}
})();
