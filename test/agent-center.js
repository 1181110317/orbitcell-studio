'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mount, routeDefaults, runtimeSettings, runtimeCustom, cleanConfiguration, windowsCommandWords, cleanPreferences, isEnabled, featureEnabled } = require('../lib/agent-center');
const nativeRuntime = require('../lib/native-runtime');
const agents = require('../lib/agents');
const { create } = require('./fixtures/expansion-harness.cjs');
let count = 0;
function check(label, fn) { fn(); count++; console.log('  PASS ' + label); }
check('CLI warnings and ANSI color do not replace or invent a version',()=>{
  assert.equal(agents.parseCliVersion('WARNING: codex PATH alias unavailable\ncodex-cli 1.2.3'),'codex-cli 1.2.3');
  assert.equal(agents.parseCliVersion('\u001b[33mWARNING: codex 1.2.3 is unavailable\u001b[0m'),'');
  assert.equal(agents.parseCliVersion('(node:123) ExperimentalWarning: version warning\nv22.1.0'),'v22.1.0');
  assert.equal(agents.parseCliVersion('Error: codex could not start'),'');
  assert.equal(agents.parseCliVersion('Usage: codex --version'),'');
});

async function unit() {
  const missingCommand=path.join(__dirname,'fixtures','missing-explicit-agent-command.exe');
  const explicitMissing=await agents.resolveBinAsync('codex',{bin:missingCommand},true);
  check('an invalid explicit command cannot silently fall back to an installed default CLI',()=>{
    assert.equal(explicitMissing,null);assert.equal(agents.resolveBin('codex',{bin:missingCommand}),null);
  });
  const original = {
    agents:{claude:{bin:'C:\\local\\claude.exe',remoteBin:'claude'}},
    agentRoutes:{claude:{providerId:'main',model:'main-model',effort:'high'}},
    agentTargets:{
      local:{claude:{command:'C:\\custom\\claude.exe',model:'local-model'}},
      'fixture-ssh':{claude:{command:'/opt/cli/claude',providerId:'remote',model:'remote-model',permMode:'plan'}},
    },
  };
  check('defaults are isolated by computer and inherit only matching connections',()=>{
    assert.equal(routeDefaults(original,'claude').model,'local-model');
    assert.equal(routeDefaults(original,'claude','fixture-ssh').model,'remote-model');
    assert.equal(routeDefaults(original,'claude','other-ssh').model,'main-model');
    assert.equal(routeDefaults(original,'claude','fixture-ssh').effort,'');
    assert.equal(routeDefaults(original,'claude','fixture-ssh').permMode,'plan');
  });
  check('an Agent connection override never inherits the global connection model or effort',()=>{
    const settings={modelDefaults:{providerId:'global',model:'global-only',effort:'high'},agentRoutes:{claude:{providerId:'other'}}};
    assert.deepEqual(routeDefaults(settings,'claude'),{providerId:'other',model:'',effort:'',permMode:''});
    assert.equal(routeDefaults(settings,'codex').model,'global-only');
    settings.agentRoutes.claude={model:'my-model'};
    assert.equal(routeDefaults(settings,'claude').providerId,'global');assert.equal(routeDefaults(settings,'claude').model,'my-model');
  });
  check('ACP uses native models while DSH inherits shared models through its session overlay',()=>{
    const settings={modelDefaults:{providerId:'global',model:'api-model',effort:'high'},agentTargets:{local:{'acp:fixture':{model:'native-model'}}}};
    assert.equal(routeDefaults(settings,'acp:fixture').providerId,'');assert.equal(routeDefaults(settings,'acp:fixture').model,'native-model');
    assert.equal(routeDefaults(settings,'dsh').model,'api-model');assert.equal(routeDefaults(settings,'dsh').providerId,'global');assert.equal(routeDefaults(settings,'dsh').effort,'high');assert.equal(routeDefaults(settings,'dsh').dshPermission,'default');
  });
  check('runtime commands reach the selected host without mutating global settings',()=>{
    const remote=runtimeSettings(original,'claude','fixture-ssh');
    assert.equal(nativeRuntime.remoteBin({settings:remote},'claude'),'/opt/cli/claude');
    assert.equal(original.agents.claude.remoteBin,'claude');
    assert.equal(runtimeSettings(original,'claude','other-ssh'),original);
    assert.equal(runtimeSettings(original,'claude').agents.claude.bin,'C:\\custom\\claude.exe');
    assert.equal(agents.agentSettings(original,'claude').bin,'C:\\custom\\claude.exe');
    assert.equal(runtimeCustom({bin:'old'},original,'claude','fixture-ssh').bin,'/opt/cli/claude');
  });
  const context={agent:'claude',hostId:'',knownAgents:new Set(['claude','builtin']),validHost:id=>!id||id==='fixture-ssh',provider:id=>id==='main'?{id}:null,fits:()=>true,efforts:['high','low']};
  check('invalid hosts, reserved keys and malformed configurations are rejected',()=>{
    assert.throws(()=>cleanConfiguration({command:42},context));
    assert.throws(()=>cleanConfiguration({command:'bad\ncommand'},context));
    assert.throws(()=>cleanConfiguration({}, {...context,hostId:'__proto__'}));
    assert.throws(()=>cleanConfiguration({}, {...context,agent:'constructor'}));
    assert.throws(()=>cleanConfiguration({}, {...context,hostId:'removed-host'}));
    assert.throws(()=>cleanConfiguration({providerId:'missing'},context));
    assert.throws(()=>cleanConfiguration({command:'anything'}, {...context,agent:'builtin'}));
    assert.throws(()=>cleanConfiguration({permMode:'invalid'},context));
    assert.throws(()=>cleanConfiguration({effort:'invalid'},context));
  });
  check('DSH native permissions are validated independently from legacy common modes',()=>{
    assert.deepEqual(cleanConfiguration({dshPermission:'read-only',effort:'high'},{...context,agent:'dsh',knownAgents:new Set(['dsh'])}),{dshPermission:'read-only',effort:'high'});
    assert.throws(()=>cleanConfiguration({dshPermission:'auto'},{...context,agent:'dsh',knownAgents:new Set(['dsh'])}));
    assert.throws(()=>cleanConfiguration({dshPermission:'read-only'},context));
  });
  check('configuration input does not accept unrelated settings or secrets',()=>{
    const clean=cleanConfiguration({model:'demo',apiKey:'synthetic-fixture',host:'elsewhere',command:''},context);
    assert.deepEqual(clean,{model:'demo'});
  });
  check('API Agent research and history settings are validated and independently stored',()=>{
    const input={webMode:'off',webMaxCalls:24,webTimeoutMs:10000,historyMessages:32};
    assert.deepEqual(cleanConfiguration(input,{...context,agent:'builtin'}),input);
    assert.throws(()=>cleanConfiguration(input,context));
    for(const config of [{webMode:'always'},{webMaxCalls:49},{webMaxCalls:'12'},{webTimeoutMs:1},{historyMessages:101}])assert.throws(()=>cleanConfiguration(config,{...context,agent:'builtin'}));
    assert.equal(require('../lib/web-research').options(input).webMaxCalls,24);
  });
  check('Windows SSH executable paths preserve spaces and backslashes',()=>{
    assert.deepEqual(windowsCommandWords('C:\\Program Files\\Node\\node.exe',agents.splitArgs),['C:\\Program Files\\Node\\node.exe']);
    assert.deepEqual(windowsCommandWords('node "C:\\Agent Tools\\cli.cjs"',agents.splitArgs),['node','C:\\Agent Tools\\cli.cjs']);
  });
  check('Agent preferences validate partial changes without accepting unrelated fields',()=>{
    assert.deepEqual(cleanPreferences({pinned:true,apiKey:'synthetic-ignored',tools:{browserTools:false}}, {enabled:false,tools:{mcpServers:false}}),{enabled:false,pinned:true,tools:{mcpServers:false,browserTools:false}});
    assert.throws(()=>cleanPreferences({hidden:'yes'}));assert.throws(()=>cleanPreferences({tools:{agenthubTools:1}}));assert.throws(()=>cleanPreferences({order:-1}));
  });
  check('per-Agent tool preferences respect global limits and leave other Agents unchanged',()=>{
    const settings={agentPreferences:{claude:{enabled:false,tools:{browserTools:false,mcpServers:false}}}};
    assert(!isEnabled(settings,'claude'));assert(isEnabled(settings,'codex'));
    assert(!featureEnabled(settings,'claude','browserTools'));assert(featureEnabled(settings,'codex','browserTools'));
    assert(!featureEnabled({...settings,mcpTools:false},'codex','agenthubTools'));
    assert(!featureEnabled({...settings,browserTools:false},'codex','browserTools'));
  });
  check('upgrade commands are isolated by target without changing executable defaults',()=>{
    const settings={agents:{claude:{bin:'local',upgradeCommand:'local update'}},agentTargets:{'fixture-ssh':{claude:{upgradeCommand:'remote update'}}}};
    const remote=runtimeSettings(settings,'claude','fixture-ssh');
    assert.equal(remote.agents.claude.remoteUpgradeCommand,'remote update');assert.equal(remote.agents.claude.bin,'local');assert.equal(settings.agents.claude.upgradeCommand,'local update');
  });

  // Exercise the mounted catalog and its asynchronous remote probe without an
  // external SSH server. A pending old result must not certify a new command.
  const routes=new Map(),app={};
  for(const method of ['get','put','post','patch'])app[method]=(url,fn)=>routes.set(method+' '+url,fn);
  let connections=0,release,cacheClears=0,nativeClears=0;
  const settings={data:{agents:{},customAgents:[],agentRoutes:{},agentTargets:{}},save(){}};
  const mockSsh={listHosts:()=>[{id:'fixture-ssh',name:'Fixture SSH'}],getHostCfg:id=>id==='fixture-ssh'?{id}:null,
    testHost:()=>{connections++;return new Promise(resolve=>{release=()=>resolve({ok:true,platform:'posix'});});},
    execStream:()=>{let out=()=>{};return {onStdout:fn=>{out=fn;},onStderr:()=>{},done:Promise.resolve().then(()=>{out('fixture-cli 1.0.0');return 0;}),kill(){}};},
  };
  mount(app,{settings,ssh:mockSsh,agents:{...agents,clearAgentsCache:()=>cacheClears++,clearNativeRouteCache:()=>nativeClears++,detectAgentsCached:async()=>[{id:'claude',name:'Claude Code',ready:false},{id:'acp:fixture',name:'ACP fixture',ready:true}]},provider:()=>null,providers:()=>[],fits:()=>true,efforts:['high']});
  const call=(method,url,body)=>new Promise((resolve,reject)=>{
    const response={headersSent:false,status(code){this.code=code;return this;},json(data){resolve({status:this.code||200,data});}};
    Promise.resolve(routes.get(method+' '+url)({body},response)).catch(reject);
  });
  await call('get','/api/agent-center');
  check('opening the Agent catalog makes no remote connections',()=>assert.equal(connections,0));
  const managed=await call('post','/api/agent-center/probe',{agent:'acp:fixture',hostId:''});
  check('ACP launchers are not mistaken for verified protocol connections',()=>{assert.equal(managed.data.cli,'managed');assert.equal(connections,0);});
  await call('put','/api/agent-center/config',{agent:'claude',hostId:'',config:{model:'new-default'}});
  check('saving model defaults does not invalidate or launch CLI discovery',()=>{assert.equal(cacheClears,0);assert.equal(nativeClears,0);});
  const probing=call('post','/api/agent-center/probe',{agent:'claude',hostId:'fixture-ssh'});
  await Promise.resolve();
  assert.equal(typeof release,'function');
  const duplicate=call('post','/api/agent-center/probe',{agent:'claude',hostId:'fixture-ssh'});
  assert.equal(connections,1,'repeated clicks on the same target share the diagnostic');
  await call('put','/api/agent-center/config',{agent:'claude',hostId:'fixture-ssh',config:{command:'/changed/claude'}});
  release();
  const old=await probing,catalog=await call('get','/api/agent-center');
  await duplicate;
  check('a late diagnostic cannot certify a command changed during the probe',()=>{
    assert.equal(old.data.stale,true);
    assert(!catalog.data.checks[JSON.stringify(['fixture-ssh','claude'])]);
  });
  const freshProbe=call('post','/api/agent-center/probe',{agent:'claude',hostId:'fixture-ssh'});
  await Promise.resolve();
  // Complete a fresh check and verify that its timing and identity belong to the selected target.
  release();const fresh=await freshProbe;
  check('a completed diagnostic records elapsed time and the selected environment command',()=>{
    assert.equal(fresh.data.cli,'ready');assert.equal(fresh.data.command,'/changed/claude');
    assert(fresh.data.checkedAt>0);assert(fresh.data.elapsedMs>=0);
  });
  const runOneShot=nativeRuntime.runOneShot;
  try {
    nativeRuntime.runOneShot=async()=>({code:127,stdout:'',stderr:'claude: command not found'});
    const missing=await call('post','/api/agent-center/probe',{agent:'claude',hostId:'wsl'});
    check('a missing CLI is distinct from a failed WSL connection',()=>{
      assert.equal(missing.data.host,'ready');assert.equal(missing.data.cli,'missing');assert(missing.data.error.includes('not found'));
    });
    nativeRuntime.runOneShot=async()=>({code:124,stdout:'',stderr:'WSL 命令超时'});
    const failed=await call('post','/api/agent-center/probe',{agent:'claude',hostId:'wsl'});
    check('a failed WSL channel cannot appear as a healthy environment',()=>assert.equal(failed.data.host,'failed'));
  } finally { nativeRuntime.runOneShot=runOneShot; }
  mockSsh.testHost=async()=>({ok:false,error:'fixture channel failed'});
  const failedSsh=await call('post','/api/agent-center/probe',{agent:'claude',hostId:'fixture-ssh'});
  check('SSH connection failures retain the transport error without inventing a CLI result',()=>{
    assert.equal(failedSsh.data.host,'failed');assert.equal(failedSsh.data.cli,'unchecked');assert.equal(failedSsh.data.error,'fixture channel failed');
  });
}

async function integration() {
  let h;
  try {
    h=await create('agent-center',{providers:[{id:'fixture-main',agent:'all',name:'Fixture connection',protocol:'openai',baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture-center-key',model:'provider-default',models:['provider-default','local-model','remote-model']}]});
    const api=async(url,method='GET',body,token)=>{
      const result=await h.api(url,method,body,token);assert.equal(result.status,200,url+': '+JSON.stringify(result.data));return result.data;
    };
    const initial=await api('/api/agent-center');
    check('real catalog exposes version and masked data without any credentials',()=>{
      assert.equal(initial.version,3);assert(Array.isArray(initial.agents));assert(initial.preferences);assert(initial.toolPolicy);
      assert(!JSON.stringify(initial).includes('fixture-center-key'));
    });
    await api('/api/agent-center/config','PUT',{agent:'dsh',hostId:'',config:{providerId:'fixture-main',model:'local-model',effort:'high',dshPermission:'read-only'}});
    const dshSession=await api('/api/sessions','POST',{agent:'dsh',cwd:h.work});
    check('DSH sessions inherit and persist native permissions and reasoning strength',()=>{assert.equal(dshSession.dshPermission,'read-only');assert.equal(dshSession.effort,'high');});
    await api('/api/sessions/'+dshSession.id,'PATCH',{dshPermission:'workspace-write',effort:'low'});
    const dshReload=await api('/api/sessions/'+dshSession.id);
    check('reloading DSH restores changed permissions and effort',()=>{assert.equal(dshReload.dshPermission,'workspace-write');assert.equal(dshReload.effort,'low');});
    const invalidDshPerm=await h.api('/api/sessions/'+dshSession.id,'PATCH',{dshPermission:'auto'});
    const foreignDshPerm=await h.api('/api/sessions','POST',{agent:'codex',dshPermission:'read-only'});
    check('invalid or foreign native permission fields cannot be silently accepted',()=>{assert.equal(invalidDshPerm.status,400);assert.equal(foreignDshPerm.status,400);});
    const dshProviders=await api('/api/providers?agent=dsh');
    check('DSH advertises the connections supported by its model overlay',()=>assert(dshProviders.some(p=>p.id==='fixture-main')));
    check('native ACP executors do not advertise external API connections',()=>assert.equal(initial.providerIds['acp:workbuddy']?.length||0,0));
    const skillRoot=path.join(h.work,'.agents','skills','source-preview-fixture');
    fs.mkdirSync(skillRoot,{recursive:true});
    const skillContent='---\nname: source-preview-fixture\ndescription: source fixture\n---\n# 源码预览\n\n```js\nconst value = 1;\n```\n';
    fs.writeFileSync(path.join(skillRoot,'SKILL.md'),skillContent);
    const skillUrl='/api/skills/content?name=source-preview-fixture&cwd='+encodeURIComponent(h.work);
    const skill=await api(skillUrl);
    check('skill preview reads the discovered skill exactly without executing its content',()=>{
      assert.equal(skill.content,skillContent);assert.equal(skill.scope,'project');assert.equal(skill.source,'agents');
    });
    const readOnlySkill=await h.api(skillUrl,'GET',undefined,'fixture-read');
    check('read-only identities cannot read full skill source',()=>assert.equal(readOnlySkill.status,403));
    const invalidSkill=await h.api('/api/skills/content?name='+encodeURIComponent('../README')+'&cwd='+encodeURIComponent(h.work));
    check('skill preview rejects traversal names instead of reading a requested file path',()=>assert.equal(invalidSkill.status,400));
    fs.writeFileSync(path.join(skillRoot,'SKILL.md'),'x'.repeat(128*1024+1));
    const oversizedSkill=await h.api(skillUrl);
    check('oversized skill files are absent from the preview inventory',()=>assert.equal(oversizedSkill.status,404));
    const fixtureFile=(relative,content)=>{const file=path.join(h.tmp,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);return file;};
    fixtureFile('codex/skills/.system/native-test/SKILL.md','---\ndescription: built in fixture\n---\n# Native');
    fixtureFile('codex/plugins/cache/vendor/plugin/1.0/skills/plugin-test/SKILL.md','---\ndescription: plugin fixture\n---\n# Plugin');
    fixtureFile('codex/config.toml','[mcp_servers.fixture]\ncommand = "node"\nargs = ["--token=secret-fixture"]\nenabled = false\n[mcp_servers.fixture.env]\nAPI_KEY = "secret-fixture"\n[mcp_servers.multiline]\ncommand = "node#fixture" # retain comment\nargs = [\n  "--old", # original argument\n  "literal,#value",\n]\n[mcp_servers.hashurl]\nurl = "https://example.test/mcp#fragment" # retain URL comment\n[mcp_servers.empty]\n');
    fixtureFile('work/.agents/skills/shared-test/SKILL.md','---\ndescription: shared fixture\n---\n# Shared');
    const inventory=await api('/api/capabilities/inventory?agent=codex&cwd='+encodeURIComponent(h.work));
    check('per-Agent native inventory discovers built-in, plugin and shared skills',()=>{
      assert(inventory.skills.some(s=>s.name==='native-test'&&s.source==='codex'));
      assert(inventory.skills.some(s=>s.name==='plugin-test'&&s.origin==='plugin'));
      assert(inventory.skills.some(s=>s.name==='shared-test'&&s.source==='agents'));
      assert(inventory.skills.every(s=>s.source==='codex'||s.source==='agents'));
    });
    check('native MCP metadata preserves origin and disabled state without leaking command secrets',()=>{
      const native=inventory.servers.find(s=>s.name==='fixture');assert(native);assert.equal(native.enabled,false);assert.equal(native.agent,'codex');
      assert(!JSON.stringify(inventory).includes('secret-fixture'));assert(!Object.hasOwn(native,'env'));assert(!Object.hasOwn(native,'args'));
    });
    const native=inventory.servers.find(s=>s.name==='fixture'),nativeQuery={agent:'codex',id:native.id,cwd:h.work};
    const nativeDetail=await api('/api/capabilities/mcp?'+new URLSearchParams(nativeQuery));
    check('native MCP editor returns a revision without configuration secrets',()=>{
      assert.equal(nativeDetail.revision.length,64);assert(!JSON.stringify(nativeDetail).includes('secret-fixture'));assert(!nativeDetail.args);
    });
    await api('/api/capabilities/mcp','POST',{...nativeQuery,revision:nativeDetail.revision,command:'node-updated',enabled:true});
    const nativeRaw=fs.readFileSync(path.join(h.tmp,'codex/config.toml'),'utf8');
    check('native TOML changes preserve arguments, authentication and other sections',()=>{
      assert(nativeRaw.includes('command = "node-updated"'));assert(nativeRaw.includes('enabled = true'));assert(nativeRaw.includes('args = ["--token=secret-fixture"]'));assert(nativeRaw.includes('API_KEY = "secret-fixture"'));
    });
    const stale=await h.api('/api/capabilities/mcp','POST',{...nativeQuery,revision:nativeDetail.revision,command:'must-not-save'});
    check('editing an outdated native configuration is rejected',()=>assert.equal(stale.status,409));
    const multiline=inventory.servers.find(s=>s.name==='multiline'),hashurl=inventory.servers.find(s=>s.name==='hashurl');
    check('TOML inventory retains hashes inside quoted commands and URLs',()=>{assert.equal(multiline.address,'node#fixture');assert.equal(hashurl.transport,'http');});
    const multiQuery={agent:'codex',cwd:h.work,id:multiline.id},multiDetail=await api('/api/capabilities/mcp?'+new URLSearchParams(multiQuery));
    await api('/api/capabilities/mcp','POST',{...multiQuery,revision:multiDetail.revision,replaceArgs:true,args:['--new','literal,#value']});
    const multiRaw=fs.readFileSync(path.join(h.tmp,'codex/config.toml'),'utf8');
    check('native TOML replaces multiline argument arrays without damaging neighboring fields',()=>{
      assert(multiRaw.includes('args = ["--new","literal,#value"]'));assert(!multiRaw.includes('"--old"'));assert(multiRaw.includes('command = "node#fixture" # retain comment'));assert(multiRaw.includes('url = "https://example.test/mcp#fragment" # retain URL comment'));assert(multiRaw.includes('API_KEY = "secret-fixture"'));
    });
    const emptyDuplicate=await h.api('/api/capabilities/mcp','POST',{create:true,agent:'codex',cwd:'',scope:'global',name:'empty',transport:'stdio',command:'node'});
    check('native creation rejects an existing empty TOML server table',()=>assert.equal(emptyDuplicate.status,409));
    const jsoncFile=fixtureFile('work/opencode.jsonc','{\n  // keep this comment\n  "other": {"keep": true},\n  "mcp": {"fixture-jsonc": {"type":"local","command":["node,}","--token=secret-jsonc"],"environment":{"KEY":"secret-jsonc"},}},\n}\n');
    const jsonInventory=await api('/api/capabilities/inventory?agent=opencode&cwd='+encodeURIComponent(h.work));
    const jsonItem=jsonInventory.servers.find(s=>s.name==='fixture-jsonc');assert(jsonItem);
    check('JSONC trailing comma parsing preserves literal commas before braces in strings',()=>assert.equal(jsonItem.address,'node,}'));
    const jsonQuery={agent:'opencode',cwd:h.work,id:jsonItem.id},jsonDetail=await api('/api/capabilities/mcp?'+new URLSearchParams(jsonQuery));
    await api('/api/capabilities/mcp','POST',{...jsonQuery,revision:jsonDetail.revision,command:'node-jsonc',enabled:false});
    const jsoncRaw=fs.readFileSync(jsoncFile,'utf8');
    check('native JSONC editing preserves comments, arguments, credentials and unrelated settings',()=>{
      assert(jsoncRaw.includes('// keep this comment'));assert(jsoncRaw.includes('secret-jsonc'));assert(jsoncRaw.includes('node-jsonc'));assert(jsoncRaw.includes('"enabled": false'));assert(jsoncRaw.includes('"other": {"keep": true}'));
      assert(fs.readdirSync(path.dirname(jsoncFile)).some(f=>f.startsWith('opencode.jsonc.agenthub-')&&f.endsWith('.bak')));
    });
    const createdMcp=await api('/api/capabilities/mcp','POST',{create:true,agent:'gemini',cwd:h.work,scope:'project',name:'created-fixture',transport:'http',url:'https://example.test/mcp'});
    check('adding a native MCP targets the selected Agent and project',()=>{
      assert.equal(createdMcp.source,path.join(h.work,'.gemini','settings.json'));
      assert.deepEqual(JSON.parse(fs.readFileSync(createdMcp.source,'utf8')).mcpServers['created-fixture'],{httpUrl:'https://example.test/mcp'});
    });
    const duplicateMcp=await h.api('/api/capabilities/mcp','POST',{create:true,agent:'gemini',cwd:h.work,scope:'project',name:'created-fixture',transport:'http',url:'https://example.test/other'});
    const readonlyMcp=await h.api('/api/capabilities/mcp','POST',{...nativeQuery,revision:nativeDetail.revision,command:'forbidden'},'fixture-read');
    check('native MCP creation rejects duplicates and read-only edits',()=>{assert.equal(duplicateMcp.status,409);assert.equal(readonlyMcp.status,403);});
    const sourceInventory=inventory.skills.find(s=>s.name==='plugin-test');
    const nativeSource=await api('/api/capabilities/skill-content?'+new URLSearchParams({agent:'codex',cwd:h.work,id:sourceInventory.id}));
    check('stable skill IDs preview the selected plugin source',()=>assert(nativeSource.content.includes('# Plugin')));
    await api('/api/skills/toggle','POST',{name:'shared-test',agent:'codex',enabled:false});
    const disabledCodex=await api('/api/skills?all=1&agent=codex&cwd='+encodeURIComponent(h.work));
    const enabledClaude=await api('/api/skills?all=1&agent=claude&cwd='+encodeURIComponent(h.work));
    check('skill delivery toggles are isolated per Agent',()=>{
      assert.equal(disabledCodex.skills.find(s=>s.name==='shared-test').enabled,false);
      assert.equal(enabledClaude.skills.find(s=>s.name==='shared-test').enabled,true);
    });
    const imported=await api('/api/skills/import','POST',{source:path.join(h.tmp,'codex/skills/.system/native-test'),agent:'codex',scope:'project',cwd:h.work});
    check('skill import uses the selected Agent destination',()=>assert.equal(imported.path,path.join(h.work,'.codex','skills','native-test')));
    const badInventory=await h.api('/api/capabilities/inventory?agent=constructor');
    const missingHost=await h.api('/api/capabilities/inventory?host=missing-ssh&agent=codex');
    const readonlyInventory=await h.api('/api/capabilities/inventory?agent=codex','GET',undefined,'fixture-read');
    check('invalid targets and read-only credentials cannot scan native configuration',()=>{
      assert.equal(badInventory.status,400);assert.equal(missingHost.status,404);assert.equal(readonlyInventory.status,403);
    });
    const custom=(await api('/api/agent-center/custom','POST',{name:'Node diagnostic fixture',bin:process.execPath,args:''})).agent;
    check('custom Agent creation appends an identity without replacing existing settings',()=>{
      assert(custom.id.startsWith('c_'));assert.equal(custom.bin,process.execPath);
    });
    const host=await api('/api/ssh/hosts','POST',{name:'Fixture host',host:'127.0.0.1',port:1,user:'fixture',authType:'password',password:'synthetic-only'});
    const hostId=host.id;
    assert(hostId,'fixture host ID missing');
    await api('/api/agent-center/config','PUT',{agent:'claude',hostId:'',config:{command:process.execPath,providerId:'fixture-main',model:'local-model',effort:'high',permMode:'plan'}});
    await api('/api/agent-center/config','PUT',{agent:'claude',hostId,config:{command:'/fixture/bin/claude',providerId:'fixture-main',model:'remote-model',effort:'low',permMode:'ask'}});
    const local=await api('/api/sessions','POST',{agent:'claude',cwd:h.work});
    const remote=await api('/api/sessions','POST',{agent:'claude',remoteHostId:hostId});
    check('new sessions inherit model, effort and permissions for the actual target',()=>{
      assert.equal(local.model,'local-model');assert.equal(local.effort,'high');assert.equal(local.permMode,'plan');
      assert.equal(remote.model,'remote-model');assert.equal(remote.effort,'low');assert.equal(remote.permMode,'ask');
    });
    const defaultEffort=await api('/api/sessions','POST',{agent:'claude',effort:''});
    check('explicit default effort clears inherited provider or Agent strength',()=>assert.equal(defaultEffort.effort,''));
    const nativeConfig=await api('/api/sessions','POST',{agent:'acp:workbuddy',effort:'low',acpConfig:{effort:'low'}});
    check('native reasoning configuration is accepted before the first prompt',()=>assert.equal(nativeConfig.acpConfig.effort,'low'));
    await api('/api/agent-center/config','PUT',{agent:'acp:workbuddy',config:{effort:'high',acpConfig:{effort:'high'},acpMode:'agent'}});
    const nativeDefaults=await api('/api/sessions','POST',{agent:'acp:workbuddy'});
    check('native Agent defaults retain reasoning, native configuration and mode',()=>{assert.equal(nativeDefaults.effort,'high');assert.equal(nativeDefaults.acpConfig.effort,'high');assert.equal(nativeDefaults.acpMode,'agent');});
    const nativeCleared=await api('/api/sessions','POST',{agent:'acp:workbuddy',effort:'',acpConfig:{},acpMode:''});
    check('explicit native defaults can clear all inherited reasoning overrides',()=>{assert.equal(nativeCleared.effort,'');assert.deepEqual(nativeCleared.acpConfig,{});assert.equal(nativeCleared.acpMode,'');});

    const explicit=await api('/api/sessions','POST',{agent:'claude',remoteHostId:hostId,providerId:'fixture-main',model:'explicit-model',effort:'medium',permMode:'plan'});
    check('explicit conversation choices override saved defaults',()=>{
      assert.equal(explicit.model,'explicit-model');assert.equal(explicit.effort,'medium');assert.equal(explicit.permMode,'plan');
    });
    await api('/api/agent-center/config','PUT',{agent:'claude',hostId,config:{permMode:'edits'}});
    const edits=await api('/api/sessions','POST',{agent:'claude',remoteHostId:hostId});
    check('edit-only defaults reach the native permission mode without enabling auto permissions',()=>{
      assert.equal(edits.permMode,'edits');assert.equal(edits.autoPerms,false);
    });
    await api('/api/agent-center/config','PUT',{agent:'claude',hostId:'',config:{model:'later-model'}});
    const previous=await api('/api/sessions/'+local.id);
    check('updating defaults keeps existing conversations intact',()=>assert.equal(previous.model,'local-model'));
    const probe=await api('/api/agent-center/probe','POST',{agent:custom.id,hostId:''});
    check('on-demand local diagnostics execute the configured command and capture its version',()=>{
      assert.equal(probe.cli,'ready');assert(probe.version.includes(process.versions.node));assert.equal(probe.model,'unchecked');
    });
    const readonly=await h.api('/api/agent-center','GET',undefined,'fixture-read');
    check('read-only users can inspect the catalog',()=>assert.equal(readonly.status,200));
    for(const [url,method,body] of [
      ['/api/agent-center/config','PUT',{agent:'claude',config:{model:'must-not-save'}}],
      ['/api/agent-center/probe','POST',{agent:'claude'}],
      ['/api/agent-center/inherit-model','POST',{agent:'claude'}],
      ['/api/agent-center/custom','POST',{name:'Must not create',bin:process.execPath}],
      ['/api/agent-center/preferences','PATCH',{agent:'claude',preferences:{enabled:false}}],
      ['/api/agent-center/order','PUT',{agents:['claude','codex']}],
    ]) {
      const denied=await h.api(url,method,body,'fixture-read');
      check('read-only identity cannot mutate or execute '+url,()=>assert.equal(denied.status,403));
    }
    await api('/api/agent-center/preferences','PATCH',{agent:'claude',preferences:{pinned:true,hidden:true,tools:{browserTools:false}}});
    await api('/api/agent-center/preferences','PATCH',{agent:'claude',preferences:{enabled:false,tools:{agenthubTools:false,permissionMemory:false,mcpServers:false}}});
    const preferences=(await api('/api/agent-center')).preferences.claude;
    check('partial preference writes preserve pinning, visibility and independent tool switches',()=>{
      assert.equal(preferences.pinned,true);assert.equal(preferences.hidden,true);assert.equal(preferences.enabled,false);
      assert.equal(preferences.tools.browserTools,false);assert.equal(preferences.tools.mcpServers,false);
    });
    const disabled=await h.api('/api/sessions','POST',{agent:'claude'}),oldSession=await h.api('/api/sessions/'+local.id);
    check('disabling an Agent prevents new tasks and preserves existing conversation data',()=>{
      assert.equal(disabled.status,409);assert.equal(oldSession.status,200);assert.equal(oldSession.data.model,'local-model');
    });
    const blockedTool=await h.api('/api/sessions/'+local.id+'/workflow-tool','POST',{name:'goal_update',args:{text:'must-not-write'}});
    check('OrbitCell tool preference is enforced before executing a workflow tool',()=>assert.equal(blockedTool.status,403));
    const memory=await api('/api/permissions/memory?sessionId='+encodeURIComponent(local.id));
    check('project permission memory exposes the real per-Agent enable state',()=>assert.equal(memory.enabled,false));
    await api('/api/agent-center/order','PUT',{agents:['codex','claude',custom.id]});
    const ordered=(await api('/api/agent-center')).preferences;
    check('common Agent ordering persists atomically without replacing other preferences',()=>{
      assert.equal(ordered.codex.order,0);assert.equal(ordered.claude.order,1);assert.equal(ordered.claude.pinned,true);
    });
    const invalidOrder=await h.api('/api/agent-center/order','PUT',{agents:['claude','claude']});
    const invalidPreference=await h.api('/api/agent-center/preferences','PATCH',{agent:'constructor',preferences:{enabled:false}});
    check('malformed order and reserved Agent identities cannot change preferences',()=>{
      assert.equal(invalidOrder.status,400);assert.equal(invalidPreference.status,404);
    });
    await api('/api/agent-center/preferences','PATCH',{agent:'claude',preferences:{enabled:true}});
    const enabledSession=await api('/api/sessions','POST',{agent:'claude'});
    check('re-enabling an Agent restores task creation',()=>assert.equal(enabledSession.agent,'claude'));
    await api('/api/agent-center/config','PUT',{agent:'claude',hostId,config:{upgradeCommand:'fixture-cli update'}});
    const upgradedConfig=(await api('/api/agent-center')).configurations[hostId].claude;
    check('target upgrade commands persist through the real API',()=>assert.equal(upgradedConfig.upgradeCommand,'fixture-cli update'));
    const invalid=await h.api('/api/agent-center/config','PUT',{agent:'claude',hostId:'removed-host',config:{model:'must-not-save'}});
    check('unknown remote hosts are rejected by the authenticated API',()=>assert.equal(invalid.status,404));
    await api('/api/model-defaults','PUT',{providerId:'fixture-main',model:'global-model',effort:'low'});
    await api('/api/settings','PUT',{agentRoutes:{claude:{providerId:'fixture-main',model:'old-agent-model',effort:'high'}}});
    await api('/api/agent-center/config','PUT',{agent:'claude',config:{providerId:'fixture-main',model:'old-local-model',command:process.execPath,permMode:'plan'}});
    await api('/api/agent-center/config','PUT',{agent:'claude',hostId,config:{model:'keep-remote',upgradeCommand:'fixture-cli update'}});
    const inherited=await api('/api/agent-center/inherit-model','POST',{agent:'claude'});
    check('restore-global clears legacy and selected-target model overrides while preserving other settings',()=>{
      assert.equal(inherited.defaults.model,'global-model');assert.equal(inherited.defaults.effort,'low');
      assert.equal(inherited.config.command,process.execPath);assert.equal(inherited.config.permMode,'plan');assert(!inherited.config.providerId);
    });
    const resetCatalog=await api('/api/agent-center'),resetSession=await api('/api/sessions','POST',{agent:'claude'});
    check('restored defaults reach new sessions and leave other environments and existing sessions intact',()=>{
      assert.equal(resetSession.model,'global-model');assert.equal(resetCatalog.configurations[hostId].claude.model,'keep-remote');
      assert.equal(resetCatalog.configurations[hostId].claude.upgradeCommand,'fixture-cli update');
      assert.equal(local.model,'local-model');
    });
    for(const file of ['/agent-center.js','/agent-center.css','/management.js','/management.css','/capabilities.js']) {
      const response=await fetch(h.base+file+'?token=fixture-full');await response.arrayBuffer();
      check('new static resource is current and uncached: '+file,()=>{assert.equal(response.status,200);assert(response.headers.get('cache-control').includes('no-store'));});
    }
  } finally { if(h)await h.stop(); }
}

(async()=>{await unit();await integration();console.log('[agent-center] '+count+' checks passed');})().catch(error=>{console.error(error.stack);process.exitCode=1;});
