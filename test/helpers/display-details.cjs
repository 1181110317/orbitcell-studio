'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.resolve(__dirname,'../../public/app.js'),'utf8'),part=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)));
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');let format='readable';
const tools=vm.runInNewContext(part('function toolInput(', '\nfunction htmlToolArtifact(')+part('function toolSourceHtml(', '\nfunction htmlArtifactHtml(')+part('function toolIoHtml(', '\nfunction toolCodeExpandHtml(')+';({toolIoHtml})',{
  esc,conversationPref:()=>format,htmlToolArtifact:()=>null,toolReferencePaths:()=>[],toolReferenceHtml:p=>'<a>'+esc(p)+'</a>',highlightLanguage:()=> 'html',toolCodeExpandHtml:()=>'',ioCardHtml:value=>'RAW:'+value,
});
const source='<svg>\n<text id="name">a & b</text>\n</svg>',detail=JSON.stringify({file_path:'C:\\project\\drawing.html',content:source});
const html=tools.toolIoHtml('Write',detail,'',false);assert(html.includes('&lt;svg&gt;\n'));assert(!html.includes('\\n'),'source text is decoded before display');assert(!html.includes('<svg>'),'source HTML stays inert');assert(html.includes('read-gutter'));
format='json';assert(tools.toolIoHtml('Write',detail,'',false).includes('RAW:'+detail),'the original JSON view remains an explicit preference');
const filter=vm.runInNewContext(part('function normalizeAgentSelection(', '\nfunction readAgentSelection(')+';normalizeAgentSelection');
const agents=[{id:'claude'},{id:'codex'}];assert.equal(filter(null,agents),null);assert.deepEqual([...filter(['claude','codex','claude','missing'],agents)],['claude','codex']);assert.equal(filter([],agents).length,0,'clear remains an empty filter rather than silently selecting all');
const live=require('../../public/usage-live.js'),session={id:'session-cache',messages:[{role:'assistant',usage:{input:100,cacheRead:900,cacheCreate:0,output:10,requests:1,cacheKnown:true}},{role:'assistant',usage:{input:900,cacheRead:100,cacheCreate:0,output:20,requests:1,cacheKnown:true}},{role:'assistant',_runStart:1,usage:{input:99999}}]};
const totals=live.sessionTotals(session);assert.equal(totals.input,1000);assert.equal(totals.cacheRead,1000);assert.equal(totals.cacheRead/(totals.input+totals.cacheRead),.5,'session cache is weighted from all input tokens, not the latest request or averaged percentages');
live.begin(session.id);live.observe(session.id,{kind:'usage',usage:{requests:1,input:100,output:3,cacheRead:0,cacheCreate:0,cacheKnown:true}});assert.equal(live.sessionTotals(session).input,1100);assert.equal(live.sessionTotals(session).cacheUnknownRequests,0,'explicit zero cache is reported, not unknown');live.finish(session.id);
const {finalMessages}=require('../../lib/web-research');
const plain=finalMessages([{role:'assistant',content:null,tool_calls:[{id:'x'}]},{role:'tool',content:'Verified excerpt',tool_call_id:'x'}],'openai');assert.equal(plain.length,1);assert.equal(plain[0].role,'user');assert(plain[0].content.includes('Verified excerpt'));assert(!JSON.stringify(plain).includes('tool_call'));
const usageRecord=vm.runInNewContext(part('function replyUsageRecord(', '\nfunction turnUsageDetailsHtml(')+';replyUsageRecord');
assert.equal(usageRecord({input:18970,cacheRead:4568960,output:10120,cacheKnown:true}).total,4598050,'reply total includes input, cached input and output exactly once');
assert.equal(usageRecord({input:0,output:0,requestDetails:[{input:0,output:0,usageKnown:false}]}).known,false,'failed requests with placeholder zero counters are unreported');
assert.equal(usageRecord({input:0,output:0,requestDetails:[{input:0,output:0,usageKnown:true}]}).known,true,'an explicitly reported zero remains a real zero');
assert.equal(usageRecord({input:100,output:30,requestDetails:[{input:100,output:30,usageKnown:true},{usageKnown:false}]}).partial,true,'partial request coverage remains explicit');
assert.equal(usageRecord({}).known,false,'an elapsed-only reply has no reported token total');
assert(usageRecord({input:10,output:20,estimatedRequests:1}).estimated,'live estimated totals keep their approximation marker');
const reply=vm.runInNewContext(part('function replyUsageHtml(', '\nfunction userMessageBodyHtml(')+';replyUsageHtml',{
  replyUsageRecord:usageRecord,window:{AgentHubUsageLive:live,AgentHubIcons:{svg:()=>'<svg></svg>'}},esc,fmtTok:String,fmtDur:value=>value+'ms',
  fmtTime:String,viewPrefBool:()=>true,fmtTokRate:(output,unused,ms)=>({label:'≈'+(output*1000/ms).toFixed(1)+' tok/s'}),
  turnUsageDetailsHtml:()=>'<span class="turn-metric-cache">缓存命中</span>',
});
const recordedUsage={input:100,output:1732,cacheRead:900,cacheCreate:0,cacheKnown:true,usageKnown:true,requests:4,model:'provider/model',requestDetails:[{output:1732,elapsedMs:30125,usageKnown:true}]};
const completedFooter=reply(recordedUsage,40417,1000),liveFooter=reply(recordedUsage,40417,0,true);
assert(completedFooter.includes('请求均速')&&completedFooter.includes('≈57.5 tok/s')&&completedFooter.includes('1/4 次请求有配对数据'),'the displayed rate states its scope and actual paired sample coverage');
assert(liveFooter.includes('已报用量')&&liveFooter.includes('4 次请求已上报')&&liveFooter.includes('data-live="true"'),'live usage identifies completed, reported requests');
assert(liveFooter.includes('reply-usage-summary')&&completedFooter.includes('reply-usage-summary'),'live and completed footers use the same expandable layout');
assert(!reply({output:30,usageKnown:true},10000,0,true).includes('tok/s'),'an in-progress turn never presents an unfinished whole-turn average as request throughput');
assert(reply({output:30,usageKnown:true},10000,0).includes('整轮均速'),'untimed historical usage labels the whole-turn fallback');
console.log('[display-details] decoded inert source, raw view, multi-Agent selection, weighted whole-session cache and tool-free final transcript passed');
