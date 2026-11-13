'use strict';
// Real CLI/WS/DOM regression. Uses only temporary fixture data and an inert CLI.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const WebSocket = require('ws');
const harness = require('./fixtures/expansion-harness.cjs');
const { makeClaudeParser } = require('../lib/claude-parser');
const INTRO = '向日葵在启动项中；ToDesk 还需要检查计划任务和服务。\n\n先核对配置，再分别处理。';
const THOUGHT = '检查启动入口，并保留各项验证结果。';
const ANSWER = '两个软件的启动项已检查。\n\n| 应用 | 检查结果 |\n| --- | --- |\n| 向日葵 | 已核对 |\n| ToDesk | 已核对 |\n\n以上是本轮检查结果。';
let h, browser, debug, cdpSession, sequence = 0;
const calls = new Map();
async function ev(expression) { const r = await browser.evaluateJs(expression); assert(r.ok, r.error); return r.value; }
function cdp(method, params = {}, sessionId = cdpSession) {
  return new Promise((resolve, reject) => {
    const id = ++sequence; calls.set(id, { resolve, reject });
    debug.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function shot(name, selector) {
  if (!process.env.AGENTHUB_UI_SHOTS) return;
  await h.wait(220);
  fs.mkdirSync(process.env.AGENTHUB_UI_SHOTS, { recursive: true });
  const clip = selector ? await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.max(0,r.x-10),y:Math.max(0,r.y-10),width:r.width+20,height:r.height+20,scale:1}})()`) : null;
  const result = await cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(process.env.AGENTHUB_UI_SHOTS, name + '.png'), Buffer.from(result.data, 'base64'));
}
async function until(expression) { await h.until(() => ev(expression)); }
async function footerRows() {
  return ev(`(()=>{const tail=qaSt.el.querySelector('.live-turn-tail'),state=tail.querySelector('.stream-progress'),usage=tail.querySelector('.live-usage'),a=state.getBoundingClientRect(),b=usage.getBoundingClientRect();return {twoRows:b.top>=a.bottom+6,aligned:Math.abs(a.left-b.left)<1,statusHeight:a.height,usageHeight:b.height,stack:getComputedStyle(tail).flexDirection}})()`);
}
async function wheel(selector, deltaY, edge = false) {
  const point = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:${edge ? 'r.right-24' : 'r.x+r.width/2'},y:r.y+Math.min(r.height/2,180)}})()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY });
  await h.wait(140);
}
(async () => {
  try {
    h = await harness.create('streaming-layout');
    const fake = path.join(h.tmp, 'streaming-cli.cjs');
    const gate = name => path.join(h.tmp, name);
    fs.writeFileSync(fake, `
const fs = require('fs'), readline = require('readline');
if(process.argv.includes('--help')){console.log('--input-format --include-partial-messages --settings --permission-mode --permission-prompt-tool');process.exit(0);}
if(process.argv.includes('--version')){console.log('Streaming layout fixture 1.0');process.exit(0);}
const send=x=>console.log(JSON.stringify(x)), stream=e=>send({type:'stream_event',event:e});
const untilFile=file=>new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(file)){clearInterval(timer);resolve();}},20);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
send({type:'system',subtype:'init',session_id:'streaming-layout-native'});
readline.createInterface({input:process.stdin}).on('line',async line=>{
 let message;try{message=JSON.parse(line);}catch{return;}if(message.type!=='user')return;
 stream({type:'message_start',message:{id:'first',model:'fixture-only',usage:{input_tokens:40,cache_read_input_tokens:960,cache_creation_input_tokens:0}}});
 stream({type:'content_block_start',index:0,content_block:{type:'thinking'}});
 stream({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:${JSON.stringify(THOUGHT)}}});
 send({type:'assistant',message:{id:'first',content:[{type:'thinking',thinking:${JSON.stringify(THOUGHT)}}]}});
 stream({type:'content_block_stop',index:0});
 stream({type:'content_block_start',index:1,content_block:{type:'text'}});
 for(const text of ${JSON.stringify(INTRO.match(/.{1,8}|\n/g))}){stream({type:'content_block_delta',index:1,delta:{type:'text_delta',text}});await sleep(25);}
 await untilFile(${JSON.stringify(gate('start-tool'))});
 send({type:'assistant',message:{id:'cli-wrapper',content:[{type:'text',text:${JSON.stringify(INTRO)}}]}});
 stream({type:'content_block_stop',index:1});
 stream({type:'content_block_start',index:2,content_block:{type:'tool_use',id:'inspect-tool',name:'Bash',input:{}}});
 await untilFile(${JSON.stringify(gate('finish-args'))});
 stream({type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"command":"inspect startup",'}});
 await sleep(30);
 stream({type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'"description":"检查启动项和服务"}'}});
 stream({type:'content_block_stop',index:2});
 send({type:'assistant',message:{id:'first',content:[{type:'thinking',thinking:${JSON.stringify(THOUGHT)}},{type:'text',text:${JSON.stringify(INTRO)}},{type:'tool_use',id:'inspect-tool',name:'Bash',input:{command:'inspect startup',description:'检查启动项和服务'}}]}});
 await untilFile(${JSON.stringify(gate('finish-tool'))});
 send({type:'user',message:{content:[{type:'tool_result',tool_use_id:'inspect-tool',content:'Checks passed',is_error:false}]}});
 stream({type:'message_delta',usage:{output_tokens:60}});
 stream({type:'message_stop'});
 stream({type:'message_start',message:{id:'final',model:'fixture-only'}});
 stream({type:'content_block_start',index:0,content_block:{type:'text'}});
 for(const text of ${JSON.stringify(ANSWER.match(/.{1,8}|\n/g))}){stream({type:'content_block_delta',index:0,delta:{type:'text_delta',text}});await sleep(25);}
 await untilFile(${JSON.stringify(gate('finish-answer'))});
 stream({type:'content_block_stop',index:0});
 send({type:'assistant',message:{id:'final',content:[{type:'text',text:${JSON.stringify(ANSWER)}}]}});
 stream({type:'message_stop'});
 send({type:'result',is_error:false,result:${JSON.stringify(ANSWER)},session_id:'streaming-layout-native'});
});
`);
    await h.api('/api/settings', 'PUT', { agents: { claude: { bin: fake } }, theme: 'studio', sound: false });
    const session = (await h.api('/api/sessions', 'POST', { agent: 'claude', cwd: h.work, title: '流式间距与工具刷新验收', permMode: 'auto', autoPerms: true })).data;
    process.env.AGENTHUB_DATA_DIR = path.join(h.tmp, 'browser-data');
    browser = require('../lib/browser-cdp');
    await browser.open(h.base + '/?token=fixture-full');
    await until('typeof S!=="undefined" && !!S.settings && S.wsReady');
    await ev(`openSession(${JSON.stringify(session.id)});true`);
    await until(`S.curSessionId===${JSON.stringify(session.id)}`);
    const status = browser.status(), version = await (await fetch('http://127.0.0.1:' + status.port + '/json/version')).json();
    debug = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r, j) => { debug.once('open', r); debug.once('error', j); });
    debug.on('message', raw => { const m = JSON.parse(raw), p = calls.get(m.id); if (p) { calls.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
    cdpSession = (await cdp('Target.attachToTarget', { targetId: status.targetId, flatten: true }, null)).sessionId;
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ev(`document.getElementById('inpText').value='执行隔离布局验收';document.getElementById('btnSend').click();true`);
    await until(`S.streams.get(S.curSessionId)?.textBuf===${JSON.stringify(INTRO)} && document.querySelector('.streaming .blk-text')?.textContent.includes('再分别处理。')`);
    assert(await ev(`(()=>{const tail=document.querySelector('.streaming .live-turn-tail');return tail?.querySelector('.stream-progress')&&tail.querySelector('.live-usage-pending')?.textContent.includes('用量待上报')&&!tail.querySelector('[data-reply-usage]')})()`), 'the bottom status and elapsed time appear before the first usage report without fake zero metrics');
    const before = await ev(`(()=>{window.qaSt=S.streams.get(S.curSessionId);window.qaP=qaSt.textBlk.querySelector('p');window.qaText=qaP.firstChild;return {height:qaSt.textBlk.getBoundingClientRect().height,y:qaP.getBoundingClientRect().y,scroll:document.getElementById('messages').scrollTop,line:getComputedStyle(qaP).lineHeight}})()`);
    fs.writeFileSync(gate('start-tool'), '1');
    await until(`S.streams.get(S.curSessionId)?.toolCards.has('inspect-tool')`);
    const moved = await ev(`({height:qaSt.el.querySelector('.blk-text').getBoundingClientRect().height,y:qaP.getBoundingClientRect().y,scroll:document.getElementById('messages').scrollTop,line:getComputedStyle(qaP).lineHeight,same:qaP===qaSt.el.querySelector('.turn-commentary p')&&qaText===qaP.firstChild,tools:qaSt.toolCards.size,body:!!qaSt.toolCards.get('inspect-tool').querySelector('.step-body'),detail:qaSt.toolCards.get('inspect-tool').dataset.detail})`);
    assert.equal(moved.height, before.height, 'moving prose under the process never changes its height');
    assert.equal(moved.y+moved.scroll, before.y+before.scroll, 'existing prose keeps its content position while the viewport may follow a new category row');
    assert.equal(moved.line, before.line); assert(moved.same, 'completion and relocation retain paragraph and text nodes');
    assert.equal(moved.tools, 1); assert.equal(moved.detail, '', 'the tool appears before parameters finish'); assert(!moved.body, 'closed live details are not rendered');
    assert(await ev(`(()=>{const font=getComputedStyle(qaP).fontSize;return ['.tool-group-summary','.tool-group-label','.tool-group-count','.tool-group-state','.step-head'].every(selector=>[...qaSt.el.querySelectorAll(selector)].every(node=>getComputedStyle(node).fontSize===font))})()`), 'group titles, counts, states and concrete tool headings match the body font size');
    assert((await footerRows()).twoRows, 'status and pending usage occupy distinct rows from the start');
    assert(await ev(`(()=>{const prose=getComputedStyle(qaP),tool=getComputedStyle(qaSt.toolCards.get('inspect-tool').querySelector('.step-title'));return prose.color!==tool.color&&prose.fontSize===tool.fontSize})()`),'answer prose and tool headings have distinct colors with the same font size');
    assert.deepEqual(await ev(`(()=>{const group=qaSt.toolCards.get('inspect-tool').closest('.tool-group');window.qaCategoryBreakdown=group.querySelector('.tool-group-breakdown');return {open:group.open,count:group.querySelector('.tool-group-count').textContent,categories:qaCategoryBreakdown.childElementCount,icon:!!group.querySelector('.tool-group-icon svg')}})()`),{open:true,count:'1 次',categories:0,icon:true},'a single live tool shows its icon and count once in the group heading');
    await shot('00-running-before-usage');
    fs.writeFileSync(gate('finish-args'), '1');
    await until(`qaSt.toolCards.get('inspect-tool').dataset.detail.includes('检查启动项和服务')`);
    await h.wait(80);
    assert.deepEqual(await ev(`({tools:qaSt.el.querySelectorAll('.step-tool').length,thoughts:qaSt.el.querySelectorAll('.step-think').length,prose:qaSt.el.querySelectorAll('.blk-text').length})`), { tools: 1, thoughts: 1, prose: 1 }, 'late snapshots do not repeat or reorder prose/thought/tool records');
    fs.writeFileSync(gate('finish-tool'), '1');
    await until(`qaSt.textBuf===${JSON.stringify(ANSWER)} && !!qaSt.answer.querySelector('table')`);
    assert(await ev(`qaCategoryBreakdown===qaSt.toolCards.get('inspect-tool').closest('.tool-group').querySelector('.tool-group-breakdown')&&!qaCategoryBreakdown.childElementCount`),'tool output/status updates preserve the single-category layout without adding duplicate counts');
    await until(`!!qaSt.el.querySelector('[data-reply-usage]')`);
    assert.equal(await ev(`getComputedStyle(qaSt.el.querySelector('.live-usage>.turn-metrics')).display`), 'none', 'compact live metrics are displayed once and keep the expanded detail source hidden');
    const wideFooter=await footerRows();assert(wideFooter.twoRows&&wideFooter.aligned&&wideFooter.stack==='column', 'reported usage stays on a second row aligned with status on a wide desktop');
    await shot('05-fixed-footer-two-rows', '.streaming .live-turn-tail');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 980, height: 1000, deviceScaleFactor: 1, mobile: false });
    await h.wait(120);
    const narrowFooter=await footerRows();assert(narrowFooter.twoRows&&narrowFooter.aligned, 'narrow desktop width never merges status into the usage row');
    assert(await ev(`(()=>{const row=qaSt.el.querySelector('.reply-usage-summary'),main=row.querySelector('.reply-usage-main').getBoundingClientRect(),meta=row.querySelector('.reply-usage-meta').getBoundingClientRect();return Math.abs(main.top-meta.top)<12&&row.scrollWidth>=row.clientWidth})()`), 'usage metadata remains in its own horizontal row without causing extra vertical jumps');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await h.wait(120);
    assert(await ev(`(()=>{const p=qaSt.answer.previousElementSibling,r=qaSt.answer.getBoundingClientRect(),a=p.getBoundingClientRect();return Math.abs(r.y-a.bottom-16)<1&&getComputedStyle(qaSt.answer,'::before').height==='1px'})()`), 'process and answer have a stable 16px gap and separator');
    await shot('01-streaming-process-and-answer');
    fs.writeFileSync(gate('finish-answer'), '1');
    await until(`!S.running.has(S.curSessionId)&&document.querySelector('.turn-final table')`);
    const full = (await h.api('/api/sessions/' + session.id)).data;
    const reply = full.messages.filter(m => m.role === 'assistant').at(-1);
    assert.deepEqual(reply.blocks.filter(b => b.type === 'text').map(b => b.text), [INTRO, ANSWER], 'only the two actual text blocks persist');
    assert.equal(reply.blocks.filter(b => b.type === 'think').length, 1);
    assert.equal(reply.blocks.filter(b => b.type === 'tool').length, 1);
    assert(!await ev(`document.querySelector('.turn-activity').open`), 'the completed process respects the existing collapsed default');
    assert.equal(await ev(`getComputedStyle(document.querySelector('.turn-summary')).borderBottomColor`), 'rgba(0, 0, 0, 0)', 'the collapsed process does not duplicate the answer separator');
    await shot('02-completed-answer');

    // Compare a single-category and a mixed-category disclosure with the real renderer.
    await ev(`(()=>{const detail=name=>JSON.stringify(name==='Edit'?{file_path:'src/app.js',old_string:'const ready = false;',new_string:'const ready = true;'}:name==='Bash'?{command:'npm test'}:name==='Read'?{file_path:'README.md'}:{query:'startup configuration'});const single=toolGroupHtml([{type:'tool',name:'Bash',detail:detail('Bash'),status:'done'}]);const mixed=toolGroupHtml(Array.from({length:8},(_,i)=>{const name=['Edit','Bash','OtherTool','Read'][i%4];return {type:'tool',name,detail:detail(name),status:'done'}}));const section=document.createElement('div');section.id='qaSummary';section.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;padding:8px';section.innerHTML='<section><div style="margin-bottom:6px;color:var(--muted);font-size:12px">单一类别</div>'+single+'</section><section><div style="margin-bottom:6px;color:var(--muted);font-size:12px">混合类别</div>'+mixed+'</section>';document.querySelector('#messages .msg-wrap').appendChild(section);section.querySelectorAll('.tool-group').forEach(group=>{group.open=true;group.querySelector('.tool-group-body').style.display='none'});return true})()`);
    assert.deepEqual(await ev(`Array.from(document.querySelectorAll('#qaSummary .tool-group')).map(group=>Array.from(group.querySelectorAll('.tool-group-category')).map(chip=>({category:chip.dataset.category,count:chip.querySelector('b').textContent,icon:!!chip.querySelector('svg'),visible:getComputedStyle(chip).display==='flex'})))`),[[],[...['编辑','运行命令','其他工具','读取'].map(category=>({category,count:'2',icon:true,visible:true}))]],'single-category counts appear once while mixed groups retain the category breakdown');
    await ev(`document.getElementById('qaSummary').scrollIntoView({block:'center'});true`);
    await h.wait(100);
    await shot('06-body-size-tool-summary', '#qaSummary');
    await ev(`document.getElementById('messages').style.setProperty('--conversation-body-size','18px');true`);
    assert(await ev(`['.tool-group-summary','.tool-group-label','.tool-group-count'].every(selector=>getComputedStyle(document.querySelector('#qaSummary '+selector)).fontSize==='18px')`), 'custom body-size preferences scale the full tool summary consistently');
    await ev(`document.getElementById('messages').style.removeProperty('--conversation-body-size');document.getElementById('qaSummary').remove();true`);
    const stopDraft=await ev(`(()=>{S.running.add(S.curSessionId);setSendBtn(true);document.getElementById('inpText').value='保留这个尚未发送的草稿';const original=requestStopSession;window.qaStopRequested='';requestStopSession=async id=>{qaStopRequested=id;};try{document.getElementById('btnSend').click();return {requested:qaStopRequested===S.curSessionId,draft:document.getElementById('inpText').value};}finally{requestStopSession=original;S.running.delete(S.curSessionId);setSendBtn(false);document.getElementById('inpText').value='';}})()`);
    assert.deepEqual(stopDraft,{requested:true,draft:'保留这个尚未发送的草稿'},'clicking the stop icon cancels even with a draft and keeps that draft');

    // Controlled event bursts use the real product renderer without another model request.
    await ev(`(()=>{document.querySelector('#messages').innerHTML='<div class="msg-wrap"></div>';const el=ensureStreamingEl();window.qaSt=makeLiveStreamState(S.curSessionId,el);qaSt.startAt=Date.now();S.streams.set(S.curSessionId,qaSt);S.running.add(S.curSessionId);messageFollow.enabled=true;for(let n=0;n<28;n++){handleChatEvent(S.curSessionId,{kind:'text',text:'第 '+n+' 段稳定的正文。'});handleChatEvent(S.curSessionId,{kind:'tool',id:'burst-'+n,name:'Bash',detail:'{}',status:'running'});}return true})()`);
    await h.wait(80);
    assert(await ev(`(()=>{const c=qaSt.toolCards.get('burst-27');window.qaFrame=0;for(let n=0;n<100;n++){handleChatEvent(S.curSessionId,{kind:'tooloutput',id:'burst-27',status:n===99?'done':'running',output:('最新输出 '+n+'\\n').repeat(2000)});if(!qaFrame)qaFrame=qaSt.toolPaintFrame;if(qaSt.toolPaintFrame!==qaFrame)return false;}return qaSt.pendingToolCards.size===1&&!c.querySelector('.step-body')})()`), 'bursts share one frame and never materialize a hidden long output');
    await h.wait(80);
    await ev(`qaSt.toolCards.get('burst-27').open=true;true`);
    await until(`qaSt.toolCards.get('burst-27').querySelector('.step-body')?.textContent.includes('最新输出 99')`);
    await ev(`(()=>{const c=qaSt.toolCards.get('burst-27');window.qaBody=c.querySelector('.step-body');window.qaPre=c.querySelector('.io-text');c.closest('.tool-group').open=false;handleChatEvent(S.curSessionId,{kind:'tooloutput',id:'burst-27',output:'父级折叠时收到的新输出',status:'done'});return true})()`);
    await h.wait(80);
    assert(await ev(`!!qaSt.toolCards.get('burst-27').dataset.lazyStep`));
    await ev(`qaSt.toolCards.get('burst-27').closest('.tool-group').open=true;true`);
    await until(`qaBody.textContent.includes('父级折叠时收到的新输出')`);
    assert(await ev(`qaBody===qaSt.toolCards.get('burst-27').querySelector('.step-body')&&qaPre===qaBody.querySelector('.io-text')`), 'revealing new output keeps existing output nodes');
    await ev(`messageFollow.enabled=true;followMessagesToEnd(S.curSessionId);true`);
    await until(`messagesAtEnd(document.getElementById('messages'))`);
    await wheel('#messages', -440, true);
    assert(await ev(`!messageFollow.enabled&&!messagesAtEnd(document.getElementById('messages'))`), 'a real upward wheel pauses the main viewport');
    await ev(`window.qaScroll=document.getElementById('messages').scrollTop;for(let i=0;i<4;i++){handleChatEvent(S.curSessionId,{kind:'text',text:'继续输出，但保留用户正在阅读的位置。'});handleChatEvent(S.curSessionId,{kind:'tool',id:'paused-'+i,name:'Read',detail:'{}'});}true`);
    await h.wait(160);
    assert.equal(await ev(`document.getElementById('messages').scrollTop`), await ev('qaScroll'), 'continued output and resize observations never pull the reader down');
    await shot('03-paused-reading');
    await wheel('#messages', 80, true);
    assert(!await ev(`messageFollow.enabled`), 'scrolling partway down cannot resume following');
    await wheel('#messages', 20000, true);
    assert(await ev(`messageFollow.enabled&&messagesAtEnd(document.getElementById('messages'))`), 'scrolling to the actual bottom resumes following without a button');
    for (let n = 0; n < 5; n++) {
      await ev(`handleChatEvent(S.curSessionId,{kind:'text',text:'第 ${n+1} 项验证已完成。'});handleChatEvent(S.curSessionId,{kind:'tool',id:'follow-${n}',name:'Bash',detail:'{}'});true`);
      await until(`messagesAtEnd(document.getElementById('messages'))`);
    }
    await ev(`(()=>{const d=document.createElement('div');d.id='qaDelayed';qaSt.timeline.appendChild(d);requestAnimationFrame(()=>{d.style.height='180px';});return true})()`);
    await h.wait(160);
    assert(await ev(`messageFollow.enabled&&messagesAtEnd(document.getElementById('messages'))`), 'delayed content layout follows without requiring another model event');
    await ev(`(()=>{const box=document.getElementById('messages');const spacer=document.getElementById('qaDelayed');spacer.style.height='0px';box.scrollTop=box.scrollTop-30;return true})()`);
    await h.wait(160);
    assert(await ev(`messageFollow.enabled&&messagesAtEnd(document.getElementById('messages'))`), 'an upward reflow adjustment cannot turn off following');

    // A consecutive group has its own limited scroll area. Its output keeps
    // following until the user reads upward, and both levels respect that pause.
    await ev(`(()=>{finishLiveText(qaSt);flushLiveToolCards(qaSt);S.streams.delete(S.curSessionId);S.running.delete(S.curSessionId);document.getElementById('messages').innerHTML='<div class="msg-wrap"></div>';const el=ensureStreamingEl();qaSt=makeLiveStreamState(S.curSessionId,el);S.streams.set(S.curSessionId,qaSt);S.running.add(S.curSessionId);window.AgentHubUsageLive.begin(S.curSessionId,{ts:Date.now()});startElapsed(qaSt);messageFollow.enabled=true;for(let i=0;i<20;i++)handleChatEvent(S.curSessionId,{kind:'tool',id:'long-'+i,name:'Read',detail:JSON.stringify({file_path:'source-'+i+'.js'}),status:'running'});return true})()`);
    await h.wait(160);
    assert(await ev(`(()=>{const b=qaSt.el.querySelector('.tool-group-body');return b.scrollHeight>b.clientHeight+100&&b.scrollHeight-b.clientHeight-b.scrollTop<2})()`), 'long consecutive tool lists follow their latest row');
    await wheel('.streaming .tool-group-body', -180);
    await ev(`window.qaInnerTop=qaSt.el.querySelector('.tool-group-body').scrollTop;window.qaScroll=document.getElementById('messages').scrollTop;handleChatEvent(S.curSessionId,{kind:'tool',id:'long-extra',name:'Read',detail:'{}'});true`);
    await h.wait(160);
    assert.equal(await ev(`qaSt.el.querySelector('.tool-group-body').scrollTop`), await ev('qaInnerTop'), 'reading upward inside a tool list keeps its internal reading position');
    assert.equal(await ev(`document.getElementById('messages').scrollTop`), await ev('qaScroll'), 'internal upward reading also pauses main viewport following');
    await wheel('.streaming .tool-group-body', 20000);
    await wheel('#messages', 20000, true);
    await ev(`handleChatEvent(S.curSessionId,{kind:'tool',id:'long-resumed',name:'Read',detail:'{}'});true`);
    await h.wait(160);
    assert(await ev(`(()=>{const b=qaSt.el.querySelector('.tool-group-body');return messageFollow.enabled&&messagesAtEnd(document.getElementById('messages'))&&b.scrollHeight-b.clientHeight-b.scrollTop<2})()`), 'both levels resume after the user reaches the bottom');
    await shot('04-live-tools-following');

    // Text-only replies must not display an orphan process separator.
    await ev(`(()=>{clearInterval(qaSt.timer);finishLiveText(qaSt);flushLiveToolCards(qaSt);S.streams.delete(S.curSessionId);S.running.delete(S.curSessionId);document.querySelector('#messages').innerHTML='<div class="msg-wrap"></div>';handleChatEvent(S.curSessionId,{kind:'text',text:'普通回答。'});return true})()`);
    assert.equal(await ev(`getComputedStyle(document.querySelector('.turn-answer'),'::before').content`), 'none');

    // Restore two real stored histories, including a long code block. Tab updates
    // and request latency must keep the existing tab strip and reading position.
    await ev(`(()=>{const st=S.streams.get(S.curSessionId);if(st){clearInterval(st.timer);finishLiveText(st);}S.streams.clear();S.running.clear();return true})()`);
    const histories = [];
    for (let i = 0; i < 2; i++) {
      const file = path.join(h.work, 'tab-history-' + i + '.jsonl');
      const text = i === 0 ? '```js\n' + 'const longLine = "' + 'readable code '.repeat(30) + '";\n```\n\n' + Array.from({ length: 50 }, (_, n) => '第 ' + n + ' 段历史消息。').join('\n\n') : '第二个会话的回答。';
      fs.writeFileSync(file, [['user', '标签稳定性验收 ' + i], ['assistant', text]].map(([role, text], n) => JSON.stringify({ type: role, sessionId: 'tabs-' + i, timestamp: new Date(Date.now() + n).toISOString(), message: { role, content: [{ type: 'text', text }] } })).join('\n'));
      const result = await h.api('/api/import', 'POST', { path: file, agent: 'claude' });
      assert.equal(result.status, 200); histories.push(result.data.id);
    }
    const [a, b] = histories;
    await ev(`refreshData().then(()=>openSession(${JSON.stringify(a)}));true`);
    await until(`S.curSessionId===${JSON.stringify(a)}&&!!document.querySelector('[data-codewrap]')`);
    await ev(`(()=>{document.querySelector('[data-codewrap]').click();window.qaHistory=document.querySelector('#messages .msg-wrap');const box=document.getElementById('messages');box.scrollTop=120;messageFollow.enabled=false;window.qaHistoryTop=box.scrollTop;return true})()`);
    await ev(`openSession(${JSON.stringify(b)});true`);
    await until(`S.curSessionId===${JSON.stringify(b)}`);
    await ev(`(()=>{window.qaTabs=[...document.querySelectorAll('[data-session-tab]')];window.qaTabWidths=qaTabs.map(el=>el.getBoundingClientRect().width);window.qaHeaderHeight=document.getElementById('mainHeader').getBoundingClientRect().height;S.running.add(${JSON.stringify(a)});renderSessionTabs();S.running.delete(${JSON.stringify(a)});renderSessionTabs();return true})()`);
    assert(await ev(`qaTabs.every((el,i)=>el===document.querySelectorAll('[data-session-tab]')[i]&&el.getBoundingClientRect().width===qaTabWidths[i])`), 'background running state updates retain tab nodes, order and width');
    await ev(`(()=>{const fetchOriginal=window.fetch;window.fetch=async(...args)=>{const response=await fetchOriginal(...args);if(String(args[0]).includes('/api/sessions/'+${JSON.stringify(a)}))await new Promise(r=>setTimeout(r,160));return response;};document.querySelector('[data-session-tab="${a}"]').click();window.qaPendingSelection=document.querySelector('.session-tab.active')?.dataset.sessionTab===${JSON.stringify(a)}&&document.querySelector('[data-session-tab="${a}"]').getAttribute('aria-busy')==='true';setTimeout(()=>{window.fetch=fetchOriginal;},300);return true})()`);
    assert(await ev('qaPendingSelection'), 'a clicked tab responds immediately while its history is loading');
    await until(`S.curSessionId===${JSON.stringify(a)}`);
    assert(await ev(`(()=>{const box=document.getElementById('messages'),wrap=box.querySelector('.msg-wrap');return qaHistory===wrap&&Math.abs(box.scrollTop-qaHistoryTop)<1&&wrap.querySelector('[data-codewrap]').getAttribute('aria-pressed')==='true'&&wrap.querySelector('.codeblock').classList.contains('is-wrapped')&&[...wrap.querySelectorAll('.msg')].every(node=>getComputedStyle(node).animationName==='none')})()`), 'switching back keeps the history node, scroll position and explicit wrap choice without replaying message animations');
    assert.equal(await ev(`document.getElementById('mainHeader').getBoundingClientRect().height`), await ev('qaHeaderHeight'), 'session metadata does not change the header height');
    await ev(`(()=>{const node=document.querySelector('[data-session-tab="${b}"]');window.qaTabLeft=node.getBoundingClientRect().left;node.focus();renderSessionTabs();return true})()`);
    assert(await ev(`document.activeElement===document.querySelector('[data-session-tab="${b}"]')&&Math.abs(document.activeElement.getBoundingClientRect().left-qaTabLeft)<1`), 'background tab rendering keeps keyboard focus and horizontal position');

    await ev(`openSession(${JSON.stringify(b)});true`); await until(`S.curSessionId===${JSON.stringify(b)}`);
    await ev(`(()=>{const fetchOriginal=window.fetch;window.fetch=async(...args)=>{const response=await fetchOriginal(...args);if(String(args[0]).includes('/api/sessions/'+${JSON.stringify(a)}))await new Promise(r=>setTimeout(r,160));return response;};window.qaClosedLoadDone=false;openSession(${JSON.stringify(a)}).finally(()=>{window.fetch=fetchOriginal;qaClosedLoadDone=true;});closeSessionTab(${JSON.stringify(a)});return true})()`);
    await until('qaClosedLoadDone');
    assert(await ev(`S.curSessionId===${JSON.stringify(b)}&&!S.openTabs.includes(${JSON.stringify(a)})&&!document.querySelector('.session-tab.is-loading')`), 'closing an in-flight tab cancels its late navigation and loading indicator');
    console.log('[streaming-layout-ui] real CLI/WS output, scroll intent, stable tab nodes/geometry, immediate pending selection, wrap/history restoration and cancelled tab navigation passed');
  } finally {
    debug?.close();
    await browser?.stopAll();
    await h?.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
