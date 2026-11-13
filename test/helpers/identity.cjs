'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../..');

module.exports=async function identityChecks(){
  const cache=new Map(),events={},draws=[];let denied=false,revoked=0,sourceWidth=640,sourceHeight=320;
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  function boot(){
    const window={addEventListener:(type,fn)=>events[type]=fn};
    const context=vm.createContext({window,localStorage:{getItem:key=>cache.get(key)||null,setItem:(key,value)=>{if(denied)throw Error('quota');cache.set(key,value);}},
      document:{querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{},createElement:type=>{assert.equal(type,'canvas');return {width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args)}),toDataURL:()=>png};}},
      URL:{createObjectURL:()=> 'blob:test-icon',revokeObjectURL:()=>revoked++},Image:class{constructor(){this.naturalWidth=sourceWidth;this.naturalHeight=sourceHeight;}async decode(){}}});
    for(const file of ['public/vendor/agent-logos/logos.js','public/icons.js','public/agent-identity.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
    return {api:window.AgentHubIdentity,icons:window.AgentHubIcons};
  }
  let {api,icons}=boot();
  for(const [agent,brand] of [['codex','openai'],['zcode','zai'],['claude','claude'],['gemini','gemini'],['opencode','opencode'],['dsh','deepseek']]){
    assert(icons.agent(agent).includes(`data-agent-brand="${brand}"`),'executor has the appropriate actual brand: '+agent);
  }
  api.setAgents([{id:'custom-work',name:'WorkBuddy'},{id:'acp:test-cursor',name:'Cursor Agent (ACP)'}]);
  assert(api.agent('custom-work').includes('data-agent-brand="workbuddy"'));
  assert(api.agent('acp:test-cursor').includes('data-agent-brand="cursor"'));
  assert(api.agent('builtin').includes('data-agent-brand="generic"'),'built-in executor does not claim a third-party brand');
  assert(api.agent('chatgpt-web').includes('data-agent-brand="generic"'),'ordinary chat is not automatically branded OpenAI');
  api.save('agent','codex',{brand:'cursor'});
  api.save('session','first',{brand:'zai'});
  assert(api.agent('codex','first').includes('data-agent-brand="zai"'));
  assert(api.agent('codex','second').includes('data-agent-brand="cursor"'),'session override is isolated');
  api.save('session','first',null);
  assert(api.agent('codex','first').includes('data-agent-brand="cursor"'),'reset follows current Agent preference');
  ({api}=boot());
  assert(api.agent('codex').includes('data-agent-brand="cursor"'),'reload retains preference');
  denied=true;
  assert.throws(()=>api.save('agent','codex',{brand:'claude'}),/浏览器未能保存/);
  assert(api.agent('codex').includes('data-agent-brand="cursor"'),'failed write leaves the previous preference in memory');
  denied=false;
  cache.set('ah.identity.v1',JSON.stringify({agents:{codex:{brand:'zai'}},sessions:{}}));
  events.storage({key:'unrelated'});assert(api.agent('codex').includes('data-agent-brand="cursor"'));
  events.storage({key:'ah.identity.v1'});assert(api.agent('codex').includes('data-agent-brand="zai"'),'same-origin storage events refresh appearance preferences');
  api.save('agent','codex',null);
  assert(api.agent('codex').includes('data-agent-brand="openai"'));
  for(const choice of [{image:'https://example.test/logo.png'},{image:'data:image/svg+xml,<svg onload="alert(1)"/>'},{brand:'not-a-brand'}])assert.throws(()=>api.save('agent','codex',choice),/格式无效/);
  assert.throws(()=>api.save('agent','__proto__',{brand:'openai'}),/目标无效/);
  assert.throws(()=>api.save('app','',{brand:'openai'}),/上传图片/);
  const escaped=api.agent('a" onload="bad','s" onclick="bad');
  assert(escaped.includes('&quot;')&&!escaped.includes(' onload="')&&!escaped.includes(' onclick="'),'dynamic attributes remain escaped');
  api.save('app','',{image:png});assert(api.hasCustomBrand()&&api.brand().startsWith('<img'));
  api.save('app','',null);assert(!api.hasCustomBrand()&&api.brand().includes('src="/brand.svg"'));
  await assert.rejects(api.normalizeFile({size:2*1024*1024+1,type:'image/png'}),/2 MB/);
  await assert.rejects(api.normalizeFile({size:20,type:'text/html'}),/支持/);
  for(const text of ['<svg><script>alert(1)</script></svg>','<svg onload="alert(1)"/>','<svg><image href="https://example.test/tracking.png"/></svg>','<svg><style>@import "https://example.test/style.css";</style></svg>']){
    await assert.rejects(api.normalizeFile({size:100,type:'image/svg+xml',text:async()=>text}),/脚本或外部资源/);
  }
  const gradient=await api.normalizeFile({size:100,type:'image/svg+xml',text:async()=>'<svg><path fill="url(\'#gradient\')"/></svg>'});
  assert.equal(gradient.image,png,'local gradient references remain valid SVG');
  const draw=draws.at(-1);assert.deepEqual(draw.slice(1),[0,32,128,64],'normalization contains the original aspect ratio in a 128px square');
  assert.equal(revoked,1,'temporary upload URLs are released');
  sourceWidth=5000;sourceHeight=5000;
  await assert.rejects(api.normalizeFile({size:100,type:'image/png'}),/尺寸过大/);
  assert.equal(revoked,2,'oversized-image path also releases the temporary URL');
  cache.set('ah.identity.v1','broken JSON');({api}=boot());assert(api.agent('codex').includes('data-agent-brand="openai"'));
  cache.set('ah.identity.v1',JSON.stringify({agents:{codex:{image:'javascript:alert(1)'}},sessions:{},app:{image:'https://example.test/a.png'}}));
  ({api}=boot());assert(!api.hasCustomBrand()&&api.agent('codex').includes('data-agent-brand="openai"'),'invalid stored payloads are ignored');
  console.log('[identity] brand mappings, upload bounds, persistence, inheritance, cancellation-independent saves, malformed input and quota recovery passed');
};
