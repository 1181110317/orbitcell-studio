// Real stdio/HTTP exchanges, no live credentials or paid inference.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-features-runtime-'));
process.env.AGENTHUB_DATA_DIR = path.join(temp, 'data');
process.env.AGENTHUB_WORKSPACE = path.join(temp, 'work');
process.env.CLAUDE_CONFIG_DIR = path.join(temp, 'claude');
process.env.CODEX_HOME = path.join(temp, 'codex');
fs.mkdirSync(process.env.AGENTHUB_WORKSPACE, { recursive: true });
const mcp = require('../lib/mcp-servers');
const client = require('../lib/mcp-client');
const api = require('../lib/api-agent');
const acp = require('../lib/acp-agent');
const skills = require('../lib/skills');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let model;
  try {
    const pidFile = path.join(temp, 'mcp-pid');
    const s = mcp.upsert({ name: 'echo', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-echo-server.js'), '--pid-file', pidFile, '--keepalive'], env: { SECRET: 'private-test-value' }, agents: ['builtin', 'acp'] });
    const raw = fs.readFileSync(mcp.store.file, 'utf8');
    assert(!raw.includes('private-test-value') && JSON.parse(raw).encrypted === 1);
    assert(!JSON.stringify(mcp.publicServer(s)).includes('private-test-value'));
    const opened = await client.openTools({ cwd: process.env.AGENTHUB_WORKSPACE, signal: new AbortController().signal });
    assert.equal(opened.tools.length, 2);
    assert.equal((await opened.call(opened.tools[0].name, {})).output, 'pong');
    mcp.upsert({ ...s, enabled: false });
    assert((await opened.call(opened.tools[0].name, {})).error);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    const cp = require('child_process'), originalExecFile = cp.execFile;
    if (process.platform === 'win32') cp.execFile = (bin, args, options, callback) => bin === 'taskkill' ? queueMicrotask(() => callback(Error('fixture: taskkill unavailable'))) : originalExecFile(bin, args, options, callback);
    try { await opened.close(); } finally { cp.execFile = originalExecFile; }
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) { try { process.kill(pid, 0); await sleep(50); } catch { alive = false; } }
    assert.equal(alive, false, 'MCP process exits even when Windows tree termination fails');
    mcp.upsert({ ...s, enabled: true });

    let turns = 0;
    let toolName = '';
    model = http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      if (++turns === 1) {
        const tool = payload.tools.find(t => t.function.name.startsWith('mcp_echo_'));
        assert(tool, 'external tools must reach the model');
        toolName = tool.function.name;
        emit({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc-1', function: { name: toolName, arguments: '{}' } }] } }] });
      } else {
        assert(payload.messages.some(m => m.role === 'tool' && m.content === 'pong'));
        emit({ choices: [{ delta: { content: 'TOOL OK' } }] });
      }
      res.end('data: [DONE]\n\n');
    });
    await new Promise(r => model.listen(0, '127.0.0.1', r));
    const events = [];
    const handle = api.runApiAgent({ sessionKey: 'test-api', prompt: 'use echo', model: 'fixture', cwd: process.env.AGENTHUB_WORKSPACE, permMode: 'ask', provider: { protocol: 'openai', baseUrl: 'http://127.0.0.1:' + model.address().port, apiKey: 'fixture' } }, ev => {
      events.push(ev);
      if (ev.kind === 'permission') setTimeout(() => api.respondPermission('test-api', ev.pid, 'allow'), 10);
    });
    assert.equal(await handle.done, 0);
    assert(events.some(e => e.kind === 'permission' && e.tool === toolName));
    assert(events.some(e => e.kind === 'text' && e.text === 'TOOL OK'));

    const skillRoot = path.join(process.env.AGENTHUB_WORKSPACE, '.claude', 'skills');
    for (const name of ['enabled', 'disabled']) {
      fs.mkdirSync(path.join(skillRoot, name), { recursive: true });
      fs.writeFileSync(path.join(skillRoot, name, 'SKILL.md'), '---\ndescription: fixture skill\n---\nOnly ' + name + ' skill body.');
    }
    const prepared = await skills.prepare({ agent: 'builtin', cwd: process.env.AGENTHUB_WORKSPACE, skillSelection: ['enabled', 'disabled'] }, ['disabled'], '$enabled task');
    assert(prepared.prompt.includes('Only enabled skill body.'));
    assert(!prepared.prompt.includes('Only disabled skill body.'));
    assert(prepared.nativePolicy.find(s => s.name === 'disabled').enabled === false);
    assert.equal((await skills.prepare({ remoteHostId: 'ssh:x' }, [], '')).prompt, '');
    assert.throws(() => skills.selection(['../escape']));

    const report = path.join(temp, 'acp.jsonl');
    const discoveryReport=path.join(temp,'acp-model-catalog.jsonl');
    const discovery=await acp.discoverModels({id:'catalog-fixture',bin:process.execPath,args:[path.join(__dirname,'fixtures/acp-runtime.cjs'),discoveryReport],cwd:process.env.AGENTHUB_WORKSPACE});
    assert.deepEqual(discovery.models.map(m=>m.id),['model-a','model-b']);
    const discoveryLog=fs.readFileSync(discoveryReport,'utf8').trim().split('\n').map(JSON.parse);
    assert(!discoveryLog.some(e=>e.method==='session/prompt'),'catalog discovery must never submit a task');
    assert.deepEqual(discoveryLog.find(e=>e.method==='initialize').params.clientCapabilities,{},'catalog probes do not advertise file or terminal access');
    const desktopReport=path.join(temp,'acp-desktop-model-catalog.jsonl');
    await acp.discoverModels({id:'acp:workbuddy',bin:process.execPath,args:[path.join(__dirname,'fixtures/acp-runtime.cjs'),desktopReport],cwd:process.env.AGENTHUB_WORKSPACE});
    assert(fs.readFileSync(desktopReport,'utf8').includes('desktop-lite-bundle'),'the WorkBuddy desktop catalog uses its shipped lightweight bundle');
    const modernReport=path.join(temp,'acp-modern.jsonl'),modern={sessionKey:'test-acp-modern',prompt:'task',model:'modern-b',cwd:process.env.AGENTHUB_WORKSPACE,custom:{id:'custom:modern',bin:process.execPath,args:[path.join(__dirname,'fixtures/acp-runtime.cjs'),modernReport,'--modern-models'],acp:true}};
    assert.equal(await acp.runAcpAgent(modern,()=>{}).done,0);
    assert.equal(await acp.runAcpAgent({...modern,model:'modern-a'},()=>{}).done,0);
    const modernLog=fs.readFileSync(modernReport,'utf8').trim().split('\n').map(JSON.parse);
    assert(modernLog.some(e=>e.method==='session/set_config_option'&&e.params.configId==='model-option'&&e.params.value==='modern-b'));
    assert.equal(modernLog.filter(e=>e.method==='session/new').length,1,'model switching reuses the same ACP session');
    acp.destroySession('test-acp-modern','test');
    const controlsReport=path.join(temp,'acp-controls.jsonl'),controlsArgs=[path.join(__dirname,'fixtures/acp-runtime.cjs'),controlsReport,'--modern-models','--modern-modes'];
    const controlsCatalog=await acp.discoverModels({id:'custom:controls',bin:process.execPath,args:controlsArgs,cwd:process.env.AGENTHUB_WORKSPACE,model:'modern-b'});
    assert.equal(controlsCatalog.currentModelId,'modern-b');assert.equal(controlsCatalog.reasoning.id,'effort');assert.deepEqual(controlsCatalog.models[0].reasoningLevels,['low','high']);
    let controlsLog=fs.readFileSync(controlsReport,'utf8').trim().split('\n').map(JSON.parse);
    assert(!controlsLog.some(e=>e.method==='session/prompt'),'discovery never submits a task');
    const controls={sessionKey:'test-acp-controls',prompt:'task',model:'modern-b',effort:'high',permMode:'plan',cwd:process.env.AGENTHUB_WORKSPACE,custom:{id:'custom:controls',bin:process.execPath,args:controlsArgs,acp:true}};
    assert.equal(await acp.runAcpAgent(controls,()=>{}).done,0);
    assert.equal(await acp.runAcpAgent({...controls,effort:'low',permMode:'ask'},()=>{}).done,0);
    controlsLog=fs.readFileSync(controlsReport,'utf8').trim().split('\n').map(JSON.parse);
    assert(controlsLog.some(e=>e.method==='session/set_config_option'&&e.params.configId==='mode-choice'&&e.params.value==='plan'));
    assert(controlsLog.some(e=>e.method==='session/set_config_option'&&e.params.configId==='effort'&&e.params.value==='high'));
    assert(controlsLog.some(e=>e.method==='session/set_config_option'&&e.params.configId==='effort'&&e.params.value==='low'));
    const promptsBefore=controlsLog.filter(e=>e.method==='session/prompt').length;
    await assert.rejects(acp.runAcpAgent({...controls,effort:'max'},()=>{}).done,/未公布推理档位/);
    await assert.rejects(acp.runAcpAgent({...controls,effort:'',permMode:'ask',acpConfig:{'mode-choice':'yolo'}},()=>{}).done,/权限冲突/);
    await assert.rejects(acp.runAcpAgent({...controls,effort:'',acpConfig:{unknown:'ignored'}},()=>{}).done,/未公布配置项/);
    assert.equal(fs.readFileSync(controlsReport,'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.method==='session/prompt').length,promptsBefore);
    acp.destroySession('test-acp-controls','test');
    console.log('[native-controls] ACP reasoning, modern modes, model selection, validation and bypass protection passed');
    const untyped={...controls,sessionKey:'test-acp-untyped',permMode:'ask',effort:'high',custom:{...controls.custom,args:[...controlsArgs,'--uncategorized-controls']}};
    const untypedCatalog=await acp.discoverModels({id:'custom:untyped',bin:process.execPath,args:untyped.custom.args,cwd:process.env.AGENTHUB_WORKSPACE});
    assert(untypedCatalog.configOptions.some(option=>option.id==='mode'&&option.category==='mode'));
    assert.equal(await acp.runAcpAgent(untyped,()=>{}).done,0);
    await assert.rejects(acp.runAcpAgent({...untyped,acpConfig:{mode:'yolo'}},()=>{}).done,/权限冲突/);
    acp.destroySession('test-acp-untyped','test');
    for(const agent of ['gemini','opencode']){
      const report=path.join(temp,agent+'-controls.jsonl'),shim=path.join(temp,agent+(process.platform==='win32'?'.cmd':'.sh'));
      const fixture=path.join(__dirname,'fixtures/acp-runtime.cjs');
      const command=process.platform==='win32'?'@echo off\r\n"'+process.execPath+'" "'+fixture+'" "'+report+'" %*\r\n':'#!/bin/sh\n'+[process.execPath,fixture,report].map(s=>"'"+s.replace(/'/g,"'\\''")+"'").join(' ')+' "$@"\n';
      fs.writeFileSync(shim,command,{mode:0o700});
      const events=[],options={agent,sessionKey:'test-native-'+agent,prompt:'task',model:'model-b',effort:'high',permMode:'plan',externalMcp:false,cwd:process.env.AGENTHUB_WORKSPACE,settings:{agents:{[agent]:{bin:shim}}}};
      const turn=await require('../lib/agents').runAgent(options,e=>events.push(e));assert.equal(await turn.done,0);
      const calls=fs.readFileSync(report,'utf8').trim().split('\n').map(JSON.parse);assert(calls.some(e=>e.method==='session/set_config_option'&&e.params.configId==='effort'&&e.params.value==='high'));assert(calls.some(e=>e.method==='session/set_mode'&&e.params.modeId==='plan'));assert(events.some(e=>e.kind==='text'&&e.text==='ACP OK'));acp.destroySession(options.sessionKey,'test');
    }
    console.log('[native-controls] Gemini and OpenCode local launchers use ACP permission/model/reasoning controls');
    const o = { sessionKey: 'test-acp', prompt: 'task', model: 'model-b', cwd: process.env.AGENTHUB_WORKSPACE, systemPrompt: 'ASSISTANT RULE', acpMode: 'plan', acpConfig: { effort: 'high' }, custom: { id: 'custom:fixture', bin: process.execPath, args: [path.join(__dirname, 'fixtures/acp-runtime.cjs'), report], acp: true } };
    const ae = [];
    assert.equal(await acp.runAcpAgent(o, e => ae.push(e)).done, 0);
    let log = fs.readFileSync(report, 'utf8').trim().split('\n').map(JSON.parse);
    assert(log.find(e => e.method === 'session/new').params.mcpServers.some(s => s.name === 'echo'));
    assert(log.some(e => e.method === 'session/set_model' && e.params.modelId === 'model-b'));
    assert(log.some(e => e.method === 'session/set_mode' && e.params.modeId === 'plan'));
    assert(log.some(e => e.method === 'session/set_config_option' && e.params.value === 'high'));
    assert(log.find(e => e.method === 'session/prompt').params.prompt[0].text.includes('ASSISTANT RULE'));
    assert(ae.some(e => e.kind === 'runtime' && e.commands?.[0]?.name === 'explain'));
    acp.destroySession('test-acp', 'test-resume');
    await sleep(100);
    const resumed = [];
    assert.equal(await acp.runAcpAgent({ ...o, cliSessionId: 'acp-session-fixture' }, e => resumed.push(e)).done, 0);
    log = fs.readFileSync(report, 'utf8').trim().split('\n').map(JSON.parse);
    assert(log.some(e => e.method === 'session/load'));
    assert(!resumed.some(e => /OLD HISTORY/.test(e.text || '')), 'load history must not duplicate timeline');
    await acp.runAcpAgent({ ...o, acpMode: '', permMode: 'ask' }, () => {}).done;
    log = fs.readFileSync(report, 'utf8').trim().split('\n').map(JSON.parse);
    assert(log.some(e => e.method === 'session/set_mode' && e.params.modeId === 'agent'), 'leaving plan mode restores a declared normal mode');
    const beforeRemote = fs.readFileSync(report, 'utf8');
    const remoteEvents = [];
    assert.equal(await acp.runAcpAgent({ ...o, remoteHostId: 'fixture-remote' }, e => remoteEvents.push(e)).done, 1);
    assert(remoteEvents.some(e => e.kind === 'error' && e.text.includes('未在本机执行')));
    assert.equal(fs.readFileSync(report, 'utf8'), beforeRemote, 'remote ACP cannot silently invoke a local process');
    await require('./helpers/acp-client.cjs')(temp, acp, require('../lib/agents'));
    await require('./helpers/zcode-runtime.cjs')(process.env.AGENTHUB_WORKSPACE);

    // Missing encryption key cannot replace existing ciphertext with defaults.
    const probe = spawnSync(process.execPath, ['-e', "const m=require('./lib/mcp-servers'); console.log(m.store.loadError); try{m.upsert({name:'new',command:'node'})}catch(e){process.exitCode=9}"], { cwd: path.join(__dirname, '..'), env: { ...process.env, AGENTHUB_DATA_DIR: path.join(temp, 'broken') }, encoding: 'utf8' });
    assert.equal(probe.status, 0); // isolated first-use control
    fs.mkdirSync(path.join(temp, 'broken-key'), { recursive: true });
    fs.copyFileSync(mcp.store.file, path.join(temp, 'broken-key', 'mcp-servers.json'));
    const missing = spawnSync(process.execPath, ['-e', "const m=require('./lib/mcp-servers');try{m.upsert({name:'new',command:'node'})}catch(e){process.exitCode=9}"], { cwd: path.join(__dirname, '..'), env: { ...process.env, AGENTHUB_DATA_DIR: path.join(temp, 'broken-key') }, encoding: 'utf8' });
    assert.equal(missing.status, 9);
    assert.equal(fs.readFileSync(path.join(temp, 'broken-key', 'mcp-servers.json'), 'utf8'), fs.readFileSync(mcp.store.file, 'utf8'));
    const invalid = spawnSync(process.execPath, ['-e', `
      const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
      const {encryptedStore,saveSecretState}=require('./lib/secret-store'),stores=require('./lib/store');
      const dir=process.env.AGENTHUB_DATA_DIR;fs.mkdirSync(dir,{recursive:true});
      for(const [name,defaults,values] of [['mcp-servers',{servers:[]},['broken JSON',JSON.stringify({servers:'invalid'})]],['mcp-auth',{entries:{}},['broken JSON',JSON.stringify({entries:[]})]]]){
        const file=path.join(dir,name+'.json'),keyFile=path.join(dir,'.'+name+'.key');
        for(const raw of values){fs.writeFileSync(file,raw);const s=encryptedStore(name,defaults);assert(s.loadError);assert.throws(()=>saveSecretState(s,defaults));stores.flushAllStores();assert.equal(fs.readFileSync(file,'utf8'),raw);assert(!fs.existsSync(keyFile),'corrupt records must not create replacement keys');assert(!stores.snapshotStoreFiles().has(file));}
        const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);fs.writeFileSync(keyFile,key);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(name));
        const payload=Buffer.concat([cipher.update(values[1]),cipher.final()]);const raw=JSON.stringify({encrypted:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:payload.toString('base64')});fs.writeFileSync(file,raw);
        const s=encryptedStore(name,defaults);assert(s.loadError);stores.flushAllStores();assert.equal(fs.readFileSync(file,'utf8'),raw);assert.deepEqual(fs.readFileSync(keyFile),key);
      }
    `], { cwd: path.join(__dirname, '..'), env: { ...process.env, AGENTHUB_DATA_DIR: path.join(temp, 'broken-json') }, encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.equal(invalid.status, 0, invalid.stderr || invalid.error?.message);
    console.log('[features-runtime] MCP call/approval/encryption, skills delivery and ACP negotiation/resume passed');
  } finally {
    acp.destroySession('test-acp', 'test-cleanup');acp.destroySession('test-acp-controls','test-cleanup');acp.destroySession('test-acp-untyped','test-cleanup');for(const agent of ['gemini','opencode'])acp.destroySession('test-native-'+agent,'test-cleanup');
    if (model) await new Promise(r => model.close(r));
    require('../lib/store').flushAllStores();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
