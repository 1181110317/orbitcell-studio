/* Browser-local reading preferences. No model/runtime settings or credentials. */
(function (root) {
  'use strict';
  const key = 'ah.conversationView.v1';
  const defaults = Object.freeze({
    processFold: true, groupFold: true, toolFold: true,
    runningDepth: '2', completedDepth: '0', historyDepth: '0',
    followOutput: true, toolShimmer: true,
    showToolTiming: true, showToolCounts: true, showDiagnostics: true,
    codeWrap: false, mentionedFilesOpen: true, htmlScripts: true,
    sidebarToolbar: 'full', sidebarAgentMarks: true, sidebarRelativeTime: true,
    replyActions: 'always', chatFontSize: 'auto', chatLineHeight: 'auto', codeFontSize: 'auto',
    toolOutputHeight: 'normal', toolListScroll:true, toolListHeight:'normal', showReplyModel: true, showCacheMetrics: true,
    showRequestCounts: true, showFileChangeStats: true, sendKey: 'enter',
    toolInputFormat:'readable',showToolSummary:true,showProgressStatus:true,
    showReplyDuration:true,showReplyRate:true,showCacheAmounts:true,showPlanStrip:true,
    contentWidth:'normal',diffDefault:'operations',statsDefaultTab:'auto',artifactFit:'fit',
    showReplyInput:true,showReplyOutput:true,
    replyUsageView:'compact',
    answerColor:'auto',processColor:'auto',detailColor:'auto',
  });
  const choices = {
    runningDepth: ['0','1','2','3'], completedDepth: ['0','1','2','3','keep'], historyDepth: ['0','1','2','3'],
    sidebarToolbar: ['full','compact'], replyActions: ['always','hover'],
    chatFontSize: ['auto','14','15','16','17','18'], chatLineHeight: ['auto','1.6','1.75','1.85','2'], codeFontSize: ['auto','12','13','14','15','16'],
    toolOutputHeight: ['compact','normal','tall','unlimited'], toolListHeight:['compact','normal','tall'], sendKey: ['enter','mod-enter'],
    toolInputFormat:['readable','json'],contentWidth:['normal','wide','full'],diffDefault:['operations','net'],statsDefaultTab:['auto','calls','turns','models'],artifactFit:['fit','scroll'],
    replyUsageView:['compact','expanded'],
  };
  const presets = Object.freeze({
    balanced: { processFold:true,groupFold:true,toolFold:true,runningDepth:'2',completedDepth:'0',historyDepth:'0' },
    compact: { processFold:true,groupFold:true,toolFold:true,runningDepth:'1',completedDepth:'0',historyDepth:'0' },
    detailed: { processFold:true,groupFold:true,toolFold:true,runningDepth:'3',completedDepth:'3',historyDepth:'3' },
    flat: { processFold:false,groupFold:false,toolFold:false,runningDepth:'3',completedDepth:'3',historyDepth:'3' },
  });
  function normalize(input) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const result = {};
    for (const [name, fallback] of Object.entries(defaults)) {
      result[name] = ['answerColor','processColor','detailColor'].includes(name) ? (/^#[0-9a-f]{6}$/i.test(value[name]) ? value[name].toLowerCase() : fallback)
        : choices[name] ? (choices[name].includes(value[name]) ? value[name] : fallback)
        : typeof value[name] === 'boolean' ? value[name] : fallback;
    }
    return Object.freeze(result);
  }
  function openFor(prefs, level, phase, previous = false) {
    if (level <= 3 && prefs[['','processFold','groupFold','toolFold'][level]] === false) return true;
    const depth = prefs[phase === 'running' ? 'runningDepth' : phase === 'completed' ? 'completedDepth' : 'historyDepth'];
    return depth === 'keep' ? previous : Number(depth) >= Math.min(level, 3);
  }
  let cached;
  const agentFields=['contentWidth','followOutput','runningDepth','completedDepth','historyDepth','showToolTiming','showToolCounts','showDiagnostics','showReplyModel','showPlanStrip','replyActions','sendKey'];
  const agentCache=new Map();
  function read(agent='') {
    if(agent){
      const base=read();let raw={};try{raw=JSON.parse(root.localStorage.getItem(key+'.agents')||'{}')[agent]||{};}catch{}
      const signature=JSON.stringify(raw),previous=agentCache.get(agent);
      if(previous?.base===base&&previous.signature===signature)return previous.value;
      const value=normalize({...base,...Object.fromEntries(Object.entries(raw).filter(([name])=>agentFields.includes(name)))});
      agentCache.set(agent,{base,signature,value});return value;
    }
    if (cached) return cached;
    try {
      const raw = root.localStorage.getItem(key);
      const saved=raw?JSON.parse(raw):{};
      const migrated=saved&&Object.prototype.hasOwnProperty.call(saved,'thinking');
      // Retire the old independent reasoning mode and its forced-open history.
      // Keep reading/font/file preferences while restoring common fold defaults.
      cached=normalize(migrated?{...saved,...presets.balanced}:saved);
      if(migrated)try{root.localStorage.setItem(key,JSON.stringify(cached));}catch{}
    } catch { cached = normalize({}); }
    return cached;
  }
  function save(input) {
    cached = normalize(input);
    try { root.localStorage.setItem(key, JSON.stringify(cached)); return true; } catch { return false; }
  }
  function saveAgent(agent,value){
    if(typeof agent!=='string'||!agent||agent.length>160||['__proto__','constructor','prototype'].includes(agent))throw Error('Agent 无效');
    let all={};try{all=JSON.parse(root.localStorage.getItem(key+'.agents')||'{}');}catch{}
    if(!all||typeof all!=='object'||Array.isArray(all))all={};
    if(value===null)delete all[agent];else{const normalized=normalize({...read(),...value});all[agent]=Object.fromEntries(agentFields.filter(name=>Object.prototype.hasOwnProperty.call(value,name)).map(name=>[name,normalized[name]]));}
    if(Object.keys(all).length>256)throw Error('Agent 页面偏好数量过多');
    root.localStorage.setItem(key+'.agents',JSON.stringify(all));agentCache.delete(agent);
  }
  function invalidate() { cached = undefined;agentCache.clear(); }
  function sendsOnEnter(event, prefs = read()) {
    return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing
      && (prefs.sendKey === 'enter' || !!(event.ctrlKey || event.metaKey));
  }
  function htmlDocument(source, scripts = true) {
    // The sandbox has an opaque origin. No host token, network requests,
    // external scripts, frames or form submission are exposed to the document.
    const policy = "default-src 'none'; script-src " + (scripts ? "'unsafe-inline'" : "'none'") + "; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + policy.replaceAll('"','&quot;') + '">' + String(source || '');
  }
  const api = Object.freeze({ key, defaults, presets, normalize, openFor, read, save, saveAgent, agentFields, invalidate, sendsOnEnter, htmlDocument });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgentHubConversationPreferences = api;
})(typeof window === 'undefined' ? globalThis : window);
