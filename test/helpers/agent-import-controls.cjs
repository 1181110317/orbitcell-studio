const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
module.exports=async({root})=>{
  const controls=require('../../public/agent-controls');
  assert.deepEqual(controls.modes('codex').map(m=>m.nativeValue),['danger-full-access','read-only','workspace-write']);
  assert(!controls.modes('codex').some(m=>m.value==='edits'));
  assert.deepEqual(controls.modes('dsh').map(m=>m.value),['default','read-only','workspace-write','danger-full-access']);
  assert.deepEqual(controls.modes('zcode').map(m=>m.nativeValue),['yolo','edit','plan','build']);
  assert.equal(controls.modes('builtin').find(m=>m.value==='edits').description,'自动批准文件编辑；命令执行不开放');
  assert(!controls.modes('claude',{features:{permMode:false}}).some(m=>m.value==='edits'));
  assert.deepEqual(controls.nativeControls({modes:{availableModes:[{id:'custom-mode',name:'Custom mode'}]}}).options,[{value:'custom-mode',label:'Custom mode',description:''}]);
  const config=controls.nativeControls({configOptions:[{category:'mode',id:'native-permissions',name:'Native permissions',options:[{group:'Agent',options:[{value:'read',name:'Read'}]}]}]});
  assert.equal(config.id,'native-permissions');assert.equal(config.options[0].value,'read');
  console.log('PASS per-Agent native mode contracts and runtime-advertised ACP controls');
  const store=new Map(),context={module:{exports:{}},localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../public/conversation-preferences.js'),'utf8'),context);
  const prefs=context.module.exports,before=prefs.read();prefs.saveAgent('claude',{contentWidth:'wide',historyDepth:'2',chatFontSize:'18'});
  assert.equal(prefs.read('claude').contentWidth,'wide');assert.equal(prefs.read('codex').contentWidth,before.contentWidth);assert.equal(prefs.read('claude').chatFontSize,before.chatFontSize);prefs.saveAgent('claude',null);assert.equal(prefs.read('claude').contentWidth,before.contentWidth);
  console.log('PASS per-Agent page preferences preserve other Agents and global typography');
  const importer=require('../../lib/agent-session-import');
  const gemini=importer.parseText(JSON.stringify({sessionId:'gemini-fixture',messages:[{type:'user',content:'Gemini question'},{type:'gemini',content:'Gemini answer'}]}),'gemini');assert.equal(gemini.msgs.length,2);
  const opencode=importer.parseText(JSON.stringify({info:{id:'opencode-fixture'},messages:[{info:{role:'user'},parts:[{type:'text',text:'OpenCode question'}]},{info:{role:'assistant'},parts:[{type:'text',text:'OpenCode answer'}]}]}),'opencode');assert.equal(opencode.msgs[1].blocks[0].text,'OpenCode answer');
  const pi=importer.parseText([{type:'session',id:'pi-fixture'},{type:'message',id:'a',parentId:null,message:{role:'user',content:'Root'}},{type:'message',id:'discarded',parentId:'a',message:{role:'assistant',content:'Old branch'}},{type:'message',id:'latest',parentId:'a',message:{role:'assistant',content:'Current branch'}}].map(JSON.stringify).join('\n'),'pi');assert.equal(pi.msgs.length,2);assert.equal(pi.msgs[1].blocks[0].text,'Current branch');
  console.log('PASS Gemini, OpenCode and Pi parsing retains the active message branch');
  const own=importer.parseText(JSON.stringify({messages:[{role:'user',text:'Question'},{role:'assistant',blocks:[{type:'text',text:'Answer'},{type:'tool',id:'call',name:'read_file',detail:'{"path":"sample.txt"}',output:'File text',status:'done'}]}]}),'json');assert.equal(own.msgs[1].blocks[0].text,'Answer');assert.equal(own.msgs[1].blocks[1].output,'File text');
  const toolResult=importer.parseText([{type:'session',id:'pi-tool'},{type:'message',message:{role:'assistant',content:[{type:'toolCall',id:'read',name:'read',arguments:{path:'file'}}]}},{type:'message',message:{role:'toolResult',toolCallId:'read',content:[{type:'text',text:'Native tool output'}]}}].map(JSON.stringify).join('\n'),'pi');assert.equal(toolResult.msgs[0].blocks[0].output,'Native tool output');
  const dir=path.join(root,'bulk-native'),files=['first','second','third'].map(name=>path.join(dir,name+'.jsonl'));fs.mkdirSync(dir,{recursive:true});
  for(const [index,file]of files.entries())fs.writeFileSync(file,[{type:'user',sessionId:'batch-'+index,cwd:dir,timestamp:'2026-11-12T00:00:00Z',message:{role:'user',content:'Question '+index}},{type:'assistant',timestamp:'2026-11-12T00:00:01Z',message:{role:'assistant',content:[{type:'text',text:'Answer '+index}]}}].map(JSON.stringify).join('\n'));
  const originals=files.map(file=>fs.readFileSync(file,'utf8'));
  const app=require('express')();app.use(require('express').json({limit:'17mb'}));app.use((req,res,next)=>{req.readOnly=req.headers['x-test-readonly']==='1';next();});
  const sessionsStore={data:{sessions:[{id:'existing',agent:'builtin',messages:[]}]},save:()=>{}},archived=new Set();
  importer.mount(app,{sessionsStore,knownAgent:id=>['claude','codex','builtin','gemini'].includes(id),maybeArchiveSessions:()=>{},isArchived:id=>archived.has(id)});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  async function call(route,method='GET',body,headers={}){const response=await fetch(base+route,{method,headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
  try{
    const route='/api/agent-import/scan?'+new URLSearchParams({agent:'claude',format:'claude',directory:dir});
    assert.equal((await call(route,'GET',null,{'x-test-readonly':'1'})).status,403);
    const scan=(await call(route)).data;assert.equal(scan.items.length,3);
    const first=(await call('/api/agent-import/commit','POST',{agent:'claude',ids:[scan.items[0].id]})).data;assert.equal(first.imported.length,1);assert.equal(sessionsStore.data.sessions.length,2);assert.equal(sessionsStore.data.sessions[0].autoPerms,false);
    const rest=await Promise.all([call('/api/agent-import/commit','POST',{agent:'claude',ids:scan.items.map(i=>i.id)}),call('/api/agent-import/commit','POST',{agent:'claude',ids:scan.items.map(i=>i.id)})]);
    assert.equal(rest.reduce((n,r)=>n+r.data.imported.length,0),2);assert.equal(sessionsStore.data.sessions.length,4);
    const rescanned=(await call(route)).data;assert(rescanned.items.every(i=>i.existingId));
    const archivedId=sessionsStore.data.sessions[0].id;archived.add(archivedId);sessionsStore.data.sessions=sessionsStore.data.sessions.filter(s=>s.id!==archivedId);assert((await call(route)).data.items.some(i=>i.existingId===archivedId&&i.archived));
    for(const [index,file]of files.entries())assert.equal(fs.readFileSync(file,'utf8'),originals[index]);
    console.log('PASS selected/all/concurrent import deduplicates, preserves sources and recognizes archived records');
    const uploaded=(await call('/api/agent-import/preview','POST',{agent:'builtin',format:'json',files:[{name:'export.json',content:JSON.stringify({messages:[{role:'user',content:'Uploaded question'},{role:'assistant',content:'Uploaded answer'}]})}]})).data;
    assert.equal(uploaded.items.length,1);const imported=(await call('/api/agent-import/commit','POST',{agent:'builtin',ids:uploaded.items.map(i=>i.id)})).data;assert.equal(imported.imported.length,1,'existing non-imported sessions cannot shadow uploaded history');
    const invalid=await call('/api/agent-import/commit','POST',{agent:'gemini',ids:scan.items.map(i=>i.id)});assert.equal(invalid.data.errors.length,3);assert.equal(invalid.data.imported.length,0);
    const changed=path.join(dir,'changed.jsonl');fs.copyFileSync(files[0],changed);const changing=(await call(route)).data.items.find(i=>i.path===changed);fs.appendFileSync(changed,'\n{}');const failure=(await call('/api/agent-import/commit','POST',{agent:'claude',ids:[changing.id]})).data;
    // Same native session ID is already imported; duplicate detection wins.
    assert.equal(failure.skipped.length,1);
    assert.equal((await call('/api/agent-import/scan?agent=__proto__&format=json')).status,400);
    console.log('PASS export-file import, source-Agent isolation and malformed requests');
  }finally{await new Promise(resolve=>server.close(resolve));await require('../../lib/store').flushAllStores();}
};
