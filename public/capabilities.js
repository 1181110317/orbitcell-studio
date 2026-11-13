/* Skills, third-party MCP and assistants share one capability inventory.
   Search updates rows only; it never replaces an in-progress import/editor. */
(() => {
  'use strict';
  const icon=name=>window.AgentHubIcons.svg(name);
  const nav=[['skills','技能库','book'],['mcp','MCP 服务器','network'],['assistants','助手','spark']];
  let controller=null;
  async function open(initial='skills',options={}) {
    if(controller?.host.active()){controller.context(options);return controller.select(initial);}
    const host=window.AgentHubManagement.open('capabilities','能力中心');
    const session=curSession();let cwd=options.cwd??session?.cwd??'';
    const normalizeHost=value=>value==='local'?'':value||'';
    const state={agent:options.agent??session?.agent??'',hostId:normalizeHost(options.hostId??session?.remoteHostId),native:[],warnings:[],view:nav.some(n=>n[0]===initial)?initial:'skills',query:'',filter:'all',scope:'',skills:[],mcp:[],assistants:[],limit:80,request:0};
    const active=host.active;
    const ctrl={host,state,context(opts){if(Object.hasOwn(opts,'agent'))state.agent=opts.agent;if(Object.hasOwn(opts,'hostId'))state.hostId=normalizeHost(opts.hostId);if(Object.hasOwn(opts,'cwd'))cwd=opts.cwd;},async select(view){const next=nav.some(n=>n[0]===view)?view:'skills';if(next!==state.view){state.query='';state.filter='all';state.limit=80;}state.view=next;window.AgentHubManagement.setMenu(false);try{await load();}catch(error){if(active())notice(error.message);}}};
    controller=ctrl;
    function notice(message,tone='error'){window.AgentHubManagement.notice(host.body.querySelector('#capNotice'),message,tone);}
    function action(selector,fn,label='处理中…'){const button=host.body.querySelector(selector);if(button)button.onclick=()=>withPendingButton(button,async()=>{try{if(active())await fn();}catch(error){if(active())notice(error.message);}},label);}
    function draw() {
      if(!active())return;
      const current=nav.find(n=>n[0]===state.view);
      host.body.innerHTML=`<div class="manage-layout" id="capabilityCenter"><aside class="manage-sidebar"><div class="manage-brand"><div><strong>能力中心</strong><small>技能、工具与角色各归其位</small></div></div><nav class="manage-nav" aria-label="能力中心分区">${nav.map(([id,label,glyph])=>`<button type="button" data-cap-view="${id}" class="${state.view===id?'active':''}" aria-current="${state.view===id?'page':'false'}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav><div class="manage-nav-caption">按状态查看</div><div class="manage-source-list">${[['all','全部'],['enabled','已启用'],['disabled','已停用'],...(state.view==='mcp'?[['attention','未检测或异常']]:[])].map(([id,label])=>`<button type="button" class="manage-source-button ${state.filter===id?'active':''}" data-cap-filter="${id}"><span>${label}</span></button>`).join('')}</div>${window.AgentHubManagement.sidebarEnd('capabilities')}</aside><main class="manage-workspace">${window.AgentHubManagement.context('能力中心 / '+current[1],'capRefresh')}<div class="manage-scroll"><header class="manage-heading"><div><h2>${current[1]}</h2><p>${({skills:'按 Agent 与电脑浏览技能，包含原生、共享和插件安装的来源。',mcp:'配置工具服务器，按需检测连接与工具目录。',assistants:'用系统提示词定义角色，执行器与模型分别管理。'})[state.view]}</p></div><button type="button" class="btn" id="capPrimary" ${S.readOnly?'disabled':''}>${icon('plus')}${({skills:'导入技能',mcp:'添加服务器',assistants:'新建助手'})[state.view]}</button></header><div id="capNotice" class="manage-notice" hidden role="status"></div><div id="capContent"></div></div></main></div>`;
      host.body.querySelectorAll('[data-cap-view]').forEach(button=>button.onclick=()=>ctrl.select(button.dataset.capView).catch(error=>active()&&notice(error.message)));
      host.body.querySelectorAll('[data-cap-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.capFilter;host.body.querySelectorAll('[data-cap-filter]').forEach(b=>b.classList.toggle('active',b===button));filterRows();});
      const nativeAgent=['claude','codex','zcode','gemini','opencode'].includes(state.agent);
      const primary=host.body.querySelector('#capPrimary');primary.disabled=S.readOnly||state.view==='mcp'&&!!state.hostId&&!nativeAgent;
      if(state.view==='mcp'&&state.hostId&&!nativeAgent)primary.title='先选择支持原生配置的 Agent';
      if(state.view!=='assistants')host.body.querySelector('#capContent').before(targetControls());
      bindTargets();
      action('#capRefresh',load,'读取中…');
      action('#capPrimary',()=>state.view==='skills'?importEditor():state.view==='mcp'?(state.hostId||state.agent&&!['claude','codex','builtin','acp'].includes(state.agent)&&!state.agent.startsWith('acp:')?nativeCreateEditor():openMcpServerEditor(null,{agent:state.agent})):openAssistantEditor(null));
    }
    async function load() {
      const request=++state.request,view=state.view;
      draw();host.body.querySelector('#capContent').innerHTML='<div class="manage-loading" role="status">正在读取…</div>';
      if(view!=='assistants'){
        try{
          let data;
          if(S.readOnly){
            if(state.hostId)throw Error('只读模式不能扫描远程电脑的安装配置。');
            data=await api('/api/skills?'+new URLSearchParams({agent:state.agent,all:'1'}));
            data.servers=[];data.warnings=[{source:'只读模式',message:'可浏览共享清单；原生配置扫描、源码和编辑需要管理权限。'}];
          }else data=await api('/api/capabilities/inventory?'+new URLSearchParams({agent:state.agent,host:state.hostId,cwd}),{timeoutMs:75000});
          if(!active()||request!==state.request)return;
          state.skills=data.skills||[];state.native=data.servers||[];state.warnings=data.warnings||[];
        }catch(error){
          if(active()&&request===state.request){host.body.querySelector('#capContent').innerHTML=`<div class="manage-empty" role="alert">${icon('server')}<strong>无法读取所选环境</strong><p>${esc(error.message)}</p><button class="btn ghost" id="capTargetRetry">重试</button></div>`;action('#capTargetRetry',load);}
          return;
        }
      }
      if(view==='skills'){
        skills();
      }else{
        if(view==='mcp'){
          host.body.querySelector('#capContent').innerHTML=toolbar('搜索 MCP 名称、命令或 Agent')+`<div id="capMetrics"></div><div class="capability-mcp-toolbar"><button type="button" class="btn-mini" id="mcpImportJson" ${S.readOnly?'disabled':''}>${icon('file')}导入 JSON</button><button type="button" class="btn-mini" id="capNativeAdd" ${S.readOnly||!['claude','codex','zcode','gemini','opencode'].includes(state.agent)?'disabled':''}>${icon('plus')}安装到此 Agent</button><button type="button" class="btn-mini" id="mcpDetectServers" ${S.readOnly?'disabled':''}>${icon('search')}刷新原生清单</button><button type="button" class="btn-mini" id="capAgentTools">${icon('shield')}按 Agent 配置工具</button></div><div id="mcpServerList" class="mcp-server-list"><div class="manage-loading">读取服务器配置…</div></div><div id="mcpTestResult" class="mcp-detect-result"></div><div id="mcpDetectResult" class="mcp-detect-result"></div><div class="manage-footnote">${icon('info')}<span>只在点击检测时连接服务器。OrbitCell 配置用于之后启动的本机会话；原生安装写入所选电脑的 CLI 配置。</span></div>`;
          bindToolbar();action('#mcpImportJson',importMcpJson);action('#capNativeAdd',nativeCreateEditor);action('#mcpDetectServers',load);action('#capAgentTools',()=>window.AgentHubAgentCenter.open({agent:state.agent,hostId:state.hostId,tab:'tools'}));
          if(state.hostId){host.body.querySelector('#mcpImportJson').disabled=true;state.mcp=[];host.body.querySelector('#mcpServerList').innerHTML='';nativeMcp();}
          else await refreshMcpServers();
        }else{
          host.body.querySelector('#capContent').innerHTML=toolbar('搜索助手名称或说明')+'<div id="capMetrics"></div><div id="assistantList" class="assistant-list"><div class="manage-loading">读取助手…</div></div><div class="manage-footnote">'+icon('info')+'<span>助手负责角色与系统提示词。默认值用于新会话，已有会话的显式选择保留。</span></div>';
          bindToolbar();await refreshAssistants();
        }
      }
    }
    function targetControls() {
      const agents=(S.agents||[]).filter(a=>a.id!=='chatgpt-web');
      if(state.agent&&!agents.some(a=>a.id===state.agent))agents.push({id:state.agent,name:agentMeta(state.agent).name});
      const targets=[{id:'',name:'本机'},...(S.wsl?.available?[{id:'wsl',name:'WSL'}]:[]),...(S.hosts||[]).map(h=>({id:h.id,name:h.name||h.host}))];
      if(state.hostId&&!targets.some(h=>h.id===state.hostId))targets.push({id:state.hostId,name:'当前远程环境'});
      const bar=document.createElement('div');bar.className='capability-target';
      bar.innerHTML=`<span class="capability-target-mark">${window.AgentHubIcons.agent(state.agent||'builtin')}</span><div class="fld"><label for="capAgent">Agent</label><select id="capAgent"><option value="">所有 Agent</option>${agents.map(a=>`<option value="${esc(a.id)}" ${state.agent===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><div class="fld"><label for="capHost">电脑</label><select id="capHost">${targets.map(h=>`<option value="${esc(h.id)}" ${state.hostId===h.id?'selected':''}>${esc(h.name)}</option>`).join('')}</select></div><span class="capability-target-note">${state.hostId?'读取目标电脑的实际安装，连接失败会显示错误。':'原生、共享与插件安装的能力分来源展示。'}</span>`;
      return bar;
    }
    function bindTargets() {
      const a=host.body.querySelector('#capAgent'),h=host.body.querySelector('#capHost');
      if(a)a.onchange=()=>{state.agent=a.value;state.query='';load().catch(e=>notice(e.message));};
      if(h)h.onchange=()=>{state.hostId=h.value;cwd=state.hostId===(session?.remoteHostId||'')?session?.cwd||'':'';load().catch(e=>notice(e.message));};
      if(a)enhanceDialogSelects(a.parentElement);if(h)enhanceDialogSelects(h.parentElement);
    }
    function nativeMcp() {
      if(!active()||state.view!=='mcp')return;
      let panel=host.body.querySelector('#capNativeMcp');
      if(!panel){panel=document.createElement('section');panel.id='capNativeMcp';panel.className='native-capabilities';host.body.querySelector('#mcpServerList').after(panel);}
      const q=state.query.trim().toLowerCase();
      const rows=state.native.filter(item=>(!q||[item.name,item.agent,item.source,item.address].join(' ').toLowerCase().includes(q))&&(state.filter==='all'||state.filter==='attention'||(state.filter==='enabled')===item.enabled));
      panel.innerHTML=`<div class="native-capabilities-heading"><h3>${icon('folder')}原生已安装</h3><span>${rows.length} 个服务器</span></div><p class="dialog-note">来自所选电脑的 CLI、项目和插件配置。可编辑连接；来源文件自动备份，认证信息保留。连接可用性由对应 CLI 检测。</p>${rows.map(item=>`<article class="capability-row"><i class="capability-native-agent">${window.AgentHubIcons.agent(item.agent)}</i><div class="capability-copy"><strong>${esc(item.name)}</strong><p>${esc(item.address)}</p><div class="capability-meta"><span>${esc(agentMeta(item.agent).name)}</span><span>${item.scope==='project'?'项目':'全局'}</span><span>${item.enabled?'配置已发现':'原生已停用'}</span></div><small class="capability-source" title="${esc(item.source)}">${esc(item.source)}</small></div><button class="btn-mini" data-native-source="${esc(item.id)}" ${S.readOnly?'disabled':''}>${icon('edit')}编辑连接</button></article>`).join('')||`<div class="compact-empty">${icon('network')}<strong>未发现原生 MCP 配置</strong><p>可刷新扫描，或在该 Agent 的来源配置中安装。</p></div>`}${state.warnings.map(w=>`<p class="manage-notice warn">${esc(w.source)} · ${esc(w.message)}</p>`).join('')}`;
      panel.querySelectorAll('[data-native-source]').forEach(b=>b.onclick=()=>{
        const item=state.native.find(x=>x.id===b.dataset.nativeSource);
        nativeEditor(item);
      });
      const metricsBox=host.body.querySelector('#capMetrics');
      if(metricsBox){const managed=state.mcp.filter(s=>!state.agent||(s.agents||[]).includes(state.agent.startsWith('acp:')?'acp':state.agent));metricsBox.innerHTML=metrics(managed.length+state.native.length,managed.filter(s=>s.enabled!==false).length+state.native.filter(s=>s.enabled).length,state.native.length,'原生已安装');}
    }
    async function nativeEditor(item) {
      const context={agent:item.agent,host:state.hostId,cwd,id:item.id};
      openDlg('编辑原生 MCP',`<div class="management-editor-intro"><i class="managed-model-mark">${window.AgentHubIcons.agent(item.agent)}</i><div><strong>${esc(item.name)}</strong><p>${esc(state.hostId?'目标电脑':'本机')} · ${esc(agentMeta(item.agent).name)}</p></div></div><div id="nativeMcpEditor" role="status">读取配置状态…</div>`);
      const guard=dialogGuard();let data;
      try{data=await api('/api/capabilities/mcp?'+new URLSearchParams(context),{timeoutMs:75000});}
      catch(e){if(guard())document.getElementById('nativeMcpEditor').innerHTML=`<p class="feature-error" role="alert">${esc(e.message)}</p>`;return;}
      if(!guard())return;
      document.getElementById('nativeMcpEditor').innerHTML=`<form id="nativeMcpForm" class="management-editor"><p class="dialog-note">填写要替换的字段，留空则保留。现有认证、环境变量与其他服务器保留；保存前会在来源旁备份。已运行的会话需重新连接 MCP。</p><code class="native-config-path">${esc(item.source)}</code><div class="management-editor-grid management-form-section">${item.transport==='http'?'<div class="fld full"><label for="nativeMcpUrl">新的服务器地址</label><input id="nativeMcpUrl" placeholder="留空保留现有地址"></div>':'<div class="fld full"><label for="nativeMcpCommand">新的启动命令</label><input id="nativeMcpCommand" placeholder="留空保留现有命令"></div><div class="fld full"><label class="setting-check"><input id="nativeReplaceArgs" type="checkbox">替换命令参数</label><textarea id="nativeMcpArgs" rows="3" disabled placeholder="每行一个参数；勾选后留空表示清空参数"></textarea></div>'}${item.canToggle?`<div class="fld full"><label class="setting-check"><input id="nativeMcpEnabled" type="checkbox" ${data.enabled?'checked':''}>在此 Agent 的原生配置中启用</label></div>`:''}</div><div id="nativeMcpError" class="manage-notice" hidden role="alert"></div><div class="dialog-actions"><button type="button" class="btn ghost" id="nativeCopySource">${icon('copy')}复制路径</button><button type="button" class="btn ghost" id="nativeMcpCancel">取消</button><button type="submit" class="btn" id="nativeMcpSave">保存配置</button></div></form>`;
      document.getElementById('nativeMcpCancel').onclick=closeDlg;
      document.getElementById('nativeCopySource').onclick=async()=>{try{await navigator.clipboard.writeText(item.source);toast('配置路径已复制','ok');}catch(e){toast(e.message,'err');}};
      const replace=document.getElementById('nativeReplaceArgs');if(replace)replace.onchange=()=>{document.getElementById('nativeMcpArgs').disabled=!replace.checked;};
      document.getElementById('nativeMcpForm').onsubmit=e=>{e.preventDefault();withPendingButton(document.getElementById('nativeMcpSave'),async()=>{
        const payload={...context,revision:data.revision};
        const command=document.getElementById('nativeMcpCommand'),url=document.getElementById('nativeMcpUrl'),enabled=document.getElementById('nativeMcpEnabled');
        if(command?.value.trim())payload.command=command.value.trim();if(url?.value.trim())payload.url=url.value.trim();
        if(replace?.checked){payload.replaceArgs=true;payload.args=document.getElementById('nativeMcpArgs').value.split(/\r?\n/).filter(line=>line.trim());}
        if(enabled&&enabled.checked!==data.enabled)payload.enabled=enabled.checked;
        try{await api('/api/capabilities/mcp',{method:'POST',timeoutMs:75000,body:payload});if(guard())closeDlg();if(active())await load();toast('原生 MCP 配置已保存并备份','ok');}
        catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('nativeMcpError'),error.message);}
      },'保存中…');};
    }
    function nativeCreateEditor() {
      if(S.readOnly)return;
      const context={agent:state.agent,host:state.hostId,cwd};
      if(!['claude','codex','zcode','gemini','opencode'].includes(context.agent))return toast('请选择一个支持原生配置的 Agent；自定义 ACP 使用 OrbitCell 管理的服务器。','err');
      openDlg('安装原生 MCP',`<form id="nativeCreateForm" class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${window.AgentHubIcons.agent(context.agent)}</i><div><strong>${esc(agentMeta(context.agent).name)}</strong><p>${esc(context.host?hostName({remoteHostId:context.host}):'本机')} · 写入所选 Agent 的原生配置</p></div></div><div class="management-editor-grid"><div class="fld"><label for="nativeCreateName">服务器名称</label><input id="nativeCreateName" required pattern="[A-Za-z0-9_-]{1,48}" placeholder="filesystem"></div><div class="fld"><label for="nativeCreateScope">安装范围</label><select id="nativeCreateScope">${cwd?'<option value="project">当前项目</option>':''}<option value="global">此电脑全局</option></select></div><div class="fld full"><label for="nativeCreateTransport">连接方式</label><select id="nativeCreateTransport"><option value="stdio">stdio · 命令</option><option value="http">HTTP · 服务器地址</option></select></div><div id="nativeCreateStdio" class="full"><div class="fld"><label for="nativeCreateCommand">启动命令</label><input id="nativeCreateCommand" placeholder="npx"></div><div class="fld"><label for="nativeCreateArgs">参数 · 每行一个</label><textarea id="nativeCreateArgs" rows="3"></textarea></div></div><div class="fld full" id="nativeCreateHttp" hidden><label for="nativeCreateUrl">服务器地址</label><input id="nativeCreateUrl" placeholder="https://example.com/mcp"></div></div><p class="dialog-note">已有配置先备份，再添加此服务器；同名条目会拒绝覆盖。高级认证参数可在来源配置中设置。</p><div id="nativeCreateError" class="manage-notice" hidden role="alert"></div><div class="dialog-actions"><button type="button" class="btn ghost" id="nativeCreateCancel">取消</button><button type="submit" class="btn" id="nativeCreateSave">安装到此 Agent</button></div></form>`);
      const guard=dialogGuard();enhanceDialogSelects(document.getElementById('nativeCreateForm'));
      document.getElementById('nativeCreateCancel').onclick=closeDlg;
      document.getElementById('nativeCreateTransport').onchange=e=>{const http=e.target.value==='http';document.getElementById('nativeCreateStdio').hidden=http;document.getElementById('nativeCreateHttp').hidden=!http;};
      document.getElementById('nativeCreateForm').onsubmit=e=>{e.preventDefault();withPendingButton(document.getElementById('nativeCreateSave'),async()=>{
        const body={...context,create:true,name:document.getElementById('nativeCreateName').value.trim(),scope:document.getElementById('nativeCreateScope').value,transport:document.getElementById('nativeCreateTransport').value,command:document.getElementById('nativeCreateCommand').value.trim(),args:document.getElementById('nativeCreateArgs').value.split(/\r?\n/).filter(line=>line.trim()),url:document.getElementById('nativeCreateUrl').value.trim()};
        try{await api('/api/capabilities/mcp',{method:'POST',timeoutMs:75000,body});if(guard())closeDlg();if(active())await load();toast('已写入所选 Agent 的原生配置','ok');}
        catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('nativeCreateError'),error.message);}
      },'安装中…');};
    }
    function toolbar(placeholder,extra='') {
      return `<div class="manage-toolbar"><label class="manage-search">${icon('search')}<input id="capSearch" type="search" aria-label="搜索${state.view==='skills'?'技能':state.view==='mcp'?'MCP 服务器':'助手'}" placeholder="${placeholder}" value="${esc(state.query)}"></label><select id="capStatusFilter" aria-label="能力状态">${[['all','全部状态'],['enabled','已启用'],['disabled','已停用'],...(state.view==='mcp'?[['attention','未检测或异常']]:[])].map(([id,label])=>`<option value="${id}" ${state.filter===id?'selected':''}>${label}</option>`).join('')}</select>${extra}</div>`;
    }
    function bindToolbar() {
      host.body.querySelector('#capSearch').oninput=event=>{state.query=event.target.value;state.limit=80;filterRows();};
      host.body.querySelector('#capStatusFilter').onchange=event=>{state.filter=event.target.value;filterRows();};
      enhanceDialogSelects(host.body.querySelector('.manage-toolbar'));
    }
    function metrics(total,enabled,third,label) {
      return `<div class="manage-metrics"><div><strong>${total}</strong><span>已发现${state.view==='skills'?'技能':state.view==='mcp'?'服务器':'助手'}</span></div><div><strong>${enabled}</strong><span>已启用</span></div><div><strong>${third}</strong><span>${label}</span></div></div>`;
    }
    function skills() {
      host.body.querySelector('#capContent').innerHTML=`<div id="capMetrics"></div>${toolbar('搜索技能名称、说明或来源',`<select id="capSkillScope" aria-label="技能范围"><option value="">全部范围</option><option value="global" ${state.scope==='global'?'selected':''}>全局技能</option><option value="project" ${state.scope==='project'?'selected':''}>当前项目</option></select>`)}<div id="capSkillList"></div><div id="capSkillCount" class="manage-result"></div><div class="manage-footnote">${icon('info')}<span>停用会阻止 OrbitCell 投递此技能；CLI 自身发现的技能仍遵循对应 CLI 的规则。项目技能优先于同名全局技能。</span></div>`;
      bindToolbar();host.body.querySelector('#capSkillScope').onchange=event=>{state.scope=event.target.value;filterRows();};skillRows();
    }
    function skillRows() {
      const query=state.query.trim().toLowerCase();
      const list=state.skills.filter(skill=>(!state.scope||skill.scope===state.scope)&&(!query||[skill.name,skill.description,skill.source].join(' ').toLowerCase().includes(query))&&(state.filter==='all'||(state.filter==='enabled')===skill.enabled));
      host.body.querySelector('#capMetrics').innerHTML=metrics(state.skills.length,state.skills.filter(s=>s.enabled).length,state.skills.filter(s=>s.scope==='project').length,'当前项目技能');
      const pendingKey=name=>JSON.stringify([state.hostId,state.agent,name]);
      host.body.querySelector('#capSkillList').innerHTML=list.slice(0,state.limit).map(skill=>`<article class="capability-row"><i class="managed-model-mark">${icon(skill.scope==='project'?'folder':'book')}</i><div class="capability-copy"><strong>${esc(skill.name)}</strong><p>${esc(skill.description||'此技能没有填写说明')}</p><div class="capability-meta"><span>${skill.scope==='project'?'项目':'全局'}</span><span class="capability-agent">${window.AgentHubIcons.agent(skill.source==='agents'?'builtin':skill.source)}${esc(skill.source==='agents'?'共享':agentMeta(skill.source).name)}</span><span>${skill.origin==='plugin'?'插件安装':'原生目录'}</span></div></div><div class="capability-actions"><button type="button" class="btn-mini" data-cap-skill-view="${esc(skill.id||skill.name)}" ${S.readOnly?'disabled':''}>查看</button><input type="checkbox" role="switch" class="manage-switch" data-cap-skill-toggle="${esc(skill.name)}" title="${state.hostId?'远程技能由目标 CLI 自身发现；可查看或导入技能':'控制 OrbitCell 对所选 Agent 的技能投递'}" aria-label="启用技能 ${esc(skill.name)}" ${skillTogglesPending.has(pendingKey(skill.name))?skillTogglesPending.get(pendingKey(skill.name))?'checked':'':skill.enabled?'checked':''} ${S.readOnly||state.hostId||skillTogglesPending.has(pendingKey(skill.name))?'disabled':''}></div></article>`).join('')||`<div class="manage-empty">${icon('book')}<strong>没有匹配的技能</strong><p>调整筛选条件，或导入一个技能目录。</p></div>`;
      host.body.querySelector('#capSkillCount').innerHTML=`显示 ${Math.min(state.limit,list.length)} / ${list.length} 个技能${list.length>state.limit?'<button type="button" class="btn-mini" id="capSkillMore">显示更多</button>':''}`;
      action('#capSkillMore',()=>{state.limit+=80;skillRows();});
      host.body.querySelectorAll('[data-cap-skill-view]').forEach(button=>button.onclick=()=>skillDetail(state.skills.find(s=>(s.id||s.name)===button.dataset.capSkillView)));
      host.body.querySelectorAll('[data-cap-skill-toggle]').forEach(input=>input.onchange=async()=>{
        const name=input.dataset.capSkillToggle,enabled=input.checked,agent=state.agent,key=pendingKey(name);if(S.readOnly||skillTogglesPending.has(key))return;
        skillTogglesPending.set(key,enabled);input.disabled=true;let applied=!enabled;
        try{const saved=await api('/api/skills/toggle',{method:'POST',body:{name,enabled,agent}});applied=saved.enabled;toast(applied?'技能已启用':enabled?'此技能仍受全局停用规则限制':'技能已停用',applied||!enabled?'ok':'');}
        catch(error){toast(error.message,'err');}
        finally{skillTogglesPending.delete(key);const next=controller;if(next?.host.active()&&next.state.view==='skills'){if(!next.state.hostId&&next.state.agent===agent){next.state.skills.filter(s=>s.name===name).forEach(skill=>skill.enabled=applied);next.skillRows();}}}
      });
    }
    function filterRows() {
      if(!active())return;
      const status=host.body.querySelector('#capStatusFilter');if(status){status.value=state.filter;status.syncControl?.();}
      host.body.querySelectorAll('[data-cap-filter]').forEach(button=>button.classList.toggle('active',button.dataset.capFilter===state.filter));
      if(state.view==='skills')return skillRows();
      const query=state.query.trim().toLowerCase(),list=state.view==='mcp'?state.mcp:state.assistants;
      const field=state.view==='mcp'?'data-mcp-row':'data-assistant';
      const matches=new Set(list.filter(item=>(state.view!=='mcp'||!state.agent||(item.agents||[]).includes(state.agent.startsWith('acp:')?'acp':state.agent))&&(!query||[item.name,item.description,item.command,item.url,(item.agents||[]).join(' ')].join(' ').toLowerCase().includes(query))&&(state.filter==='all'||state.filter==='attention'?state.filter!=='attention'||!item.lastTest?.ok:(state.filter==='enabled')===(item.enabled!==false))).map(item=>item.id));
      host.body.querySelectorAll('['+field+']').forEach(row=>row.hidden=!matches.has(row.getAttribute(field)));
      host.body.querySelectorAll('.assistant-group-title').forEach(title=>title.hidden=!!query||state.filter!=='all');
      let empty=host.body.querySelector('#capFilteredEmpty');if(!empty){empty=document.createElement('div');empty.id='capFilteredEmpty';empty.className='manage-empty';host.body.querySelector(state.view==='mcp'?'#mcpServerList':'#assistantList').append(empty);}
      empty.hidden=matches.size>0||!list.length;empty.textContent='当前筛选下没有匹配项';
      if(state.view==='mcp')nativeMcp();
    }
    function mcpRefreshed(data,list) {
      if(!active()||state.view!=='mcp'||!host.body.contains(list))return;
      state.mcp=data.servers||[];
      host.body.querySelector('#capMetrics').innerHTML=metrics(state.mcp.length,state.mcp.filter(s=>s.enabled!==false).length,state.mcp.reduce((n,s)=>n+(s.lastTest?.ok?Number(s.lastTest.count)||0:0),0),'上次成功检测的工具');
      list.querySelectorAll('[data-mcp-toggle]').forEach(input=>input.classList.add('manage-switch'));
      list.querySelector('.mcp-empty-icon')?.replaceChildren();
      filterRows();
    }
    function assistantsRefreshed(data,list) {
      if(!active()||state.view!=='assistants'||!host.body.contains(list))return;
      state.assistants=[...(data.builtin||[]),...(data.custom||[])];
      host.body.querySelector('#capMetrics').innerHTML=metrics(state.assistants.length,state.assistants.filter(a=>a.enabled!==false).length,(data.custom||[]).length,'自定义助手');
      list.querySelectorAll('[data-assistant-toggle]').forEach(input=>input.classList.add('manage-switch'));
      list.querySelectorAll('.assistant-glyph').forEach(mark=>{const name=mark.closest('[data-assistant]').dataset.assistant,assistant=state.assistants.find(a=>a.id===name);if((data.builtin||[]).some(a=>a.id===name)||!assistant?.glyph||assistant.glyph==='✦')mark.innerHTML=icon('spark');mark.classList.add('managed-model-mark');});
      filterRows();
    }
    async function skillDetail(skill) {
      openDlg('技能详情',`<div class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${icon('book')}</i><div><strong>${esc(skill.name)}</strong><p>${esc(skill.description||'技能说明')}</p></div></div><div id="skillDetailContent" role="status">读取 SKILL.md…</div></div>`);
      const guard=dialogGuard();let data;
      try{data=await api('/api/capabilities/skill-content?'+new URLSearchParams({id:skill.id||'',cwd,agent:state.agent||(skill.source==='agents'?'builtin':skill.source),host:state.hostId}),{timeoutMs:75000});}catch(error){if(guard())document.getElementById('skillDetailContent').innerHTML=`<div class="manage-notice error" role="alert">技能源码读取失败：${esc(error.message)}</div><p class="dialog-note">请刷新技能列表；刚更新程序时，需要重启后端再试。</p>`;return;}
      if(!guard())return;
      const content=data.content||'',body=content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/,'');
      document.getElementById('skillDetailContent').innerHTML=`<div class="capability-meta"><span>${data.scope==='project'?'项目技能':'全局技能'}</span><span>${esc(data.source)}</span><span>${data.enabled?'已启用':'已停用'}</span></div><div class="skill-detail-tabs" role="tablist" aria-label="技能内容"><button type="button" class="active" role="tab" aria-selected="true" data-skill-tab="preview">说明</button><button type="button" role="tab" aria-selected="false" data-skill-tab="source">源码</button></div><div id="skillPreview" class="skill-detail-content md-body">${md(body)}</div><pre id="skillSource" class="skill-source-code" hidden><code class="language-markdown">${esc(content)}</code></pre><p class="dialog-note">来源：<code>${esc(data.path)}</code></p>`;
      highlightIn(document.getElementById('skillDetailContent'));
      renderMermaids(document.getElementById('skillPreview'));
      const tabs=Array.from(document.querySelectorAll('[data-skill-tab]'));
      function selectTab(button,focus=false){const preview=button.dataset.skillTab==='preview';document.getElementById('skillPreview').hidden=!preview;document.getElementById('skillSource').hidden=preview;tabs.forEach(tab=>{const selected=tab===button;tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});if(focus)button.focus();}
      tabs.forEach((button,index)=>{button.onclick=()=>selectTab(button);button.onkeydown=event=>{const step=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(!step&&!['Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+step+tabs.length)%tabs.length;selectTab(tabs[next],true);};});
      selectTab(tabs[0]);
    }
    function importEditor() {
      if(S.readOnly)return;
      const target={agent:state.agent||'builtin',host:state.hostId,cwd};
      openDlg('导入技能',`<form id="capSkillImportForm" class="management-editor"><div class="management-editor-intro"><i class="managed-model-mark">${icon('folder')}</i><div><strong>添加可复用的技能</strong><p>选择所选电脑上包含 SKILL.md 的目录，或从本机导入技能 ZIP。</p></div></div><div class="management-editor-grid"><div class="fld full"><label for="skillImportPath">技能来源目录</label><input id="skillImportPath" placeholder="技能来源目录的绝对路径" required></div><div class="fld full"><label for="skillImportScope">导入范围</label><select id="skillImportScope">${cwd?'<option value="project">当前项目</option>':''}<option value="global">全局</option></select></div></div><div id="capSkillImportError" class="manage-notice" hidden></div><div class="dialog-actions"><label class="btn-mini">${icon('file')}导入 ZIP<input id="skillImportZip" type="file" accept=".zip" hidden></label><button type="button" class="btn ghost" id="capSkillImportCancel">取消</button><button type="submit" class="btn" id="skillImportBtn">导入目录</button></div></form>`);
      const guard=dialogGuard();enhanceDialogSelects(document.getElementById('capSkillImportForm'));document.getElementById('capSkillImportCancel').onclick=closeDlg;
      document.getElementById('capSkillImportForm').onsubmit=event=>{event.preventDefault();const body={...target,source:document.getElementById('skillImportPath').value.trim(),scope:document.getElementById('skillImportScope').value};withPendingButton(document.getElementById('skillImportBtn'),async()=>{try{await api('/api/skills/import',{method:'POST',timeoutMs:75000,body});if(guard())closeDlg();if(active()){state.query='';state.scope='';state.filter='all';await load();}toast('技能已导入','ok');}catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('capSkillImportError'),error.message);}},'导入中…');};
      document.getElementById('skillImportZip').onchange=async event=>{const file=event.target.files?.[0],scope=document.getElementById('skillImportScope').value;event.target.value='';if(!file)return;const ok=await importSkillZip(file,{...target,scope,hostId:target.host,refresh:load});if(ok&&guard())closeDlg();};
    }
    Object.assign(ctrl,{mcpRefreshed,assistantsRefreshed,skillRows});
    try{await load();}catch(error){if(active()){host.body.innerHTML=`<div class="manage-empty"><strong>能力中心读取失败</strong><p>${esc(error.message)}</p><button type="button" class="btn ghost" id="capRetry">重试</button><button type="button" class="btn-mini" data-manage-close>返回工作台</button></div>`;host.body.querySelector('#capRetry').onclick=()=>{controller=null;open(state.view,{agent:state.agent,hostId:state.hostId,cwd});};}}
  }
  window.AgentHubCapabilities=Object.freeze({open,mcpRefreshed:(data,list)=>controller?.mcpRefreshed?.(data,list),assistantsRefreshed:(data,list)=>controller?.assistantsRefreshed?.(data,list)});
  const entry=document.getElementById('btnCapabilities');
  if(entry){entry.addEventListener('click',()=>open());entry.disabled=false;entry.removeAttribute('aria-busy');}
})();
