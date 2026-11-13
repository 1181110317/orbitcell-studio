'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-stop-recovery-')); process.env.AGENTHUB_DATA_DIR = dir;
const bridge = require('../lib/claude-bridge');
const fake = String.raw`
const readline=require('readline');let round=0,timer;
const emit=m=>process.stdout.write(JSON.stringify(m)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='control_request'){clearTimeout(timer);emit({type:'result',result:'',is_error:false,session_id:'retained-session'});return;}if(m.type!=='user')return;round++;emit({type:'system',subtype:'init',session_id:'retained-session'});emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'partial-'+round}}});if(round===2)timer=setTimeout(()=>{emit({type:'assistant',message:{content:[{type:'text',text:'second-round-complete'}]}});emit({type:'result',result:'second-round-complete',is_error:false,session_id:'retained-session'});},4200);}).on('close',()=>process.exit());
`;
bridge.initBridge({ resolveBin: () => process.execPath, agentSettings: () => null, cap: () => ({ streamInput: true, partial: true, settings: false, permMode: false, permPrompt: false }), capsOverride: () => true, claudeStreamFlags: () => [], buildClaudeEnv: () => ({ env: process.env, settingsEnv: {} }), defOf: () => ({ binNames: ['claude'] }), localInvocation: (bin,args,env) => ({ bin,args:['-e',fake,'--',...args],env,shell:false,windowsVerbatimArguments:false }), commandLine: (bin,args) => [bin,...args].join(' '), winToWsl: value => value, mcpClaudeArgs: () => [] });
(async()=>{try {
  let gotFirst; const firstDelta=new Promise(r=>gotFirst=r), firstEvents=[];
  const first=bridge.runStreamTurn({agent:'claude',sessionKey:'cancel-timer',prompt:'first',settings:{}},e=>{firstEvents.push(e);if(e.kind==='delta')gotFirst();});
  await firstDelta; const child=bridge.getSession('cancel-timer').child;
  first.cancel(); await first.done;
  const secondEvents=[],second=bridge.runStreamTurn({agent:'claude',sessionKey:'cancel-timer',prompt:'continue',settings:{}},e=>secondEvents.push(e));
  const result=await Promise.race([second.done,new Promise((_,reject)=>setTimeout(()=>reject(Error('second round timed out')),10000).unref())]);
  assert.equal(result,0);assert(secondEvents.some(e=>e.kind==='text'&&e.text==='second-round-complete'));
  assert.equal(bridge.getSession('cancel-timer').child,child,'continuation keeps the native process');
  assert(!secondEvents.some(e=>/强制停止/.test(e.text||'')),'an earlier interrupt timer cannot kill the continuation');
  const earlyEvents=[],early=bridge.runStreamTurn({agent:'claude',sessionKey:'cancel-before-start',prompt:'never start',settings:{}},e=>earlyEvents.push(e));
  early.cancel();assert.equal(await early.done,130,'a stop in the startup microtask is retained');
  assert(!bridge.getSession('cancel-before-start').child,'startup cancellation never launches a CLI');
  bridge.destroySession('cancel-before-start','test');
  const harness=require('./fixtures/expansion-harness.cjs');
  const h=await harness.create('stop-http');
  let ws;
  try {
    const fakeFile=path.join(h.tmp,'unresponsive-cli.cjs');
    fs.writeFileSync(fakeFile,`if(process.argv.includes('--help')){console.log('--input-format --include-partial-messages');process.exit(0);}if(process.argv.includes('--version')){console.log('Stop fixture');process.exit(0);}const readline=require('readline');const emit=m=>console.log(JSON.stringify(m));readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='user'){emit({type:'system',subtype:'init',session_id:'unresponsive'});emit({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text'}}});emit({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Running'}}});}});setInterval(()=>{},1000);`);
    await h.api('/api/settings','PUT',{agents:{claude:{bin:fakeFile}}});
    const session=(await h.api('/api/sessions','POST',{agent:'claude',cwd:h.work,autoPerms:true})).data;
    const WebSocket=require('ws');ws=new WebSocket(h.base.replace('http','ws')+'/ws?token=fixture-full');await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
    const events=[];ws.on('message',raw=>events.push(JSON.parse(raw)));
    ws.send(JSON.stringify({type:'chat',sessionId:session.id,text:'start'}));
    await h.until(()=>events.some(m=>m.ev?.kind==='delta'));
    const at=Date.now(),stop=await h.api('/api/running/stop-session','POST',{sessionId:session.id});
    assert.equal(stop.status,200);assert(Date.now()-at<1000,'HTTP stop acknowledges without a synchronous process kill');
    const repeated=setInterval(()=>{ws.send(JSON.stringify({type:'chat.cancel',sessionId:session.id}));},200);
    try {
      assert.equal((await h.api('/api/health')).status,200,'the service stays responsive while stopping');
      await h.until(()=>events.some(m=>m.type==='chat.done'&&m.sessionId===session.id),6500);
    } finally {clearInterval(repeated);}
    assert(Date.now()-at<5000,'repeated stop requests do not restart the 3-second forced-stop deadline');
    assert(events.some(m=>m.ev?.stopping===true),'stopping feedback reaches the browser immediately');
    assert.equal((await h.api('/api/sessions/'+session.id)).data.lastRun.stopped,true);
    // Stop as soon as the startup reservation is announced, before bridge initialization.
    const startup=(await h.api('/api/sessions','POST',{agent:'claude',remoteHostId:'',cwd:h.work})).data;
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='chat.started'&&m.sessionId===startup.id)ws.send(JSON.stringify({type:'chat.cancel',sessionId:startup.id}));});
    ws.send(JSON.stringify({type:'chat',sessionId:startup.id,text:'cancel startup'}));
    await h.until(()=>events.some(m=>m.type==='chat.done'&&m.sessionId===startup.id),6500);
    assert.equal((await h.api('/api/health')).status,200,'startup cancellation cannot hit an uninitialized callback');
  } finally {ws?.close();await h.stop();}
  console.log('[stop-recovery] native continuation, pre-start cancellation, responsive HTTP stop, immediate feedback and bounded forced stop passed');
}catch(error){console.error(error);process.exitCode=1;}finally{bridge.destroySession('cancel-timer','test');fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}})();
