// Isolated browser regression: settings writes and cross-Agent navigation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http=require('node:http');
const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-settings-ui-'));
const BASE = 'http://127.0.0.1:18953';
fs.writeFileSync(path.join(DATA, 'providers.json'), JSON.stringify({ list: [], meta: { ccswitchImportDone: true } }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, directoryServer, directoryBase, failures = 0;
async function api(route, method = 'GET', body) {
  try {
    // 浏览器冷启动由后端给出最长 60 秒预算，调用者不能先在 35 秒截断。
    const timeout = route === '/api/browser/open' ? 90000 : route === '/api/health' ? 2000 : 35000;
    const r = await fetch(BASE + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const data = await r.json(); assert(r.ok, `${method} ${route}: ${r.status} ${JSON.stringify(data).slice(0, 600)}`); return data;
  } catch (e) { throw Error(`${method} ${route}: ${e.message}`); }
}
const browser = (route, body = {}) => api('/api/browser/' + route, 'POST', body);
async function ev(expression) { const r = await browser('evaluate', { expression }); assert(r.ok, r.error); return r.value; }
async function waitFor(fn) { const deadline = Date.now() + 60000; let error; while (Date.now() < deadline) { try { if (await fn()) return; } catch (e) { error = e; } await sleep(150); } throw Error('Startup timeout: ' + (error?.message || String(fn))); }
async function check(name, fn) { try { await fn(); console.log('  PASS ' + name); } catch (e) { failures++; console.error('  FAIL ' + name + ': ' + e.message); } }
let taskSequence = 0;
async function uiTask(action) {
  // Agent discovery can outlive one CDP evaluation on a loaded Windows host.
  // Each task has its own completion slot so a late result cannot settle a
  // different action after an earlier timeout.
  const key = String(++taskSequence);
  await ev(`(()=>{window.__settingsUiTasks||={};window.__settingsUiTasks[${JSON.stringify(key)}]={done:false};(async()=>{${action}})().then(value=>{window.__settingsUiTasks[${JSON.stringify(key)}]={done:true,value};},error=>{window.__settingsUiTasks[${JSON.stringify(key)}]={done:true,error:String(error?.stack||error)};});return true;})()`);
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const task = await ev(`window.__settingsUiTasks[${JSON.stringify(key)}]`);
    if (task.done) { await ev(`delete window.__settingsUiTasks[${JSON.stringify(key)}];true`); assert(!task.error, task.error); return task.value; }
    await sleep(150);
  }
  throw Error('asynchronous settings action timed out');
}
async function delay(route, method, action) {
  return uiTask(`const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).startsWith(${JSON.stringify(route)})&&(args[1]?.method||'GET')===${JSON.stringify(method)})await new Promise(r=>setTimeout(r,350));return response;};try{${action}}finally{window.fetch=original;}`);
}
async function fixtures() {
  await api('/api/settings', 'PUT', { customAgents: ['first','second'].map(id => ({ id: 'c_' + id, name: id, bin: process.execPath, args: '--version', color: '#59687a' })) });
  await uiTask('await refreshData();await showSettings();');
}
(async()=>{
  try {
    directoryServer=http.createServer((req,res)=>{
      res.setHeader('content-type','application/json');
      if(req.url==='/proxy/models'&&req.headers.authorization==='Bearer ui-directory-key')return res.end(JSON.stringify({data:[{id:'ui-directory-model'},{id:'ui-directory-other'}]}));
      res.writeHead(404);res.end('{}');
    });
    await new Promise(resolve=>directoryServer.listen(0,'127.0.0.1',resolve));
    directoryBase='http://127.0.0.1:'+directoryServer.address().port+'/proxy';

    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, windowsHide: true, stdio: 'ignore', env: { ...process.env, AGENTHUB_PORT: '18953', AGENTHUB_HOST: '127.0.0.1', AGENTHUB_DATA_DIR: DATA, AGENTHUB_TOKEN: '', AGENTHUB_RO_TOKEN: '' } });
    await waitFor(()=>api('/api/health'));
    if (!(await api('/api/browser/status')).browser) { console.log('[settings-ui] skipped: Chrome/Edge unavailable'); return; }
    const session = await api('/api/sessions', 'POST', { agent: 'builtin', autoPerms: true, permMode: 'auto' });
    await browser('open', { url: BASE }); await waitFor(()=>ev('typeof S!=="undefined"&&S.wsReady&&S.agents.length>0'));
    await check('switching Agent cancels a pending session view', async()=>{
      const state = await delay('/api/sessions/'+session.id, 'GET', `const pending=openSession(${JSON.stringify(session.id)});await switchAgent('codex');await pending;return {agent:S.curAgent,session:S.curSessionId};`);
      assert.deepEqual(state, {agent:'codex', session:null});
    });
    await check('new-session completion respects subsequent navigation', async()=>{
      const state = await delay('/api/sessions', 'POST', `await switchAgent('builtin');const pending=newSession();await switchAgent('codex');await pending;return {agent:S.curAgent,session:S.curSessionId};`);
      assert.deepEqual(state, {agent:'codex', session:null});
    });
    await check('an API Agent without a provider offers onboarding instead of claiming a native model connection',async()=>{
      const result=await uiTask(`closeDlg();await switchAgent('builtin');document.getElementById('pillModel').click();const menu=document.getElementById('flyMenu'),button=menu.querySelector('[data-model-add-provider]');const view={add:!!button,native:!!menu.querySelector('.model-picker-native')};button.click();await new Promise(requestAnimationFrame);view.editor=!!document.getElementById('npSave');closeDlg();return view;`);
      assert.deepEqual(result,{add:true,native:false,editor:true});
    });
    await check('DSH permissions stay visible and reasoning survives selecting and reopening a session',async()=>{
      const provider=await api('/api/providers','POST',{agent:'dsh',name:'DSH reasoning fixture',baseUrl:'http://127.0.0.1:1/v1',model:'fixture-glm',models:['fixture-glm']});
      const session=await api('/api/sessions','POST',{agent:'dsh',providerId:provider.id,model:'fixture-glm'});
      const view=await uiTask(`closeDlg();await refreshData();await openSession(${JSON.stringify(session.id)});const perm=document.getElementById('pillPerm');perm.click();const item=[...document.querySelectorAll('#flyMenu .fly-item')].find(e=>e.textContent.includes('只读'));if(!item)throw Error('native permission option missing');item.click();await sessionPatchQueues.get(${JSON.stringify(session.id)});composerModelCatalog.rows=[{providerId:${JSON.stringify(provider.id)},id:'fixture-glm',reasoning:true,efforts:['low','high','max']}];composerModelCatalog.loadedAt=Date.now();document.getElementById('pillModel').click();const stops=[...document.querySelectorAll('#flyMenu [data-effort-stop]')].map(b=>b.textContent);document.querySelector('#flyMenu [data-effort-stop="2"]').click();await sessionPatchQueues.get(${JSON.stringify(session.id)});return {visible:getComputedStyle(perm).display!=='none'&&!!perm.closest('.composer-controls')&&perm.getBoundingClientRect().right<document.getElementById('pillModel').getBoundingClientRect().left,options:[...document.getElementById('selPerm').options].map(o=>o.value),stops};`);
      assert.equal(view.visible,true);assert.deepEqual(view.options,['default','read-only','workspace-write','danger-full-access']);assert.deepEqual(view.stops,['default','low','high','max']);
      const saved=await api('/api/sessions/'+session.id);assert.equal(saved.dshPermission,'read-only');assert.equal(saved.effort,'high');
      const restored=await uiTask(`closeFlyMenu();await openSession(${JSON.stringify(session.id)});return {permission:document.getElementById('selPerm').value,effort:document.getElementById('selEffort').value,label:document.getElementById('permLabel').textContent};`);
      assert.deepEqual(restored,{permission:'read-only',effort:'high',label:'只读'});
    });
    await check('all shared executors expose effective permissions and persist their own reasoning selection',async()=>{
      const provider=await api('/api/providers','POST',{agent:'builtin',name:'Shared controls fixture',baseUrl:'http://127.0.0.1:1/v1',model:'controls-model',models:['controls-model']});
      for(const agent of ['claude','codex','zcode','builtin','chatgpt-web']){
        const session=await api('/api/sessions','POST',{agent,providerId:provider.id,model:'controls-model',effort:'high',permMode:'ask'});
        const view=await uiTask(`closeDlg();await refreshData();await openSession(${JSON.stringify(session.id)});composerModelCatalog.rows=[{providerId:${JSON.stringify(provider.id)},id:'controls-model',reasoning:true,efforts:['none','minimal','low','medium','high','xhigh','max','ultra']}];composerModelCatalog.loadedAt=Date.now();document.getElementById('pillModel').click();const result={permissions:[...document.getElementById('selPerm').options].map(o=>o.value),visible:getComputedStyle(document.getElementById('pillPerm')).display!=='none',levels:[...document.querySelectorAll('#flyMenu [data-effort-stop]')].map(e=>e.textContent)};document.querySelector('#flyMenu [data-effort-stop="1"]').click();await sessionPatchQueues.get(${JSON.stringify(session.id)});closeFlyMenu();return result;`);
        assert.equal(view.visible,agent!=='chatgpt-web');if(agent==='codex')assert.deepEqual(view.permissions,['auto','plan','ask']);
        if(agent==='zcode')assert.deepEqual(view.levels,['default','low','high','max']);
        if(agent==='claude')assert.deepEqual(view.levels,['default','none','low','medium','high','xhigh','max']);
        assert.equal((await api('/api/sessions/'+session.id)).effort,view.levels[1]);
      }
    });
    await check('model selection stays open, preserves list position and updates reasoning controls',async()=>{
      const provider=await api('/api/providers','POST',{agent:'builtin',name:'Model picker fixture',model:'fixture-a',models:['fixture-a','fixture-b','fixture-none',...Array.from({length:15},(_,i)=>'fixture-extra-'+i)]});
      const pickerSession=await api('/api/sessions','POST',{agent:'builtin',providerId:provider.id,model:'fixture-a',effort:'max'});
      await uiTask(`closeDlg();await refreshData();await openSession(${JSON.stringify(pickerSession.id)});composerModelCatalog.rows=[{providerId:${JSON.stringify(provider.id)},id:'fixture-a',name:'Fixture A',reasoning:true,efforts:['low','medium','high','max']},{providerId:${JSON.stringify(provider.id)},id:'fixture-b',name:'Fixture B',reasoning:true,efforts:['low','high','ultra']},{providerId:${JSON.stringify(provider.id)},id:'fixture-none',name:'No reasoning',reasoning:false,efforts:[]}];composerModelCatalog.loadedAt=Date.now();document.getElementById('pillModel').click();`);
      const state=await ev(`(()=>{const menu=document.getElementById('flyMenu'),list=menu.querySelector('.model-picker-list'),button=list.querySelector('[data-model-id="fixture-b"]');list.scrollTop=42;const top=list.scrollTop;button.focus();button.click();const range=menu.querySelector('input[type="range"]');range.value='3';range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));const model=document.getElementById('modelLabel'),effort=document.getElementById('modelEffortLabel');return {open:!menu.classList.contains('hidden'),same:button===list.querySelector('[data-model-id="fixture-b"]'),focused:document.activeElement===button,scroll:list.scrollTop===top,model:document.getElementById('inpModel').value,effort:document.getElementById('selEffort').value,label:effort.textContent,muted:getComputedStyle(model).color!==getComputedStyle(effort).color,stops:[...menu.querySelectorAll('[data-effort-stop]')].map(b=>b.textContent),rangeText:range.getAttribute('aria-valuetext'),rangeVisible:range.getBoundingClientRect().width>180&&range.getBoundingClientRect().height>=24&&getComputedStyle(range.closest('.model-effort-rail')).clipPath==='none'};})()`);
      assert(await ev(`!document.getElementById('btnComposerConfig')&&!!document.querySelector('#flyMenu [data-model-defaults]')`));
      assert.deepEqual(state,{open:true,same:true,focused:true,scroll:true,model:'fixture-b',effort:'ultra',label:'Ultra',muted:true,stops:['default','low','high','ultra'],rangeText:'ultra',rangeVisible:true});
      const stableFrame=await ev(`(()=>{const menu=document.getElementById('flyMenu'),pill=document.getElementById('pillModel'),before=menu.getBoundingClientRect(),pillBefore=pill.getBoundingClientRect(),initial={x:before.x,y:before.y,width:before.width,height:before.height,pillWidth:pillBefore.width};for(const id of ['fixture-a','fixture-b','fixture-a','fixture-b'])menu.querySelector('[data-model-id="'+id+'"]').click();const after=menu.getBoundingClientRect(),pillAfter=pill.getBoundingClientRect();return {stable:['x','y','width','height'].every(key=>Math.abs(after[key]-initial[key])<1),pillStable:Math.abs(pillAfter.width-initial.pillWidth)<1,selected:document.getElementById('inpModel').value};})()`);
      assert.deepEqual(stableFrame,{stable:true,pillStable:true,selected:'fixture-b'},'model switches cannot move or resize the picker and its trigger');
      await uiTask(`await sessionPatchQueues.get(${JSON.stringify(pickerSession.id)});`);
      assert.equal(state.rangeVisible,true,'reasoning range is visible and usable');
      assert.equal((await api('/api/sessions/'+pickerSession.id)).effort,'ultra');
      const fallback=await ev(`(()=>{const menu=document.getElementById('flyMenu');menu.querySelector('[data-model-id="fixture-none"]').click();const button=menu.querySelector('[data-effort-default]');button.click();return {open:!menu.classList.contains('hidden'),default:document.getElementById('selEffort').value,label:document.getElementById('modelEffortLabel').textContent,slider:!!menu.querySelector('input[type="range"]')};})()`);
      assert.deepEqual(fallback,{open:true,default:'',label:'默认',slider:false},'redrawing the default button cannot be mistaken for an outside click');
      await uiTask(`await sessionPatchQueues.get(${JSON.stringify(pickerSession.id)});document.getElementById('inpText').click();`);
      assert(await ev(`document.getElementById('flyMenu').classList.contains('hidden')`),'clicking outside still closes the popover');
      await ev('document.getElementById("pillModel").click();document.querySelector("#flyMenu [data-model-close]").click();true');
      assert(await ev(`document.getElementById('flyMenu').classList.contains('hidden')&&document.getElementById('pillModel').getAttribute('aria-expanded')==='false'`));
    });
    await check('switching provider returns to the model menu with the saved catalog and reasoning',async()=>{
      const first=await api('/api/providers','POST',{name:'Picker source',baseUrl:directoryBase,model:'source-model',models:['source-model']});
      const second=await api('/api/providers','POST',{name:'Picker destination',baseUrl:directoryBase,model:'destination-model',models:['destination-model','destination-extra'],effort:'high'});
      const session=await api('/api/sessions','POST',{agent:'builtin',providerId:first.id,model:'source-model'});
      const result=await uiTask(`closeDlg();await refreshData();await openSession(${JSON.stringify(session.id)});document.getElementById('pillModel').click();document.querySelector('[data-model-provider]').click();document.querySelector('[data-provider-search]').value='destination';document.querySelector('[data-provider-search]').dispatchEvent(new Event('input'));const choice=document.querySelector('[data-provider-choice="${second.id}"]');await choice.onclick();const menu=document.getElementById('flyMenu');return {open:!menu.classList.contains('hidden'),panel:!!menu.querySelector('.model-provider-panel'),provider:menu.querySelector('[data-model-provider]').textContent,model:document.getElementById('inpModel').value,models:[...menu.querySelectorAll('[data-model-id]')].map(b=>b.dataset.modelId),effort:document.getElementById('selEffort').value};`);
      assert.equal(result.open,true);assert.equal(result.panel,false);assert(result.provider.includes(second.name));assert.equal(result.model,'destination-model');assert(result.models.includes('destination-extra'));assert(!result.models.includes('source-model'));assert.equal(result.effort,'high');
      const saved=await api('/api/sessions/'+session.id);assert.equal(saved.providerId,second.id);assert.equal(saved.model,'destination-model');
      const draft=await uiTask(`closeFlyMenu();await switchAgent('builtin');document.getElementById('pillModel').click();document.querySelector('[data-model-provider]').click();await document.querySelector('[data-provider-choice="${second.id}"]').onclick();return {open:!document.getElementById('flyMenu').classList.contains('hidden'),model:document.getElementById('inpModel').value};`);
      assert.deepEqual(draft,{open:true,model:'destination-model'});
    });
    await check('failed provider switches restore the visible connection and dismissed saves do not reopen a menu',async()=>{
      const providers=await api('/api/providers?agent=all'),first=providers.find(p=>p.name==='Picker source'),second=providers.find(p=>p.name==='Picker destination');
      const session=await api('/api/sessions','POST',{agent:'builtin',providerId:first.id,model:first.model});
      const rollback=await uiTask(`closeFlyMenu();await openSession(${JSON.stringify(session.id)});const original=window.fetch;window.fetch=async(url,options)=>String(url)==='/api/sessions/${session.id}'&&options?.method==='PATCH'?new Response(JSON.stringify({error:'fixture rejected'}),{status:503,headers:{'content-type':'application/json'}}):original(url,options);try{document.getElementById('pillModel').click();document.querySelector('[data-model-provider]').click();await document.querySelector('[data-provider-choice="${second.id}"]').onclick();return {open:!document.getElementById('flyMenu').classList.contains('hidden'),provider:currentProvider().id,model:document.getElementById('inpModel').value};}finally{window.fetch=original;}`);
      assert.deepEqual(rollback,{open:true,provider:first.id,model:first.model});
      const closed=await delay('/api/sessions/'+session.id,'PATCH',`closeFlyMenu();document.getElementById('pillModel').click();document.querySelector('[data-model-provider]').click();const pending=document.querySelector('[data-provider-choice="${second.id}"]').onclick();closeFlyMenu();await pending;return document.getElementById('flyMenu').classList.contains('hidden');`);assert.equal(closed,true);
      assert.equal((await api('/api/sessions/'+session.id)).providerId,second.id);
    });
    await check('async anonymous selects share the styled menu and remain synchronized',async()=>{
      const view=await uiTask(`closeFlyMenu();openDlg('下拉框核验','<div id="selectProbe"><label>协议<select><option value="a">协议 A</option><option value="b">协议 B</option></select></label></div>');const select=document.createElement('select');select.innerHTML='<option value="one">选项一</option><option value="two">选项二</option>';document.getElementById('selectProbe').append(select);await new Promise(requestAnimationFrame);const button=select.nextElementSibling;button.click();await new Promise(requestAnimationFrame);const styled=document.getElementById('flyMenu').dataset.menuKind==='select';[...document.querySelectorAll('#flyMenu .fly-item')].find(e=>e.textContent==='选项二').click();select.disabled=true;await new Promise(requestAnimationFrame);const result={styled,value:select.value,label:button.textContent,disabled:button.disabled,native:[...document.querySelectorAll('#selectProbe select')].filter(s=>getComputedStyle(s).display!=='none').length};closeDlg();return result;`);
      assert.deepEqual(view,{styled:true,value:'two',label:'选项二',disabled:true,native:0});
    });
    await check('model options escape scrolling dialogs and support keyboard selection without clipping',async()=>{
      const view=await uiTask(`openDlg('模型下拉核验','<div style="height:200px;overflow:auto"><label for="portalProbe">默认模型</label><input id="portalProbe"></div>');const input=document.getElementById('portalProbe');enhanceModelInput(input,[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'},...Array.from({length:12},(_,i)=>({id:'extra-'+i,name:'Extra '+i}))]);input.nextElementSibling.click();await new Promise(requestAnimationFrame);const popup=document.querySelector('.model-suggestions-portal:not([hidden])'),rect=popup.getBoundingClientRect();input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));const result={portal:popup.parentElement===document.body,inViewport:rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,model:input.value,closed:popup.hidden};closeDlg();await new Promise(requestAnimationFrame);result.cleaned=!document.getElementById('portalProbe-models');openDlg('父级模型设置','<input id="restoredModelProbe">');enhanceModelInput(document.getElementById('restoredModelProbe'),['alpha','beta']);openDlg('子页面','<p>child</p>');await new Promise(requestAnimationFrame);closeDlg();await new Promise(requestAnimationFrame);document.getElementById('restoredModelProbe').nextElementSibling.click();result.restored=!!document.querySelector('.model-suggestions-portal:not([hidden]) [data-model-option]');closeDlg();return result;`);
      assert.deepEqual(view,{portal:true,inViewport:true,model:'beta',closed:true,cleaned:true,restored:true});
    });
    await check('model management opens the owning provider model selector without asking for API credentials',async()=>{
      const first=await api('/api/providers','POST',{name:'Catalog editor first',baseUrl:'http://127.0.0.1:1/v1',model:'different-default',models:['shared-model-id']});
      const second=await api('/api/providers','POST',{name:'Catalog editor second',baseUrl:'http://127.0.0.1:2/v1',model:'second-default',models:['shared-model-id']});
      const result=await uiTask(`closeDlg();await window.AgentHubFeatures.modelCenter('models');const row=[...document.querySelectorAll('.managed-model-row')].find(row=>row.dataset.catalogModel==='shared-model-id'&&row.querySelector('.managed-model-source').textContent.includes('Catalog editor second'));row.querySelector('[data-mc-model-edit]').click();const view={provider:document.querySelector('.provider-editor-title strong').textContent,credentials:!!document.getElementById('epKey'),selected:[...document.querySelectorAll('[data-pm-id]:checked')].map(i=>i.dataset.pmId)};document.getElementById('pmCancel').click();const current=[...document.querySelectorAll('.managed-model-row')].find(row=>row.dataset.catalogModel==='shared-model-id');current.querySelector('[data-mc-detail]').click();document.getElementById('mcDetailEdit').click();view.detailProvider=document.querySelector('.provider-editor-title strong').textContent;closeDlg();window.AgentHubManagement.close();return view;`);
      assert.equal(result.provider,'Catalog editor second');assert.equal(result.detailProvider,result.provider);assert.equal(result.credentials,false);assert(result.selected.includes('shared-model-id'));
      assert.equal((await api('/api/providers?agent=all')).find(p=>p.id===first.id).model,'different-default');
      assert.equal((await api('/api/providers?agent=all')).find(p=>p.id===second.id).model,'second-default');
    });
    await check('explicit model refresh bypasses cache and clears an empty remote catalog',async()=>{
      const state=await uiTask(`const provider=currentProvider(),original=window.fetch;let requested=false;S.providerModels[provider.id]=['stale-model'];provider.models=['stale-model'];window.fetch=async(url,options)=>String(url)==='/api/providers/models'?(requested=JSON.parse(options.body).refresh,new Response(JSON.stringify({ok:true,models:[]}),{headers:{'content-type':'application/json'}})):original(url,options);try{const count=await refreshProviderModels(true);return {requested,count,cached:S.providerModels[provider.id],models:S.providers.find(p=>p.id===provider.id).models};}finally{window.fetch=original;}`);
      assert.deepEqual(state,{requested:true,count:0,cached:[],models:[]});
    });
    await check('provider onboarding selects models and later adds models without resubmitting credentials',async()=>{
      await uiTask(`closeDlg();window.AgentHubConnectionEditor.open(null);document.getElementById('npName').value='UI directory connection';document.getElementById('npBase').value=${JSON.stringify(directoryBase)};document.getElementById('npKey').value='ui-directory-key';document.getElementById('npFetch').click();`);
      await waitFor(()=>ev(`!!document.querySelector('[data-pm-id="ui-directory-model"]')&&!document.getElementById('npFetch').disabled`));
      const selected=await ev(`(()=>{document.querySelector('[data-pm-id="ui-directory-model"]').click();return {model:document.getElementById('npModel').value,manual:document.getElementById('npModels').value,selected:[...document.querySelectorAll('[data-pm-id]:checked')].length};})()`);
      assert.deepEqual(selected,{model:'ui-directory-model',manual:'',selected:1});
      await ev(`document.getElementById('npSave').click();true`);
      await waitFor(()=>ev(`document.getElementById('overlay').classList.contains('hidden')`));
      const saved=(await api('/api/providers?agent=all')).find(p=>p.name==='UI directory connection');
      assert(saved);assert.deepEqual(saved.models,['ui-directory-model','ui-directory-other']);assert.deepEqual(saved.enabledModels,['ui-directory-model']);assert.deepEqual(saved.manualModels,[]);assert.equal(saved.modelSync.ok,true);
      await uiTask(`window.AgentHubProviderModelPicker.open(${JSON.stringify(saved)});document.getElementById('pmRefresh').click();`);
      await waitFor(()=>ev(`document.getElementById('pmStatus').textContent.includes('获取到')&&!document.getElementById('pmRefresh').disabled`));
      assert.equal(await ev(`!!document.querySelector('#epKey,#npKey')`),false,'adding models never reopens authentication fields');
      await ev(`document.querySelector('[data-pm-id="ui-directory-other"]').click();document.getElementById('pmSave').click();true`);
      await waitFor(()=>ev(`document.getElementById('overlay').classList.contains('hidden')`));
      const more=(await api('/api/providers?agent=all')).find(p=>p.id===saved.id);
      assert.deepEqual(more.enabledModels,['ui-directory-model','ui-directory-other']);assert.deepEqual(more.manualModels,[]);assert.equal(more.apiKey,saved.apiKey);assert.equal(more.baseUrl,saved.baseUrl);
      await api('/api/providers/'+encodeURIComponent(saved.id),'PUT',{enabledModels:['ui-directory-model']});
      const selectionSession=await api('/api/sessions','POST',{agent:'builtin',providerId:saved.id,model:'ui-directory-model'});
      const candidates=await uiTask(`await refreshData();await openSession(${JSON.stringify(selectionSession.id)});S.providerModels[${JSON.stringify(saved.id)}]=['ui-directory-model','ui-directory-other'];return modelCandidates();`);
      assert(candidates.includes('ui-directory-model'));assert(!candidates.includes('ui-directory-other'),'unselected models stay out of the composer even when cached');
      await uiTask(`window.AgentHubConnectionEditor.open(null);document.getElementById('npName').value='UI empty provider';document.getElementById('npBase').value=${JSON.stringify(directoryBase)};document.getElementById('npKey').value='ui-directory-key';document.getElementById('npSave').click();`);
      await waitFor(()=>ev(`document.getElementById('overlay').classList.contains('hidden')`));
      assert.deepEqual((await api('/api/providers?agent=all')).find(p=>p.name==='UI empty provider').enabledModels,[],'a saved provider can be configured before selecting models');
      await uiTask(`await refreshData();await window.AgentHubModelCenter.usage({id:'ui-directory-model',providerId:${JSON.stringify(saved.id)},providerName:'UI directory connection'});`);
      assert(await ev(`[...document.querySelectorAll('[data-mu-enabled]')].every(input=>input.checked)&&document.querySelectorAll('.model-usage-agent-icon svg').length>=6`));
      const configured=await uiTask(`const row=[...document.querySelectorAll('[data-mu-row]')].find(row=>row.querySelector('b').textContent==='Codex');row.querySelector('[data-mu-toggle]').click();row.querySelector('[data-mu-protocol]').value='anthropic';document.getElementById('muSave').click();let end=Date.now()+10000;while(!document.getElementById('muNotice').textContent.includes('使用设置已保存')&&Date.now()<end)await new Promise(r=>setTimeout(r,20));return document.getElementById('muNotice').textContent;`);
      assert(configured.includes('使用设置已保存'));assert.equal((await api('/api/providers?agent=all')).find(p=>p.id===saved.id).agentOverrides.codex.protocol,'anthropic');
      await ev(`document.getElementById('muClose').click();true`);
    });
    await check('official reference models are explicit manual selections and do not change connection credentials',async()=>{
      const provider=await api('/api/providers','POST',{name:'UI reference provider',baseUrl:'http://127.0.0.1:1/v1',apiKey:'ui-reference-key',enabledModels:[]});
      await uiTask(`closeDlg();AgentHubProviderModelPicker.open({...${JSON.stringify(provider)},baseUrl:'https://api.minimaxi.com/anthropic'});`);
      await waitFor(()=>ev(`!document.getElementById('pmReference').hidden`));
      const chosen=await ev(`(()=>{document.getElementById('pmReference').click();const input=document.querySelector('[data-pm-id]');input.click();return {id:input.dataset.pmId,note:document.getElementById('pmStatus').textContent};})()`);
      assert(chosen.note.includes('尚未验证'));await ev(`document.getElementById('pmSave').click();true`);
      await waitFor(()=>ev(`document.getElementById('overlay').classList.contains('hidden')`));
      const saved=(await api('/api/providers?agent=all')).find(p=>p.id===provider.id);
      assert.deepEqual(saved.enabledModels,[chosen.id]);assert(saved.manualModels.includes(chosen.id));assert.equal(saved.baseUrl,provider.baseUrl);assert.equal(saved.apiKey,provider.apiKey);
    });
    await check('native ACP permissions and reasoning are editable and persisted before the first prompt',async()=>{
      const created=await api('/api/agent-center/custom','POST',{name:'Native model UI fixture',bin:process.execPath,args:JSON.stringify(path.join(ROOT,'test/fixtures/acp-runtime.cjs')),acp:true});
      const session=await api('/api/sessions','POST',{agent:created.agent.id,model:'model-b',effort:'high',permMode:'ask'});
      try{
      await uiTask(`closeDlg();window.AgentHubManagement.close();await refreshData();await openSession(${JSON.stringify(session.id)});document.getElementById('pillModel').click();`);
      await waitFor(()=>ev(`!!document.querySelector('#flyMenu [data-model-id="model-b"]')&&!!document.querySelector('#flyMenu [data-effort-stop="2"]')`));
      const view=await uiTask(`const stops=[...document.querySelectorAll('#flyMenu [data-effort-stop]')].map(e=>e.textContent);document.querySelector('#flyMenu [data-effort-stop="1"]').click();await sessionPatchQueues.get(${JSON.stringify(session.id)});return {stops,permission:getComputedStyle(document.getElementById('pillPerm')).display!=='none'};`);
      assert.deepEqual(view,{stops:['default','low','high'],permission:true});
      let saved=await api('/api/sessions/'+session.id);assert.equal(saved.effort,'low');assert.equal(saved.acpConfig.effort,'low');assert.equal(saved.messages.length,0);
      await uiTask(`document.querySelector('#flyMenu [data-effort-stop="0"]').click();await sessionPatchQueues.get(${JSON.stringify(session.id)});closeFlyMenu();await window.AgentHubFeatures.runtime();`);
      saved=await api('/api/sessions/'+session.id);assert.equal(saved.effort,'');assert.equal(saved.acpConfig.effort,'low');
      await waitFor(()=>ev(`!!document.querySelector('[data-runtime-config="effort"]')`));
      await uiTask(`const select=document.querySelector('[data-runtime-config="effort"]');select.value='high';select.dispatchEvent(new Event('change'));document.getElementById('runtimeSave').click();`);
      await waitFor(()=>ev(`document.getElementById('overlay').classList.contains('hidden')`));
      saved=await api('/api/sessions/'+session.id);assert.equal(saved.effort,'high');assert.equal(saved.acpConfig.effort,'high');assert.equal(saved.messages.length,0);
      await uiTask(`await openSession(${JSON.stringify(session.id)});return true;`);assert.equal(await ev(`document.getElementById('selEffort').value`),'high');
      await api('/api/agent-center/config','PUT',{agent:created.agent.id,config:{model:'model-b'}});
      await uiTask(`await window.AgentHubAgentCenter.open({agent:${JSON.stringify(created.agent.id)},tab:'config'});`);
      await waitFor(()=>ev(`!!document.querySelector('#acEffort option[value="high"]')`));
      await uiTask(`const select=document.getElementById('acEffort');select.value='high';select.dispatchEvent(new Event('change'));document.querySelector('#acConfigForm [type="submit"]').click();`);
      await waitFor(async()=>{const c=await api('/api/agent-center');return c.configurations.local?.[created.agent.id]?.effort==='high';});
      const defaults=(await api('/api/agent-center')).configurations.local[created.agent.id];assert.equal(defaults.acpConfig.effort,'high');
      assert.equal(await ev(`agentTargetDefaults(${JSON.stringify(created.agent.id)},'').effort`),'high');
      await uiTask(`window.AgentHubAgentCenter.close();await switchAgent('claude');`);

      }finally{await api('/api/sessions/'+session.id,'DELETE');}
    });
    await check('reopening Agent management during detection clears the original pending state',async()=>{
      await api('/api/agent-center/config','PUT',{agent:'claude',config:{command:process.execPath}});
      const state=await uiTask(`closeDlg();const original=window.fetch;let release;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0])==='/api/agent-center/probe')await new Promise(resolve=>release=resolve);return response;};try{await window.AgentHubAgentCenter.open({agent:'claude',tab:'config'});document.querySelector('#agentCenterPage [data-ac-action="probe"]').click();let deadline=Date.now()+10000;while(!release&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!release)throw Error('probe response did not reach fixture');window.AgentHubAgentCenter.close();await window.AgentHubAgentCenter.open({agent:'claude',tab:'config'});release();deadline=Date.now()+10000;while(Date.now()<deadline){const buttons=[...document.querySelectorAll('#agentCenterPage [data-ac-action="probe"]')];if(buttons.length&&buttons.every(b=>!b.disabled))return {ready:document.querySelector('#agentCenterPage h2').textContent.includes('CLI 可用'),pending:buttons.some(b=>b.textContent.includes('检测中'))};await new Promise(r=>setTimeout(r,10));}throw Error('reopened probe buttons stayed disabled');}finally{window.fetch=original;window.AgentHubAgentCenter.close();}`);
      assert.deepEqual(state,{ready:true,pending:false});
    });
    await check('custom Agent double submit creates one and keeps next dialog', async()=>{
      await fixtures();
      const view = await delay('/api/settings', 'PUT', `document.getElementById('caName').value='added';document.getElementById('caBin').value=${JSON.stringify(process.execPath)};const b=document.getElementById('caAdd');const a=b.onclick();const second=b.onclick();await showProviders();await Promise.all([a,second]);return {modelCenter:window.AgentHubManagement.isOpen('models'),active:document.querySelector('[data-mc-tab].active')?.dataset.mcTab,dialogHidden:document.getElementById('overlay').classList.contains('hidden')};`);
      assert.equal((await api('/api/settings')).customAgents.filter(c=>c.name==='added').length,1);
      assert.deepEqual(view,{modelCenter:true,active:'connections',dialogHidden:true}, 'a late settings save cannot replace the model connection page');
    });
    await check('double delete never removes a neighboring custom Agent', async()=>{
      await fixtures();
      await delay('/api/settings', 'PUT', `const b=document.querySelector('[data-cdel]');await Promise.all([b.onclick(),b.onclick()]);`);
      assert.deepEqual((await api('/api/settings')).customAgents.map(c=>c.id),['c_second']);
    });
    await check('save CLI settings preserves unrelated server preferences', async()=>{
      await fixtures();
      const initial = await api('/api/settings');
      await api('/api/settings','PUT',{sound:initial.sound===false});
      await uiTask('await document.getElementById("setSave").onclick();');
      assert.equal((await api('/api/settings')).sound, initial.sound===false);
    });
    await check('failed workflow preference resets the displayed value', async()=>{
      await ev('showSettings()');
      const values=await ev(`(async()=>{const select=document.getElementById('setQueueMode'),before=select.value,original=window.fetch;window.fetch=(url,opts)=>url==='/api/settings'&&opts?.method==='PUT'?Promise.resolve(new Response(JSON.stringify({error:'fixture failure'}),{status:503,headers:{'content-type':'application/json'}})):original(url,opts);try{select.value=before==='ask'?'queue':'ask';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,150));return {before,after:select.value};}finally{window.fetch=original;}})()`);
      assert.equal(values.after,values.before);
    });
    await check('settings sections preserve edits and save actions stay visible', async()=>{
      await ev('showSettings("settings-cli")');
      const state = await ev(`(()=>{const input=document.querySelector('[data-bin]');input.value='fixture-unsaved';document.querySelector('[data-settings-jump="settings-custom"]').click();const a=document.querySelector('#caAdd').getBoundingClientRect();document.querySelector('[data-settings-jump="settings-cli"]').click();const b=document.querySelector('#setSave').getBoundingClientRect();return {value:input.value,visiblePanes:[...document.querySelectorAll('.settings-pane')].filter(p=>!p.hidden).length,addVisible:a.width>0&&a.height>0,saveVisible:b.top>=0&&b.bottom<=innerHeight,cliSelected:document.querySelector('[data-settings-jump="settings-cli"]').getAttribute('aria-selected')};})()`);
      assert.deepEqual(state,{value:'fixture-unsaved',visiblePanes:1,addVisible:true,saveVisible:true,cliSelected:'true'});
      await ev('showSettings()');
    });
    await check('checkbox text aligns and focused search has one frame',async()=>{
      await uiTask('await showSettings("settings-preferences");');
      const state=await ev(`(()=>{const input=document.getElementById('setSound'),label=document.querySelector('label[for="setSound"]'),a=input.getBoundingClientRect(),b=label.getBoundingClientRect(),search=document.querySelector('.settings-global-search input');search.focus();const css=getComputedStyle(search);return {offset:Math.abs(a.y+a.height/2-b.y-b.height/2),border:css.borderWidth,outline:css.outlineStyle,shadow:css.boxShadow,labelMargin:getComputedStyle(label).marginBottom,outerBorder:getComputedStyle(search.parentElement).borderStyle};})()`);
      assert(state.offset<1,'checkbox and label centers align');assert.equal(state.labelMargin,'0px');assert.equal(state.border,'0px');assert.equal(state.outline,'none');assert.equal(state.shadow,'none');assert.equal(state.outerBorder,'solid');
    });
    await check('conversation colors apply to real content, reload and return to the active theme',async()=>{
      await uiTask('await showSettings("settings-conversation");');
      const colors=await ev(`(()=>{document.querySelector('[data-conversation-tab="reading"]').click();for(const [name,color]of [['answerColor','#223344'],['processColor','#778899'],['detailColor','#5f6b7c']]){const input=document.querySelector('[data-conversation-pref="'+name+'"]');input.value=color;input.dispatchEvent(new Event('change',{bubbles:true}));}return {answer:document.getElementById('messages').style.getPropertyValue('--conversation-answer-color'),process:document.getElementById('messages').style.getPropertyValue('--conversation-process-color'),detail:document.getElementById('messages').style.getPropertyValue('--conversation-detail-color'),preview:getComputedStyle(document.querySelector('.conversation-color-preview p')).color,detailPreview:getComputedStyle(document.querySelector('.conversation-color-preview code')).color};})()`);
      assert.deepEqual(colors,{answer:'#223344',process:'#778899',detail:'#5f6b7c',preview:'rgb(34, 51, 68)',detailPreview:'rgb(95, 107, 124)'});
      const content = await ev(`(()=>{const fixture=document.createElement('div');fixture.id='color-fixture';fixture.innerHTML='<div class="turn-answer md-body"><h5>回答标题</h5><table class="md-table"><tbody><tr><td>回答内容</td></tr></tbody></table></div><div class="turn-commentary md-body"><p>执行前说明</p></div><div class="turn-process">'+stepBlockHtml({type:'think',text:'核对步骤'},true,'running')+stepBlockHtml({type:'tool',id:'read-color',name:'Read',detail:JSON.stringify({file_path:'sample.txt'}),output:'source text',status:'ok'},true,'running')+stepBlockHtml({type:'tool',id:'error-color',name:'Other',detail:'{}',output:'error message',status:'error'},true,'running')+stepBlockHtml({type:'tool',id:'edit-color',name:'Edit',detail:JSON.stringify({file_path:'sample.txt',old_string:'old',new_string:'new'}),output:'',status:'ok'},true,'running')+'</div>';document.getElementById('messages').appendChild(fixture);try{const color=selector=>getComputedStyle(fixture.querySelector(selector)).color;return {answer:color('.turn-answer td'),heading:color('.turn-answer h5'),commentary:color('.turn-commentary p'),process:color('.step-think .step-title'),detail:color('.read-code code'),error:color('.io-text[data-error]'),errorSummary:color('.err-sum'),add:color('.diff-line.add'),del:color('.diff-line.del'),addMark:color('.diff-line.add .diff-mark')};}finally{fixture.remove();}})()`);
      assert.equal(content.answer,'rgb(34, 51, 68)');assert.equal(content.heading,content.answer);assert.equal(content.commentary,content.answer);
      assert.equal(content.process,'rgb(119, 136, 153)');assert.equal(content.detail,'rgb(95, 107, 124)');
      assert.equal(content.error,content.errorSummary);assert.notEqual(content.error,content.detail,'errors retain their warning color');
      assert.notEqual(content.add,content.del,'diff addition and deletion stay distinct');assert.notEqual(content.add,content.detail);assert.notEqual(content.del,content.detail);assert.equal(content.addMark,content.add);
      await ev('location.reload();true');await waitFor(()=>ev('typeof S!=="undefined"&&S.wsReady&&S.agents.length>0'));
      assert.deepEqual(await ev(`({answer:AgentHubConversationPreferences.read().answerColor,process:document.getElementById('messages').style.getPropertyValue('--conversation-process-color'),detail:document.getElementById('messages').style.getPropertyValue('--conversation-detail-color')})`),{answer:'#223344',process:'#778899',detail:'#5f6b7c'});
      await uiTask('await showSettings("settings-conversation");');
      const reset=await ev(`(()=>{document.querySelector('[data-conversation-tab="reading"]').click();for(const b of document.querySelectorAll('[data-color-reset]'))b.click();return {answer:AgentHubConversationPreferences.read().answerColor,process:AgentHubConversationPreferences.read().processColor,detail:AgentHubConversationPreferences.read().detailColor,inline:document.getElementById('messages').style.getPropertyValue('--conversation-answer-color')};})()`);
      assert.deepEqual(reset,{answer:'auto',process:'auto',detail:'auto',inline:''});
      const themes=await ev(`(()=>{const previous=document.body.dataset.theme,rows=[];try{for(const theme of ['studio','ink']){applyTheme(theme);const colors=conversationThemeColors();const actual={};for(const [name,selector]of [['answerColor','p'],['processColor','span'],['detailColor','code']]){const input=document.querySelector('[data-conversation-pref="'+name+'"]'),value=document.querySelector('[data-color-value="'+name+'"] span');actual[name]={input:input.value,text:value.textContent,preview:getComputedStyle(document.querySelector('.conversation-color-preview>'+selector)).color,expected:colors[name]};}rows.push(actual);}return rows;}finally{applyTheme(previous);}})()`);
      for(const row of themes)for(const color of Object.values(row)){assert.equal(color.input,color.expected);assert.equal(color.text,color.expected);assert.notEqual(color.preview,'rgba(0, 0, 0, 0)');}
      assert.notEqual(themes[0].answerColor.input,themes[1].answerColor.input,'theme defaults update in the existing settings dialog');
    });
    await check('context meter uses the latest value after compaction', async()=>{
      assert.equal(await ev(`lastUsageMsg({messages:[{usage:{context:100}},{usage:{context:20}},{role:'user',text:'next'}]}).usage.context`),20);
      assert.equal(await ev(`lastUsageMsg({messages:[{usage:{context:100}},{usage:{context:0}}]}).usage.context`),0);
    });
    await check('ask queue mode waits, supports cancel and honors priority', async()=>{
      const value = await uiTask(`
        closeDlg();await openSession(${JSON.stringify(session.id)});const sid=S.curSessionId,route='/api/sessions/'+sid+'/queue',prior=S.settings.workflowDefaults;
        S.settings.workflowDefaults={queueMode:'ask',notify:'none'};await api(route,{method:'PATCH',body:{action:'pause'}});
        acceptServerQueue(sid,await api(route,{method:'POST',body:{text:'existing',qid:'fixture-existing'}}));S.running.add(sid);setSendBtn(true);
        try {const input=document.getElementById('inpText');input.value='priority fixture';await sendCurrent();const waiting=!document.getElementById('flyMenu').classList.contains('hidden')&&S.queue[sid].length===1&&input.value==='priority fixture';
          [...document.querySelectorAll('#flyMenu .fly-item')].find(e=>e.textContent.includes('取消')).click();const retained=input.value;await sendCurrent();[...document.querySelectorAll('#flyMenu .fly-item')].find(e=>e.textContent.includes('队首')).click();
          const end=Date.now()+5000;while(S.queueSubmitting?.has(sid)&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
          const first=(await api(route)).items[0].text;return {waiting,retained,first};
        }finally {let q=await api(route);while(q.items.length)q=await api(route,{method:'PATCH',body:{action:'remove',qid:q.items[0].qid,expectedRevision:q.revision}});acceptServerQueue(sid,q);S.running.delete(sid);setSendBtn(false);S.settings.workflowDefaults=prior;}
      `);
      assert.deepEqual(value,{waiting:true,retained:'priority fixture',first:'priority fixture'});
    });
    await check('switching sessions during send never sends to the new session', async()=>{
      const other=await api('/api/sessions','POST',{agent:'builtin'});
      const result=await delay('/api/sessions/'+session.id,'PATCH',`await openSession(${JSON.stringify(session.id)});document.getElementById('inpText').value='keep this input';const originalSend=wsSend;let chats=0;wsSend=message=>{if(message.type==='chat')chats++;return true;};try{const pending=sendCurrent();await openSession(${JSON.stringify(other.id)});await pending;return {chats,current:S.curSessionId,text:document.getElementById('inpText').value,pending:S.sendPending.has(${JSON.stringify(session.id)})};}finally{wsSend=originalSend;}`);
      assert.deepEqual(result,{chats:0,current:other.id,text:'keep this input',pending:false});
    });
    await check('concurrent MCP toggles preserve both changes', async()=>{
      await api('/api/settings','PUT',{mcpTools:true,mcpDisabledTools:[]});
      await uiTask('await refreshData();await showSettings("settings-preferences");await refreshMcpToolGrid();');
      const names=await delay('/api/settings','PUT',`const inputs=[...document.querySelectorAll('[data-mcp-tool]')].slice(0,2);if(inputs.length!==2)throw Error('MCP fixture missing');for(const input of inputs){input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}await settingsWriteQueue;return inputs.map(i=>i.dataset.mcpTool);`);
      assert.deepEqual((await api('/api/settings')).mcpDisabledTools.slice().sort(),names.sort());
    });
    await check('unreadable MCP configuration is shown as an error rather than an empty setup', async()=>{
      await uiTask('await showSettings("settings-mcp-servers");');
      const state = await uiTask(`const original=window.fetch;window.fetch=(...args)=>String(args[0]).startsWith('/api/mcp/servers')?Promise.resolve(new Response(JSON.stringify({servers:[],loadError:'fixture <script> corrupted credentials'}),{headers:{'content-type':'application/json'}})):original(...args);try{await refreshMcpServers();const list=document.getElementById('mcpServerList');return {alert:!!list.querySelector('[role=alert]'),empty:list.textContent.includes('还没有第三方 MCP'),escaped:list.querySelectorAll('script').length,text:list.textContent};}finally{window.fetch=original;}`);
      assert.equal(state.alert, true); assert.equal(state.empty, false); assert.equal(state.escaped, 0); assert.match(state.text, /原文件已保留/);
    });
    await check('SSH form shows the chosen authentication fields and preserves input', async()=>{
      const modes=await ev(`(async()=>{await showSSH();const select=document.getElementById('shAuth');document.getElementById('shPass').value='fixture-password';const visible=()=>[...document.querySelectorAll('[data-ssh-auth]')].filter(e=>!e.classList.contains('hidden')).map(e=>e.dataset.sshAuth);const values={password:visible()};for(const mode of ['key','agent','password']){select.value=mode;select.dispatchEvent(new Event('change'));values[mode]=visible();}values.retained=document.getElementById('shPass').value;return values;})()`);
      assert.deepEqual(modes,{password:['password'],key:['key','key'],agent:['agent'],retained:'fixture-password'});
    });
    await check('Agent cards and the sidebar choose an Agent and enter an unsent conversation',async()=>{
      const before=(await api('/api/sessions')).length;
      const view=await uiTask(`closeDlg();await AgentHubAgentCenter.open();const button=document.querySelector('.ac-agent-card [data-ac-start]');if(!button)throw Error('conversation button missing');button.click();let end=Date.now()+5000;while(!document.getElementById('agentCenterPage').hidden&&Date.now()<end)await new Promise(r=>setTimeout(r,20));return {closed:document.getElementById('agentCenterPage').hidden,session:S.curSessionId,agent:S.curAgent};`);
      assert.equal(view.closed,true);assert.equal(view.session,null);assert(view.agent);
      await api('/api/agent-center/preferences','PATCH',{agent:'gemini',preferences:{hidden:true}});
      await uiTask('await refreshData();renderAgents();');
      assert.equal(await ev(`!!document.querySelector('[data-agent-choice="gemini"]')`),false,'hidden Agents remain in management instead of the conversation selector');
      const choice=await uiTask(`S.agentSelectMode='single';renderAgents();document.getElementById('agentFilterDetails').open=true;const button=[...document.querySelectorAll('[data-agent-choice]')].find(b=>b.dataset.agentChoice!==S.curAgent),id=button.dataset.agentChoice;button.click();return {id,agent:S.curAgent,closed:!document.getElementById('agentFilterDetails').open,legacy:!!document.getElementById('agentMoreBtn'),inputs:document.querySelectorAll('#agentGrid input').length};`);
      assert.equal(choice.id,choice.agent);assert.equal(choice.closed,true);assert.equal(choice.legacy,false);assert.equal(choice.inputs,0);
      assert.equal((await api('/api/sessions')).length,before,'choosing an Agent does not create an empty history record');
    });
    await check('multi-Agent filtering shows all selected icons without changing the active Agent',async()=>{
      const result=await uiTask(`closeDlg();closeFlyMenu();await switchAgent('claude');S.agentSelectMode='multiple';S.agentSelection=['claude','codex'];renderAgents();document.getElementById('agentFilterDetails').open=true;document.querySelector('[data-agent-choice="dsh"]').click();const label=document.getElementById('agentFilterLabel');return {open:document.getElementById('agentFilterDetails').open,agent:S.curAgent,text:label.textContent,icons:[...label.querySelectorAll('[data-identity-agent]')].map(e=>e.dataset.identityAgent)};`);
      assert.equal(result.open,true);assert.equal(result.agent,'claude');assert.equal(result.text,'3 个 Agent');assert.deepEqual(result.icons.sort(),['claude','codex','dsh']);
    });
    await check('new task chooses an Agent and keeps the project without copying another Agent settings',async()=>{
      const session=await api('/api/sessions','POST',{agent:'builtin',cwd:DATA,model:'previous-agent-model',effort:'max'});
      const count=(await api('/api/sessions')).length;
      const result=await uiTask(`document.getElementById('agentFilterDetails').open=false;await openSession(${JSON.stringify(session.id)});document.getElementById('btnNewTask').click();document.getElementById('btnNewTask').click();const menus=document.querySelectorAll('.new-task-chooser').length,hidden=!!document.querySelector('[data-task-agent="gemini"]');await document.querySelector('[data-task-agent="codex"]').onclick();return {menus,hidden,agent:S.curAgent,session:S.curSessionId,cwd:document.getElementById('inpCwd').value,model:document.getElementById('inpModel').value,closed:document.getElementById('overlay').classList.contains('hidden')};`);
      assert.equal(result.menus,1);assert.equal(result.hidden,false);assert.equal(result.agent,'codex');assert.equal(result.session,null);assert.equal(result.cwd,DATA);assert.notEqual(result.model,'previous-agent-model');assert.equal(result.closed,true);assert.equal((await api('/api/sessions')).length,count);
      const keyboard=await uiTask(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',altKey:true,bubbles:true,cancelable:true}));const result=!!document.querySelector('[data-task-agent="codex"]');closeDlg();return result;`);assert.equal(keyboard,true);
    });
    await check('new-task environment choices reject local-only Agents and keep directories scoped to the host',async()=>{
      const host=await api('/api/ssh/hosts','POST',{name:'Task environment fixture',host:'127.0.0.1',port:1,user:'fixture',authType:'agent'});
      const result=await uiTask(`await refreshData();openNewTaskAgentChooser({hostId:${JSON.stringify(host.id)},cwd:'/remote/project'});const remoteDisabled=document.querySelector('[data-task-agent="builtin"]').disabled,select=document.getElementById('taskEnvironment');select.value='';select.dispatchEvent(new Event('change'));const localEnabled=!document.querySelector('[data-task-agent="builtin"]').disabled;await document.querySelector('[data-task-agent="builtin"]').onclick();return {remoteDisabled,localEnabled,host:document.getElementById('selRemote').value,cwd:document.getElementById('inpCwd').value};`);
      assert.deepEqual(result,{remoteDisabled:true,localEnabled:true,host:'',cwd:''});
    });
    await check('native mode menus and Agent settings use ACP declarations without broadening approval',async()=>{
      const created=await api('/api/agent-center/custom','POST',{name:'Native modes fixture',bin:process.execPath,args:JSON.stringify(path.join(ROOT,'test/fixtures/acp-runtime.cjs'))+' --modern-modes',acp:true});
      const fixture=await api('/api/sessions','POST',{agent:created.agent.id,model:'model-b',permMode:'ask'});
      await uiTask(`window.AgentHubAgentCenter.close();closeDlg();await refreshData();await openSession(${JSON.stringify(fixture.id)});document.getElementById('pillPerm').click();`);
      await waitFor(()=>ev(`!!document.querySelector('#flyMenu .fly-item[data-permission="plan"]')`));
      const nativeMenu=await ev(`(()=>{const menu=document.getElementById('flyMenu');return {edit:!!menu.querySelector('[data-permission="edits"]'),blocked:menu.querySelector('[data-permission="yolo"]')?.getAttribute('aria-disabled'),labels:menu.textContent};})()`);
      assert.equal(nativeMenu.edit,false);assert.equal(nativeMenu.blocked,'true');assert(nativeMenu.labels.includes('OrbitCell 审批'));
      await uiTask(`document.querySelector('#flyMenu [data-permission="plan"]').click();`);
      await waitFor(async()=>{const s=await api('/api/sessions/'+fixture.id);return s.acpConfig?.['mode-choice']==='plan';});
      const saved=await api('/api/sessions/'+fixture.id);assert.equal(saved.autoPerms,false);assert.equal(saved.messages.length,0);
      assert.equal(await ev(`document.getElementById('permLabel').textContent`),'Plan');
      await uiTask(`await window.AgentHubAgentCenter.open({agent:${JSON.stringify(created.agent.id)},tab:'config'});`);
      await waitFor(()=>ev(`document.querySelectorAll('#acNativeMode option').length===4`));
      await uiTask(`const select=document.getElementById('acNativeMode');select.value='agent';select.dispatchEvent(new Event('change'));document.querySelector('#acConfigForm [type="submit"]').click();`);
      await waitFor(async()=>{const state=await api('/api/agent-center');return state.configurations.local?.[created.agent.id]?.acpConfig?.['mode-choice']==='agent';});
      await uiTask(`window.AgentHubAgentCenter.close();`);
    });
    await check('detected versions are visible without a manual probe and page preferences are isolated',async()=>{
      const cli=path.join(DATA,'version-fixture.cjs');
      fs.writeFileSync(cli,'#!/usr/bin/env node\nif(process.argv.includes("--version"))console.log("Fixture Agent 3.2.1");\n',{mode:0o755});
      await api('/api/agent-center/custom','POST',{name:'Version fixture',bin:cli,args:''});
      await uiTask(`closeDlg();await window.AgentHubAgentCenter.open();`);
      const versions=await ev(`[...document.querySelectorAll('.ac-agent-card')].filter(card=>/fixture|first|second/i.test(card.querySelector('h3').textContent)).map(card=>({version:card.querySelector('.ac-card-version')?.textContent,status:card.querySelector('.ac-inventory-state')?.textContent}))`);
      assert(versions.some(item=>/\d+\.\d+/.test(item.version)&&item.status.includes('CLI 已验证')),JSON.stringify(versions));
      const prefs=await uiTask(`const before=window.AgentHubConversationPreferences.read('claude');await window.AgentHubAgentCenter.open({agent:'builtin',tab:'appearance'});document.getElementById('ap-contentWidth').value='wide';document.querySelector('.ac-appearance-form').requestSubmit();const result={own:window.AgentHubConversationPreferences.read('builtin').contentWidth,other:window.AgentHubConversationPreferences.read('claude').contentWidth,before:before.contentWidth,font:window.AgentHubConversationPreferences.read('builtin').chatFontSize,globalFont:window.AgentHubConversationPreferences.read().chatFontSize};document.querySelector('[data-appearance-reset]').click();return result;`);
      assert.equal(prefs.own,'wide');assert.equal(prefs.other,prefs.before);assert.equal(prefs.font,prefs.globalFont);
    });
    await check('Agent import UI previews, imports selected records and imports all remaining without duplicates',async()=>{
      const source=path.join(DATA,'ui-import');fs.mkdirSync(source,{recursive:true});
      const files=[0,1,2].map(i=>path.join(source,'conversation-'+i+'.json'));
      for(const [i,file]of files.entries())fs.writeFileSync(file,JSON.stringify({id:'ui-conversation-'+i,messages:[{role:'user',content:'Import question '+i},{role:'assistant',content:'Import answer '+i}]}));
      const before=(await api('/api/sessions')).length;
      await uiTask(`await window.AgentHubAgentCenter.open({agent:'builtin',tab:'imports'});`);
      await waitFor(()=>ev(`document.getElementById('aiScan')&&!document.getElementById('aiScan').disabled`));
      await uiTask(`document.getElementById('aiDirectory').value=${JSON.stringify(source)};document.getElementById('aiScan').click();`);
      await waitFor(()=>ev(`document.querySelectorAll('[data-import-id]').length===3&&!document.getElementById('aiScan').disabled`));
      await uiTask(`document.querySelector('[data-import-id]').click();document.getElementById('aiCommit').click();`);
      await waitFor(async()=>(await api('/api/sessions')).length===before+1);
      await waitFor(()=>ev(`!document.getElementById('aiAll').disabled`));
      await uiTask(`document.getElementById('aiAll').click();`);
      await waitFor(async()=>(await api('/api/sessions')).length===before+3);
      await waitFor(()=>ev(`document.querySelectorAll('.agent-import-item.imported').length===3`));
      assert.equal(await ev(`document.getElementById('aiAll').disabled`),true);
      for(const file of files)assert(fs.readFileSync(file,'utf8').includes('Import question'));
      await uiTask(`window.AgentHubAgentCenter.close();`);
    });
    if (failures) throw Error(failures+' checks failed');
    console.log('[settings-ui] passed');
  } catch (e) { console.error(e.message); process.exitCode=1; }
  finally {
    try { await browser('close'); } catch {}
    if (server) { server.kill(); await sleep(500); }
    directoryServer?.closeAllConnections();directoryServer?.close();
    const target=path.resolve(DATA); assert.equal(path.dirname(target),path.resolve(os.tmpdir())); assert(path.basename(target).startsWith('ah-settings-ui-'));
    fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
})();
