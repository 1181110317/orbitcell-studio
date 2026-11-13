// Provider CRUD, model catalog cache, and billing through a local fake provider.
const assert = require('assert');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-providers-data-'));
const PORT = 17990;
const BASE = `http://127.0.0.1:${PORT}`;
let server, fake;
let failModels = false, sawAuth = false, emptyModels = false, htmlModels = false, modelRequests = 0, holdModel = false, releaseModel;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(route, method = 'GET', body) {
  const r = await fetch(BASE + route, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { code: r.status, data: await r.json() };
}

(async () => {
  try {
    const detached=path.join(DATA,'detached');fs.mkdirSync(detached);
    fs.writeFileSync(path.join(detached,'legacy-catalog.json'),JSON.stringify({pricing:{'preserved-model':{in:2,out:4}},rollups:[{date:new Date().toISOString().slice(0,10),agent:'codex',model:'preserved-model',requests:3,source:'ccswitch'}]}));
    const isolated=spawnSync(process.execPath,['-e',`const assert=require('assert'),fs=require('fs');const old=fs.readFileSync;fs.readFileSync=function(p,...args){if(String(p).includes('forbidden-legacy-db'))throw Error('unexpected legacy database access');return old.call(this,p,...args);};const cc=require(${JSON.stringify(path.join(ROOT,'lib','ccswitch.js'))});assert.equal(cc.enabled,false);assert.equal(cc.dbPath(),null);assert.deepEqual(cc.listProviders(),[]);assert.equal(cc.modelPricing()['preserved-model'].in,2);assert.equal(cc.usageRollups().length,1);`],{env:{...process.env,AGENTHUB_DATA_DIR:detached,AGENTHUB_CCSWITCH_DIR:path.join(detached,'forbidden-legacy-db'),AGENTHUB_LEGACY_CCSWITCH:'0'},encoding:'utf8'});
    assert.equal(isolated.status,0,isolated.stderr||isolated.stdout);
    fake = http.createServer((req, res) => {
      sawAuth ||= req.headers.authorization === 'Bearer audit-secret-key';
      res.setHeader('Content-Type', 'application/json');
      if(req.url==='/proxy/models')return res.end(JSON.stringify({models:[{model_id:'exact-base-model'}]}));
      if(req.url==='/custom/catalog?version=2')return res.end(JSON.stringify({data:{models:[{id:'custom-directory-model'}]}}));
      if(req.url==='/dict/models')return res.end(JSON.stringify({models:{'dictionary-model':{context_window:32000}}}));
      if (['/v1/models','/v2/models'].includes(req.url)) {
        modelRequests++;
        if (req.headers.authorization !== 'Bearer audit-secret-key' && req.headers['x-api-key'] !== 'audit-secret-key') {
          res.statusCode=401;return res.end('{"error":"unauthorized"}');
        }
        const finish=()=>res.end(htmlModels ? '<html>Sign in</html>' : JSON.stringify(failModels ? { error: 'offline' } : { data: emptyModels ? [] : [{ id: 'audit-model-a' }, { id: 'audit-model-b' }, {id:''}, {}, {id:'audit-model-a'}] }));
        if(holdModel){holdModel=false;releaseModel=finish;return;}
        return finish();
      }
      if (req.url === '/v1/dashboard/billing/subscription') return res.end(JSON.stringify({ hard_limit_usd: 20 }));
      if (req.url.startsWith('/v1/dashboard/billing/usage')) return res.end(JSON.stringify({ total_usage: 500 }));
      res.statusCode = 404; res.end('{}');
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    const providerBase = `http://127.0.0.1:${fake.address().port}`;
    fs.writeFileSync(path.join(DATA,'providers.json'),JSON.stringify({list:[],meta:{ccswitchImportDone:true}}));
    server = spawn(process.execPath, ['server.js'], {
      cwd: ROOT, windowsHide:true, env: { ...process.env, AGENTHUB_PORT: String(PORT), AGENTHUB_DATA_DIR: DATA,
        AGENTHUB_CCSWITCH_DIR:path.join(DATA,'cc'),CODEX_HOME:path.join(DATA,'codex'),CLAUDE_CONFIG_DIR:path.join(DATA,'claude'),AGENTHUB_ZCODE_DIR:path.join(DATA,'zcode') }, stdio: 'ignore',
    });
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      try { healthy = (await api('/api/health')).code === 200; if (healthy) break; } catch {}
      await sleep(250);
    }
    assert(healthy, 'OrbitCell did not start');
    const preview = await api('/api/providers/models/preview', 'POST', { agent: 'builtin', baseUrl: providerBase, apiKey: 'audit-secret-key', protocol: 'openai' });
    assert.equal(preview.code, 200);
    assert.deepEqual(preview.data.models, ['audit-model-a', 'audit-model-b']);
    const exactPreview=await api('/api/providers/models/preview','POST',{baseUrl:providerBase+'/proxy',apiKey:'audit-secret-key'});
    assert.deepEqual(exactPreview.data.models,['exact-base-model'],'custom base paths also try their direct /models directory');
    const customPreview=await api('/api/providers/models/preview','POST',{baseUrl:providerBase,modelsUrl:providerBase+'/custom/catalog?version=2',apiKey:'audit-secret-key'});
    assert.deepEqual(customPreview.data.models,['custom-directory-model'],'explicit catalogs retain their path and query');
    assert.deepEqual((await api('/api/providers/models/preview','POST',{baseUrl:providerBase,modelsUrl:providerBase+'/dict/models'})).data.models,['dictionary-model']);
    const created = await api('/api/providers', 'POST', { agent: 'builtin', name: 'Audit Provider', baseUrl: providerBase, apiKey: 'audit-secret-key', protocol: 'openai',modelPreviewId:preview.data.modelPreviewId });
    assert.equal(created.code, 200);
    assert(!JSON.stringify(created.data).includes('audit-secret-key'));
    const id = created.data.id;
    assert.deepEqual(created.data.models,preview.data.models,'a matching preview is retained when the connection is saved');
    assert.equal(created.data.modelSources.manual,0,'fetched catalogs are not silently converted to manual entries');
    const availability=await api('/api/model-center/connections/'+encodeURIComponent(id)+'/agents');
    assert(availability.data.agents.find(a=>a.id==='dsh')?.enabled,'shared-capable Agents are enabled without individual assignment');
    assert.equal((await api('/api/model-center/connections/'+encodeURIComponent(id)+'/agents','PUT',{agents:{claude:{enabled:false},codex:{protocol:'anthropic',baseUrl:providerBase+'/native'}}})).code,200);
    assert(!(await api('/api/providers?agent=claude')).data.some(p=>p.id===id),'explicit exclusions apply to the composer and API');
    const access=(await api('/api/settings')).data.modelAccess;
    const effective=require('../lib/model-access').effective({id,baseUrl:providerBase,protocol:'openai',apiKey:'audit-secret-key'},'codex',{modelAccess:access});
    assert.equal(effective.protocol,'anthropic');assert.equal(effective.baseUrl,providerBase+'/native');assert.equal(effective.apiKey,'audit-secret-key');
    assert.equal((await api('/api/model-center/connections/'+encodeURIComponent(id)+'/agents','PUT',{agents:{codex:{protocol:'invalid'}}})).code,400);
    await api('/api/model-center/connections/'+encodeURIComponent(id)+'/agents','PUT',{agents:{}});
    await api('/api/providers/'+encodeURIComponent(id),'PUT',{scope:'agent'});
    assert(!(await api('/api/providers?agent=claude')).data.some(p=>p.id===id),'a private Agent connection is not advertised to other executors');
    assert.equal((await api('/api/model-center/connections/'+encodeURIComponent(id)+'/agents')).data.agents.find(a=>a.id==='codex').supported,false);
    await api('/api/providers/'+encodeURIComponent(id),'PUT',{scope:'shared'});
    const savedPreview=await api('/api/providers/models/preview','POST',{id,apiKey:''});
    assert.equal(savedPreview.code,200,'edit preview must reuse the saved key');
    assert.deepEqual(savedPreview.data.models,preview.data.models);
    assert(!JSON.stringify(savedPreview.data).includes('audit-secret-key'));
    assert.equal((await api('/api/providers/models/preview','POST',{id,clearApiKey:true})).code,502,'explicit clear must not reuse the saved key');
    assert.equal((await api('/api/providers/models/preview','POST',{id:'missing'})).code,404);
    const endpointPreview=await api('/api/providers/models/preview','POST',{id,baseUrl:providerBase+'/v2/chat/completions'});
    assert.deepEqual(endpointPreview.data.models,preview.data.models,'full endpoints and version prefixes normalize to models');
    htmlModels=true;
    const htmlHealth=await api('/api/providers/'+encodeURIComponent(id)+'/health','POST',{mode:'models'});
    assert.equal(htmlHealth.data.ok,false,'an HTML login page is not a healthy model catalog');
    htmlModels=false;
    const listed = await api('/api/providers?agent=builtin');
    assert(listed.data.some(p => p.id === id && p.apiKey.includes('***')));
    for (const agent of ['claude', 'codex', 'zcode', 'builtin', 'chatgpt-web']) {
      const shared = await api('/api/providers?agent=' + agent);
      assert(shared.data.some(p => p.id === id && p.shared === true), 'shared provider missing for ' + agent);
    }
    const defaulted = await api('/api/model-defaults', 'PUT', { providerId: id, model: 'audit-model-a', effort: 'low' });
    assert.equal(defaulted.data.providerId, id);
    for (const agent of ['claude', 'codex', 'zcode', 'builtin']) {
      const session = await api('/api/sessions', 'POST', { agent });
      assert.equal(session.data.providerId, id, 'global provider not inherited by ' + agent);
      assert.equal(session.data.model, 'audit-model-a', 'global model not inherited by ' + agent);
      assert.equal(session.data.effort, 'low', 'global effort not inherited by ' + agent);
      assert.equal((await api('/api/sessions/' + session.data.id, 'DELETE')).code, 200);
    }
    const catalog = await api('/api/providers/models', 'POST', { id });
    assert.equal(catalog.code, 200);
    assert.deepEqual(catalog.data.models, ['audit-model-a', 'audit-model-b']);
    failModels = true;
    const cached = await api('/api/providers/models', 'POST', { id });
    assert.equal(cached.code, 200);
    assert.equal(cached.data.source, 'catalog');
    assert.deepEqual(cached.data.models, catalog.data.models);
    const forcedFailure = await api('/api/providers/models', 'POST', { id, refresh: true });
    assert.equal(forcedFailure.code, 200);
    assert.equal(forcedFailure.data.ok, false);
    assert.equal(forcedFailure.data.stale, true);
    assert.deepEqual(forcedFailure.data.models, catalog.data.models);
    assert.equal(forcedFailure.data.modelSync.stale, true);
    failModels = false;
    const forcedSuccess = await api('/api/providers/models', 'POST', { id, refresh: true });
    assert.equal(forcedSuccess.data.ok, true);
    assert.equal(forcedSuccess.data.modelSync.ok, true);
    assert.deepEqual((await api('/api/providers?agent=all')).data.find(p=>p.id===id).manualModels,[],'remote cache must not become manual models in the editor');
    // A provider is configured once; selection changes must not mutate its credentials or remote catalog.
    const selected=await api('/api/providers/'+encodeURIComponent(id),'PUT',{enabledModels:['audit-model-a']});
    assert.equal(selected.code,200);assert.deepEqual(selected.data.enabledModels,['audit-model-a']);
    assert.deepEqual(selected.data.models,['audit-model-a','audit-model-b']);assert.deepEqual(selected.data.manualModels,[]);
    assert.equal(selected.data.apiKey,created.data.apiKey);assert.equal(selected.data.baseUrl,providerBase);
    let selectedCatalog=(await api('/api/model-center')).data.catalog.filter(m=>m.providerId===id);
    assert.deepEqual(selectedCatalog.map(m=>m.id),['audit-model-a']);
    await api('/api/providers/models','POST',{id,refresh:true});
    assert.deepEqual((await api('/api/providers?agent=all')).data.find(p=>p.id===id).enabledModels,['audit-model-a'],'refresh preserves explicit model selection');
    assert.equal((await api('/api/providers/'+encodeURIComponent(id),'PUT',{enabledModels:'all'})).code,400);
    assert.equal((await api('/api/providers','POST',{name:'invalid selection',enabledModels:[{}]})).code,400);
    await api('/api/providers/'+encodeURIComponent(id),'PUT',{enabledModels:[]});
    assert.equal((await api('/api/model-center')).data.catalog.filter(m=>m.providerId===id).length,0,'empty selection cannot fall back to a provider default');
    await api('/api/providers/'+encodeURIComponent(id),'PUT',{enabledModels:['audit-model-a','audit-model-b']});
    assert.equal((await api('/api/providers/models/preview','POST',{id})).code,200,'adding models leaves the saved key usable');
    emptyModels=true;
    const empty=await api('/api/providers/models','POST',{id,refresh:true});
    assert.equal(empty.data.ok,true,'an empty remote catalog is a successful response');
    assert.deepEqual(empty.data.models,[],'removed remote models must not survive in the manual list');
    emptyModels=false;
    await api('/api/providers/models','POST',{id,refresh:true});
    const requestsBefore=modelRequests;
    holdModel=true;
    const late=api('/api/providers/models','POST',{id,refresh:true});
    for(let i=0;i<100&&!releaseModel;i++)await sleep(10);
    assert(releaseModel,'catalog request did not reach fixture');
    const duplicate=api('/api/providers/models','POST',{id,refresh:true});
    await sleep(30);
    await api('/api/providers/'+encodeURIComponent(id),'PUT',{baseUrl:providerBase+'/v2'});
    releaseModel();releaseModel=null;
    assert.equal((await late).data.stale,true,'a late catalog response cannot certify a changed connection');
    assert.equal((await duplicate).data.stale,true);
    assert.equal(modelRequests,requestsBefore+1,'duplicate synchronizations share one request');
    assert.deepEqual((await api('/api/providers?agent=all')).data.find(p=>p.id===id).models,[],'late response cannot repopulate invalidated cache');
    await api('/api/providers/'+encodeURIComponent(id),'PUT',{baseUrl:providerBase});
    await api('/api/providers/models','POST',{id,refresh:true});
    const balance = await api('/api/providers/balance', 'POST', { id });
    assert.equal(balance.code, 200);
    assert.equal(balance.data.supported, true);
    assert.equal(balance.data.total, '15');
    assert(sawAuth, 'provider key was not sent to fake provider');
    const updated = await api(`/api/providers/${encodeURIComponent(id)}`, 'PUT', { name: 'Audit Renamed', apiKey: created.data.apiKey, imageModel: 'audit-image', imageBaseUrl: providerBase });
    assert.equal(updated.data.name, 'Audit Renamed');
    assert.equal(updated.data.imageModel, 'audit-image');
    assert.equal(updated.data.imageBaseUrl, providerBase);
    assert(!JSON.stringify(updated.data).includes('audit-secret-key'));
    const linked = await api('/api/sessions', 'POST', { agent: 'builtin', providerId: id });
    assert.equal(linked.code, 200);
    assert.equal((await api(`/api/providers/${encodeURIComponent(id)}`, 'DELETE')).code, 409);
    assert.equal((await api(`/api/sessions/${linked.data.id}`, 'DELETE')).code, 200);
    await api('/api/agent-center/config','PUT',{agent:'claude',config:{providerId:id,model:'audit-model-a',command:process.execPath,permMode:'plan'}});
    assert.equal((await api(`/api/providers/${encodeURIComponent(id)}`, 'DELETE')).code, 200);
    assert.equal((await api('/api/providers?agent=builtin')).data.some(p => p.id === id), false);
    const cleaned=(await api('/api/agent-center')).data.configurations.local.claude;
    assert.equal(cleaned.providerId,undefined,'deleting a connection must clear per-environment routing references');
    assert.equal(cleaned.command,process.execPath);assert.equal(cleaned.permMode,'plan');
    const replacement=await api('/api/providers','POST',{name:'Shared replacement',baseUrl:providerBase,apiKey:'audit-secret-key',protocol:'openai',model:'audit-model-a'});
    await api('/api/providers/'+encodeURIComponent(replacement.data.id),'PUT',{model:'audit-model-b',effort:'high'});
    const inherited=await api('/api/sessions','POST',{agent:'builtin'});
    assert.equal(inherited.data.model,'audit-model-b','automatic global default follows edits to the connection model');
    assert.equal(inherited.data.effort,'high');
    console.log('[provider-integrations] CRUD, masking, model preview/cache, billing, linked delete guard passed');
  } finally {
    try { server && server.kill(); } catch {}
    try { fake && fake.close(); } catch {}
    await sleep(500);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
