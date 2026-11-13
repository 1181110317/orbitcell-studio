/* Shared management workspace chrome. Controllers keep their own data and
   use the returned guard to discard replies after navigation. */
(() => {
  'use strict';
  const icon=name=>window.AgentHubIcons.svg(name);
  const root=document.createElement('section');
  root.id='managementPage';root.className='management-page';root.hidden=true;
  root.setAttribute('role','region');document.body.append(root);
  let serial=0,current=null,pendingSessionRefresh=false,pendingMessageRender=false;
  const modules=[['projects','项目','folder'],['agents','Agent','agents'],['models','模型','cube'],['capabilities','能力','capabilities'],['settings','设置','sliders']];
  function navigation(selected) {
    return `<nav class="manage-global-nav" aria-label="管理中心导航">${modules.map(([id,label,glyph])=>`<button type="button" data-manage-go="${id}" class="${selected===id?'active':''}" title="${label}管理" aria-label="${label}管理">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>`;
  }
  function close() {
    if(!current)return;
    ++serial;current=null;root.hidden=true;root.replaceChildren();document.body.classList.remove('management-open');
    document.getElementById('btnModelCenter')?.classList.remove('active');
    document.getElementById('btnCapabilities')?.classList.remove('active');
    document.getElementById('btnProjectCenter')?.classList.remove('active');
  }
  function resumeSession(restoreRemembered=true) {
    if(document.body.classList.contains('management-open')||document.body.classList.contains('agent-center-open')||!document.getElementById('overlay').classList.contains('hidden'))return;
    if(pendingMessageRender){pendingMessageRender=false;renderMessages();}
    if(document.getElementById('inpText')?.value.trim())return;
    if(S.curSessionId&&!pendingSessionRefresh){if(S.review.open&&S.review.mode==='browser')activateReviewTab(S.review.activeTabId);return;}
    const remembered=S.curSessionId||(restoreRemembered?storageGet('ah.session'):'');
    if(remembered&&S.sessions.some(session=>session.id===remembered)){pendingSessionRefresh=false;openSession(remembered).catch(error=>{pendingSessionRefresh=true;toast(error.message,'err');});}
  }
  function suspendSession(){if(pendingSessionLoad||document.getElementById('app').getAttribute('aria-busy')==='true')pendingSessionRefresh=true;}
  function back(){
    const agentOpen=document.body.classList.contains('agent-center-open');
    if(!current&&!agentOpen)return false;
    window.AgentHubAgentCenter?.close();close();resumeSession();return true;
  }
  function dismissDialogs(){while(!document.getElementById('overlay').classList.contains('hidden'))closeDlg();document.getElementById('dlgBody').replaceChildren();}
  function open(kind,label) {
    suspendSession();
    window.AgentHubFeatures?.suspendBrowser?.();
    if(innerWidth<=900)toggleSidebar(false);
    dismissDialogs();
    window.AgentHubAgentCenter?.close();close();++openSessionSeq;
    const generation=++serial;current={kind,generation};
    root.innerHTML='<div class="manage-shell"><div id="managementBody" class="manage-host"><div class="manage-loading" role="status">正在读取…</div></div></div>';
    root.setAttribute('aria-label',label);root.dataset.module=kind;setMenu(false);root.hidden=false;
    document.body.classList.add('management-open');
    document.getElementById(kind==='models'?'btnModelCenter':kind==='projects'?'btnProjectCenter':'btnCapabilities')?.classList.add('active');
    return {root,body:root.querySelector('#managementBody'),active:()=>current?.generation===generation&&!root.hidden};
  }
  function context(label,refreshId,refreshLabel='刷新') {
    return `<header class="manage-context"><button type="button" class="manage-menu-toggle" data-manage-menu aria-expanded="false" aria-label="打开管理目录">${icon('sidebar')}</button><span>${esc(label)}</span><div><button type="button" class="btn-mini manage-refresh" id="${refreshId}" title="${refreshLabel}" aria-label="${refreshLabel}">${icon('refresh')}<span>${refreshLabel}</span></button><button type="button" class="btn-mini manage-close" data-manage-close aria-label="返回工作台">${icon('close')}</button></div></header>`;
  }
  function sidebarEnd(kind) {
    return `<footer class="manage-sidebar-footer">${navigation(kind)}<button type="button" class="manage-return" data-manage-close>${icon('chevronLeft')}返回工作台</button></footer>`;
  }
  function notice(node,message,tone='error') {
    if(!node?.isConnected)return;node.textContent=message||'';node.hidden=!message;
    node.className='manage-notice '+tone;node.setAttribute('role',tone==='error'?'alert':'status');
  }
  function setMenu(opened) {
    root.classList.toggle('manage-menu-open',opened);
    const toggle=root.querySelector('[data-manage-menu]');if(toggle){toggle.setAttribute('aria-expanded',String(opened));toggle.setAttribute('aria-label',opened?'收起管理目录':'打开管理目录');}
  }
  document.addEventListener('click',event=>{const choice=event.target.closest('[data-mc-tab],[data-mc-source],[data-cap-view],[data-cap-filter]');if(choice&&root.contains(choice))setMenu(false);},true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-manage-go],[data-manage-close],[data-manage-menu]');
    if(!button||!button.closest('#managementPage,#agentCenterPage,.settings-dialog'))return;
    if(button.hasAttribute('data-manage-close')){back();return;}
    if(button.hasAttribute('data-manage-menu')){setMenu(!root.classList.contains('manage-menu-open'));return;}
    if(button.closest('.manage-global-nav')&&button.classList.contains('active'))return;
    const kind=button.dataset.manageGo;
    if(kind==='agents'){close();window.AgentHubAgentCenter?.open();}
    else if(kind==='projects')window.AgentHubProjectCenter?.open();
    else if(kind==='models')window.AgentHubFeatures?.modelCenter();
    else if(kind==='capabilities')window.AgentHubCapabilities?.open();
    else {close();showSettings();}
  });
  function enhanceSettings(container,preferred) {
    const workbench=container?.querySelector('.settings-workbench');
    if(!workbench||container.dataset.structured)return;
    container.dataset.structured='true';
    const nav=workbench.querySelector('.settings-quicknav'),content=workbench.querySelector('.settings-content'),mobile=workbench.querySelector('.settings-mobile-nav'),footer=container.querySelector('.settings-footer');
    const side=document.createElement('aside');side.className='settings-sidebar';
    const heading=document.createElement('div');heading.className='settings-sidebar-heading';heading.innerHTML='<strong>工作台设置</strong><small>偏好、外观与应用配置</small>';
    side.append(heading,nav);if(mobile)side.append(mobile);
    const links=document.createElement('div');links.innerHTML=navigation('settings');side.append(links);
    const basic=['settings-preferences','settings-appearance','settings-conversation','settings-workspace','settings-assistants','settings-mcp-servers','settings-shortcuts','settings-access','settings-maintenance'];
    for(const id of basic){const button=nav.querySelector('[data-settings-jump="'+id+'"]');if(button)nav.append(button);}
    nav.querySelectorAll('[data-settings-jump] span').forEach(element=>element.remove());
    const advanced=document.createElement('details');advanced.className='settings-compatibility';advanced.innerHTML='<summary>执行器兼容设置</summary>';
    for(const id of ['settings-cli','settings-remote','settings-custom']){const button=nav.querySelector('[data-settings-jump="'+id+'"]');if(button)advanced.append(button);}
    nav.append(advanced);
    const toolBlock=container.querySelector('#mcpToolGrid')?.closest('.mcp-tool-block');
    if(toolBlock){const details=document.createElement('details');details.className='settings-tool-details';details.innerHTML='<summary>细分工具权限 <small>按工具设置全局上限</small></summary>';toolBlock.before(details);details.append(...toolBlock.childNodes);toolBlock.remove();}
    for(const [id,view,label,description] of [['settings-assistants','assistants','助手','浏览角色与提示词，创建可复用的助手。'],['settings-mcp-servers','mcp','MCP','管理服务器、检测连接并选择可使用的 Agent。']]){
      const panel=container.querySelector('#'+id+'-panel');if(!panel)continue;
      const heading=panel.querySelector('.settings-section-title');panel.replaceChildren();if(heading)panel.append(heading);
      const card=document.createElement('div');card.className='settings-center-card';
      card.innerHTML=`<i class="managed-model-mark">${icon(view==='mcp'?'server':'spark')}</i><strong>${label} 已集中到能力中心</strong><p>${description}</p><button type="button" class="btn">打开${label}管理 ${icon('arrowRight')}</button>`;
      card.querySelector('button').onclick=()=>window.AgentHubCapabilities?.open(view);panel.append(card);
    }
    nav.querySelectorAll('[data-settings-jump]').forEach(button=>button.onkeydown=event=>{
      const offset=['ArrowDown','ArrowRight'].includes(event.key)?1:['ArrowUp','ArrowLeft'].includes(event.key)?-1:0;
      if(!offset&&!['Home','End'].includes(event.key))return;event.preventDefault();
      const visible=[...nav.querySelectorAll('[data-settings-jump]')].filter(element=>element.getClientRects().length>0),index=visible.indexOf(button);
      const next=visible[event.key==='Home'?0:event.key==='End'?visible.length-1:(index+offset+visible.length)%visible.length];
      next?.click();next?.focus();
    });
    if(preferred&&['settings-cli','settings-remote','settings-custom'].includes(preferred))advanced.open=true;
    container.replaceChildren(side,content);if(footer){footer.classList.add('settings-save-footer');content.append(footer);}
  }
  window.AgentHubManagement=Object.freeze({open,close,back,resumeSession,suspendSession,dismissDialogs,deferSessionRefresh:()=>{pendingSessionRefresh=true;},deferMessageRender:()=>{pendingMessageRender=true;},sessionRefreshed:()=>{pendingSessionRefresh=false;},navigation,context,sidebarEnd,notice,setMenu,enhanceSettings,isOpen:kind=>!!current&&(!kind||current.kind===kind)});
})();
