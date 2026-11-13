'use strict';
// Real stream-json protocol + isolated files; operated manually through CUA.
const fs = require('fs'), path = require('path'), readline = require('readline'), assert = require('assert');
const { create } = require('../fixtures/expansion-harness.cjs');
(async () => {
  const h = await create('conversation-design');
  const fake = path.join(h.tmp, 'design-cli.cjs'), stageFile = path.join(h.tmp, 'stage');
  const css = path.join(h.work, 'src', 'styles', 'app.css'), notes = path.join(h.work, 'implementation.md');
  fs.mkdirSync(path.dirname(css), { recursive: true });
  const before = '.toolbar {\n  gap: 16px;\n  color: var(--text);\n}\n';
  const after = '.toolbar {\n  gap: 8px;\n  align-items: center;\n  color: var(--text);\n}\n';
  fs.writeFileSync(css, before);
  fs.writeFileSync(stageFile, '0');
  const answers = path.join(h.tmp, 'answers.json');
  fs.writeFileSync(fake, `
const fs=require('fs'),readline=require('readline');
const css=${JSON.stringify(css)},notes=${JSON.stringify(notes)},before=${JSON.stringify(before)},after=${JSON.stringify(after)},stageFile=${JSON.stringify(stageFile)},answers=${JSON.stringify(answers)};
if(process.argv.includes('--help')){console.log('--input-format --include-partial-messages --settings --permission-mode --permission-prompt-tool');process.exit(0);}
if(process.argv.includes('--version')){console.log('Isolated UI fixture 1.0');process.exit(0);}
const send=o=>console.log(JSON.stringify(o));
const assistant=(id,content)=>send({type:'assistant',message:{id,model:'fixture-only',content,usage:{input_tokens:40,output_tokens:18}}});
const tool=(id,name,input)=>assistant(id,[{type:'tool_use',id,name,input}]);
const result=(id,content)=>send({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content}]}});
const text=(id,text)=>assistant(id,[{type:'text',text}]);
const steps=['整理权限、提问与计划的共用样式','重构文件改动列表与增删行数','核对执行进度与会话恢复','验证亮色、深色和窄窗口布局'];
let round=0,timer=null;
const plan=done=>{const id='plan-'+round+'-'+done;tool(id,'TodoWrite',{todos:steps.map((content,i)=>({content,activeForm:'正在'+content,status:i<done?'completed':i===done?'in_progress':'pending'}))});result(id,'Plan updated');};
const finish=()=>{text('final-'+round,'本轮验收完成。权限和提问保留紧凑记录，计划步骤与文件增删按实际事件显示。');send({type:'result',subtype:'success',is_error:false,result:'验收完成',session_id:'design-native'});};
const questions=[
 {header:'界面风格',question:'提问和计划采用哪种风格？',options:[{label:'统一工作台',description:'小图标、轻边框，使用当前主题的字体与配色。'},{label:'紧凑列表',description:'优先显示当前步骤与关键操作。'}]},
 {header:'验收范围',question:'本轮需要验证哪些项目？',multiSelect:true,options:[{label:'权限与提问',description:'审批后收为记录，回答提交后不再占满页面。'},{label:'计划与文件',description:'显示真实步骤，以及每个文件的新增和删除行数。'}]}
];
send({type:'system',subtype:'init',session_id:'design-native'});
readline.createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(m.type==='user'){
  round++;clearInterval(timer);
  if(JSON.stringify(m.message).includes('方案文档')){text('doc-intro-'+round,'这是待确认的方案正文。执行清单将在实施任务中单独维护。');tool('doc-'+round,'ExitPlanMode',{plan:'# 统一会话控件\\n\\n## 实施步骤\\n\\n1. 统一权限、提问与计划的边框和字号。\\n2. 显示当前步骤与文件增删行数。\\n3. 验证亮色、深色与窄窗口。\\n\\n完成每一步后更新原生执行清单。'});result('doc-'+round,'Plan recorded');finish();return;}
  text('intro-'+round,'我先统一会话控件的排版，再核对执行进度与文件改动。开始前，需要你确认这次文件编辑。');
  plan(0);
  tool('edit-'+round,'Edit',{file_path:css,old_string:'  gap: 16px;\\n',new_string:'  gap: 8px;\\n  align-items: center;\\n'});
  send({type:'control_request',request_id:'edit-'+round,request:{subtype:'can_use_tool',tool_name:'Edit',input:{file_path:css,old_string:'  gap: 16px;\\n',new_string:'  gap: 8px;\\n  align-items: center;\\n'},permission_suggestions:[{type:'setMode',mode:'acceptEdits',destination:'session'}]}});
 }else if(m.type==='control_response'){
  const reply=m.response?.response||{},rid=m.response?.request_id||'';
  const log=fs.existsSync(answers)?JSON.parse(fs.readFileSync(answers,'utf8')):[];log.push(m);fs.writeFileSync(answers,JSON.stringify(log,null,2));
  if(rid.startsWith('edit-')){
   if(reply.behavior==='deny'){result('edit-'+round,'用户拒绝');finish();return;}
   fs.writeFileSync(css,after);result('edit-'+round,'File edited successfully');
   plan(1);
   text('question-intro-'+round,'文件编辑已获允许。接下来确认风格与验收范围，选择会保留在提问记录中。');
   tool('ask-'+round,'AskUserQuestion',{questions});send({type:'control_request',request_id:'ask-'+round,request:{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions}}});
  }else if(rid.startsWith('ask-')){
   result('ask-'+round,'已收到回答');plan(2);
   text('working-'+round,'已收到你的选择。文件改动显示操作累计增删；缺少旧快照的写入保留实际写入行数。');
   const body='# 验收记录\\n\\n- 权限：紧凑审批与回执\\n- 提问：逐题作答\\n- 计划：原生状态更新\\n- 文件：新增与删除行数\\n';
   tool('write-'+round,'Write',{file_path:notes,content:body});fs.writeFileSync(notes,body);result('write-'+round,'File written successfully');
   let last=Number(fs.readFileSync(stageFile,'utf8'));
   timer=setInterval(()=>{const stage=Number(fs.readFileSync(stageFile,'utf8'));if(stage===last)return;last=stage;if(stage===4){plan(3);text('verify-'+round,'当前进入最后一步：检查主题、窄窗口和刷新恢复。');}if(stage>=5){clearInterval(timer);plan(4);finish();}},100);
  }
 }
});
process.stdin.on('end',()=>{clearInterval(timer);process.exit(0);});
`);
  assert.equal((await h.api('/api/settings', 'PUT', { agents: { claude: { bin: fake } }, theme: 'studio', sound: false })).status, 200);
  const session = (await h.api('/api/sessions', 'POST', { agent: 'claude', cwd: h.work, title: '会话工作台 · 统一设计验收', permMode: 'ask' })).data;
  const history = (await h.api('/api/sessions', 'POST', { agent: 'claude', cwd: h.work, title: '计划正文 · 编辑与预览验收', permMode: 'plan' })).data;
  console.log(JSON.stringify({ ready: true, base: h.base, sessionId: session.id, documentSessionId: history.id, work: h.work, tmp: h.tmp }));
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async line => {
    try {
      const command = JSON.parse(line);
      if (command.action === 'stage') { fs.writeFileSync(stageFile, String(command.stage)); console.log(JSON.stringify({ stage: command.stage })); }
      if (command.action === 'check') {
        const full = (await h.api('/api/sessions/' + session.id)).data;
        const health = (await h.api('/api/health')).data;
        console.log(JSON.stringify({ version: health.conversationTimeline, messages: (full.messages || []).map(m => ({ role: m.role, plan: m.plan, files: m.files?.map(f => ({ path: path.basename(f.path), tool: f.tool, writtenLines: f.writtenLines, snapshotUnavailable: f.snapshotUnavailable })), records: m.blocks?.filter(b => b.type === 'question-response') })), responses: fs.existsSync(answers) ? JSON.parse(fs.readFileSync(answers, 'utf8')).map(m => ({ requestId: m.response?.request_id, behavior: m.response?.response?.behavior, answers: m.response?.response?.updatedInput?.answers })) : [] }));
      }
      if (command.action === 'stop') { rl.close(); await h.stop(); console.log('design fixture stopped'); process.exit(0); }
    } catch (error) { console.error(error.stack); }
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
