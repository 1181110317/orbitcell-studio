'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-codex-commentary-'));
process.env.AGENTHUB_DATA_DIR = path.join(tmp, 'data');
const bridge = require('../../lib/codex-bridge');
const cli = `
const readline=require('readline');
const send=o=>console.log(JSON.stringify(o));
const notification=(method,params)=>send({method,params:{threadId:'fixture-thread',...params}});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(m.method==='initialize')return send({id:m.id,result:{userAgent:'fixture'}});
 if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'fixture-thread'}}});
 if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'fixture-turn',status:'inProgress'}}});
  notification('turn/started',{turn:{id:'fixture-turn'}});
  notification('item/started',{item:{type:'agentMessage',id:'intro'}});
  notification('item/agentMessage/delta',{itemId:'intro',delta:'先检查界面。'});
  notification('item/completed',{item:{type:'agentMessage',id:'intro',text:'先检查界面。'}});
  notification('item/started',{item:{type:'commandExecution',id:'command',command:'node --check fixture.js'}});
  notification('item/completed',{item:{type:'commandExecution',id:'command',aggregatedOutput:'passed',status:'completed'}});
  notification('item/completed',{item:{type:'agentMessage',id:'middle',text:'检查完成，开始调整样式。'}});
  notification('item/agentMessage/delta',{itemId:'final',delta:'已经'});
  notification('item/agentMessage/delta',{itemId:'final',delta:'修复。'});
  notification('item/completed',{item:{type:'agentMessage',id:'final',text:'已经修复。'}});
  notification('turn/completed',{turn:{id:'fixture-turn',status:'completed',items:[
   {type:'agentMessage',id:'intro',text:'先检查界面。'},
   {type:'agentMessage',id:'middle',text:'检查完成，开始调整样式。'},
   {type:'agentMessage',id:'final',text:'已经修复。'}
  ]}});
  setTimeout(()=>process.exit(0),350);
 }
});
`;
bridge.initBridge({
  resolveBin: () => process.execPath,
  localInvocation: (bin, args, env) => ({ bin, args: ['-e', cli, '--', ...args], env, shell: false }),
});
(async () => {
  const received = [];
  const turn = bridge.runStreamTurn({
    sessionKey: 'fixture-commentary', agent: 'codex', cwd: tmp, model: 'fixture-model',
    prompt: '检查界面', settings: {}, autoPerms: false, permMode: 'ask',
  }, ev => received.push(ev));
  const deadline = setTimeout(() => { console.error('Codex commentary integration timed out'); process.exitCode = 1; }, 15000);
  assert.equal(await turn.done, 0);
  clearTimeout(deadline);
  assert.deepEqual(received.filter(ev => ev.kind === 'text').map(ev => ev.text),
    ['先检查界面。', '检查完成，开始调整样式。', '已经修复。'], 'native messages stay separate and are emitted exactly once');
  assert(received.findIndex(ev => ev.kind === 'text') < received.findIndex(ev => ev.kind === 'tool'), 'commentary arrives before the command');
  assert.equal(received.filter(ev => ev.kind === 'done').length, 1);
  const child = bridge.getSession('fixture-commentary')?.child;
  if (child && child.exitCode == null) await new Promise(resolve => child.once('exit', resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('[codex-commentary-integration] real stdio handshake, streamed commentary, tool order, non-streamed messages and duplicate turn snapshots passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
