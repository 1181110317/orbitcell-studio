'use strict';
window.AgentHubUsage = (()=>{
  let overviewSubscription=null;
  const n=v=>Math.max(0,Number(v)||0), tokens=r=>n(r.input)+n(r.output)+n(r.cacheRead)+n(r.cacheCreate);
  const model=u=>u.model&&!['unknown','—','<synthetic>'].includes(u.model)?u.model:u.requested||'未记录模型';
  const card=(label,value,sub='')=>`<div class="stat-card"><div class="sc-label"><span>${label}</span>${window.AgentHubIcons.svg(/缓存/.test(label)?'activity':/费用/.test(label)?'chart':/上下文/.test(label)?'grid':/等待|时长|用时|速度|采样/.test(label)?'clock':'chart')}</div><div class="sc-value">${value}</div><div class="sc-sub">${sub}</div></div>`;
  const count=v=>Math.round(n(v)).toLocaleString();
  const cache=t=>{const input=n(t.input)+n(t.cacheRead)+n(t.cacheCreate);return n(t.cacheUnknownRequests)&&!n(t.cacheRead)&&!n(t.cacheCreate)?'未记录':input?((n(t.cacheRead)/input)*100).toFixed(1)+'%'+(n(t.cacheUnknownRequests)?' *':''):'—';};
  const cacheNote=t=>n(t.cacheUnknownRequests)?(n(t.legacyRequests)?'部分调用或历史回合未报告缓存；有 * 的命中率仅供参考':`${count(t.cacheUnknownRequests)} 次调用未报告缓存；有 * 的命中率仅供参考`):'缓存读取 /（普通输入 + 缓存读 + 缓存写）';
  const unknownUsage=t=>n(t.requests)>0&&n(t.usageUnknownRequests)>=n(t.requests);
  const tokenNote=t=>n(t.usageUnknownRequests)?`${count(t.usageUnknownRequests)} 次请求未报告 Token；合计仅包含已报告用量`:'包含普通输入、输出、缓存读与写';
  const costValue=t=>unknownUsage(t)||n(t.requests)>0&&n(t.unpricedRequests)>=n(t.requests)?'—':fmtStatsCost(t.cost);
  const costNote=t=>[n(t.unpricedRequests)?n(t.legacyRequests)?'部分调用或历史回合未定价':count(t.unpricedRequests)+' 次请求未定价':'',n(t.usageUnknownRequests)?n(t.legacyRequests)?'部分调用或历史回合未报告 Token':count(t.usageUnknownRequests)+' 次请求未报告 Token':'',n(t.cacheRead)+n(t.cacheCreate)?'缓存使用默认倍率估算':'','按已报告用量与配置单价估算，非供应商账单'].filter(Boolean).join('；');
  const latency=ms=>ms<1000?Math.round(n(ms))+'ms':(n(ms)/1000).toFixed(2)+'s';
  function firstWaitCard(t,requests=0){
    const samples=n(t.ttftRequests),scope=requests>0?`${count(samples)} / ${count(requests)} 次请求有首字计时`:`${count(samples)} 次请求有首字计时`;
    return card('平均首字等待',samples?latency(n(t.ttftMs)/samples):'未记录',samples?scope+'；仅按已记录样本计算':'尚无首字计时记录');
  }
  function csv(rows,filename){
    const keys=['ts','agent','provider','model','requests','input','output','cacheRead','cacheCreate','usageKnown','cacheKnown','tokensEstimated','cost','unpricedRequests','success','elapsedMs'];
    const cell=v=>'"'+String(v??'').replace(/^[=+\-@]/,"'$&").replace(/"/g,'""')+'"';
    const content='\ufeff'+[keys.join(','),...rows.map(r=>keys.map(k=>cell(r.usageKnown===false&&['input','output','cacheRead','cacheCreate'].includes(k)||r.cacheKnown===false&&['cacheRead','cacheCreate'].includes(k)?'':r[k])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function decorate(data){
    overviewSubscription?.();overviewSubscription=null;
    const body=document.getElementById('dlgBody');if(!body||!data)return;body.classList.add('usage-workspace');
    let displayed=window.AgentHubUsageLive?.overlay(data,statsFilter,S.sessions)||data,rows=displayed.details||[];const overview=body.querySelector('.stats-overview-cards');
    const paintOverview=()=>{const t=displayed.totals||{};
    if(overview)overview.innerHTML=card('Token',unknownUsage(t)?'未记录':(t.estimatedRequests?'≈':'')+fmtTok(tokens(t)),tokenNote(t))
      +card('模型请求',count(n(t.requests)-n(t.legacyRequests)),`${n(t.legacyRequests)?count(t.legacyRequests)+' 个历史回合缺少调用数 · ':''}${count(t.failures)} 次已记录失败`)
      +card('估算费用',costValue(t),costNote(t))
      +card('缓存命中率',cache(t),cacheNote(t))
      +firstWaitCard(t,Math.max(0,n(t.requests)-n(t.legacyRequests)));};paintOverview();
    const latencies=rows.filter(r=>r.source!=='ccswitch').map(r=>n(r.elapsedMs)).filter(Boolean).sort((a,b)=>a-b),p=q=>latencies.length?fmtDurShort(latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*q)-1)]):'—';
    const more=body.querySelector('.stats-more .stat-cards');
    if(more)more.insertAdjacentHTML('afterbegin',card('回合时长 P50 / P95',p(.5)+' / '+p(.95),`${latencies.length} 个有耗时回合，含工具与等待`));
    const toolbar=body.querySelector('.stats-toolbar');if(toolbar)body.prepend(toolbar);
    const controls=document.createElement('div');controls.className='usage-view-controls';controls.innerHTML='<button type="button" class="btn-mini active" data-usage-tab="overview">概览与分布</button><button type="button" class="btn-mini" data-usage-tab="requests">请求记录</button><button type="button" class="btn-mini" id="usageCurrentSession">当前会话统计</button>';
    if(toolbar)toolbar.after(controls);else body.prepend(controls);
    const overviewNodes=[...body.children].filter(el=>el!==toolbar&&el!==controls);
    const panel=document.createElement('section');panel.className='usage-requests hm-box';panel.hidden=true;panel.innerHTML=`<div class="hm-head"><b>请求与回合记录</b><button type="button" class="btn-mini" id="usageExportCsv">导出 CSV</button></div><div class="usage-request-filters"><input id="usageRequestSearch" aria-label="搜索请求" placeholder="搜索模型、供应商、Agent 或会话"><select id="usageRequestState" aria-label="请求结果"><option value="all">全部结果</option><option value="failed">失败</option><option value="success">成功</option><option value="unknown">结果未记录</option></select></div><div class="usage-request-table"></div><div class="usage-request-page"></div>`;body.appendChild(panel);
    let limit=50,filtered=[];
    const draw=()=>{
      const q=panel.querySelector('input').value.toLowerCase(),state=panel.querySelector('select').value;
      filtered=rows.filter(r=>(!q||[r.model,r.provider,r.agent,r.sessionId,r.project].join(' ').toLowerCase().includes(q))&&(state==='all'||state==='failed'&&r.success===false||state==='success'&&r.success===true||state==='unknown'&&typeof r.success!=='boolean'));
      panel.querySelector('.usage-request-table').innerHTML=`<table class="tbl"><thead><tr><th>时间 / 模型</th><th>Agent / 供应商</th><th>请求</th><th>输入</th><th>输出</th><th>缓存读 / 写</th><th>结果</th><th>时长</th></tr></thead><tbody>${filtered.slice(0,limit).map(r=>`<tr><td><time>${esc(new Date(r.ts).toLocaleString())}</time><b>${esc(model(r))}</b></td><td>${esc(agentMeta(r.agent).name||r.agent)}<small>${esc(r.provider)}</small></td><td>${r.legacyRequests?'—':n(r.requests)||1}</td><td>${r.usageKnown===false?'—':fmtTok(r.input)}</td><td>${r.usageKnown===false?'—':fmtTok(r.output)}</td><td>${r.cacheUnknownRequests&&!r.cacheRead&&!r.cacheCreate?'—':fmtTok(r.cacheRead)+' / '+fmtTok(r.cacheCreate)+(r.cacheUnknownRequests?' *':'')}</td><td>${r.success===true?'成功':r.success===false?'失败':'—'}</td><td>${r.elapsedMs?fmtDurShort(r.elapsedMs):'—'}</td></tr>`).join('')||'<tr><td colspan="8" class="empty-cell">没有匹配的请求记录</td></tr>'}</tbody></table>`;
      panel.querySelector('.usage-request-page').innerHTML=`<span>显示 ${Math.min(limit,filtered.length)} / ${filtered.length} 条记录；一条历史回合可能含多个请求。</span>${limit<filtered.length?'<button type="button" class="btn-mini" id="usageRequestMore">显示更多</button>':''}`;
      panel.querySelector('#usageRequestMore')?.addEventListener('click',()=>{limit+=50;draw();});
    };
    panel.querySelector('input').oninput=()=>{limit=50;draw();};panel.querySelector('select').onchange=()=>{limit=50;draw();};
    panel.querySelector('#usageExportCsv').onclick=()=>csv(filtered,'orbitcell-usage.csv');
    enhanceDialogSelects(panel);
    controls.querySelectorAll('[data-usage-tab]').forEach(button=>button.onclick=()=>{const show=button.dataset.usageTab==='overview';[...body.children].filter(el=>el!==toolbar&&el!==controls&&el!==panel).forEach(el=>el.hidden=!show);panel.hidden=show;if(!show)draw();controls.querySelectorAll('[data-usage-tab]').forEach(b=>b.classList.toggle('active',b===button));});
    controls.querySelector('#usageCurrentSession').onclick=openSessionUsage;
    const seq=dlgSeq;const unsubscribe=window.AgentHubUsageLive?.subscribe(()=>{if(seq!==dlgSeq||!controls.isConnected){unsubscribe?.();return;}displayed=window.AgentHubUsageLive.overlay(data,statsFilter,S.sessions);rows=displayed.details||[];paintOverview();if(!panel.hidden)draw();refreshStatsLiveBreakdowns(displayed);refreshStatsDay?.();});overviewSubscription=unsubscribe;
  }
  function sessionPerformance(rows,totals=null,requestDetails=null){
    const finite=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
    const summary={turns:rows.length,timedTurns:0,elapsedMs:0,pairedTurns:0,output:0,outputMs:0,decodeMs:0,timedOutput:0,timedRequests:0,ttftMs:0,ttftRequests:0};
    for(const row of rows){
      const elapsed=finite(row.elapsedMs??row.elapsed),unknown=row.usageKnown===false||finite(row.usageUnknownRequests)>0&&finite(row.usageUnknownRequests)>=Math.max(1,finite(row.requests));
      const known=!unknown&&row.tokensEstimated!==true&&!finite(row.estimatedRequests)&&row.output!=null;
      if(elapsed>0){summary.elapsedMs+=elapsed;summary.timedTurns++;if(known){summary.output+=finite(row.output);summary.outputMs+=elapsed;summary.pairedTurns++;}}
      const decode=finite(row.decodeMs)||(row.genEstimated===false?finite(row.genMs):0);
      const output=finite(row.timedOutput??(row.genEstimated===false?row.output:0));
      if(known&&decode>0&&output>0){summary.decodeMs+=decode;summary.timedOutput+=output;summary.timedRequests+=finite(row.timedRequests);}
      summary.ttftMs+=finite(row.ttftMs);summary.ttftRequests+=finite(row.ttftRequests);
    }
    if(totals){
      summary.turns=finite(totals.turns)||summary.turns;
      summary.timedTurns=finite(totals.durationSamples);
      summary.elapsedMs=finite(totals.elapsedMs);
      // Use complete aggregate counters even when the detail list was capped.
      // Partial coverage uses only paired output/time samples from the rows.
      if(summary.timedTurns===summary.turns&&!finite(totals.estimatedRequests)&&!finite(totals.usageUnknownRequests)){
        summary.output=finite(totals.output);summary.outputMs=summary.elapsedMs;summary.pairedTurns=summary.turns;
      }
      if(!finite(totals.estimatedRequests)&&finite(totals.decodeMs)>0&&finite(totals.timedOutput)>0){
        summary.decodeMs=finite(totals.decodeMs);summary.timedOutput=finite(totals.timedOutput);summary.timedRequests=finite(totals.timedRequests);
      }
      summary.ttftMs=finite(totals.ttftMs);summary.ttftRequests=finite(totals.ttftRequests);
    }
    summary.meanRate=fmtTokRate(summary.output,0,summary.outputMs,true)?.label||'—';
    summary.decodeRate=summary.decodeMs>=1000?fmtTokRate(summary.timedOutput,summary.decodeMs,0,false)?.label||'—':'—';
    const requests=new Map();
    const observations=Array.isArray(requestDetails)?requestDetails:rows.flatMap(row=>Array.isArray(row.requestDetails)?row.requestDetails:[]);
    for(const [position,request] of observations.entries()){
      if(!request||typeof request!=='object')continue;
      const key=request.id?'id:'+request.id:'row:'+position;
      if(!requests.has(key)||requests.get(key).usageKnown===false&&request.usageKnown===true)requests.set(key,request);
    }
    summary.requestCount=Math.max(requests.size,finite(totals?.requests)-finite(totals?.legacyRequests),rows.reduce((sum,row)=>sum+Math.max(0,finite(row.requests)-finite(row.legacyRequests)),0));
    summary.requestPaired=0;summary.requestOutput=0;summary.requestMs=0;summary.longestGapMs=0;
    const stamp=value=>typeof value==='number'?value:Date.parse(value);
    const timed=[...requests.values()].filter(row=>finite(row.elapsedMs)>0);
    for(const request of timed){
      if(request.usageKnown===false||request.tokensEstimated===true||request.output==null)continue;
      summary.requestPaired++;summary.requestOutput+=finite(request.output);summary.requestMs+=finite(request.elapsedMs);
    }
    // Ledger timestamps mark turn completion. Assign sorted requests to their
    // turn before finding gaps, so idle time between two turns is not a gap in
    // one turn, and overlapping requests do not invent an idle interval.
    const windows=rows.filter(row=>row.elapsedMs>0&&Number.isFinite(stamp(row.ts))).map(row=>({start:stamp(row.ts)-finite(row.elapsedMs),end:stamp(row.ts)})).sort((a,b)=>a.start-b.start);
    const chronological=timed.filter(row=>Number.isFinite(stamp(row.ts))).sort((a,b)=>stamp(a.ts)-stamp(b.ts));
    let index=0,previousWindow=-1,lastEnd=0;
    for(const request of chronological){
      const start=stamp(request.ts);
      while(index<windows.length&&start>windows[index].end)index++;
      if(index>=windows.length||start<windows[index].start)continue;
      if(previousWindow===index)summary.longestGapMs=Math.max(summary.longestGapMs,start-lastEnd);
      else{previousWindow=index;lastEnd=start;}
      lastEnd=Math.max(lastEnd,start+finite(request.elapsedMs));
    }
    summary.requestRate=fmtTokRate(summary.requestOutput,0,summary.requestMs,true)?.label||'—';
    return summary;
  }
  const seconds=ms=>(n(ms)/1000).toLocaleString(undefined,{maximumFractionDigits:3})+' 秒';
  function performanceCards(performance){
    return card('回合累计用时',performance.timedTurns?fmtDur(performance.elapsedMs):'未记录',`${count(performance.timedTurns)} / ${count(performance.turns)} 轮，含工具与等待${performance.longestGapMs>60000?'；最长请求间隔 '+fmtDur(performance.longestGapMs):''}`)
      +card('请求输出均速',performance.requestRate,`${count(performance.requestPaired)} / ${count(performance.requestCount)} 次请求有用量和耗时；含请求等待，不计请求间空档`)
      +firstWaitCard(performance,performance.requestCount);
  }
  function performanceProof(performance){
    return `<details class="usage-timing-proof"><summary>查看速率计算依据</summary><p>${performance.requestPaired?`请求输出均速：${count(performance.requestOutput)} 个输出 Token / ${seconds(performance.requestMs)} = ${performance.requestRate}。`:'请求耗时未记录，无法计算请求输出均速。'}仅包含用量与耗时可配对的请求。</p><p>回合均速（含工具及等待）：${count(performance.output)} 个输出 Token / ${seconds(performance.outputMs)} = ${performance.meanRate}，${count(performance.pairedTurns)} 轮有配对数据。回合累计用时是起止跨度，不代表模型持续生成。</p><p>${performance.ttftRequests?`平均首字等待：累计 ${seconds(performance.ttftMs)} / ${count(performance.ttftRequests)} 次有计时请求 = ${latency(performance.ttftMs/performance.ttftRequests)}。仅按 Agent 已记录的首字计时计算，未记录的请求不参与平均。`:'首字等待未记录，无法计算平均值。'}</p></details>`;
  }
  function session(s){
    if(!s)return toast('请先打开一个会话','err');
    const messageRows=messages=>(messages||[]).filter(m=>m.role==='assistant'&&!m._runStart).map((m,i)=>({i,ts:m.ts,...m.usage,model:model(m.usage||{}),elapsed:m.elapsed||0}));
    const rows=messageRows(s.messages);
    const fallback=rows.reduce((t,r)=>{for(const k of ['input','output','cacheRead','cacheCreate'])t[k]+=n(r[k]);if(Number.isFinite(r.requests))t.requests+=n(r.requests);else t.legacyRequests++;if(r.cacheKnown!==true&&!r.cacheRead&&!r.cacheCreate)t.cacheUnknownRequests+=n(r.requests)||1;if(r.usageKnown===false)t.usageUnknownRequests+=n(r.requests)||1;if(r.tokensEstimated)t.estimatedRequests++;return t;},{input:0,output:0,cacheRead:0,cacheCreate:0,requests:0,legacyRequests:0,cacheUnknownRequests:0,usageUnknownRequests:0,estimatedRequests:0});
    let data=null,loading=true,error='',tab=conversationPref('statsDefaultTab')==='auto'?'turns':conversationPref('statsDefaultTab'),q='',result='all',limit=50,serial=0,chosen=conversationPref('statsDefaultTab')!=='auto',searchTimer=0;
    openDlg('当前会话统计'+(s.title?' · '+s.title:''),'<div class="session-usage-workspace" id="sessionUsageWorkspace"></div>');
    const host=document.getElementById('sessionUsageWorkspace'),seq=dlgSeq;
    const current=()=>dlgSeq===seq&&host.isConnected&&!document.getElementById('overlay').classList.contains('hidden')||dlgStack.some(d=>d.seq===seq);
    const missing='<span class="usage-missing" title="原始记录未提供">—</span>';
    const timestamp=v=>{const d=new Date(v);return v&&Number.isFinite(d.getTime())?esc(d.toLocaleString()):'时间未保存';};
    const exact=v=>`<span class="usage-exact" title="${count(v)}">${fmtTok(v)}</span>`;
    function draw(){
      if(!current())return;
      const latestSession=S.sessions.find(item=>item.id===s.id)||s,loadedRows=messageRows(latestSession.messages),active=window.AgentHubUsageLive?.snapshot(s.id);
      const bodyScroll=document.getElementById('dlgBody')?.scrollTop||0;
      const table=host.querySelector('.session-usage-table'),tableScroll=table?{top:table.scrollTop,left:table.scrollLeft}:null,proofOpen=host.querySelector('.usage-timing-proof')?.open;
      const settledRows=loadedRows.length?loadedRows:data?.records?.slice().reverse().map((r,i)=>({...r,i,model:model(r),requests:r.legacyRequests?undefined:r.requests,cacheKnown:!r.cacheUnknownRequests,elapsed:r.elapsedMs}))||[];
      const liveRow=active?{...active,i:settledRows.length,elapsed:active.elapsedMs,model:model(active)}:null,rows=liveRow?[...settledRows,liveRow]:settledRows;
      const messageFallback=!!data&&!data.records?.length&&!data.requestDetails?.length&&!n(data.totals?.requests)&&tokens(fallback)>0;
      const base=messageFallback?fallback:data?.totals||fallback,t=active?window.AgentHubUsageLive.mergeTotals(base,{...active,turns:1,durationSamples:1}):base,requests=Math.max(0,n(t.requests)-n(t.legacyRequests),(data?.requestDetails?.length||0)+(active?.requests||0),fallback.requests),c=effectiveCtx(latestSession,data?.requestDetails),calls=window.AgentHubUsageLive?window.AgentHubUsageLive.unique([...(data?.requestDetails?.length?data.requestDetails:settledRows.flatMap(r=>r.requestDetails||[])),...(active?.requestDetails||[])]):data?.requestDetails||[],groups=new Map();
      const timedRows=!messageFallback&&data?.records?.length?data.records:settledRows,performance=sessionPerformance(liveRow?[...timedRows,liveRow]:timedRows,active?null:!messageFallback&&data?.records?.length?data.totals:null,calls);
      for(const r of !messageFallback&&data?.byModel?.length?data.byModel:settledRows)groups.set(r.model,(groups.get(r.model)||0)+tokens(r));for(const r of active?.requestDetails||[])groups.set(model(r),(groups.get(model(r))||0)+tokens(r));
      const filtered=calls.filter(r=>(!q||model(r).toLowerCase().includes(q.toLowerCase()))&&(result==='all'||result==='success'&&r.success===true||result==='failed'&&r.success===false||result==='unknown'&&typeof r.success!=='boolean'));
      const wasSearch=host.contains(document.activeElement)&&document.activeElement?.id==='sessionRequestSearch',selection=wasSearch?document.activeElement.selectionStart:0;
      host.innerHTML=`<div class="usage-session-identity">${agentGlyph(s.agent,s.id)}<div><strong title="${esc(s.title||'当前会话')}">${esc(s.title||'当前会话')}</strong><span>${esc(agentMeta(s.agent).name)} · ${esc(baseName(s.cwd||'')||'默认工作区')}</span></div><span class="badge">${s.remoteHostId?'远程':'本机'}</span></div><div class="usage-session-toolbar"><p><b>${count(requests)} 次已记录请求</b> · ${rows.length||n(data?.turns)} 轮回复${active?' · <span class="usage-live-label">运行中 · 自动更新</span>':''}${active?.partialRequests?' · 仅恢复了部分请求记录':''}${n(t.legacyRequests)?' · '+count(t.legacyRequests)+' 个历史回合缺少调用数':''}</p><button type="button" class="btn-mini" id="sessionUsageRefresh" ${loading?'disabled':''}>${window.AgentHubIcons.svg('refresh')}刷新</button><button type="button" class="btn-mini" id="sessionUsageContext">${window.AgentHubIcons.svg('grid')}上下文</button></div>
        <div class="stat-cards session-usage-metrics">${card('累计 Token',unknownUsage(t)?'未记录':(t.estimatedRequests?'≈':'')+exact(tokens(t)),tokenNote(t))}${card('普通输入 / 输出',unknownUsage(t)?'未记录':exact(t.input)+' / '+exact(t.output),n(t.cacheUnknownRequests)?'含未报告缓存的请求':'两项均不重复包含缓存')}${card('缓存读取 / 写入',cache(t)==='未记录'?'未记录':exact(t.cacheRead)+' / '+exact(t.cacheCreate),cacheNote(t))}${card('缓存命中率',cache(t),cacheNote(t))}${card('最近请求上下文',c.has?esc(contextPercent(c.used,c.max)):'未记录',c.has?count(c.used)+' / '+count(c.max)+' tokens':'窗口 '+count(c.max)+' tokens，点击上方设置')}${card('费用估算','<span id="sessionUsageCost">'+(data&&!messageFallback?costValue(t):'—')+'</span>','<span id="sessionUsageCostNote">'+(loading?'正在读取本会话账单':messageFallback?'已保存回合用量，尚无对应账单记录':data?costNote(t):'后端尚未返回费用明细')+'</span>')}</div>
        <div class="stat-cards session-usage-metrics session-performance" aria-label="会话速度与耗时">${performanceCards(performance)}</div>${performanceProof(performance)}
        <div class="usage-view-controls">${[['calls','逐请求明细'],['turns','按回合汇总'],['models','模型分布']].map(([id,label])=>`<button type="button" class="btn-mini ${tab===id?'active':''}" data-session-usage-tab="${id}">${label}</button>`).join('')}</div>
        ${error?`<div class="usage-coverage" role="status">${esc(error)}</div>`:messageFallback?'<div class="usage-coverage" role="status">账单索引暂无本会话记录，当前显示已保存的回合用量；缺少的请求数、费用和逐次明细不会推算补齐。</div>':data?.requestDetails?.length&&!data.requestDetails.some(r=>r.usageKnown!==false)?'<div class="usage-coverage" role="status">历史调用只保存了计数与模型，逐次用量、缓存和耗时无法还原。这里先展示已保存的回合合计；调用记录仍可在“逐请求明细”中查看。</div>':''}
        ${tab==='calls'?`<section><div class="usage-coverage" role="status">${loading?'正在读取逐请求记录…':calls.length?'保留 '+count(calls.length)+' 条调用记录，其中 '+count(calls.filter(r=>r.usageKnown!==false).length)+' 条含逐次用量'+(n(data?.missingRequestDetails)?'；另有 '+count(data.missingRequestDetails)+' 次历史请求只保留回合汇总，无法还原逐次用量':''):'历史版本只保存了回合汇总；新请求将逐条记录'}。请求数与回复回合数分别统计，— 表示原始记录未提供；历史调用的逐次用量无法从回合合计中还原。</div><div class="usage-request-filters"><input id="sessionRequestSearch" aria-label="筛选本会话请求" placeholder="筛选模型…" value="${esc(q)}"><select id="sessionRequestState" aria-label="本会话请求结果">${[['all','全部结果'],['success','成功'],['failed','失败'],['unknown','结果未记录']].map(([v,l])=>`<option value="${v}" ${result===v?'selected':''}>${l}</option>`).join('')}</select><button type="button" class="btn-mini" id="sessionUsageExport" ${!filtered.length?'disabled':''}>导出请求 CSV</button></div><div class="session-usage-table"><table class="tbl"><thead><tr><th># / 时间</th><th>模型</th><th>普通输入</th><th>输出</th><th>缓存读</th><th>缓存写</th><th>合计</th><th>结果</th><th>请求耗时</th></tr></thead><tbody>${filtered.slice(0,limit).map((r,i)=>`<tr><td>${i+1}<small>${timestamp(r.ts)}</small></td><td class="mono">${esc(model(r))}</td>${['input','output','cacheRead','cacheCreate'].map(k=>`<td>${r.usageKnown===false||k.startsWith('cache')&&r.cacheKnown!==true?missing:count(r[k])}</td>`).join('')}<td>${r.usageKnown===false?missing:count(tokens(r))}</td><td>${r.success===true?'成功':r.success===false?'失败':'—'}</td><td>${r.elapsedMs?fmtDurShort(r.elapsedMs):missing}</td></tr>`).join('')||'<tr><td colspan="9" class="empty-cell">'+(loading?'正在加载…':'没有可展示的逐请求记录')+'</td></tr>'}</tbody></table></div><div class="usage-request-page"><span>显示 ${Math.min(limit,filtered.length)} / ${filtered.length} 条逐请求明细</span>${limit<filtered.length?'<button type="button" class="btn-mini" id="sessionRequestMore">显示更多</button>':''}</div></section>`:''}
        ${tab==='turns'?`<section><p class="dialog-note">每行是一轮回复；一轮可以包含多次模型调用。下表没有将回合数冒充请求数。</p><div class="session-usage-table"><table class="tbl"><thead><tr><th>回合 / 时间</th><th>模型</th><th>请求数</th><th>输入</th><th>输出</th><th>缓存读 / 写</th><th>合计</th><th>回合耗时</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.i+1}<small>${esc(fmtTime(r.ts))}</small></td><td>${esc(r.model)}</td><td>${Number.isFinite(r.requests)?count(r.requests):'未记录'}</td><td>${count(r.input)}</td><td>${count(r.output)}</td><td>${r.cacheKnown===false||!r.cacheRead&&!r.cacheCreate&&r.cacheKnown!==true?'未记录':count(r.cacheRead)+' / '+count(r.cacheCreate)}</td><td>${count(tokens(r))}</td><td>${r.elapsed?fmtDurShort(r.elapsed):'未记录'}</td></tr>`).join('')||'<tr><td colspan="8" class="empty-cell">当前没有回合用量</td></tr>'}</tbody></table></div></section>`:''}
        ${tab==='models'?`<section class="hm-box"><div class="hm-head"><b>模型分布</b><span>${groups.size} 个模型</span></div><div class="session-model-breakdown">${[...groups].map(([name,value])=>`<div><code>${esc(name)}</code><b title="${count(value)} tokens">${fmtTok(value)} tok</b></div>`).join('')||'<p>尚无模型用量</p>'}</div></section>`:''}`;
      host.querySelectorAll('.sc-sub').forEach(node=>node.title=node.textContent);
      host.querySelectorAll('[data-session-usage-tab]').forEach(b=>b.onclick=()=>{chosen=true;tab=b.dataset.sessionUsageTab;draw();});
      host.querySelector('#sessionUsageContext').onclick=()=>{if(s.id===S.curSessionId)editCtxWindow();else toast('先打开该会话以修改窗口');};
      host.querySelector('#sessionUsageRefresh').onclick=load;
      host.querySelector('#sessionRequestMore')?.addEventListener('click',()=>{limit+=50;draw();});
      host.querySelector('#sessionRequestSearch')?.addEventListener('input',e=>{q=e.target.value;limit=50;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(current()&&tab==='calls')draw();},120);});
      host.querySelector('#sessionRequestState')?.addEventListener('change',e=>{result=e.target.value;limit=50;draw();});
      if(host.querySelector('#sessionUsageExport'))host.querySelector('#sessionUsageExport').onclick=()=>csv(filtered.map(r=>({...r,agent:s.agent,requests:1})),'agenthub-session-requests.csv');
      enhanceDialogSelects(host);
      const nextTable=host.querySelector('.session-usage-table');if(tableScroll&&nextTable){nextTable.scrollTop=tableScroll.top;nextTable.scrollLeft=tableScroll.left;}
      const proof=host.querySelector('.usage-timing-proof');if(proof&&proofOpen!=null)proof.open=proofOpen;
      if(document.getElementById('dlgBody'))document.getElementById('dlgBody').scrollTop=bodyScroll;
      if(wasSearch){const field=host.querySelector('#sessionRequestSearch');if(field){field.focus();field.setSelectionRange(selection,selection);}}
    }
    async function load(quiet=false){const token=++serial;loading=true;error='';if(!quiet)draw();try{const result=await api('/api/usage/session/'+encodeURIComponent(s.id)+'?details=1');if(!current()||token!==serial)return;if(result.totals){data=result;if(!chosen)tab=result.requestDetails?.some(r=>r.usageKnown!==false)?'calls':'turns';}else error='后端仍为旧版本。当前先展示回合汇总；后端更新后可查看逐请求明细。';}catch(e){if(current()&&token===serial)error='逐请求记录读取失败：'+e.message+'，可点击刷新重试。';}finally{if(current()&&token===serial){loading=false;draw();}}}
    const unsubscribe=window.AgentHubUsageLive?.subscribe(ids=>{if(!current()){unsubscribe?.();return;}if(!ids.includes(s.id))return;if(window.AgentHubUsageLive.snapshot(s.id))draw();else load(true);});
    load();
  }
  return {decorate,session,sessionPerformance};
})();
