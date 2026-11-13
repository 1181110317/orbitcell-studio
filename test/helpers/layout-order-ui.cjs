const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
module.exports = async function ({ api, ev, waitFor, browser, provider, other, quotaUrl, workspaceDir }) {
  const status = await api('/api/browser/status');
  const version = await (await fetch('http://127.0.0.1:' + status.port + '/json/version')).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl), pending = new Map();
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let serial = 0, sessionId; const errors = [];
  socket.on('message', bytes => {
    const message = JSON.parse(bytes); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
  });
  const call = (method, params = {}, page = true) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(page && sessionId ? { sessionId } : {}) }));
  });
  sessionId = (await call('Target.attachToTarget', { targetId: status.targetId, flatten: true }, false)).sessionId;
  await call('Runtime.enable');
  const draw = code => ev('(async()=>{' + code + '})()');
  const screenshot = async name => {
    if (process.env.ORBITCELL_UPDATE_PREVIEWS !== '1') return;
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
    const shot = await browser('screenshot'); fs.copyFileSync(shot.path, path.resolve(__dirname, '../../docs/assets/' + name + '.png'));
  };
  const drag = async (item, target, cancel = false) => {
    await ev(`Promise.all(document.getElementById('dlg').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))).then(()=>true)`);
    const points = await ev(`(()=>{const el=document.querySelector(${JSON.stringify(item)}),to=document.querySelector(${JSON.stringify(target)});el.scrollIntoView({block:'nearest',behavior:'instant'});const a=el.querySelector(':scope>.layout-drag-handle').getBoundingClientRect(),b=to.getBoundingClientRect();window.__dragEvents=[];for(const t of ['pointerdown','pointermove','pointerup'])el.parentElement.addEventListener(t,e=>{__dragEvents.push({type:t,target:e.target.className,x:e.clientX,y:e.clientY});if(__dragEvents.length>30)__dragEvents.shift();},{capture:true});return {a:{x:a.left+a.width/2,y:a.top+a.height/2},b:{x:b.left+b.width/2,y:b.top+b.height/2}}})()`);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.a });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.a, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.a.x + (points.b.x - points.a.x) * step / 8, y: points.a.y + (points.b.y - points.a.y) * step / 8, button: 'left', buttons: 1 });
    if (cancel) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.b, button: 'left', buttons: 0, clickCount: 1 });
  };
  const taskOrder = () => ev(`Array.from(document.querySelectorAll('.new-task-agents>[data-layout-key]')).map(el=>el.dataset.layoutKey)`);
  try {
    assert.deepEqual(await ev(`OrbitCellLayout.merge(['a','b','c','d'],['d','b'])`), ['a','d','c','b'], 'filtered sorting preserves hidden slots');
    const host = await api('/api/ssh/hosts', 'POST', { name: '排序测试环境', host: '127.0.0.1', port: 1, user: 'fixture' });
    await draw(`closeDlg();window.AgentHubManagement.close();window.AgentHubAgentCenter.close();await refreshData();document.getElementById('inpText').value='排序保留的草稿';openNewTaskAgentChooser({hostId:${JSON.stringify(host.id)},cwd:'/fixture'});return true;`);
    const before = await ev(`({agent:S.curAgent,session:S.curSessionId,selection:JSON.stringify(S.agentSelection),draft:document.getElementById('inpText').value})`);
    assert(await ev(`!!document.querySelector('[data-task-agent=builtin]:disabled')`));
    assert(await ev(`Array.from(document.querySelectorAll('.new-task-agents>.layout-sort-item')).every(el=>!el.querySelector('.layout-drag-handle')||getComputedStyle(el.querySelector('.new-task-agent>svg')).opacity==='0')`), 'drag handles replace arrows rather than overlap them');
    const first = (await taskOrder())[0];
    await drag('.new-task-agents>[data-layout-key=builtin]', '.new-task-agents>[data-layout-key=' + first + ']');
    await waitFor(async () => (await taskOrder())[0] === 'builtin' && (await api('/api/agent-center')).preferences.builtin?.order === 0, 'drag persists Agent order');
    assert.deepEqual(await ev(`({agent:S.curAgent,session:S.curSessionId,selection:JSON.stringify(S.agentSelection),draft:document.getElementById('inpText').value})`), before);
    assert(await ev(`!!document.querySelector('[data-task-agent=builtin]:disabled')`), 'reordering an unsupported Agent cannot enable it');
    assert.equal((await api('/api/running')).sessions.length, 0, 'dragging does not start a turn');
    const order = await taskOrder();
    await drag('.new-task-agents>[data-layout-key=builtin]', '.new-task-agents>[data-layout-key=' + order[1] + ']', true);
    assert.deepEqual(await taskOrder(), order, 'Escape restores the order without saving');
    await draw(`window.__beforeSortApi=api;api=(url,...args)=>url==='/api/agent-center/order'?Promise.reject(Error('fixture-sort-failure')):__beforeSortApi(url,...args);const h=document.querySelector('.new-task-agents>.layout-sort-item>.layout-drag-handle');h.focus();h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));return true;`);
    await waitFor(() => ev(`!!document.querySelector('[data-layout-announcement]')?.textContent.includes('恢复')`), 'failed order rolls back');
    assert.deepEqual(await taskOrder(), order); await ev('api=__beforeSortApi;delete window.__beforeSortApi;true');
    await ev(`document.querySelector('.new-task-agents>.layout-sort-item>.layout-drag-handle').focus();true`);
    for (const [key, code] of [['ArrowRight', 39], ['ArrowLeft', 37]]) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, modifiers: 1, windowsVirtualKeyCode: code });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, modifiers: 1, windowsVirtualKeyCode: code });
      await waitFor(() => ev(`document.querySelector('.new-task-agents').getAttribute('aria-busy')!=='true'`), 'keyboard reorder save');
    }
    assert.deepEqual(await taskOrder(), order, 'keyboard reorder keeps focus and restores the original order');
    await call('Page.reload'); await waitFor(() => ev(`typeof S!=='undefined'&&S.wsReady&&S.agents.length>0`), 'reload after ordering');
    await draw(`openNewTaskAgentChooser({hostId:'',cwd:''});return true;`); assert.equal((await taskOrder())[0], 'builtin');
    await draw(`closeDlg();await window.AgentHubAgentCenter.open();document.querySelector('.ac-overview-link').click();return true;`);
    assert.equal(await ev(`document.querySelector('.ac-inventory>.ac-agent-card').dataset.acAgent`), 'builtin');
    await draw(`window.AgentHubAgentCenter.close();await window.AgentHubModelCenter.open('connections');return true;`);
    const providerBefore = (await api('/api/providers?agent=all')).find(p => p.id === provider.id);
    const oldProviders = await ev(`Array.from(document.querySelectorAll('#mcConnections>.provider-card')).map(el=>el.dataset.providerId)`);
    const source = oldProviders.at(-1), target = oldProviders[0];
    await drag('#mcConnections>[data-provider-id=' + JSON.stringify(source) + ']', '#mcConnections>[data-provider-id=' + JSON.stringify(target) + ']');
    await waitFor(() => ev(`document.querySelector('#mcConnections>.provider-card').dataset.providerId===${JSON.stringify(source)}`), 'provider drag order');
    const savedProviderOrder = await ev(`JSON.parse(localStorage.getItem('orbitcell.layout-order.v1')).providers`);
    assert.equal(savedProviderOrder[0], source);
    await draw(`document.querySelector('[data-manage-close]').click();await window.AgentHubModelCenter.open('connections');return true;`);
    assert.equal(await ev(`document.querySelector('#mcConnections>.provider-card').dataset.providerId`), source);
    const amounts = (await api('/api/providers?agent=all')).find(p => p.id === provider.id);
    for (const field of ['name','baseUrl','apiKey','model','quotaApi']) assert.deepEqual(amounts[field], providerBefore[field], 'sorting preserves provider ' + field);
    console.log('  PASS real pointer drag: disabled Agent stays disabled, no selection/draft/task changes; failed save rolls back; Agent order survives reload and all entry points; provider order persists');
    const projects = [];
    for (const name of ['Alpha', 'Beta']) {
      const cwd = path.join(workspaceDir, 'layout-project-' + name); fs.mkdirSync(cwd);
      projects.push(await api('/api/projects', 'POST', { name, cwd }));
    }
    await draw(`window.AgentHubManagement.close();await window.AgentHubProjectCenter.open();return true;`);
    const projectBefore = await ev(`Array.from(document.querySelectorAll('#pcCards>[data-layout-key]')).map(el=>el.dataset.layoutKey)`);
    await drag('#pcCards>[data-layout-key=' + JSON.stringify(projectBefore[1]) + ']', '#pcCards>[data-layout-key=' + JSON.stringify(projectBefore[0]) + ']');
    await waitFor(() => ev(`document.querySelector('#pcCards>[data-layout-key]').dataset.layoutKey===${JSON.stringify(projectBefore[1])}`), 'project order saved');
    for (const project of projects) {
      const actual = (await api('/api/projects')).projects.find(p => p.id === project.id);
      assert.equal(actual.name, project.name); assert.equal(actual.cwd, project.cwd);
    }
    await draw(`window.AgentHubManagement.close();await window.AgentHubProjectCenter.open();return true;`);
    assert.equal(await ev(`document.querySelector('#pcCards>[data-layout-key]').dataset.layoutKey`), projectBefore[1]);
    await draw(`window.AgentHubManagement.close();window.AgentHubFeatures.show();const h=document.querySelector('.feature-grid .layout-drag-handle');h.focus();h.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));return true;`);
    const toolFirst = await ev(`document.querySelector('.feature-grid>.layout-sort-item').dataset.layoutKey`);
    await draw(`closeDlg();window.AgentHubFeatures.show();return true;`);
    assert.equal(await ev(`document.querySelector('.feature-grid>.layout-sort-item').dataset.layoutKey`), toolFirst);
    console.log('  PASS project pointer sorting and toolbox keyboard sorting survive reopening without editing project metadata or launching tools');

    // Isolated example accounts: no model request and no real account data.
    const quota = { type: 'json', url: quotaUrl, auth: 'none', metrics: [
      { label: '5 小时', kind: 'window', basis: 'usedPercent', valuePath: 'data.five', windowSeconds: 18000 },
      { label: '每周', kind: 'window', basis: 'remainingPercent', valuePath: 'data.week', windowSeconds: 604800 },
      { label: '每月', kind: 'window', basis: 'used', valuePath: 'data.month.used', limitPath: 'data.month.limit', windowSeconds: 2592000, unit: '次' },
    ] };
    await api('/api/providers/' + other.id, 'PUT', { name: 'MiniMax · 演示套餐', quotaApi: quota });
    await api('/api/providers', 'POST', { name: 'DeepSeek · 演示余额', baseUrl: 'https://api.deepseek.com', scope: 'shared', models: ['fixture-model'], quotaApi: { type: 'json', url: quotaUrl, auth: 'none', metrics: [{ label: '余额', kind: 'balance', valuePath: 'data.balance', unit: 'CNY' }] } });
    await draw(`closeDlg();window.AgentHubManagement.close();await refreshData();await window.AgentHubModelCenter.open('connections');return true;`);
    await waitFor(() => ev(`document.querySelectorAll('#mcConnections .pq-mini-window').length===6`), 'all three periods in provider cards');
    const windows = await ev(`(()=>{const el=document.querySelector('[data-provider-id=${JSON.stringify(other.id)}]');return {labels:[...el.querySelectorAll('.pq-mini-window small')].map(n=>n.textContent),meters:[...el.querySelectorAll('[role=meter]')].map(n=>+n.getAttribute('aria-valuenow')),parts:[...el.children].filter(n=>!n.matches('.layout-drag-handle')).map(n=>n.className),footer:el.querySelector('footer,.provider-card-footer').getBoundingClientRect().top,quota:el.querySelector('.pq-glance').getBoundingClientRect().bottom};})()`);
    assert.deepEqual(windows.labels, ['5 小时', '每周', '每月']); assert.deepEqual(windows.meters, [62, 65, 75]); assert(windows.quota <= windows.footer + 1, JSON.stringify(windows));
    await screenshot('orbitcell-quota-cards');
    for (const width of [1280, 900, 390, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const boxes = await ev(`(()=>{const cards=[...document.querySelectorAll('#mcConnections>.provider-card')],rows=[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top)))];return {root:document.documentElement.scrollWidth<=innerWidth+1,cards:cards.every(c=>c.scrollWidth<=c.clientWidth+1),windows:cards.flatMap(c=>[...c.querySelectorAll('.pq-mini-window')]).every(w=>w.scrollWidth<=w.clientWidth+1),periods:rows.every(top=>{const same=cards.filter(c=>Math.round(c.getBoundingClientRect().top)===top).map(c=>c.querySelector('.pq-card-periods')).filter(Boolean);return same.length<2||Math.max(...same.map(c=>c.getBoundingClientRect().top))-Math.min(...same.map(c=>c.getBoundingClientRect().top))<2}),footer:rows.every(top=>{const same=cards.filter(c=>Math.round(c.getBoundingClientRect().top)===top);return Math.max(...same.map(c=>c.querySelector('.provider-card-footer').getBoundingClientRect().top))-Math.min(...same.map(c=>c.querySelector('.provider-card-footer').getBoundingClientRect().top))<2})};})()`);
      assert.deepEqual(boxes, { root: true, cards: true, windows: true, periods: true, footer: true }, width + ': ' + JSON.stringify(boxes));
    }
    await call('Emulation.clearDeviceMetricsOverride');
    await draw(`document.querySelector('[data-provider-id=${JSON.stringify(other.id)}] [data-provider-open]').click();return true;`);
    await waitFor(() => ev(`document.querySelectorAll('#mcProviderQuota .pq-window').length===3`), 'three period account details'); await screenshot('orbitcell-quota-detail');
    const session = await api('/api/sessions', 'POST', { agent: 'builtin', providerId: other.id, model: 'fixture-model', title: '额度演示 · 5 小时 / 每周 / 每月' });
    await draw(`window.AgentHubManagement.close();await refreshData();await openSession(${JSON.stringify(session.id)});return true;`);
    await waitFor(() => ev(`['5 小时','每周','每月'].every(s=>document.getElementById('quotaChip')?.textContent.includes(s))`), 'all periods in conversation header');
    const brand = await ev(`(()=>{const box=document.querySelector('.brand-logo'),s=getComputedStyle(box),img=box.querySelector('img');return {transparent:s.backgroundColor==='rgba(0, 0, 0, 0)',border:parseFloat(s.borderTopWidth),shadow:s.boxShadow,full:Math.abs(img.getBoundingClientRect().width-box.getBoundingClientRect().width)<1}})()`);
    assert.deepEqual(brand, { transparent: true, border: 0, shadow: 'none', full: true }); await screenshot('orbitcell-quota-chat');
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    assert(await ev(`(()=>{const el=document.getElementById('quotaChip'),s=getComputedStyle(el);return el.getBoundingClientRect().height>0&&el.scrollWidth<=el.clientWidth+1&&el.querySelectorAll('.pq-glance-button>span').length===3&&s.display!=='none'&&document.documentElement.scrollWidth<=innerWidth+1})()`), 'all three periods remain available on mobile');
    await call('Emulation.clearDeviceMetricsOverride');
    console.log('  PASS transparent full-size brand, aligned quota card/footer at 4 sizes, 5h/week/month visible together in cards/details/conversation/mobile; captured isolated examples');
  } catch (error) {
    console.error('layout-order diagnostic', await ev(`({events:window.__dragEvents,ghosts:document.querySelectorAll('.layout-drag-preview').length,order:[...document.querySelectorAll('.new-task-agents>[data-layout-key]')].map(e=>e.dataset.layoutKey),notice:document.querySelector('[data-layout-announcement]')?.textContent,title:document.getElementById('dlgTitle').textContent})`), errors);
    const shot = await browser('screenshot'); fs.copyFileSync(shot.path, path.join(require('node:os').tmpdir(), 'orbitcell-drag-failure.png'));
    throw error;
  } finally {
    try { await ev('if(window.__beforeSortApi){api=__beforeSortApi;delete window.__beforeSortApi;}true'); } catch {}
    socket.close();
  }
};
