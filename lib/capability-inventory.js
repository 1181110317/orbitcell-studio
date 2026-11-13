'use strict';
// Runs unchanged on the selected computer. Return inventory metadata, never
// command arguments, credentials, environment values or configuration contents.
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sharedAgents = ['claude','codex','zcode','gemini','opencode','dsh','builtin','acp'];
const homes = () => {
  const home = os.homedir();
  return {
    claude: process.env.CLAUDE_CONFIG_DIR || path.join(home,'.claude'),
    codex: process.env.CODEX_HOME || path.join(home,'.codex'),
    zcode: process.env.AGENTHUB_ZCODE_DIR || path.join(home,'.zcode'),
    gemini: path.join(home,'.gemini'), opencode: path.join(home,'.config','opencode'),
    dsh: path.join(home,'.dsh'), agents: path.join(home,'.agents'),
  };
};
const id = value => crypto.createHash('sha256').update(value).digest('hex').slice(0,24);
const validAgent = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value) && !['__proto__','constructor','prototype'].includes(value);
async function text(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('配置文件过大');
  return fs.readFile(file,'utf8');
}
function roots(cwd, agent = '') {
  const locations = homes(), out = [];
  for (const [source,home] of Object.entries(locations)) {
    // Older OrbitCell versions imported every executor's skills into .claude.
    // Keep those available to built-in/ACP/custom executors during migration.
    const legacy=source==='claude'&&agent&&!Object.hasOwn(locations,agent);
    const agents = source === 'agents' ? sharedAgents : legacy?[source,agent]:[source];
    if (agent && source !== 'agents' && source !== agent && !legacy) continue;
    if (cwd) out.push({root:path.join(cwd,'.'+source,'skills'),source,scope:'project',agents});
    out.push({root:path.join(home,'skills'),source,scope:'global',agents});
  }
  return out.sort((a,b)=>Number(a.source==='claude'&&agent!==a.source)-Number(b.source==='claude'&&agent!==b.source));
}
async function scanSkills(cwd, disabled = [], options = {}) {
  const off = new Set(disabled), found = [], seen = new Set(), walked = new Set();
  let visited = 0;
  async function walk(dir, descriptor, depth = 0, plugins = false) {
    if (found.length >= 512 || visited++ >= 4000 || depth > (plugins ? 10 : 2)) return;
    let real, entries;
    try { real=await fs.realpath(dir);if(walked.has(real))return;walked.add(real);entries=await fs.readdir(real,{withFileTypes:true}); } catch { return; }
    const skillFile = entries.find(e=>e.isFile()&&e.name==='SKILL.md');
    if (skillFile) {
      try {
        const file=path.join(real,'SKILL.md'), stat=await fs.stat(file), name=path.basename(real);
        if(stat.size>128*1024)return;
        const raw=await text(file);
        if (/^[A-Za-z0-9._-]{1,160}$/.test(name) && !seen.has(file)) {
          seen.add(file);
          found.push({id:id(file),name,description:(/^description:\s*(.+)$/m.exec(raw)?.[1]||'').replace(/^["']|["']$/g,'').slice(0,240),
            scope:descriptor.scope,source:descriptor.source,agents:descriptor.agents,path:file,
            origin:plugins?'plugin':descriptor.origin||'native',enabled:!off.has(name)});
        }
      } catch {}
      return;
    }
    for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
      if ((!entry.isDirectory()&&!entry.isSymbolicLink()) || ['node_modules','.git'].includes(entry.name) || (!plugins&&entry.name==='vendor')) continue;
      await walk(path.join(real,entry.name),descriptor,depth+1,plugins);
    }
  }
  for (const descriptor of roots(cwd,options.agent)) await walk(descriptor.root,descriptor);
  if (!options.agent || ['claude','codex'].includes(options.agent)) {
    for (const agent of options.agent ? [options.agent] : ['claude','codex']) {
      await walk(path.join(homes()[agent],'plugins','cache'),{source:agent,scope:'global',agents:[agent]},0,true);
    }
  }
  return found.sort((a,b)=>Number(b.scope==='project')-Number(a.scope==='project')||a.name.localeCompare(b.name));
}
function publicAddress(config) {
  if (config.url||config.httpUrl) {
    try { const u=new URL(config.url||config.httpUrl);return u.protocol+'//'+u.host+u.pathname; } catch { return 'HTTP 服务器'; }
  }
  return String(config.command || '').split(/[\\/]/).at(-1).slice(0,120) || 'stdio';
}
function parseToml(raw) {
  const result = []; let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const section=/^\s*\[([^\]]+)\]/.exec(line);
    if (section) {
      const match=/^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))$/.exec(section[1]);
      current=match?{name:match[1]||match[2]||match[3],enabled:true}:null;
      if(current)result.push(current);
      continue;
    }
    if(!current)continue;
    const item=/^\s*(command|url|enabled)\s*=\s*("(?:\\.|[^"\\])*"|'[^']*'|true|false)(?:\s*(?:#.*)?)$/.exec(line);
    if(!item)continue;
    if(item[1]==='enabled')current.enabled=item[2]!=='false';
    else {try{current[item[1]]=item[2][0]==="'"?item[2].slice(1,-1):JSON.parse(item[2]);}catch{}}
  }
  return result.filter(c=>c.command||c.url);
}
function parseJson(raw) {
  // Strip comments and trailing commas without touching strings or executing code.
  const noComments=raw.replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g,(all,str)=>str||'');
  return JSON.parse(noComments.replace(/("(?:\\.|[^"\\])*")|,\s*(?=[}\]])/g,(all,str)=>str||''));
}
async function scanMcp(cwd, agent='', internal=false) {
  const locations=homes(), found=[], scanned=new Set(), warnings=[];
  const files=[];
  const add=(file,owner,scope='global')=>{if(!agent||agent===owner)files.push({file,owner,scope});};
  add(process.env.CLAUDE_CONFIG_DIR?path.join(locations.claude,'.claude.json'):path.join(os.homedir(),'.claude.json'),'claude');
  for(const owner of ['claude','zcode','gemini']) {
    add(path.join(locations[owner],'settings.json'),owner);
    if(cwd)add(path.join(cwd,'.'+owner,'settings.json'),owner,'project');
  }
  add(path.join(locations.codex,'config.toml'),'codex');
  if(cwd){add(path.join(cwd,'.codex','config.toml'),'codex','project');add(path.join(cwd,'.mcp.json'),'claude','project');}
  add(path.join(locations.opencode,'opencode.json'),'opencode');
  add(path.join(locations.opencode,'opencode.jsonc'),'opencode');
  if(cwd){add(path.join(cwd,'opencode.json'),'opencode','project');add(path.join(cwd,'opencode.jsonc'),'opencode','project');}
  let pluginDirs=0;
  async function plugins(dir,owner,depth=0) {
    if(depth>9||pluginDirs++>2500)return;
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const entry of entries) {
      if(entry.isFile()&&['.mcp.json','mcp.json'].includes(entry.name))add(path.join(dir,entry.name),owner);
      else if(entry.isDirectory()&&!['node_modules','.git'].includes(entry.name))await plugins(path.join(dir,entry.name),owner,depth+1);
    }
  }
  if(!agent||agent==='claude')await plugins(path.join(locations.claude,'plugins','cache'),'claude');
  for(const {file,owner,scope} of files) {
    if(scanned.has(file))continue;scanned.add(file);
    let raw;
    try{raw=await text(file);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')warnings.push({source:file,message:'配置无法读取'});continue;}
    let entries;
    try {
      if(file.endsWith('.toml'))entries=parseToml(raw);
      else {
        // JSONC accepts comments/trailing commas without evaluating code.
        const data=parseJson(raw), group=data.mcpServers?'mcpServers':'mcp';
        const records=(map,location)=>Object.entries(map||{}).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)).map(([name,cfg])=>({...cfg,name,_location:[...location,name],command:Array.isArray(cfg.command)?cfg.command[0]:cfg.command}));
        entries=records(data[group],[group]);
        if(cwd&&owner==='claude'&&data.projects?.[cwd]?.mcpServers)entries.push(...records(data.projects[cwd].mcpServers,['projects',cwd,'mcpServers']));
      }
    } catch {warnings.push({source:file,message:'配置格式无法解析，请在来源配置中检查'});continue;}
    for(const item of entries) {
      const record={id:id(file+'\0'+JSON.stringify(item._location||item.name)),name:String(item.name).slice(0,160),agent:owner,agents:[owner],scope,source:file,origin:'native',
        enabled:item.enabled!==false&&!item.disabled,canToggle:['codex','opencode'].includes(owner),transport:item.url||item.httpUrl?'http':'stdio',address:publicAddress(item)};
      if(internal)Object.assign(record,{_location:item._location,_raw:raw,_revision:revision(raw)});
      found.push(record);
    }
  }
  return {servers:found,warnings};
}
const revision=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}

// Locate JSON values so edits preserve comments, unrelated settings and secrets.
// The file has already been parsed; this walker only records source spans.
function jsonObject(raw,location) {
  let i=0,match;
  function space(){for(;;){const before=i;while(/\s/.test(raw[i]||'')&&i<raw.length)i++;if(raw.slice(i,i+2)==='//'){i=raw.indexOf('\n',i);if(i<0)i=raw.length;}else if(raw.slice(i,i+2)==='/*'){const end=raw.indexOf('*/',i+2);i=end<0?raw.length:end+2;}if(i===before)return;}}
  function string(){const start=i++;while(i<raw.length){if(raw[i++]==='"')return JSON.parse(raw.slice(start,i));if(raw[i-1]==='\\')i++;}fail('配置字符串不完整');}
  function value(keys){
    space();const start=i,kind=raw[i++],props=[];
    if(kind==='{'){
      space();while(i<raw.length&&raw[i]!=='}'){const key=string();space();if(raw[i++]!==':')fail('配置格式不支持');space();const a=i;value([...keys,key]);props.push({key,start:a,end:i});space();if(raw[i]===','){i++;space();}else break;}
      const close=i;if(raw[i++]!=='}')fail('配置对象不完整');
      if(JSON.stringify(keys)===JSON.stringify(location))match={start,end:i,close,props};
    }else if(kind==='['){space();while(i<raw.length&&raw[i]!==']'){value([...keys,String(i)]);space();if(raw[i]===','){i++;space();}else break;}i++;}
    else if(kind==='"'){i=start;string();}
    else while(i<raw.length&&!/[\s,}\]]/.test(raw[i])&&raw.slice(i,i+2)!=='//'&&raw.slice(i,i+2)!=='/*')i++;
  }
  value([]);if(!match)fail('来源配置已变化，请刷新清单',409);return match;
}
function setJson(raw,location,changes) {
  parseJson(raw);
  for(const [key,val] of Object.entries(changes)){
    const object=jsonObject(raw,location),property=object.props.find(p=>p.key===key),encoded=JSON.stringify(val);
    if(property)raw=raw.slice(0,property.start)+encoded+raw.slice(property.end);
    else{
      const lineStart=raw.lastIndexOf('\n',object.close)+1,indent=/^\s*/.exec(raw.slice(lineStart,object.close))[0];
      const newline=raw.includes('\r\n')?'\r\n':'\n';
      const previous=object.props.at(-1),after=previous?raw.slice(previous.end,object.close):'';
      const comma=previous&&!/^\s*,/.test(after.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,''))?',':'';
      if(comma)raw=raw.slice(0,previous.end)+','+raw.slice(previous.end);
      const end=object.close+comma.length;
      raw=raw.slice(0,end)+newline+indent+'  '+JSON.stringify(key)+': '+encoded+newline+indent+raw.slice(end);
    }
  }
  parseJson(raw);return raw;
}
function tomlSection(raw,name) {
  const lines=raw.split(/(?<=\n)/),target='mcp_servers.'+JSON.stringify(name);let start=-1,end=raw.length,offset=0;
  for(const line of lines){
    const heading=/^\s*\[([^\]]+)\]/.exec(line);
    if(heading){
      if(start>=0){end=offset;break;}
      const key=heading[1];
      if(key===target||key==='mcp_servers.'+name||key==="mcp_servers.'"+name+"'")start=offset+line.length;
    }
    offset+=line.length;
  }
  if(start<0)fail('原生 MCP 已移走，请刷新清单',404);return {start,end};
}
function setToml(raw,name,changes) {
  for(const [key,value] of Object.entries(changes)){
    const {start,end}=tomlSection(raw,name),section=raw.slice(start,end),line=new RegExp('^[ \\t]*'+key+'[ \\t]*=[ \\t]*','m'),match=line.exec(section);
    const encoded=JSON.stringify(value);
    let next;
    if(match){
      const from=match.index+match[0].length;let to=from,depth=0,quote='';
      if(section.slice(from,from+3)==='"""'||section.slice(from,from+3)==="'''")fail('此字段使用多行 TOML 字符串，请在来源配置中编辑');
      for(;to<section.length;to++){
        const ch=section[to];
        if(quote){if(ch==='\\'&&quote==='"')to++;else if(ch===quote)quote='';continue;}
        if(ch==='"'||ch==="'"){quote=ch;continue;}
        if(ch==='['||ch==='{')depth++;else if(ch===']'||ch==='}')depth--;
        if(ch==='#'){if(!depth)break;while(to<section.length&&!/[\r\n]/.test(section[to]))to++;continue;}
        if(/[\r\n]/.test(ch)&&!depth)break;
      }
      if(quote||depth)fail('TOML 字段不完整，请先检查来源配置');
      while(to>from&&/[ \t]/.test(section[to-1]))to--;
      next=section.slice(0,from)+encoded+section.slice(to);
    }else next=section+(section&&!section.endsWith('\n')?'\n':'')+key+' = '+encoded+'\n';
    raw=raw.slice(0,start)+next+raw.slice(end);
  }
  return raw;
}
async function nativeRecord(cwd,agent,serverId) {
  const data=await scanMcp(cwd,agent,true),item=data.servers.find(s=>s.id===serverId);
  if(!item)fail('原生 MCP 不存在或来源已变化，请刷新清单',404);return item;
}
function connectionChanges(body,item) {
  const changes={};
  if(typeof body.command==='string'&&body.command.trim()){
    if(item.transport!=='stdio')fail('此配置使用 HTTP 连接');
    if(body.command.length>1024||/[\0\r\n]/.test(body.command))fail('启动命令无效');
    changes.command=body.command.trim();
  }
  if(body.replaceArgs===true){
    if(item.transport!=='stdio'||!Array.isArray(body.args)||body.args.length>80||body.args.some(a=>typeof a!=='string'||a.length>4096||a.includes('\0')))fail('参数格式无效');
    changes.args=body.args;
  }
  if(typeof body.url==='string'&&body.url.trim()){
    if(item.transport!=='http')fail('此配置使用 stdio 连接');
    let u;try{u=new URL(body.url);}catch{fail('服务器地址无效');}
    if(!['http:','https:'].includes(u.protocol)||body.url.length>4096)fail('需要 HTTP(S) 服务器地址');
    changes.url=body.url.trim();
  }
  if(Object.hasOwn(body,'enabled')){
    if(typeof body.enabled!=='boolean'||!item.canToggle)fail('此 CLI 的原生启停由 CLI 自身管理');
    changes.enabled=body.enabled;
  }
  return changes;
}
async function saveNative(file,raw,next,create=false) {
  if(raw===next)return;
  let stat;
  try{file=await fs.realpath(file);stat=await fs.stat(file);if(await text(file)!==raw)fail('配置在编辑期间已变化，请重新打开后再保存',409);}
  catch(e){if(e.code!=='ENOENT'||!create)throw e;await fs.mkdir(path.dirname(file),{recursive:true});}
  const mode=stat?stat.mode&0o777:0o600,suffix='.agenthub-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex'),temporary=file+suffix+'.tmp';
  // Backups live beside the original and retain its restricted permissions.
  if(stat)await fs.writeFile(file+suffix+'.bak',raw,{flag:'wx',mode});
  try{
    await fs.writeFile(temporary,next,{flag:'wx',mode});
    if(stat&&await text(file)!==raw)fail('配置在编辑期间已变化，请重新打开后再保存',409);
    if(!stat){try{await fs.link(temporary,file);}catch(e){if(e.code==='EEXIST')fail('配置刚被其他程序创建，请刷新后重试',409);throw e;}}
    else await fs.rename(temporary,file);
  }
  finally{await fs.unlink(temporary).catch(()=>{});}
}
async function createNativeMcp(cwd,agent,body) {
  if(!['claude','codex','zcode','gemini','opencode'].includes(agent))fail('此 Agent 使用 OrbitCell/ACP 投递，或需在它自己的配置中安装 MCP');
  if(typeof body.name!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(body.name))fail('服务器名称需要 1–48 个字母、数字、下划线或短横线');
  const project=body.scope==='project',locations=homes();
  if(project&&(!cwd||!path.isAbsolute(cwd)||!(await fs.stat(cwd)).isDirectory()))fail('请选择目标电脑上的项目目录');
  let file;
  if(agent==='claude')file=project?path.join(cwd,'.mcp.json'):process.env.CLAUDE_CONFIG_DIR?path.join(locations.claude,'.claude.json'):path.join(os.homedir(),'.claude.json');
  else if(agent==='codex')file=path.join(project?path.join(cwd,'.codex'):locations.codex,'config.toml');
  else if(agent==='opencode')file=path.join(project?cwd:locations.opencode,'opencode.json');
  else file=path.join(project?path.join(cwd,'.'+agent):locations[agent],'settings.json');
  let raw;try{raw=await text(file);}catch(e){if(e.code!=='ENOENT')throw e;raw='';}
  const item={transport:body.transport==='http'?'http':'stdio',canToggle:['codex','opencode'].includes(agent)};
  const changes=connectionChanges({...body,replaceArgs:item.transport==='stdio',args:body.args||[]},item);
  if(item.transport==='stdio'&&!changes.command||item.transport==='http'&&!changes.url)fail('请填写启动命令或服务器地址');
  let next;
  if(agent==='codex'){
    let exists=false;
    try{tomlSection(raw,body.name);exists=true;}catch(error){if(error.status!==404)throw error;}
    if(exists)fail('已有同名原生 MCP 服务器',409);
    next=raw+(raw&&!raw.endsWith('\n')?'\n':'')+'\n[mcp_servers.'+JSON.stringify(body.name)+']\n'+Object.entries(changes).map(([k,v])=>k+' = '+JSON.stringify(v)).join('\n')+'\n';
  }else{
    raw=raw||'{}\n';const data=parseJson(raw),group=agent==='opencode'?'mcp':'mcpServers';
    if(Object.hasOwn(data[group]||{},body.name))fail('已有同名原生 MCP 服务器',409);
    let config=changes;
    if(agent==='opencode')config=item.transport==='stdio'?{type:'local',command:[changes.command,...changes.args],enabled:true}:{type:'remote',url:changes.url,enabled:true};
    else if(agent==='gemini'&&item.transport==='http')config={httpUrl:changes.url};
    else if(item.transport==='http')config={type:'http',url:changes.url};
    next=data[group]?setJson(raw,[group],{[body.name]:config}):setJson(raw,[],{[group]:{[body.name]:config}});
  }
  // For new JSON files use an empty on-disk baseline, not the "{}" parse seed.
  let baseline;try{baseline=await text(file);}catch(e){if(e.code!=='ENOENT')throw e;baseline='';}
  if(baseline&&baseline!==raw)fail('配置已变化，请刷新后再试',409);
  await saveNative(file,baseline,next,true);
  return {ok:true,source:file};
}
async function nativeMcp(cwd,agent,body,write=false) {
  if(!validAgent(agent))fail('请选择一个 Agent');
  const item=await nativeRecord(cwd,agent,body.id);
  if(!write){const {_raw,_location,_revision,...safe}=item;return {...safe,revision:_revision};}
  if(body.revision!==item._revision)fail('配置在编辑期间已变化，请重新打开后再保存',409);
  const changes=connectionChanges(body,item);
  if(!Object.keys(changes).length)fail('请填写要修改的连接字段');
  let next;
  if(item.agent==='codex')next=setToml(item._raw,item.name,changes);
  else{
    const data=parseJson(item._raw);let config=data;for(const key of item._location)config=config[key];
    if(item.agent==='opencode'){
      if(Object.hasOwn(changes,'command')||Object.hasOwn(changes,'args')){
        changes.command=[changes.command||config.command[0],...(changes.args||config.command.slice(1))];delete changes.args;
      }
    }
    if(Object.hasOwn(changes,'url')&&config.httpUrl&&!config.url){changes.httpUrl=changes.url;delete changes.url;}
    next=setJson(item._raw,item._location,changes);
  }
  await saveNative(item.source,item._raw,next);
  return {ok:true,source:item.source};
}
function importRoot(agent, cwd) {
  const owner=agent==='builtin'||agent==='acp'||!agent?'agents':agent;
  if(!Object.hasOwn(homes(),owner))throw new Error('此 Agent 的原生技能目录尚未支持，可选择共享技能库');
  return cwd?path.join(cwd,'.'+owner,'skills'):path.join(homes()[owner],'skills');
}
async function execute(request={}) {
  const body=request.body||{}, agent=validAgent(body.agent)?body.agent:'';
  const cwd=typeof request.root==='string'?request.root:'';
  if(request.op==='capabilities.mcp-detail')return nativeMcp(cwd,agent,body);
  if(request.op==='capabilities.mcp-update')return nativeMcp(cwd,agent,body,true);
  if(request.op==='capabilities.mcp-create')return createNativeMcp(cwd,agent,body);
  if(request.op==='capabilities.skill-content'){
    const skill=(await scanSkills(cwd,[],{agent})).find(s=>s.id===body.id);
    if(!skill)fail('技能不存在或已移走，请刷新清单',404);
    const content=await text(skill.path);
    if(Buffer.byteLength(content)>128*1024)fail('技能源文件超过 128 KiB');
    return {...skill,content};
  }
  if(request.op==='capabilities.skill-import'){
    const project=body.scope==='project';
    if(project&&(!cwd||!path.isAbsolute(cwd)||(await fs.stat(cwd)).isDirectory()!==true))fail('请选择目标电脑上的项目目录');
    const importer=module.exports._skillImport||require('./skill-import'),destination=importRoot(agent,project?cwd:'');
    const result=Array.isArray(body.files)?importer.importZip(body.files,destination):importer.importSkill(body.source,destination);
    return {ok:true,...result};
  }
  const [skills,mcp]=await Promise.all([scanSkills(cwd,body.disabled||[],{agent}),scanMcp(cwd,agent)]);
  return {skills,...mcp,agent,hostPlatform:process.platform,inventoryVersion:1};
}
module.exports={execute,scanSkills,scanMcp,importRoot,validAgent};
