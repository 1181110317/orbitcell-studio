'use strict';
// Import is a local read and creates OrbitCell history. No source files, CLI
// settings, login state or external processes are modified.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const legacy=require('./import-sessions');
const MAX_FILE=64*1024*1024,MAX_UPLOAD=8*1024*1024;
const formats=Object.freeze([{id:'claude',name:'Claude / CodeBuddy JSONL'},{id:'codex',name:'Codex JSONL'},{id:'gemini',name:'Gemini JSON'},{id:'pi',name:'Pi JSONL'},{id:'opencode',name:'OpenCode 导出 JSON'},{id:'json',name:'通用 JSON / OrbitCell 导出'}]);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const issue=message=>Object.assign(new Error(message),{status:400});
const textOf=content=>typeof content==='string'?content:Array.isArray(content)?content.filter(p=>p&&['text','input_text','output_text'].includes(p.type)).map(p=>p.text||'').join('\n'):'';
function roots(agent,format){
  const home=os.homedir();
  if(format==='claude'){if(/codebuddy/i.test(agent))return [path.join(home,'.codebuddy','projects')];return legacy.roots().filter(r=>r.agent==='claude').map(r=>r.dir);}
  if(format==='codex')return legacy.roots().filter(r=>r.agent==='codex').map(r=>r.dir);
  if(format==='gemini')return [path.join(home,'.gemini','tmp')];
  if(format==='pi')return [path.join(home,'.pi','agent','sessions')];
  return [];
}
function parseText(source,format){
  if(typeof source!=='string'||Buffer.byteLength(source)>MAX_FILE)throw issue('会话文件为空或超过 64 MB');
  if(['claude','codex'].includes(format)){const parsed=legacy.parseText(source,format);if(parsed.cliSessionId==='export')parsed.cliSessionId='';return parsed;}
  let document,events;
  try{if(format==='pi')events=source.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));else document=JSON.parse(source);}catch{throw issue('文件不是有效的 '+(format==='pi'?'JSONL':'JSON'));}
  let title='',cwd='',sourceSessionId='',messages=[];
  if(events){
    const header=events.find(e=>e.type==='session')||{};cwd=header.cwd||'';sourceSessionId=header.id||'';
    const linked=events.filter(e=>e.id&&e.type!=='session'),map=new Map(linked.map(e=>[e.id,e]));
    if(linked.length&&linked.some(e=>e.parentId)){const branch=[],seen=new Set();let e=linked.at(-1);while(e&&!seen.has(e.id)){seen.add(e.id);branch.unshift(e);e=map.get(e.parentId);}events=branch;}
    messages=events.filter(e=>e.type==='message').map(e=>({...e.message,timestamp:e.timestamp||e.message?.timestamp}));
  }else{
    if(!document||typeof document!=='object')throw issue('导出文件缺少会话对象');
    title=document.title||document.info?.title||'';cwd=document.cwd||document.info?.directory||'';sourceSessionId=document.sessionId||document.info?.id||document.id||'';
    messages=Array.isArray(document)?document:document.messages||document.conversation?.messages||[];
    if(!Array.isArray(messages))throw issue('导出文件的 messages 必须是数组');
  }
  const msgs=[];
  for(const raw of messages.slice(0,20000)){
    if(!raw||typeof raw!=='object')continue;
    const info=raw.info||raw,role=({gemini:'assistant',model:'assistant',human:'user',ai:'assistant'})[info.role||info.type]||info.role||info.type;
    const content=raw.parts||raw.blocks||raw.content||raw.text||info.content||'';
    if(role==='toolResult'||role==='tool'){
      const id=raw.toolCallId||raw.tool_call_id||raw.id;
      const block=msgs.flatMap(message=>message.blocks||[]).findLast(part=>part.type==='tool'&&part.id===id);
      if(block){block.output=textOf(content);block.status=raw.isError?'error':'done';}continue;
    }
    if(!['user','assistant'].includes(role))continue;
    const text=textOf(content);const ts=Number(raw.ts)||Date.parse(raw.timestamp||info.time?.created)||Number(raw.timestamp)||Number(info.time?.created)||Date.now();
    if(role==='user'){if(text&&!/^<(?:environment_context|app-context|system-reminder)(?:\s|>|\/)/i.test(text))msgs.push({role,text,ts});continue;}
    const blocks=[];
    if(Array.isArray(content))for(const part of content){
      if(!part||typeof part!=='object')continue;
      if(part.type==='text'&&part.text)blocks.push({type:'text',text:String(part.text)});
      else if(['think','thinking','reasoning'].includes(part.type)&&(part.thinking||part.text))blocks.push({type:'think',text:String(part.thinking||part.text),status:'done'});
      else if(['toolCall','tool_use','tool'].includes(part.type))blocks.push({type:'tool',id:String(part.id||''),name:String(part.name||part.tool||'tool'),detail:typeof part.detail==='string'?part.detail:JSON.stringify(part.arguments||part.input||part.state?.input||{}),output:typeof part.output==='string'?part.output:typeof part.state?.output==='string'?part.state.output:'',status:part.status==='error'||part.state?.status==='error'?'error':'done'});
    }
    if(!blocks.length&&text)blocks.push({type:'text',text});if(blocks.length)msgs.push({role,blocks,ts});
  }
  return {msgs,title:String(title||msgs.find(m=>m.role==='user')?.text||'导入的会话').slice(0,200),cwd:String(cwd).slice(0,4096),cliSessionId:'',sourceSessionId:String(sourceSessionId).slice(0,256),truncated:messages.length>20000};
}
async function filesUnder(dir,max=2000){
  const found=[];let visited=0,truncated=false;
  async function visit(current,depth){
    if(depth>8||found.length>=max||visited++>10000){truncated=true;return;}
    let entries;try{entries=await fs.promises.readdir(current,{withFileTypes:true});}catch{return;}
    for(const e of entries){if(found.length>=max){truncated=true;break;}const target=path.join(current,e.name);if(e.isDirectory())await visit(target,depth+1);else if(e.isFile()&&/\.(jsonl|json)$/i.test(e.name))found.push(target);}
  }
  await visit(dir,0);return {files:found,truncated};
}
function mount(app,{sessionsStore,knownAgent,maybeArchiveSessions,isArchived=()=>false}){
  const previews=new Map();let queue=Promise.resolve();
  const registry=new (require('./store').Store)('session-import-index',{records:{}});
  const previousImport=(fingerprint,agent,source)=>{
    const active=sessionsStore.data.sessions.find(s=>s.imported?.fingerprint===fingerprint||source&&s.agent===agent&&s.imported?.from===source);
    if(active)return {id:active.id,archived:false};
    const saved=registry.data.records?.[fingerprint];return saved&&isArchived(saved.id)?{id:saved.id,archived:true}:null;
  };
  const validAgent=value=>{if(typeof value!=='string'||!value||value.length>160||['__proto__','constructor','prototype'].includes(value)||!knownAgent(value))throw issue('请选择已接入的 Agent');return value;};
  const validFormat=value=>{if(!formats.some(f=>f.id===value))throw issue('不支持的会话格式');return value;};
  function remember(data){const id=crypto.randomUUID();previews.set(id,{...data,at:Date.now()});while(previews.size>4000)previews.delete(previews.keys().next().value);return id;}
  function publicItem(parsed,source,agent,format){
    const fingerprint=hash(agent+'\0'+format+'\0'+(parsed.sourceSessionId||parsed.cliSessionId||source));
    const existing=previousImport(fingerprint,agent,source);
    return {fingerprint,existingId:existing?.id||'',archived:!!existing?.archived,title:parsed.title||'未命名会话',cwd:parsed.cwd||'',messages:parsed.msgs.length,preview:parsed.msgs.find(m=>m.role==='user')?.text?.slice(0,160)||'',truncated:!!parsed.truncated};
  }
  const wrap=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(error.status||500).json({error:error.message});}};
  app.get('/api/agent-import/scan',wrap(async req=>{
    if(req.readOnly)throw Object.assign(issue('只读身份不能扫描导入源'),{status:403});
    const agent=validAgent(req.query.agent),format=validFormat(req.query.format||'json');
    const custom=String(req.query.directory||'').trim();if(custom&&(!path.isAbsolute(custom)||custom.length>4096))throw issue('请选择绝对目录路径');
    const locations=custom?[path.resolve(custom)]:roots(agent,format),items=[],errors=[];let truncated=false;
    for(const location of locations){const listing=await filesUnder(location);truncated ||= listing.truncated;
      for(const file of listing.files){try{const stat=await fs.promises.stat(file);if(stat.size>MAX_FILE||!stat.size)continue;
        const parsed=parseText(await fs.promises.readFile(file,'utf8'),format);if(!parsed.msgs.length)continue;
        const item=publicItem(parsed,file,agent,format),id=remember({agent,format,file,mtime:stat.mtimeMs,bytes:stat.size,...item});
        items.push({id,path:file,mtime:stat.mtimeMs,bytes:stat.size,...item});
      }catch(error){if(errors.length<20)errors.push({name:path.basename(file),error:error.message});}}
    }
    return {items:items.sort((a,b)=>b.mtime-a.mtime),locations,truncated,errors,formats};
  }));
  app.post('/api/agent-import/preview',wrap(req=>{
    const agent=validAgent(req.body?.agent),format=validFormat(req.body?.format||'json');
    if(!Array.isArray(req.body.files)||req.body.files.length<1||req.body.files.length>20)throw issue('每次选择 1–20 个导出文件');
    const items=[],errors=[];
    for(const file of req.body.files){try{if(typeof file?.name!=='string'||typeof file.content!=='string'||Buffer.byteLength(file.content)>MAX_UPLOAD)throw issue('导出文件需小于 8 MB');
      const parsed=parseText(file.content,format);if(!parsed.msgs.length)throw issue('没有可导入的用户或助手消息');
      const source='export:'+hash(file.content),item=publicItem(parsed,source,agent,format),id=remember({agent,format,parsed,source,...item});items.push({id,path:file.name,bytes:Buffer.byteLength(file.content),mtime:Date.now(),...item});
    }catch(error){errors.push({name:String(file?.name||'文件'),error:error.message});}}
    return {items,errors,formats};
  }));
  app.post('/api/agent-import/commit',wrap(req=>{
    const agent=validAgent(req.body?.agent),ids=req.body?.ids;
    if(!Array.isArray(ids)||ids.length<1||ids.length>2000||ids.some(id=>typeof id!=='string'))throw issue('请选择 1–2000 个会话');
    const run=async()=>{const imported=[],skipped=[],errors=[];
      for(const id of new Set(ids)){try{const entry=previews.get(id);if(!entry||entry.agent!==agent||Date.now()-entry.at>30*60000)throw issue('预览已失效，请重新扫描');
        const existing=previousImport(entry.fingerprint,agent,entry.file||entry.source);
        if(existing){skipped.push({id,sessionId:existing.id});continue;}
        if(entry.file){const stat=await fs.promises.stat(entry.file);if(stat.mtimeMs!==entry.mtime||stat.size!==entry.bytes)throw issue('源文件已更新，请重新扫描');}
        const parsed=entry.parsed||parseText(await fs.promises.readFile(entry.file,'utf8'),entry.format);if(!parsed.msgs.length)throw issue('源文件没有消息');
        const now=Date.now(),native=agent==='claude'&&entry.format==='claude'&&entry.file&&roots(agent,'claude').some(dir=>{const rel=path.relative(path.resolve(dir),entry.file);return !!rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);});
        const session={id:'s'+crypto.randomUUID().replaceAll('-',''),agent,title:String(parsed.title||'导入的会话').slice(0,200),model:'',providerId:'',remoteHostId:'',cwd:parsed.cwd||'',autoPerms:false,permMode:'ask',effort:'',titled:true,cliSessionId:native?parsed.cliSessionId||'':'',createdAt:parsed.msgs[0]?.ts||now,updatedAt:parsed.msgs.at(-1)?.ts||now,messages:parsed.msgs,imported:{from:entry.file||entry.source,at:now,messages:parsed.msgs.length,fingerprint:entry.fingerprint,format:entry.format,historyOnly:!native}};
        sessionsStore.data.sessions.unshift(session);registry.data.records||={};registry.data.records[entry.fingerprint]={id:session.id,at:now};imported.push({id,sessionId:session.id,title:session.title});
      }catch(error){errors.push({id,error:error.message});}}
      if(imported.length){sessionsStore.save();registry.save();maybeArchiveSessions();}return {imported,skipped,errors};
    };
    const task=queue.then(run,run);queue=task.catch(()=>{});return task;
  }));
}
module.exports={mount,parseText,roots,formats};
