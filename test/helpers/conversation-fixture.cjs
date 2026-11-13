'use strict';
// Isolated manual/CUA fixture. No browser automation or real model requests.
const fs = require('fs'), path = require('path'), readline = require('readline'), assert = require('assert');
const { create } = require('../fixtures/expansion-harness.cjs');
(async () => {
  const h = await create('conversation-controls');
  const fake = path.join(h.tmp, 'claude-fixture.cjs'), gate = path.join(h.work, '.continue-run');
  const sample = path.join(h.work, 'workspace.js');
  fs.writeFileSync(sample, '// 文件与终端布局验收\nexport function greeting(name) {\n  return `Hello, ${name}`;\n}\n\nconsole.log(greeting("OrbitCell"));\n');
  const questions = [
    { header: '界面风格', question: '希望提问和计划采用哪种界面风格？', multiSelect: false, options: [
      { label: '简洁工作台', description: '沿用当前主题、统一文字与间距，减少大色块。' },
      { label: '信息卡片', description: '用更明显的卡片分组呈现内容。' },
      { label: '紧凑列表', description: '优先展示关键内容，详情按需展开。' },
    ] },
    { header: '验收项目', question: '本次需要检查哪些操作？', multiSelect: true, options: [
      { label: '提问与计划', description: '提交后保留紧凑记录，计划显示进度。' },
      { label: '运行说明', description: '中间说明与工具按时间顺序显示。' },
      { label: '文件和终端', description: '文件全屏时也可以使用当前项目终端。' },
    ] },
    { header: '补充说明', question: '是否需要保留原来的工作区与标签两种布局？', multiSelect: false, options: [
      { label: '两种都保留', description: '可继续在左目录右文件与标签模式之间切换。' },
      { label: '只使用工作区', description: '优先使用目录和文件并排的布局。' },
    ] },
  ];
  fs.writeFileSync(fake, `
const fs=require('fs'),readline=require('readline');
const gate=${JSON.stringify(gate)},log=${JSON.stringify(path.join(h.tmp, 'answers.json'))},sample=${JSON.stringify(sample)};
const questions=${JSON.stringify(questions)};
if(process.argv.includes('--help')){console.log('--input-format --include-partial-messages --settings --permission-mode --permission-prompt-tool');process.exit(0);}
if(process.argv.includes('--version')){console.log('Fixture Claude 1.0');process.exit(0);}
const send=value=>console.log(JSON.stringify(value));
const assistant=(id,content)=>send({type:'assistant',message:{id,model:'fixture-only',content,usage:{input_tokens:24,output_tokens:10}}});
send({type:'system',subtype:'init',session_id:'fixture-native'});
let round=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(m.type==='user'){
   round++;const free=JSON.stringify(m.message).includes('自由回答');
   assistant('intro-'+round,[{type:'text',text:'我先检查提问和计划的排版，再验证文件工作区中的终端。运行中的说明应直接显示在这里。'}]);
   assistant('plan-'+round,[{type:'tool_use',id:'plan-'+round,name:'TodoWrite',input:{todos:[
    {content:'对照截图整理提问与计划的显示方式',status:'completed'},
    {content:'验证提交后的记录与运行中的说明',status:'in_progress'},
    {content:'检查文件全屏终端及窄屏布局',status:'pending'}]}}]);
   send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'plan-'+round,content:'Plan updated'}]}});
   assistant('ask-'+round,[{type:'tool_use',id:'ask-'+round,name:'AskUserQuestion',input:{questions:free?[]:questions}}]);
   send({type:'control_request',request_id:'question-'+round,request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:free?[]:questions}}});
 }else if(m.type==='control_response'){
   fs.writeFileSync(log,JSON.stringify(m,null,2));
   send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'ask-'+round,content:'已收到用户回答'}]}});
   assistant('after-'+round,[{type:'text',text:'已收到你的选择。我继续核对运行说明的顺序，工具步骤可单独展开，整段过程持续可见。'}]);
   assistant('read-'+round,[{type:'tool_use',id:'read-'+round,name:'Read',input:{file_path:sample}}]);
   const finish=()=>{send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-'+round,content:fs.readFileSync(sample,'utf8')}]}});assistant('final-'+round,[{type:'text',text:'本轮布局验收完成。提问已收成紧凑记录，运行说明与工具保持时间顺序。'}]);send({type:'result',subtype:'success',is_error:false,result:'验收完成',session_id:'fixture-native'});};
   if(fs.existsSync(gate))finish();else{const timer=setInterval(()=>{if(fs.existsSync(gate)){clearInterval(timer);finish();}},150);}
 }
});
process.stdin.on('end',()=>process.exit(0));
`);
  assert.equal((await h.api('/api/settings', 'PUT', { agents: { claude: { bin: fake } }, theme: 'studio', sound: false })).status, 200);
  const session = (await h.api('/api/sessions', 'POST', { agent: 'claude', cwd: h.work, title: '提问、计划与运行过程验收', permMode: 'ask' })).data;
  process.stdout.write(JSON.stringify({ ready: true, base: h.base, sessionId: session.id, work: h.work, tmp: h.tmp }) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async line => {
    try {
      const command = JSON.parse(line);
      if (command.action === 'finish') { fs.writeFileSync(gate, 'ready'); console.log(JSON.stringify({ finished: true })); }
      if (command.action === 'check') {
        const full = await h.api('/api/sessions/' + session.id);
        const blocks = full.data.messages?.flatMap(m => m.blocks || []) || [];
        const records = blocks.filter(b => b.type === 'question-response');
        const answerFile = path.join(h.tmp, 'answers.json');
        console.log(JSON.stringify({ status: full.status, records, kinds: blocks.map(b => b.type), answers: fs.existsSync(answerFile) ? JSON.parse(fs.readFileSync(answerFile, 'utf8')).response?.response : null }));
      }
      if (command.action === 'stop') { rl.close(); await h.stop(); console.log('fixture stopped'); process.exit(0); }
    } catch (error) { console.error(error.stack); }
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
