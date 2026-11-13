/* Request metadata only. No chat text, credentials, polling or estimated tokens. */
(function(root){
  'use strict';
  const n=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
  const stamp=v=>typeof v==='number'?v:Date.parse(v);
  const day=v=>{const d=new Date(v);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
  const blank=()=>({requests:0,input:0,output:0,cacheRead:0,cacheCreate:0,cacheUnknownRequests:0,usageUnknownRequests:0,estimatedRequests:0,elapsedMs:0,turns:0,durationSamples:0,successes:0,failures:0,known:0,unpricedRequests:0,cost:0});
  function unique(rows){
    const map=new Map();
    for(const [i,row] of (rows||[]).entries()){
      if(!row||typeof row!=='object')continue;
      const key=row.id?'id:'+row.id:'row:'+i,old=map.get(key);
      if(!old)map.set(key,{...row});
      else map.set(key,{...row,...old,...(old.usageKnown!==true&&row.usageKnown===true?row:{})});
    }
    return [...map.values()];
  }
  function totals(rows){
    const t=blank();
    for(const r of unique(rows)){
      t.requests++;const known=r.usageKnown!==false&&['input','output','cacheRead','cacheCreate'].some(k=>r[k]!=null);
      if(!known)t.usageUnknownRequests++;
      else for(const k of ['input','output','cacheRead','cacheCreate'])t[k]+=n(r[k]);
      if(r.cacheKnown!==true)t.cacheUnknownRequests++;
      if(r.tokensEstimated)t.estimatedRequests++;
      for(const k of ['ttftMs','ttftRequests'])t[k]=(t[k]||0)+n(r[k]);
      if(typeof r.success==='boolean'){t.known++;t[r.success?'successes':'failures']++;}
      t.unpricedRequests++;
    }
    t.usageKnown=t.usageUnknownRequests<t.requests;t.cacheKnown=t.requests>0&&!t.cacheUnknownRequests;
    return t;
  }
  function rate(usage,elapsed){
    const rows=unique(usage?.requestDetails),reported=rows.filter(r=>r.usageKnown!==false&&!r.tokensEstimated&&r.output!=null);
    const paired=reported.filter(r=>n(r.elapsedMs)>0);
    const output=paired.reduce((s,r)=>s+n(r.output),0),ms=paired.reduce((s,r)=>s+n(r.elapsedMs),0);
    if(output>0&&ms>0)return {output,ms,value:output/(ms/1000),scope:'request',paired:paired.length,total:Math.max(rows.length,n(usage.requests))};
    const turnOutput=rows.length?reported.reduce((sum,r)=>sum+n(r.output),0):n(usage?.output);
    if(usage?.usageKnown!==false&&!usage?.tokensEstimated&&turnOutput>0&&n(elapsed)>0)return {output:turnOutput,ms:n(elapsed),value:turnOutput/(n(elapsed)/1000),scope:'turn',paired:0,total:Math.max(rows.length,n(usage.requests))};
    return null;
  }
  const runs=new Map(),listeners=new Set();let timer=0,changed=new Set();
  function notify(id){changed.add(id);if(timer)return;timer=setTimeout(()=>{timer=0;const ids=[...changed];changed.clear();for(const fn of listeners)fn(ids);},160);}
  function begin(id,meta={}){
    const previous=runs.get(id),start=stamp(meta.ts)||Date.now();
    if(previous?.active&&Math.abs(previous.startedAt-start)<1000)return previous;
    const state={id,startedAt:start,active:true,rows:new Map(),observed:new Map(),sequence:0,meta:{...meta}};
    runs.set(id,state);while(runs.size>32)runs.delete(runs.keys().next().value);notify(id);return state;
  }
  function observe(id,ev,meta={}){
    if(!['usage','request-usage'].includes(ev?.kind)||!ev.usage)return;
    let state=runs.get(id);if(!state?.active)state=begin(id,meta);
    const rows=ev.usage.requestDetails?.length?ev.usage.requestDetails:ev.usage.lastRequest?[ev.usage.lastRequest]:ev.kind==='request-usage'||ev.usage.requests===1?[ev.usage]:[];
    const target=ev.kind==='request-usage'?state.observed:state.rows;
    for(const row of rows){
      const key=row.id||'event:'+(meta.seq??++state.sequence),old=target.get(key);
      target.set(key,{...old,...row,id:row.id||key,ts:row.ts||new Date(stamp(meta.ts)||Date.now()).toISOString()});
    }
    while(target.size>2000){target.delete(target.keys().next().value);state.partial=true;}
    notify(id);
  }
  function snapshot(id){
    const state=runs.get(id);if(!state?.active)return null;
    const observed=[...state.observed.values()],native=[...state.rows.values()];
    // Match gateway/native IDs. If a gateway is observed it owns this turn's
    // request list; unrelated CLI IDs must not double its bill.
    const rows=observed.length?unique(observed.map(r=>({...native.find(v=>v.id===r.id),...r}))):unique(native);
    const t=totals(rows),last=[...rows].filter(r=>r.usageKnown!==false&&n(r.context)>0).sort((a,b)=>stamp(b.ts)-stamp(a.ts))[0];
    return {...t,requestDetails:rows,lastRequest:last,context:n(last?.context),model:last?.model||state.meta.model||'',startedAt:state.startedAt,elapsedMs:Math.max(0,Date.now()-state.startedAt),ts:Date.now(),live:true,partialRequests:!!state.partial};
  }
  function finish(id){if(runs.has(id)){runs.delete(id);notify(id);}}
  function mergeTotals(a,b){const out={...a};for(const k of Object.keys(blank()))out[k]=n(a?.[k])+n(b?.[k]);for(const k of ['ttftMs','ttftRequests'])out[k]=n(a?.[k])+n(b?.[k]);return out;}
  function sessionTotals(session,ledger){
    let value=ledger?{...ledger}:blank();
    if(!ledger)for(const m of session?.messages||[]){if(m.role!=='assistant'||m._runStart||!m.usage)continue;const u=m.usage,count=n(u.requests)||1,details=u.requestDetails||[];
      value=mergeTotals(value,{...u,requests:count,cacheUnknownRequests:Number.isFinite(u.cacheUnknownRequests)?u.cacheUnknownRequests:details.length===count?details.filter(r=>r.cacheKnown!==true).length:u.cacheKnown===true?0:count,usageUnknownRequests:Number.isFinite(u.usageUnknownRequests)?u.usageUnknownRequests:u.usageKnown===false?count:0});
    }
    const active=snapshot(session?.id);return active?mergeTotals(value,active):value;
  }
  function overlay(data,filter={},sessions=[]){
    const out={...data,totals:{...data?.totals}};
    for(const k of ['byDay','byAgent','byModel','byProvider','bySource','bySession','byProject'])out[k]=(data?.[k]||[]).map(r=>({...r}));
    out.details=[...(data?.details||[])];
    for(const [id,state]of runs){
      const s=sessions.find(v=>v.id===id)||state.meta,live=snapshot(id);if(!live?.requests||filter.source==='ccswitch'||filter.agent&&filter.agent!=='all'&&filter.agent!==s.agent)continue;
      // Active turns belong to today's range, matching the completion-date
      // convention of the ledger. Allocate mixed models from request metadata.
      const date=day(Date.now()),agent=s.agent||'unknown',project=s.cwd||'未标注项目';
      const value={...live,turns:1,durationSamples:1},add=(name,key,valueKey,v=value,extra={})=>{const rows=out[name];let index=rows.findIndex(r=>r[key]===valueKey);const previous=index<0?{}:rows[index];const next={...previous,...mergeTotals(previous,v),[key]:valueKey,...extra};if(index<0)rows.push(next);else rows[index]=next;return next;};
      const nested=(host,key,name,v,label)=>{host[key]={...host[key]};const before=host[key][name]||{};return host[key][name]={...before,...mergeTotals(before,v),[label]:name};};
      out.totals=mergeTotals(out.totals,value);
      const bucket=add('byDay','date',date),agentRow=add('byAgent','agent',agent);
      add('bySource','source','live');add('bySession','sessionId',id,value,{project});add('byProject','project',project);
      const dayAgent=nested(bucket,'agents',agent,value,'agent'),models=new Map(),providers=new Map();
      for(const r of live.requestDetails){const model=r.model||s.model||'unknown',provider=r.provider||'未标注供应商';if(!models.has(model))models.set(model,[]);models.get(model).push(r);if(!providers.has(provider))providers.set(provider,[]);providers.get(provider).push(r);}
      for(const [model,rows]of models){
        const v={...totals(rows),turns:1},modelRow=add('byModel','model',model,v,{agent});
        nested(dayAgent,'models',model,v,'model');nested(agentRow,'models',model,v,'model');nested(modelRow,'agents',agent,v,'agent');nested(bucket,'modelStats',model,v,'model');
        bucket.models={...bucket.models,[model]:n(bucket.models?.[model])+n(v.input)+n(v.output)+n(v.cacheRead)+n(v.cacheCreate)};
      }
      for(const [provider,rows]of providers){const v={...totals(rows),turns:1},providerRow=add('byProvider','provider',provider,v);nested(providerRow,'agents',agent,v,'agent');nested(agentRow,'providers',provider,v,'provider');nested(bucket,'providers',provider,v,'provider');}
      out.details.unshift({...value,sessionId:id,agent:s.agent,model:live.model||s.model,source:'live',date,ts:new Date().toISOString(),live:true});
    }
    return out;
  }
  const api={unique,totals,rate,begin,observe,snapshot,finish,overlay,mergeTotals,sessionTotals,ids:()=>[...runs.keys()],markPartial(id){const state=runs.get(id);if(state){state.partial=true;notify(id);}},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AgentHubUsageLive=api;
})(typeof window==='undefined'?globalThis:window);
