/* Real settings controls, protected content and bilingual documentation captures. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const WebSocket=require('ws');
module.exports=async({api,browser,ev,waitFor,uiTask,workspaceDir,base})=>{
  const draw=code=>uiTask(code+';return true;');
  const choose=async(selector,value)=>{await ev(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);};
  const provider=await api('/api/providers','POST',{name:'保存',baseUrl:'http://127.0.0.1:1/v1',apiKey:'locale-fixture-key',models:['文件'],enabledModels:['文件'],model:'文件'});
  const settingsBefore=await api('/api/settings');
  const originalProvider=(await api('/api/providers?agent=all')).find(p=>p.id===provider.id);
  let quotaServer,socket;
  try{
    await draw(`closeDlg();window.AgentHubAgentCenter.close();window.AgentHubManagement.close();AgentHubLocale.set('zh-CN');await showSettings();document.getElementById('inpText').value='保存 新会话 KEEP_DRAFT';document.getElementById('setFontApp').value='KEEP_FONT_DRAFT';const trace=document.createElement('div');trace.id='localeContentProbe';trace.innerHTML='<span>保存 新会话</span><pre><code>const 保存 = 1;</code></pre>';document.getElementById('messages').append(trace);`);
    await choose('#setLocale','en');
    await waitFor(()=>ev(`document.documentElement.lang==='en'&&document.getElementById('btnNewTask').textContent.includes('New task')`));
    assert.equal(await ev(`document.querySelector('label[for=setLocale]').textContent`),'Interface language');
    assert.equal(await ev(`document.querySelector('#sessionList [data-i18n-text]')?.textContent`),'Default workspace');
    assert.equal(await ev(`document.getElementById('inpText').value`),'保存 新会话 KEEP_DRAFT');
    assert.equal(await ev(`document.getElementById('setFontApp').value`),'KEEP_FONT_DRAFT');
    assert.equal(await ev(`document.getElementById('localeContentProbe').textContent`),'保存 新会话const 保存 = 1;');
    await ev(`(()=>{const input=document.querySelector('[data-settings-search]');input.value='language';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await waitFor(()=>ev(`!!document.querySelector('.settings-search-hit')`));
    assert((await ev(`document.querySelector('.settings-search-results').textContent`)).includes('Interface language'));
    await draw(`document.querySelector('.settings-search-hit').click();`);
    await choose('#setLocale','zh-CN');
    await waitFor(()=>ev(`document.querySelector('label[for=setLocale]').textContent==='界面语言'`));
    assert.equal(await ev(`document.querySelector('[data-select-control=setTerminalShell] .select-control-value').textContent`),'自动（优先 PowerShell 7）');
    assert.deepEqual(await api('/api/settings'),settingsBefore,'language does not write server configuration');
    console.log('  PASS language setting is discoverable, translates settings search and restores original labels without changing drafts or server defaults');

    await draw(`closeDlg();AgentHubLocale.set('en');await refreshData();await window.AgentHubModelCenter.open('connections');`);
    await waitFor(()=>ev(`document.querySelector('#mcConnections .provider-name')&&document.querySelector('#modelCenter .manage-nav').textContent.includes('Provider')`));
    assert.equal(await ev(`document.querySelector('[data-provider-id=${JSON.stringify(provider.id)}] .provider-name').textContent`),'保存');
    await draw(`await window.AgentHubModelCenter.open('models');`);
    await waitFor(()=>ev(`!!document.querySelector('[data-catalog-model="文件"]')`));
    assert.equal(await ev(`document.querySelector('[data-catalog-model="文件"] .managed-model-title b').textContent`),'文件');
    assert.deepEqual((await api('/api/providers?agent=all')).find(p=>p.id===provider.id),originalProvider);
    await draw(`window.AgentHubManagement.close();S.readOnly=true;await showSettings();`);
    assert.equal(await ev(`document.getElementById('setLocale').disabled`),false);
    await choose('#setLocale','ar');await waitFor(()=>ev(`document.documentElement.dir==='rtl'`));
    await choose('#setLocale','en');await waitFor(()=>ev(`document.documentElement.dir==='ltr'`));
    await draw(`document.getElementById('setFontApp').value='LANGUAGE_PACK_DRAFT';AgentHubLocale.extend([{id:'fr',name:'Français',dir:'ltr',dictionary:{'界面语言':'Langue de l’interface'}}]);`);
    await waitFor(()=>ev(`!!document.querySelector('#setLocale option[value=fr]')`));
    await choose('#setLocale','fr');
    assert.equal(await ev(`document.querySelector('label[for=setLocale]').textContent`),'Langue de l’interface');
    assert.equal(await ev(`AgentHubLocale.translate('取消')`),'Cancel');
    assert.equal(await ev(`document.getElementById('setFontApp').value`),'LANGUAGE_PACK_DRAFT');
    await draw(`AgentHubLocale.extend([]);`);
    assert.equal(await ev(`document.getElementById('setLocale').value`),'en');
    assert.equal(await ev(`document.querySelector('#setLocale option[value=fr]')`),null);
    await choose('#setLocale','en');
    await draw(`S.readOnly=false;closeDlg();openDlg('选项测试','<div class="fld"><label for="localeSelectProbe">权限</label><select id="localeSelectProbe" data-native-select><option value="read">只读</option><option value="auto">自动</option></select></div>');AgentHubLocale.apply();const select=document.getElementById('localeSelectProbe');select.removeAttribute('data-native-select');enhanceDialogSelects(select);`);
    await waitFor(()=>ev(`document.querySelector('[data-select-control=localeSelectProbe] .select-control-value').textContent==='Read only'`));
    await draw(`AgentHubLocale.set('zh-CN');`);
    assert.equal(await ev(`document.querySelector('[data-select-control=localeSelectProbe] .select-control-value').textContent`),'只读');
    await draw(`AgentHubLocale.set('en');closeDlg();`);
    await draw(`await showSettings();AgentHubLocale.apply();await showSettings();closeDlg();`);
    assert.equal(await ev(`document.getElementById('overlay').classList.contains('hidden')`),true,'translated titles do not create duplicate dialog history');
    await draw(`await showSettings();document.getElementById('setFontApp').value='PARENT_DRAFT';AgentHubLocale.apply();openDlg('添加供应商','<p>连接设置</p>');AgentHubLocale.apply();AgentHubLocale.set('zh-CN');closeDlg();`);
    assert.equal(await ev(`document.getElementById('dlgTitle').textContent`),'设置');
    assert.equal(await ev(`document.getElementById('setFontApp').value`),'PARENT_DRAFT');
    await draw(`AgentHubLocale.set('en');closeDlg();`);
    await browser('open',{url:base});await waitFor(()=>ev(`typeof S!=='undefined'&&S.wsReady&&!!window.AgentHubLocale&&document.getElementById('btnNewTask').textContent.includes('New task')`));
    assert.equal(await ev(`AgentHubLocale.preference`),'en');
    const automatic=await ev(`(()=>{const saved=Object.getOwnPropertyDescriptor(navigator,'languages');try{Object.defineProperty(navigator,'languages',{configurable:true,value:['en-US']});AgentHubLocale.set('auto');const first=AgentHubLocale.id;Object.defineProperty(navigator,'languages',{configurable:true,value:['zh-CN']});window.dispatchEvent(new Event('languagechange'));return {first,next:AgentHubLocale.id,pref:AgentHubLocale.preference,invalid:AgentHubLocale.set('not-a-locale')};}finally{saved?Object.defineProperty(navigator,'languages',saved):delete navigator.languages;AgentHubLocale.set('en');}})()`);
    assert.deepEqual(automatic,{first:'en',next:'zh-CN',pref:'auto',invalid:false});
    console.log('  PASS saved language survives reload; system preference, Arabic RTL, late language packs, nested dialogs, local read-only preferences and cloned select labels work; provider and model names are preserved');

    if(process.env.ORBITCELL_UPDATE_PREVIEWS!=='1')return;
    quotaServer=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{balance:38.5,credits:1500,five:38,week:65,month:{used:250,limit:1000}}}));});
    await new Promise(resolve=>quotaServer.listen(0,'127.0.0.1',resolve));
    const quotaUrl='http://127.0.0.1:'+quotaServer.address().port+'/usage';
    for(const p of await api('/api/providers?agent=all'))await api('/api/providers/'+p.id,'DELETE');
    const windows=[{label:'5 小时',kind:'window',basis:'usedPercent',valuePath:'data.five',windowSeconds:18000},{label:'每周',kind:'window',basis:'remainingPercent',valuePath:'data.week',windowSeconds:604800},{label:'每月',kind:'window',basis:'used',valuePath:'data.month.used',limitPath:'data.month.limit',windowSeconds:2592000,unit:'requests'}];
    const plan=await api('/api/providers','POST',{name:'MiniMax Plan',baseUrl:'https://api.minimaxi.com/v1',scope:'shared',model:'MiniMax-M2.7',models:['MiniMax-M2.7','MiniMax-M2.5'],quotaApi:{type:'json',url:quotaUrl,auth:'none',metrics:windows}});
    await api('/api/providers','POST',{name:'DeepSeek Balance',baseUrl:'https://api.deepseek.com/v1',scope:'shared',model:'deepseek-chat',models:['deepseek-chat','deepseek-reasoner'],quotaApi:{type:'json',url:quotaUrl,auth:'none',metrics:[{label:'余额',kind:'balance',valuePath:'data.balance',unit:'CNY'}]}});
    await api('/api/providers','POST',{name:'Workspace API',baseUrl:'https://gateway.example.invalid/v1',scope:'shared',model:'workspace-chat',models:['workspace-chat','workspace-code'],quotaApi:{type:'json',url:quotaUrl,auth:'none',metrics:[...windows,{label:'积分',kind:'credits',valuePath:'data.credits',unit:'credits'}]}});
    await api('/api/model-defaults','PUT',{providerId:plan.id,model:'MiniMax-M2.7',effort:''});
    const status=await api('/api/browser/status'),version=await(await fetch('http://127.0.0.1:'+status.port+'/json/version')).json();
    socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
    let serial=0,sessionId;const pending=new Map();socket.on('message',bytes=>{const msg=JSON.parse(bytes),task=pending.get(msg.id);if(task){pending.delete(msg.id);clearTimeout(task.timer);msg.error?task.reject(Error(msg.error.message)):task.resolve(msg.result);}});
    const cdp=(method,params={},page=true)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(page&&sessionId?{sessionId}:{})}));});
    sessionId=(await cdp('Target.attachToTarget',{targetId:status.targetId,flatten:true},false)).sessionId;
    await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await draw(`storageSet('ah.zoom','1');applyZoom();applyTheme('studio');await refreshData();`);
    const residuals={};
    async function capture(lang,name){
      await ev(`AgentHubLocale.apply();true`);await new Promise(resolve=>setTimeout(resolve,100));
      await ev(`Promise.all([...document.querySelectorAll('img')].map(i=>i.decode().catch(()=>{}))).then(()=>true)`);
      if(lang==='en')residuals[name]=await ev(`(()=>{const skip='script,style,pre,code,option,[hidden],[data-i18n-ignore],#messages,#sessionList,#sessionTabs,#hdrTitle,#providerLabel,#modelLabel',walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),found=new Set();while(walker.nextNode()){const n=walker.currentNode,p=n.parentElement;if(!p||p.closest(skip)||!/[\\u3400-\\u9fff]/.test(n.nodeValue))continue;const r=p.getBoundingClientRect();if(r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(p).visibility!=='hidden')found.add(n.nodeValue.trim());}return [...found];})()`);
      const dir=path.resolve(__dirname,'../../docs/assets',lang);fs.mkdirSync(dir,{recursive:true});
      const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1440,height:1000,scale:1}});
      fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(shot.data,'base64'));
    }
    const sample=await api('/api/sessions','POST',{agent:'builtin',providerId:plan.id,model:'MiniMax-M2.7',title:'Allowance overview'});
    for(const lang of ['zh-CN','en']){
      for(const chat of await api('/api/sessions'))await api('/api/sessions/'+chat.id,'PATCH',{title:lang==='en'?(chat.id===sample.id?'Allowance overview':'Quick start'):(chat.id===sample.id?'额度概览':'快速开始')});
      await draw(`closeDlg();window.AgentHubManagement.close();window.AgentHubAgentCenter.close();AgentHubLocale.set(${JSON.stringify(lang)});await window.AgentHubAgentCenter.open();`);await capture(lang,'orbitcell-agents');
      await draw(`window.AgentHubAgentCenter.close();await window.AgentHubModelCenter.open('connections');`);await waitFor(()=>ev(`document.querySelectorAll('#mcConnections .pq-mini-window').length===6`));await capture(lang,'orbitcell-quota-cards');
      await draw(`document.getElementById('mcProviderOrder').click();`);await capture(lang,'orbitcell-order-settings');
      await draw(`closeDlg();document.querySelector('[data-provider-id=${JSON.stringify(plan.id)}] [data-provider-open]').click();`);await waitFor(()=>ev(`document.querySelectorAll('#mcProviderQuota .pq-window').length===3`));await capture(lang,'orbitcell-quota-detail');
      await draw(`window.AgentHubManagement.close();await refreshData();await openSession(${JSON.stringify(sample.id)});`);await waitFor(()=>ev(`!!document.getElementById('quotaChip')?.textContent`));await capture(lang,'orbitcell-quota-chat');
      await draw(`await showSettings();`);await capture(lang,'orbitcell-language-settings');
    }
    console.log('  Locale preview text audit:',JSON.stringify(residuals));
    for(const [name,values]of Object.entries(residuals))assert.deepEqual(values,[],name+': untranslated interface labels');
    console.log('  PASS generated Chinese and English README screenshots from the same isolated dataset');
  }finally{
    try{await ev(`S.readOnly=false;AgentHubLocale.set('zh-CN');closeDlg();true`);}catch{}
    socket?.close();quotaServer?.closeAllConnections();quotaServer?.close();
  }
};
