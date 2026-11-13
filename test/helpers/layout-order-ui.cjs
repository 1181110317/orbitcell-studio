const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
module.exports = async function ({ api, ev, waitFor, browser, provider, other, quotaUrl, workspaceDir }) {
  const status = await api('/api/browser/status'), version = await (await fetch('http://127.0.0.1:' + status.port + '/json/version')).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl), pending = new Map(), errors = [];
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let serial = 0, sessionId;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer);
    message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
  });
  const call = (method, params = {}, page = true) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(page && sessionId ? { sessionId } : {}) }));
  });
  sessionId = (await call('Target.attachToTarget', { targetId: status.targetId, flatten: true }, false)).sessionId; await call('Runtime.enable');
  const draw = code => ev('(async()=>{' + code + '})()');
  const screenshot = async name => {
    if (process.env.ORBITCELL_UPDATE_PREVIEWS !== '1') return;
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    const viewport=await ev('({width:innerWidth,height:innerHeight})');
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,...viewport,scale:1}});
    const bytes=Buffer.from(shot.data,'base64');assert.equal(bytes.readUInt32BE(16),viewport.width);assert.equal(bytes.readUInt32BE(20),viewport.height);
    fs.writeFileSync(path.resolve(__dirname, '../../docs/assets/' + name + '.png'),bytes);
  };
  const click = selector => ev(`document.querySelector(${JSON.stringify(selector)}).click();true`);
  const setPosition = (id, value) => ev(`(()=>{const row=[...document.querySelectorAll('#layoutOrderList [data-order-id]')].find(e=>e.dataset.orderId===${JSON.stringify(id)}),input=row.querySelector('[data-order-position]');input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const taskOrder = () => ev(`Array.from(document.querySelectorAll('.new-task-agents>[data-task-agent]')).map(el=>el.dataset.taskAgent)`);
  const providerOrder = () => ev(`Array.from(document.querySelectorAll('#mcConnections>.provider-card')).map(el=>el.dataset.providerId)`);
  const noDrag = () => ev(`!document.querySelector('.layout-sort-wrap,.layout-drag-handle,.layout-drag-preview')`);
  try {
    assert.deepEqual(await ev(`OrbitCellLayout.merge(['a','b','c','d'],['d','b'])`), ['a','d','c','b']);
    const host = await api('/api/ssh/hosts', 'POST', { name: '顺序测试环境', host: '127.0.0.1', port: 1, user: 'fixture' });
    await draw(`closeDlg();window.AgentHubManagement.close();window.AgentHubAgentCenter.close();await refreshData();document.getElementById('inpText').value='排序保留的草稿';openNewTaskAgentChooser({hostId:${JSON.stringify(host.id)},cwd:'/fixture'});return true;`);
    assert(await noDrag()); assert(await ev(`!!document.querySelector('[data-task-agent=builtin]:disabled')`));
    const before = await ev(`({agent:S.curAgent,session:S.curSessionId,selection:JSON.stringify(S.agentSelection),draft:document.getElementById('inpText').value})`), original = await taskOrder();
    await click('[data-task-order]'); await setPosition('builtin', 1);
    assert.deepEqual(await ev(`[...document.querySelectorAll('#layoutOrderList [data-order-id]')].slice(0,1).map(el=>el.dataset.orderId)`), ['builtin']);
    assert.notEqual((await api('/api/agent-center')).preferences.builtin?.order, 0, 'draft changes are not saved');
    await click('#layoutOrderReset'); assert(await ev(`document.getElementById('layoutOrderSave').disabled`));
    await setPosition('builtin',2);await click('[data-order-id=builtin] [data-order-up]');assert.equal(await ev(`document.querySelector('[data-order-id=builtin] [data-order-position]').value`),'1');
    await click('[data-order-id=builtin] [data-order-down]');assert.equal(await ev(`document.querySelector('[data-order-id=builtin] [data-order-position]').value`),'2');
    await setPosition('builtin', 1); await click('#layoutOrderCancel'); assert.deepEqual(await taskOrder(), original);
    await click('[data-task-order]'); await setPosition('builtin', 1); await click('#layoutOrderSave');
    await waitFor(async () => !await ev(`!!document.getElementById('layoutOrderEditor')`) && (await taskOrder())[0] === 'builtin', 'Agent order applied after save');
    assert.equal((await api('/api/agent-center')).preferences.builtin.order, 0);
    assert.deepEqual(await ev(`({agent:S.curAgent,session:S.curSessionId,selection:JSON.stringify(S.agentSelection),draft:document.getElementById('inpText').value})`), before);
    assert(await ev(`!!document.querySelector('[data-task-agent=builtin]:disabled')`)); assert.equal((await api('/api/running')).sessions.length, 0);
    await click('[data-task-order]'); await setPosition('builtin', 2);
    await ev(`window.__beforeSortApi=api;api=(url,...args)=>url==='/api/agent-center/order'?Promise.reject(Error('fixture-order-failure')):__beforeSortApi(url,...args);true`);
    await click('#layoutOrderSave'); await waitFor(() => ev(`document.getElementById('layoutOrderError')?.textContent.includes('fixture-order-failure')`), 'failed save preserves the editor');
    assert.equal(await ev(`document.querySelector('[data-order-id=builtin] [data-order-position]').value`), '2');
    assert.equal((await api('/api/agent-center')).preferences.builtin.order, 0);
    await ev('api=__beforeSortApi;delete window.__beforeSortApi;true'); await click('#layoutOrderCancel'); assert.equal((await taskOrder())[0], 'builtin');
    await click('[data-task-order]');await setPosition('builtin',2);
    await ev(`window.__beforeSortApi=api;api=(url,...args)=>url==='/api/agent-center/order'?new Promise((resolve,reject)=>{window.__finishSort=()=>__beforeSortApi(url,...args).then(resolve,reject);}):__beforeSortApi(url,...args);true`);
    await click('#layoutOrderSave');await draw(`openDlg('后打开的页面','<input id="laterOrderDialog" value="保留此页面">');__finishSort();return true;`);
    await waitFor(async()=> (await api('/api/agent-center')).preferences.builtin.order===1,'delayed order save');
    assert(await ev(`document.getElementById('dlgTitle').textContent==='后打开的页面'&&document.getElementById('laterOrderDialog').value==='保留此页面'`));
    await click('#dlgClose');await waitFor(()=>ev(`!!document.getElementById('layoutOrderEditor')&&document.getElementById('layoutOrderSave').disabled`),'saved editor restored');
    assert(await ev(`document.getElementById('layoutOrderSave').disabled&&!document.getElementById('layoutOrderSearch').disabled`));
    await ev('api=__beforeSortApi;delete window.__beforeSortApi;delete window.__finishSort;true');await click('#layoutOrderCancel');assert.notEqual((await taskOrder())[0],'builtin');
    await click('[data-task-order]');await setPosition('builtin',1);await click('#layoutOrderSave');await waitFor(async()=> (await taskOrder())[0]==='builtin','restore chosen Agent order');
    await call('Page.reload'); await waitFor(() => ev(`typeof S!=='undefined'&&S.wsReady&&S.agents.length>0`), 'reload after ordering');
    await draw(`openNewTaskAgentChooser({hostId:'',cwd:''});return true;`); assert.equal((await taskOrder())[0], 'builtin'); assert(await noDrag());
    await draw(`closeDlg();await window.AgentHubAgentCenter.open();document.querySelector('.ac-overview-link').click();return true;`);
    assert.equal(await ev(`document.querySelector('.ac-inventory>.ac-agent-card').dataset.acAgent`), 'builtin');
    console.log('  PASS separate Agent order editor: draft/cancel/reset, explicit save, failure retention, reload and shared entry points; native cards, disabled states and composer remain intact');

    await draw(`window.AgentHubAgentCenter.close();await window.AgentHubModelCenter.open('connections');return true;`);
    const providerBefore = (await api('/api/providers?agent=all')).find(p => p.id === provider.id), oldProviders = await providerOrder(), source = oldProviders.at(-1);
    await click('#mcProviderOrder'); await setPosition(source, 1); await click('#layoutOrderCancel'); assert.deepEqual(await providerOrder(), oldProviders);
    await click('#mcProviderOrder'); await setPosition(source, 1); await click('#layoutOrderSave'); await waitFor(async () => (await providerOrder())[0] === source, 'provider order save');
    await draw(`window.AgentHubManagement.close();await window.AgentHubModelCenter.open('connections');return true;`); assert.equal((await providerOrder())[0], source);
    const after = (await api('/api/providers?agent=all')).find(p => p.id === provider.id);
    for (const field of ['name','baseUrl','apiKey','model','quotaApi']) assert.deepEqual(after[field], providerBefore[field]);
    const pagedModels=['fixture-model',...Array.from({length:90},(_,i)=>'fixture-page-'+String(i).padStart(3,'0'))];
    await api('/api/providers/'+provider.id,'PUT',{models:pagedModels,enabledModels:pagedModels});
    await draw(`window.AgentHubManagement.close();await window.AgentHubModelCenter.open('models');return true;`);
    const modelRows=await ev(`Array.from(document.querySelectorAll('#mcModelList>.managed-model-row [data-mc-model-edit]')).map(el=>el.dataset.mcModelEdit)`);
    await click('#mcModelOrder');const modelIds=await ev(`Array.from(document.querySelectorAll('#layoutOrderList>[data-order-id]')).map(el=>el.dataset.orderId)`);
    await setPosition(modelIds.at(-1),1);await click('#layoutOrderSave');
    await waitFor(()=>ev(`document.querySelector('#mcModelList>.managed-model-row [data-mc-model-edit]')?.dataset.mcModelEdit===${JSON.stringify(modelRows.at(-1))}`),'model list position');
    await click('#mcModelOrder');
    await ev(`(()=>{const input=document.getElementById('layoutOrderSearch');input.value='fixture-page-089';input.dispatchEvent(new Event('input'));return true})()`);
    await setPosition(JSON.stringify([provider.id,'fixture-page-089']),1);await click('#layoutOrderSave');
    await waitFor(()=>ev(`document.querySelector('#mcModelList>.managed-model-row')?.dataset.catalogModel==='fixture-page-089'`),'model beyond the first page moves to the first position');
    const projects = [];
    for (const name of ['Alpha', 'Beta',...Array.from({length:40},(_,i)=>'Page-'+i)]) { const cwd = path.join(workspaceDir, 'order-project-' + name); fs.mkdirSync(cwd); projects.push(await api('/api/projects', 'POST', { name, cwd })); }
    await draw(`window.AgentHubManagement.close();await window.AgentHubProjectCenter.open();return true;`);
    await click('#pcOrder'); await setPosition(projects.at(-1).id, 1); await click('#layoutOrderSave');
    await waitFor(() => ev(`document.querySelector('#pcCards>[data-pc-project]')?.dataset.pcProject===${JSON.stringify(projects.at(-1).id)}`), 'project beyond the first page moves to the first position');
    const savedProjects=(await api('/api/projects')).projects;
    for (const project of projects) { const actual = savedProjects.find(p => p.id === project.id); assert.equal(actual.name, project.name); assert.equal(actual.cwd, project.cwd); }
    await draw(`window.AgentHubManagement.close();window.AgentHubFeatures.show();return true;`);
    const firstTool = await ev(`document.querySelector('.feature-grid>[data-feature]').dataset.feature`);
    await click('#featureOrder'); await setPosition(firstTool, 2); await click('#layoutOrderSave');
    await waitFor(() => ev(`!!document.getElementById('featureOrder')`), 'toolbox restored after order save');
    const toolFirst = await ev(`document.querySelector('.feature-grid>[data-feature]').dataset.feature`); assert.notEqual(toolFirst, firstTool);
    await draw(`closeDlg();window.AgentHubFeatures.show();return true;`); assert.equal(await ev(`document.querySelector('.feature-grid>[data-feature]').dataset.feature`), toolFirst); assert(await noDrag());
    await ev(`(()=>{const input=document.getElementById('featureSearch');input.value='不匹配的工具名称';input.dispatchEvent(new Event('input'));return true})()`);
    assert.equal(await ev(`document.querySelectorAll('.feature-section:not([hidden])').length`),0,'search hides empty tool categories');
    await ev(`(()=>{const input=document.getElementById('featureSearch');input.value='';input.dispatchEvent(new Event('input'));return true})()`);
    assert.equal(await ev(`document.querySelector('.feature-grid>[data-feature]').dataset.feature`),toolFirst,'search preserves the saved order');
    console.log('  PASS provider/project/tool order persists through explicit editors without modifying metadata or launching tools');

    const quota = { type:'json',url:quotaUrl,auth:'none',metrics:[
      {label:'5 小时',kind:'window',basis:'usedPercent',valuePath:'data.five',windowSeconds:18000},
      {label:'每周',kind:'window',basis:'remainingPercent',valuePath:'data.week',windowSeconds:604800},
      {label:'每月',kind:'window',basis:'used',valuePath:'data.month.used',limitPath:'data.month.limit',windowSeconds:2592000,unit:'次'},
    ]};
    await api('/api/providers/'+other.id,'PUT',{name:'MiniMax · 演示套餐',quotaApi:quota});
    await api('/api/providers','POST',{name:'DeepSeek · 演示余额',baseUrl:'https://api.deepseek.com',scope:'shared',models:['fixture-model'],quotaApi:{type:'json',url:quotaUrl,auth:'none',metrics:[{label:'余额',kind:'balance',valuePath:'data.balance',unit:'CNY'}]}});
    for (let i=0;i<6;i++) await api('/api/providers','POST',{name:'用于检查完整长名称与操作按钮的供应商 '+(i+1),baseUrl:'https://gateway-'+i+'.example.invalid/'+('workspace-with-a-very-long-api-route/').repeat(7),scope:'shared',models:['fixture-model'],quotaApi:{type:'json',url:quotaUrl,auth:'none',metrics:[{label:'余额',kind:'balance',valuePath:'data.balance',unit:'CNY'}]}});
    await draw(`closeDlg();window.AgentHubManagement.close();await refreshData();await window.AgentHubModelCenter.open('connections');return true;`);
    await waitFor(() => ev(`document.querySelectorAll('#mcConnections .pq-mini-window').length===6&&[...document.querySelectorAll('[data-provider-quota]')].every(el=>!el.textContent.includes('读取中'))`), 'quota cards with long URLs');
    assert(await noDrag());
    for (const [width,height,zoom] of [[1920,1080,1],[1440,900,1],[1280,800,1],[900,900,1],[390,844,1],[320,800,1],[740,390,1],[1920,1080,1.25],[1440,900,.85]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); await ev(`storageSet('ah.zoom',${JSON.stringify(String(zoom))});applyZoom();true`);
      assert.deepEqual(await ev('({width:innerWidth,height:innerHeight})'),{width,height},'responsive assertions use the requested viewport');
      const layout = await ev(`(()=>{const cards=[...document.querySelectorAll('#mcConnections>.provider-card')],rows=[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top)))];return {root:document.documentElement.scrollWidth<=innerWidth+2,native:cards.length===9&&cards.every(c=>c.parentElement.id==='mcConnections'),contained:cards.every(c=>{const r=c.getBoundingClientRect();return [...c.querySelectorAll('.provider-card-main,.provider-card-main>svg,.provider-card-main code,.provider-card-footer,.provider-card-footer>button,.pq-glance-button,.pq-card-caption')].every(el=>{const b=el.getBoundingClientRect();return b.right<=r.right+1&&b.left>=r.left-1&&b.width<=r.width+1;})}),actions:cards.every(c=>{const b=c.querySelector('.provider-card-footer>button');return b.scrollWidth<=b.clientWidth+1}),footers:rows.every(top=>{const same=cards.filter(c=>Math.round(c.getBoundingClientRect().top)===top);return Math.max(...same.map(c=>c.querySelector('.provider-card-footer').getBoundingClientRect().top))-Math.min(...same.map(c=>c.querySelector('.provider-card-footer').getBoundingClientRect().top))<2})};})()`);
      assert.deepEqual(layout,{root:true,native:true,contained:true,actions:true,footers:true},JSON.stringify({width,height,zoom,layout}));
      await click('#mcProviderOrder');
      const popup=await ev(`(()=>{const el=document.getElementById('layoutOrderEditor'),r=el.getBoundingClientRect(),save=el.querySelector('#layoutOrderSave').getBoundingClientRect(),list=el.querySelector('.order-list');return {fits:r.left>=-1&&r.right<=innerWidth+1,save:save.bottom<=innerHeight&&save.top>=0,list:list.scrollWidth<=list.clientWidth+1,rows:[...list.querySelectorAll('.order-row')].every(row=>{const r=row.getBoundingClientRect();return [...row.children].every(el=>el.getBoundingClientRect().right<=r.right+1)})};})()`);
      assert.deepEqual(popup,{fits:true,save:true,list:true,rows:true},JSON.stringify({width,height,zoom,popup}));
      const focus=await ev(`(()=>{const input=document.getElementById('layoutOrderSearch');input.focus();return {inner:getComputedStyle(input).outlineStyle,outer:getComputedStyle(input.closest('.order-search')).outlineStyle};})()`);
      assert.deepEqual(focus,{inner:'none',outer:'solid'},'search has one visible focus indicator');await click('#layoutOrderCancel');
    }
    await ev(`storageSet('ah.zoom','1');applyZoom();true`);await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await screenshot('orbitcell-quota-cards');
    await click('#mcProviderOrder'); await screenshot('orbitcell-order-settings'); await click('#layoutOrderCancel');
    await draw(`document.querySelector('[data-provider-id=${JSON.stringify(other.id)}] [data-provider-open]').click();return true;`);
    await waitFor(() => ev(`document.querySelectorAll('#mcProviderQuota .pq-window').length===3`),'quota detail'); await screenshot('orbitcell-quota-detail');
    const session = await api('/api/sessions','POST',{agent:'builtin',providerId:other.id,model:'fixture-model',title:'额度演示 · 5 小时 / 每周 / 每月'});
    await draw(`window.AgentHubManagement.close();await refreshData();await openSession(${JSON.stringify(session.id)});return true;`);
    await waitFor(() => ev(`['5 小时','每周','每月'].every(s=>document.getElementById('quotaChip')?.textContent.includes(s))`),'all periods in conversation');
    const brand = await ev(`(()=>{const el=document.querySelector('.brand-logo'),s=getComputedStyle(el);return {transparent:s.backgroundColor==='rgba(0, 0, 0, 0)',border:parseFloat(s.borderTopWidth),shadow:s.boxShadow};})()`); assert.deepEqual(brand,{transparent:true,border:0,shadow:'none'}); await screenshot('orbitcell-quota-chat');
    assert.deepEqual(errors,[]);
    console.log('  PASS long provider names/URLs, contained arrows/details/model actions, native grids and aligned footers at 6 viewports and 2 zoom levels; no drag markup or runtime errors');
  } catch (reason) {
    console.error('order editor diagnostic',await ev(`({title:document.getElementById('dlgTitle').textContent,error:document.getElementById('layoutOrderError')?.textContent,editor:!!document.getElementById('layoutOrderEditor')})`),errors);
    const shot=await browser('screenshot');fs.copyFileSync(shot.path,path.join(require('node:os').tmpdir(),'orbitcell-order-failure.png'));throw reason;
  } finally {
    try { await ev('if(window.__beforeSortApi){api=__beforeSortApi;delete window.__beforeSortApi;}true'); } catch {}
    for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Browser test closed'));}socket.close();
  }
};
