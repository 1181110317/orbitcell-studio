'use strict';
// Backend contracts use HTTP and WebSocket. Browser coverage lives in the CUA
// acceptance record so UI tests do not depend on the retired modal selectors.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),WebSocket=require('ws');
const {create}=require('./fixtures/expansion-harness.cjs');
let h,upstream,chat,checks=0,failCatalog=false,brokenCatalog=false,modelRequests=0;
const sockets=new Set(),calls=[],output=process.env.AH_MODEL_ARTIFACT_DIR||path.join(require('node:os').tmpdir(),'agenthub-model-center');
const check=(yes,label)=>{assert(yes,label);checks++;console.log('  PASS '+label);};
const rawModels=[{id:'group/team',display_name:'团队推理模型',owned_by:'fixture',context_window:1000000,modalities:{input:['text','image']},reasoning:true,reasoning_levels:['low','high']},...Array.from({length:110},(_,i)=>({id:'fixture/model-'+i,display_name:'Model '+i,context_length:128000})),{id:'fixture/xss',display_name:'<img src=x onerror="window.__mcPwn=1">'},{id:'group/team'},{id:''}];
async function api(url,method='GET',body){const r=await h.api(url,method,body);assert.equal(r.status,200,url+': '+JSON.stringify(r.data));return r.data;}
(async()=>{try{
  fs.mkdirSync(output,{recursive:true});
  upstream=http.createServer(async(req,res)=>{
    if(req.url==='/page'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Browser fixture</title><input id="human" style="position:absolute;left:20px;top:20px;width:210px;height:40px"><h1 style="margin-top:120px">BROWSER_DOCK_FIXTURE</h1>');return;}
    const bytes=[];for await(const b of req)bytes.push(b);const body=bytes.length?JSON.parse(Buffer.concat(bytes).toString()):{};
    calls.push({url:req.url,body,key:req.headers.authorization});
    if(req.url.endsWith('/models')){modelRequests++;res.setHeader('content-type','application/json');if(failCatalog){res.writeHead(503);res.end('{"error":"fixture offline"}');return;}if(brokenCatalog){res.end('{broken');return;}res.end(JSON.stringify({data:req.url.startsWith('/local')?[{id:'local-new'}]:rawModels}));return;}
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'MAGPIE_GATEWAY_OK'}}]})+'\n\n');res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:4}})+'\n\ndata: [DONE]\n\n');
  });upstream.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+upstream.address().port;
  h=await create('model-center',{magpieUrl:base+'/v1',providers:[{id:'local',agent:'builtin',name:'本机 API',baseUrl:base+'/local/v1',apiKey:'local-fixture-key',protocol:'openai',model:'local-model',models:['local-model']}]});
  const resources=await Promise.all(['/','/model-center.js','/management.js','/management.css','/capabilities.js','/workspace-tools.js'].map(async asset=>{const r=await fetch(h.base+asset+'?token=fixture-full'),item={path:asset,status:r.status,cacheControl:r.headers.get('cache-control')};await r.arrayBuffer();return item;}));
  check(resources.every(r=>r.status===200&&r.cacheControl?.includes('no-store')),'管理中心与侧栏浏览器静态资源返回 200 且不缓存');
  fs.writeFileSync(path.join(output,'static-resources.json'),JSON.stringify(resources,null,2));
  let data=await api('/api/model-center');
  check(data.magpie.connected&&data.magpie.modelCount===112,'自动发现 Magpie 模型，过滤空 ID 与重复项');
  check(data.catalog.some(m=>m.id==='group/team'&&m.context===1000000&&m.group&&m.imageInput&&m.reasoning&&m.efforts.includes('high')),'路由分组、上下文、图片与推理能力进入目录');
  for(const agent of ['claude','codex','zcode','builtin','chatgpt-web'])check((await api('/api/providers?agent='+agent)).some(p=>p.id==='magpie:gateway'&&p.models.includes('group/team')),'Magpie 目录进入 '+agent+' 供应商列表');
  check(modelRequests===1,'并发页面读取复用有时效的目录缓存');
  await api('/api/model-center/magpie','PUT',{baseUrl:base,apiKey:'fixture-center-secret',enabled:true});
  data=await api('/api/model-center');check(!JSON.stringify(data).includes('fixture-center-secret')&&!JSON.stringify(await api('/api/providers?agent=all')).includes('fixture-center-secret'),'网关密钥不会返回管理页或供应商 API');
  const disk=fs.readFileSync(path.join(h.data,'model-center.json'),'utf8');check(JSON.parse(disk).encrypted===1&&!disk.includes('fixture-center-secret'),'网关配置加密保存');
  for(const input of [{baseUrl:'file:///etc/passwd'},{baseUrl:'http://user:secret@localhost/'},{enabled:'yes'},{apiKey:123}])check((await h.api('/api/model-center/magpie','PUT',input)).status===400,'拒绝无效网关配置 '+Object.keys(input)[0]);
  check((await h.api('/api/model-center/magpie','PUT',{},'fixture-read')).status===403,'只读令牌不能更改网关');
  check((await h.api('/api/model-center','GET',undefined,'fixture-read')).status===200,'只读令牌可以查看脱敏目录');
  const route={providerId:'magpie:gateway',model:'group/team',effort:'high'};
  const prior=await api('/api/sessions','POST',{agent:'builtin',cwd:h.work,providerId:'local',model:'local-model',autoPerms:true});
  const profile=await api('/api/model-center/profiles','POST',{name:'日常开发',routes:{claude:route,codex:route,builtin:route}});
  check((await h.api('/api/model-center/profiles','POST',{name:'日常开发',routes:{}})).status===409,'档案重名时拒绝覆盖');
  check((await h.api('/api/model-center/profiles','POST',{name:'bad',routes:{claude:{...route,providerId:'missing'}}})).status===409,'档案拒绝不存在的连接');
  const variant=await api('/api/model-center/profiles','POST',{name:'部分 Agent 变体',routes:{claude:route}});
  check(Object.keys(variant.routes).length===1&&variant.routes.claude.model==='group/team','复制变体可以只包含选中的 Agent');
  check(Object.keys((await api('/api/model-center')).profiles.find(p=>p.id===profile.id).routes).length===3,'保存变体保留原预设与其分配范围');
  const edited=await api('/api/model-center/profiles/'+variant.id,'PUT',{name:'已编辑的覆盖预设',routes:{codex:route}});
  check(edited.id===variant.id&&edited.name==='已编辑的覆盖预设'&&Object.keys(edited.routes).join()==='codex','已有覆盖预设可以原位编辑名称与 Agent 分配');
  check((await h.api('/api/model-center/profiles/'+variant.id,'PUT',{name:'日常开发',routes:{codex:route}})).status===409,'编辑覆盖预设拒绝重名');
  check((await h.api('/api/model-center/profiles/'+variant.id,'PUT',{name:'只读更改',routes:{codex:route}},'fixture-read')).status===403,'只读用户不能编辑覆盖预设');
  await api('/api/model-center/profiles/'+profile.id+'/apply','POST',{});
  const configured=await api('/api/sessions','POST',{agent:'builtin',cwd:h.work,autoPerms:true});
  check(configured.providerId==='magpie:gateway'&&configured.model==='group/team'&&configured.effort==='high','应用档案后新会话继承分配');
  check((await api('/api/sessions/'+prior.id)).model==='local-model','应用档案保留已有会话配置');
  chat=new WebSocket(h.base.replace('http','ws')+'/ws?token=fixture-full');await new Promise((r,j)=>{chat.once('open',r);chat.once('error',j);});
  const done=new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('model round timed out')),20000);chat.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='chat.done'&&m.sessionId===configured.id){clearTimeout(timer);r(m);}});});chat.send(JSON.stringify({type:'chat',sessionId:configured.id,text:'HELLO_MODEL_CENTER'}));
  const completedRound=await done,completedSession=await api('/api/sessions/'+configured.id),responseText=(completedSession.messages.at(-1)?.blocks||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  check(completedRound.code===0&&responseText.includes('MAGPIE_GATEWAY_OK'),'模型选择完成真实 HTTP/WS 回合'+(completedRound.code===0?'':'；code='+completedRound.code+'；'+responseText.replaceAll('fixture-center-secret','[fixture key]').replaceAll('local-fixture-key','[fixture key]').slice(0,700)));
  check(calls.some(c=>c.url==='/v1/chat/completions'&&c.body.model==='group/team'&&c.key==='Bearer fixture-center-secret'),'模型 ID 与网关密钥传给正确连接');chat.close();chat=null;
  check(calls.some(c=>c.body.model==='group/team'&&c.body.reasoning_effort==='high'),'网关目录声明的推理档位传入真实模型请求，不被降为其他档位');
  check((await api('/api/model-center/magpie','PUT',{effort:'none'})).enabled,'共享关闭推理档位通过后端校验');
  await api('/api/providers/models','POST',{id:'local',refresh:true});
  check((await api('/api/providers?agent=all')).find(p=>p.id==='local').models.includes('local-new'),'强制刷新补入供应商的新模型');
  const gatewayModels=data.providers.find(p=>p.id==='magpie:gateway').models;
  await api('/api/providers/'+encodeURIComponent('magpie:gateway'),'PUT',{enabledModels:['group/team']});
  data=await api('/api/model-center');check(data.catalog.filter(m=>m.providerId==='magpie:gateway').map(m=>m.id).join()==='group/team','Magpie 目录与已添加模型独立保存');
  await api('/api/providers/'+encodeURIComponent('magpie:gateway'),'PUT',{enabledModels:[]});
  data=await api('/api/model-center');check(!data.catalog.some(m=>m.providerId==='magpie:gateway'),'取消全部 Magpie 模型不会回退到整个目录');
  await api('/api/providers/'+encodeURIComponent('magpie:gateway'),'PUT',{enabledModels:gatewayModels});
  failCatalog=true;data=await api('/api/model-center?refresh=1');check(!data.magpie.connected&&data.magpie.cached&&data.catalog.some(m=>m.id==='group/team'),'Magpie 离线时保留缓存并报告错误');failCatalog=false;
  brokenCatalog=true;data=await api('/api/model-center?refresh=1');check(data.magpie.cached&&data.providers.some(p=>p.id==='local'),'无效目录不会清空模型或影响其他连接');brokenCatalog=false;await api('/api/model-center?refresh=1');
  await api('/api/model-center/magpie','PUT',{enabled:false});data=await api('/api/model-center');check(!data.magpie.connected&&!data.providers.some(p=>p.id==='magpie:gateway'),'停用后连接状态和可选模型同步更新');
  await api('/api/model-center/magpie','PUT',{enabled:true});check((await api('/api/model-center')).magpie.connected,'重新启用恢复已保存的网关配置');
  await api('/api/model-center/profiles/'+profile.id,'DELETE');await api('/api/model-center/profiles/'+variant.id,'DELETE');check(!(await api('/api/model-center')).profiles.some(p=>p.id===profile.id||p.id===variant.id),'配置档案可以删除');
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:checks,transport:'HTTP / WebSocket'},null,2));console.log('[model-center] '+checks+' checks passed; '+output);
}catch(e){console.error(e);if(h){console.error(h.errors());}process.exitCode=1;}
finally{chat?.close();if(h){await h.stop();}for(const s of sockets)s.destroy();if(upstream)await new Promise(r=>upstream.close(r));}})();
