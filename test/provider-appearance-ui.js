// Isolated data: icon drafts, persistence and non-executable Agent catalog.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const http=require('node:http');
const ROOT=path.resolve(__dirname,'..');
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'ah-provider-appearance-'));
const BASE='http://127.0.0.1:18957';
fs.writeFileSync(path.join(DATA,'providers.json'),JSON.stringify({list:[],meta:{ccswitchImportDone:true}}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,quotaFixture;
async function api(route,method='GET',body){
  const res=await fetch(BASE+route,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(route==='/api/browser/open'?90000:35000)});
  const data=await res.json();assert(res.ok,`${route}: ${res.status} ${JSON.stringify(data).slice(0,300)}`);return data;
}
const browser=(action,body={})=>api('/api/browser/'+action,'POST',body);
async function ev(expression){const result=await browser('evaluate',{expression});assert(result.ok,result.error);return result.value;}
async function waitFor(fn,label){const until=Date.now()+60000;let error;while(Date.now()<until){try{if(await fn())return;}catch(err){error=err;}await sleep(150);}throw Error(label+': '+(error?.message||'timeout'));}
const ready=()=>waitFor(()=>ev('typeof S!=="undefined"&&S.wsReady&&S.agents.length>0&&!!window.AgentHubAgentCatalog'),'page startup');
(async()=>{
  try{
    quotaFixture=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{balance:38.5,credits:1500,five:38,week:65,month:{used:250,limit:1000},reset:'2030-01-01T00:00:00Z'}}));});
    await new Promise(resolve=>quotaFixture.listen(0,'127.0.0.1',resolve));
    const quotaUrl='http://127.0.0.1:'+quotaFixture.address().port+'/usage';
    server=spawn(process.execPath,['server.js'],{cwd:ROOT,windowsHide:true,stdio:'ignore',env:{...process.env,AGENTHUB_HOST:'127.0.0.1',AGENTHUB_PORT:'18957',AGENTHUB_DATA_DIR:DATA,AGENTHUB_TOKEN:'',AGENTHUB_RO_TOKEN:''}});
    await waitFor(()=>api('/api/health'),'server startup');
    const provider=await api('/api/providers','POST',{name:'Appearance fixture',baseUrl:'https://api.deepseek.com',apiKey:'fixture-key-never-sent',scope:'shared',models:['fixture-model'],enabledModels:['fixture-model'],quotaApi:{type:'json',url:quotaUrl,auth:'none',metrics:[{label:'余额',valuePath:'data.balance',unit:'CNY'}]}});
    const other=await api('/api/providers','POST',{name:'Second fixture',baseUrl:'https://api.minimaxi.com',scope:'shared'});
    await browser('open',{url:BASE});await ready();
    await ev(`(async()=>{await refreshData();window.__appearanceProvider=S.providers.find(p=>p.id===${JSON.stringify(provider.id)});window.AgentHubConnectionEditor.open(window.__appearanceProvider);})()`);
    const cancel=await ev(`(async()=>{
      const before=localStorage.getItem('ah.identity.v1');
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="#7b31d8"/></svg>';
      const file=new File([svg],'supplier.svg',{type:'image/svg+xml'}),input=document.getElementById('epIconFile');
      Object.defineProperty(input,'files',{configurable:true,value:[file]});await input.onchange();
      const draft=document.querySelector('#epIconPreview img')?.src.startsWith('data:image/png;base64,');
      document.getElementById('connectionCancel').click();return {draft,unchanged:localStorage.getItem('ah.identity.v1')===before};
    })()`);
    assert.deepEqual(cancel,{draft:true,unchanged:true});
    assert.equal((await api('/api/providers?agent=all')).find(p=>p.id===provider.id).name,'Appearance fixture');
    console.log('  PASS uploaded icon is a PNG draft; cancel leaves appearance and connection unchanged');
    const save=await ev(`(async()=>{
      window.AgentHubConnectionEditor.open(window.__appearanceProvider);
      const input=document.getElementById('epIconFile'),svg='<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="#7b31d8"/></svg>';
      Object.defineProperty(input,'files',{configurable:true,value:[new File([svg],'supplier.svg',{type:'image/svg+xml'})]});await input.onchange();
      const image=document.querySelector('#epIconPreview img').src;
      document.getElementById('modelConnectionForm').requestSubmit();return image;
    })()`);
    await waitFor(()=>ev('document.getElementById("overlay").classList.contains("hidden")'),'connection save');
    await browser('open',{url:BASE});await ready();
    const persisted=await ev(`(async()=>{
      await window.AgentHubModelCenter.open({view:'connections'});
      const provider=S.providers.find(p=>p.id===${JSON.stringify(provider.id)}),other=S.providers.find(p=>p.id===${JSON.stringify(other.id)});
      const images=[...document.querySelectorAll('[data-identity-provider]')].filter(n=>n.dataset.identityProvider===provider.id).map(n=>n.getAttribute('src'));
      return {image:window.AgentHubIdentity.providerChoice(provider.id)?.image,images,otherCustom:!!window.AgentHubIdentity.providerChoice(other.id),key:provider.hasApiKey};
    })()`);
    assert.equal(persisted.image,save);assert(persisted.images.length>=1);assert(persisted.images.every(src=>src===save));assert.equal(persisted.otherCustom,false);
    console.log('  PASS saved custom icon survives reload and renders in provider cards without changing other providers');
    const rejected=await ev(`(async()=>{try{await window.AgentHubIdentity.normalizeFile(new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],'bad.svg',{type:'image/svg+xml'}));return false;}catch{return true;}})()`);
    assert.equal(rejected,true);
    await ev(`window.AgentHubConnectionEditor.open(S.providers.find(p=>p.id===${JSON.stringify(provider.id)}));document.getElementById('epIconReset').click();document.getElementById('modelConnectionForm').requestSubmit();true`);
    await waitFor(()=>ev('document.getElementById("overlay").classList.contains("hidden")'),'reset save');
    assert.equal(await ev(`window.AgentHubIdentity.providerChoice(${JSON.stringify(provider.id)})`),null);
    assert.equal((await api('/api/providers?agent=all')).find(p=>p.id===provider.id).apiKey,provider.apiKey,'blank key is preserved');
    console.log('  PASS restoring the brand icon preserves the API key; unsafe SVG input is rejected');
    await ev(`(async()=>{await window.AgentHubAgentCenter.open();document.querySelector('[data-ac-filter="planned"]').click();})()`);
    const catalog=await ev(`(async()=>{
      const cards=[...document.querySelectorAll('#acOverview [data-ac-planned]')];
      await Promise.all(cards.flatMap(n=>[...n.querySelectorAll('img')]).map(n=>n.decode()));
      const result={ids:cards.map(n=>n.dataset.acPlanned),images:cards.every(n=>!!n.querySelector('img,svg')),runnable:cards.some(n=>n.querySelector('[data-ac-start],[data-ac-select],[data-ac-directory]')),unknown:window.AgentHubAgentCatalog.some(item=>S.agents.some(agent=>agent.id==='catalog:'+item.id))};
      document.querySelector('#acOverview [data-ac-action="directory"]').click();
      await new Promise(requestAnimationFrame);
      const search=document.getElementById('acDirectorySearch');search.value='hermes';search.dispatchEvent(new Event('input'));
      result.search=[...document.querySelectorAll('.ac-directory-dialog [data-search]')].filter(n=>!n.hidden).map(n=>n.textContent);
      closeDlg();openNewTaskAgentChooser({hostId:'',cwd:''});result.taskPlaceholder=!!document.querySelector('.new-task-chooser [data-task-agent^="catalog:"]');closeDlg();return result;
    })()`);
    for(const id of ['codebuddy','antigravity','qoder','kimi-code','openclaw','minimax-code','hermes','pi','grok-build'])assert(catalog.ids.includes(id),id+' catalog entry');
    assert(catalog.images);assert.equal(catalog.runnable,false);assert.equal(catalog.unknown,false);assert.equal(catalog.taskPlaceholder,false);assert.equal(catalog.search.length,1);assert(catalog.search[0].includes('Hermes'));
    console.log('  PASS branded catalog entries are searchable but cannot create or execute sessions');
    await ev(`(async()=>{window.AgentHubAgentCenter.close();const frame=document.createElement('iframe');frame.id='appearanceFrame';frame.style.cssText='position:fixed;inset:0;z-index:10000;border:0;width:390px;height:844px';frame.src=location.origin;document.body.append(frame);await new Promise(resolve=>frame.onload=resolve);})()`);
    await waitFor(()=>ev(`document.getElementById('appearanceFrame').contentWindow.eval('typeof S!=="undefined"&&S.wsReady&&!!S.providers.length')`),'frame startup');
    for(const [width,height]of [[1280,720],[390,844],[740,390],[320,640]]){
      const layout=await ev(`(async()=>{
        const frame=document.getElementById('appearanceFrame');frame.style.width='${width}px';frame.style.height='${height}px';const w=frame.contentWindow,d=w.document;
        w.AgentHubConnectionEditor.open(w.eval('S.providers').find(p=>p.id===${JSON.stringify(provider.id)}));d.querySelector('.connection-advanced').open=true;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const rect=n=>n.getBoundingClientRect(),save=rect(d.getElementById('epSave')),name=rect(d.getElementById('epName')),protocol=rect(d.querySelector('[data-select-control="epProtocol"]'));
        const caret=rect(d.querySelector('[data-select-control="epProtocol"] .select-control-caret'));
        const input=rect(d.getElementById('epImageBase')),model=rect(d.getElementById('epImageModel'));
        const body=d.getElementById('dlgBody');body.scrollTop=body.scrollHeight;
        const test=d.getElementById('epTest');test.scrollIntoView({block:'nearest'});
        const target=rect(test),hit=d.elementFromPoint(target.x+target.width/2,target.y+target.height/2);
        const data={overflow:body.scrollWidth>body.clientWidth+1,save:save.top>=0&&save.bottom<=w.innerHeight,columns:Math.abs(name.width-protocol.width)<2&&Math.abs(input.width-model.width)<2,heights:Math.abs(name.height-protocol.height)<1,caret:Math.abs(caret.top+caret.height/2-protocol.top-protocol.height/2)<2,test:hit===test||test.contains(hit)};
        w.closeDlg();
        await w.AgentHubAgentCenter.open({agent:'builtin',tab:'appearance'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const appearance=rect(d.querySelector('.ac-appearance-form [type="submit"]'));data.appearance=appearance.top>=0&&appearance.bottom<=w.innerHeight;
        await w.AgentHubAgentCenter.open({agent:'builtin',tab:'imports'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const importButton=rect(d.getElementById('aiCommit'));data.imports=importButton.top>=0&&importButton.bottom<=w.innerHeight;data.pageOverflow=d.documentElement.scrollWidth>w.innerWidth;
        w.AgentHubAgentCenter.close();return data;
      })()`);
      assert.equal(layout.overflow,false,`${width}: horizontal overflow`);assert.equal(layout.pageOverflow,false);for(const key of ['save','columns','heights','caret','test','appearance','imports'])assert(layout[key],`${width}x${height} ${key}: ${JSON.stringify(layout)}`);
    }
    console.log('  PASS 4 viewport sizes: equal fields, centered dropdown arrow and reachable save/diagnostic controls');
    await ev(`document.getElementById('appearanceFrame').remove();true`);
    await require('./helpers/provider-quota-ui.cjs')({api,ev,waitFor,browser,provider,quotaUrl});
    console.log('[provider-appearance-ui] passed');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{
    try{await browser('close');}catch{}
    if(server){server.kill();await sleep(500);}
    quotaFixture?.closeAllConnections();quotaFixture?.close();
    const target=path.resolve(DATA);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('ah-provider-appearance-'));
    fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
})();
