'use strict';

const SHARED = new Set(['claude','codex','zcode','dsh','builtin','chatgpt-web']);
function supportsShared(agent, settings) {
  return SHARED.has(agent);
}
function overrides(settings, providerId) { return settings.modelAccess?.[providerId]?.agents || {}; }
function compatible(provider,agent,settings){
  return supportsShared(agent,settings)&&(!provider||((provider.baseUrl||provider.agent===agent)
    && (provider.scope!=='agent'&&provider.shared!==false||provider.agent===agent||agent==='zcode'&&provider.agent==='claude')));
}
function effective(provider, agent, settings) {
  if (!provider) return provider;
  const own = overrides(settings,provider.id)[agent] || {};
  return { ...provider, ...(own.protocol ? {protocol:own.protocol} : {}), ...(own.baseUrl ? {baseUrl:own.baseUrl} : {}) };
}
function enabled(provider, agent, settings) {
  return compatible(provider,agent,settings) && overrides(settings,provider?.id)[agent]?.enabled !== false;
}
function mount(app,{agents,settings,provider,knownAgent}) {
  app.get('/api/model-center/connections/:id/agents',async(req,res)=>{
    const connection=provider(req.params.id);
    if(!connection)return res.status(404).json({error:'模型连接不存在'});
    const detected=await agents.detectAgentsCached(settings.data);
    res.json({providerId:connection.id,agents:detected.map(agent=>({id:agent.id,name:agent.name,
      ready:agent.ready??agent.found,supported:compatible(connection,agent.id,settings.data),
      enabled:enabled(connection,agent.id,settings.data),override:overrides(settings.data,connection.id)[agent.id]||{},
      note:!supportsShared(agent.id,settings.data)?'使用 Agent 原生模型目录，连接与认证由该执行器管理':!compatible(connection,agent.id,settings.data)?'此连接被设为 Agent 专用；编辑连接可调整共享范围':'默认共享；无需逐个分配'}))});
  });
  app.put('/api/model-center/connections/:id/agents',(req,res)=>{
    if(!provider(req.params.id))return res.status(404).json({error:'模型连接不存在'});
    const source=req.body?.agents;
    if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>256)return res.status(400).json({error:'Agent 使用设置格式无效'});
    const clean={};
    try{
      for(const [agent,value] of Object.entries(source)){
        if(['__proto__','prototype','constructor'].includes(agent)||!knownAgent(agent)||!value||typeof value!=='object'||Array.isArray(value))throw Error('Agent 使用设置无效');
        const item={};
        if(value.enabled!=null){if(typeof value.enabled!=='boolean')throw Error('可用标记必须是布尔值');item.enabled=value.enabled;}
        if(value.protocol){if(!['openai','anthropic'].includes(value.protocol))throw Error('请选择 OpenAI 或 Anthropic 协议');item.protocol=value.protocol;}
        if(value.baseUrl){
          if(typeof value.baseUrl!=='string'||value.baseUrl.length>2048)throw Error('Agent 专用 API 地址无效');
          const url=new URL(value.baseUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('Agent 专用地址必须是 http(s)，不能包含账户密码或锚点');
          if([...url.searchParams.keys()].some(key=>/^(?:api[-_]?key|key|access_token|token|authorization|secret|password|auth)$/i.test(key)))throw Error('专用地址不能携带密钥；请使用连接的 API Key');
          item.baseUrl=url.href.replace(/\/$/,'');
        }
        if(Object.keys(item).length)clean[agent]=item;
      }
    }catch(error){return res.status(400).json({error:error.message});}
    const previous=settings.data.modelAccess;
    settings.data.modelAccess={...(previous||{}),[req.params.id]:{agents:clean}};
    if(!settings.saveNow()){settings.data.modelAccess=previous;return res.status(500).json({error:'使用设置保存失败'});}
    res.json({ok:true,agents:clean});
  });
}
module.exports={supportsShared,enabled,effective,mount};
