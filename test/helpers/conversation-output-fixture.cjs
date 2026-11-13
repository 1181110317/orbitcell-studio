'use strict';
// Temporary data + an inert CLI protocol fixture. No real model or SSH calls.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { create } = require('../fixtures/expansion-harness.cjs');
const INTRO = '我先检查输出是否完整，再整理工具记录与文件改动。';
const ANSWER = '已完成本轮检查。\n\n- Agent 的最终回答会直接显示在这里。\n- 工具、思考和权限记录可以分别查看。\n- 文件改动保留准确的新增与删除行数。';
(async () => {
  const h = await create('conversation-output');
  assert(path.resolve(h.tmp).startsWith(path.resolve(require('node:os').tmpdir()) + path.sep) && path.basename(h.tmp).startsWith('ah-conversation-output-'), 'fixture cleanup stays inside its own temporary directory');
  const fake = path.join(h.tmp, 'output-cli.cjs'), gate = path.join(h.tmp, 'finish');
  const css = path.join(h.work, 'src', 'app.css'), notes = path.join(h.work, 'notes.md');
  fs.mkdirSync(path.dirname(css), { recursive: true });
  fs.writeFileSync(css, '.toolbar {\n  gap: 12px;\n}\n');
  fs.writeFileSync(fake, `
const fs=require('fs'),readline=require('readline');
const css=${JSON.stringify(css)},notes=${JSON.stringify(notes)},gate=${JSON.stringify(gate)};
const send=x=>console.log(JSON.stringify(x));
const assistant=(id,content)=>send({type:'assistant',message:{id,model:'fixture-only',content}});
const tool=(id,name,input)=>assistant(id,[{type:'tool_use',id,name,input}]);
const output=(id,text,error=false)=>send({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:text,is_error:error}]}});
if(process.argv.includes('--help')){console.log('--input-format --include-partial-messages --settings --permission-mode --permission-prompt-tool');process.exit(0);}
if(process.argv.includes('--version')){console.log('Output fixture 1.0');process.exit(0);}
send({type:'system',subtype:'init',session_id:'output-native'});
let round=0,index=0,timer,started=false;
const jobs=Array.from({length:12},(_,i)=>({id:'job-'+i,name:i%2?'Bash':'Read',input:i%2?{command:'node --check src/app.js',description:'检查页面脚本与主题布局'}:{file_path:css}}));
function next(){
 if(index<jobs.length){const job=jobs[index];job.id='r'+round+'-job-'+index;tool(job.id,job.name,job.input);send({type:'control_request',request_id:job.id,request:{subtype:'can_use_tool',tool_name:job.name,input:job.input}});return;}
 tool('edit-'+round,'Edit',{file_path:css,old_string:'  gap: 12px;\\n',new_string:'  gap: 8px;\\n  align-items: center;\\n'});output('edit-'+round,'File edited');
 fs.writeFileSync(notes,'# 检查结果\\n\\n输出、权限和文件改动已核对。\\n');
 tool('write-'+round,'Write',{file_path:notes,content:fs.readFileSync(notes,'utf8')});output('write-'+round,'File written');
 tool('plan-'+round,'TodoWrite',{todos:[{content:'检查 Agent 输出与正文显示',status:'completed'},{content:'整理工具与权限记录',status:'completed'},{content:'等待验收并返回结果',status:'in_progress'}]});output('plan-'+round,'Plan updated');
 tool('waiting-'+round,'Bash',{command:'node test/layout-check.js',description:'验证亮色、深色与窄窗口布局'});
 timer=setInterval(()=>{if(!fs.existsSync(gate))return;clearInterval(timer);output('waiting-'+round,'Layout checks passed');send({type:'result',subtype:'success',is_error:false,result:${JSON.stringify(ANSWER)},session_id:'output-native'});},100);
}
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(m.type==='user'&&!started){started=true;round++;
  send({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}});
  send({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:${JSON.stringify(INTRO)}}}});
  send({type:'stream_event',event:{type:'content_block_stop',index:0}});
  assistant('think-'+round,[{type:'thinking',thinking:'核对过程信息、权限记录和最终回答的显示顺序。'}]);
  next();
 }else if(m.type==='control_response'&&String(m.response?.request_id||'').includes('-job-')){
  const job=jobs[index];output(job.id,m.response?.response?.behavior==='deny'?'用户拒绝':job.name==='Read'?'1  .toolbar {\\n2    gap: 12px;\\n3  }':'Syntax check passed');index++;setTimeout(next,15);
 }
});
process.stdin.on('end',()=>{clearInterval(timer);process.exit(0);});
`);
  await h.api('/api/settings', 'PUT', { agents: { claude: { bin: fake } }, theme: 'studio', sound: false });
  const session = (await h.api('/api/sessions', 'POST', { agent: 'claude', cwd: h.work, title: 'Agent 输出与过程排版验收', permMode: 'ask' })).data;
  const info = { ready: true, base: h.base, sessionId: session.id, tmp: h.tmp, work: h.work };
  console.log(JSON.stringify(info));
  if (process.argv.includes('--verify')) {
    const messages = [];
    const socket = new WebSocket(h.base.replace('http:', 'ws:') + '/ws?token=fixture-full');
    try {
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.on('message', async data => {
      const message = JSON.parse(String(data)); messages.push(message);
      if (message.sessionId === session.id && message.ev?.kind === 'permission') await h.api('/api/bridge/respond', 'POST', { sessionId: session.id, requestId: message.ev.pid, action: 'allow', remember: 'project' });
    });
    socket.send(JSON.stringify({ type: 'chat', sessionId: session.id, text: '执行隔离验收', clientId: 'output-verification' }));
    await h.until(() => messages.some(m => m.ev?.kind === 'tool' && m.ev.id?.startsWith('waiting-')));
    fs.writeFileSync(gate, 'finish');
    await h.until(() => messages.some(m => m.type === 'chat.done' && m.sessionId === session.id));
    const full = (await h.api('/api/sessions/' + session.id)).data;
    const reply = full.messages.filter(m => m.role === 'assistant').at(-1);
    assert.deepEqual(reply.blocks.filter(b => b.type === 'text').map(b => b.text), [INTRO, ANSWER], 'streamed commentary and result-only final answer both survive persistence in order');
    assert.equal(messages.filter(m => m.ev?.kind === 'text' && m.ev.text === ANSWER).length, 1);
    assert.equal(messages.filter(m => m.ev?.kind === 'status' && /^已按项目权限记忆允许/.test(m.ev.text)).length, 10);
    assert.equal(reply.files.length, 2);
    assert.equal(reply.permissionAudit.manualCount, 2);
    assert.equal(reply.permissionAudit.records.length, 2);
    assert.equal(reply.permissionAudit.automatic.Read, 5);
    assert.equal(reply.permissionAudit.automatic.Bash, 5);
    assert(reply.permissionAudit.records.every(record => record.label === '已记住本项目' && record.detail));
    assert.equal(messages.filter(m => m.ev?.kind === 'permission-response').length, 2);
    assert.equal(full.lastRun.code, 0);
    await h.until(() => {
      try {
        const stored = JSON.parse(fs.readFileSync(path.join(h.data, 'sessions', session.id + '.json'), 'utf8'));
        return stored.at(-1).permissionAudit?.manualCount === 2 && stored.at(-1).permissionAudit?.automatic?.Read === 5;
      } catch { return false; }
    });
    const health = (await h.api('/api/health')).data;
    assert(health.conversationTimeline.resultTextFallback && health.conversationTimeline.permissionAudit);
    console.log('[conversation-output-integration] native CLI, final-only result, ordered text persistence, 2 manual / 10 automatic durable receipts and successful completion passed');
    } finally { socket.close(); await h.stop(); }
    return;
  }
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async line => {
    try {
      const command = JSON.parse(line);
      if (command.action === 'finish') { fs.writeFileSync(gate, 'finish'); console.log('final answer released'); }
      if (command.action === 'check') {
        const full = (await h.api('/api/sessions/' + session.id)).data;
        console.log(JSON.stringify({ lastRun: full.lastRun, permissionAudit: full.messages.at(-1)?.permissionAudit && { manual: full.messages.at(-1).permissionAudit.manualCount, automatic: full.messages.at(-1).permissionAudit.automatic }, texts: full.messages.filter(m => m.role === 'assistant').flatMap(m => m.blocks || []).filter(b => b.type === 'text').map(b => ({ chars: b.text?.length, intro: b.text === INTRO, final: b.text === ANSWER })) }));
      }
      if (command.action === 'stop') { rl.close(); await h.stop(); console.log('output fixture stopped'); process.exit(0); }
    } catch (error) { console.error(error.stack); }
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
