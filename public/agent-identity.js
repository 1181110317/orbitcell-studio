/* Local appearance preferences. Brand vectors are vendored; uploaded SVGs
   are decoded as images and normalized to a small PNG, never inserted as HTML. */
(() => {
  'use strict';
  const KEY='ah.identity.v1', MAX_IMAGE=100000, MAX_STORE=1500000;
  const brands=window.AgentHubBrandLogos||{};
  const native={claude:'claude',codex:'openai',zcode:'zai',gemini:'gemini',dsh:'deepseek',opencode:'opencode'};
  const names=new Map();
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
  const keyOK=id=>typeof id==='string'&&id.length>0&&id.length<=160&&!['__proto__','prototype','constructor'].includes(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  function cleanChoice(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    if(typeof value.brand==='string'&&own(brands,value.brand))return {brand:value.brand};
    if(typeof value.image==='string'&&value.image.length<=MAX_IMAGE&&/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.image))return {image:value.image};
    return null;
  }
  function read(){
    try{
      const text=localStorage.getItem(KEY);if(!text||text.length>MAX_STORE)return {agents:{},sessions:{},providers:{}};
      const data=JSON.parse(text),out={agents:{},sessions:{},providers:{}};
      for(const field of ['agents','sessions','providers'])if(data?.[field]&&typeof data[field]==='object'&&!Array.isArray(data[field])){
        for(const [id,value] of Object.entries(data[field]).slice(0,256)){const choice=cleanChoice(value);if(keyOK(id)&&choice)out[field][id]=choice;}
      }
      const app=cleanChoice(data?.app);if(app?.image)out.app=app;
      return out;
    }catch{return {agents:{},sessions:{},providers:{}};}
  }
  let preferences=read(),revision=0;
  function defaultBrand(id){
    if(own(native,id))return native[id];
    const name=(String(id)+' '+(names.get(id)||'')).toLowerCase();
    for(const [pattern,brand] of [[/workbuddy/,'workbuddy'],[/cursor/,'cursor'],[/claude|anthropic/,'claude'],[/codex|openai/,'openai'],[/zcode|zhipu|z\.ai/,'zai'],[/gemini/,'gemini'],[/deepseek/,'deepseek'],[/opencode/,'opencode'],[/codebuddy/,'codebuddy'],[/antigravity/,'antigravity'],[/qoder/,'qoder'],[/kimi/,'kimi'],[/openclaw/,'openclaw'],[/minimax|mcode/,'minimax'],[/hermes/,'hermes'],[/(?:^|[:\s])pi(?:$|\s|-)|pi coding/,'pi'],[/grok/,'grok'],[/qwen/,'qwen'],[/kiro/,'kiro']])if(pattern.test(name))return brand;
    return '';
  }
  const collection=scope=>scope==='agent'?'agents':scope==='provider'?'providers':'sessions';
  function choiceFor(scope,id){return scope==='app'?preferences.app||null:preferences[collection(scope)]?.[id]||null;}
  function selected(id,sessionId=''){
    if(sessionId&&own(preferences.sessions,sessionId))return preferences.sessions[sessionId];
    if(own(preferences.agents,id))return preferences.agents[id];
    const brand=defaultBrand(id);return brand?{brand}:null;
  }
  function imageHtml(image,attributes=''){
    return `<img class="ui-icon agent-custom-image" src="${image}" width="24" height="24" alt="" aria-hidden="true" decoding="async" ${attributes}>`;
  }
  function brandHtml(brand,attributes=''){
    if(brands[brand]?.asset)return `<img class="ui-icon agent-brand" data-icon="brand-${brand}" data-agent-brand="${brand}" src="${brands[brand].asset}" width="24" height="24" alt="" aria-hidden="true" decoding="async" ${attributes}>`;
    if(['gemini','workbuddy','deepseek','claude'].includes(brand))return `<img class="ui-icon agent-brand" data-icon="brand-${brand}" data-agent-brand="${brand}" src="/vendor/agent-logos/${brand}-color.svg" width="24" height="24" alt="" aria-hidden="true" decoding="async" ${attributes}>`;
    return brands[brand]?.svg.replace('<svg ',`<svg class="ui-icon agent-brand" data-icon="brand-${brand}" data-agent-brand="${brand}" stroke="none" aria-hidden="true" focusable="false" ${attributes} `)||'';
  }
  function agent(id,sessionId='',override){
    const mark=own(native,id)||['builtin','chatgpt-web'].includes(id)?id:'custom';
    const attributes=`data-agent-icon="${mark}" data-identity-agent="${esc(id)}" data-identity-session="${esc(sessionId)}"`;
    const choice=override===undefined?selected(id,sessionId):override;
    if(choice?.image)return imageHtml(choice.image,attributes+' data-agent-brand="custom"');
    if(choice?.brand&&own(brands,choice.brand))return brandHtml(choice.brand,attributes);
    return window.AgentHubIcons.svg('chat').replace('<svg ',`<svg ${attributes} data-agent-brand="generic" `);
  }
  function brand(){return preferences.app?.image?imageHtml(preferences.app.image,'data-brand-custom="true"'):'<img src="/brand.svg" alt="" width="32" height="32">';}
  function provider(id,override){
    const choice=override===undefined?choiceFor('provider',id):override;
    if(choice?.image)return imageHtml(choice.image,'data-provider-brand="custom"');
    if(choice?.brand&&own(brands,choice.brand))return brandHtml(choice.brand,`data-provider-brand="${esc(choice.brand)}"`);
    return '';
  }
  function refresh(){
    for(const node of document.querySelectorAll('[data-identity-agent]')){
      if(node.closest('.identity-editor'))continue;
      const template=document.createElement('template');template.innerHTML=agent(node.dataset.identityAgent,node.dataset.identitySession);
      node.replaceWith(template.content.firstElementChild);
    }
    for(const node of document.querySelectorAll('[data-identity-provider]')){
      if(node.closest('.connection-identity'))continue;
      const template=document.createElement('template');
      template.innerHTML=window.AgentHubIcons.provider({id:node.dataset.identityProvider,baseUrl:node.dataset.providerBase});
      node.replaceWith(template.content.firstElementChild);
    }
    for(const logo of document.querySelectorAll('.brand-logo,.es-logo,.te-pv-logo,.auth-logo')){
      logo.innerHTML=brand();logo.dataset.identityVersion=String(revision);logo.classList.toggle('has-custom-brand',!!preferences.app?.image);
    }
    const favicon=document.querySelector('link[rel="icon"]');if(favicon)favicon.href=preferences.app?.image||'/brand.svg';
  }
  function save(scope,id,value){
    if(!['agent','session','app','provider'].includes(scope)||scope!=='app'&&!keyOK(id))throw Error('图标目标无效');
    const choice=cleanChoice(value);if(value&&!choice)throw Error('图标格式无效');
    if(scope==='app'&&choice&&!choice.image)throw Error('工作台图标需要上传图片');
    const next={...preferences,agents:{...preferences.agents},sessions:{...preferences.sessions},providers:{...preferences.providers}};
    if(scope==='app'){if(choice)next.app=choice;else delete next.app;}
    else{const field=collection(scope);if(choice)next[field][id]=choice;else delete next[field][id];}
    if(['agents','sessions','providers'].some(field=>Object.keys(next[field]).length>256))throw Error('图标数量已满，请先恢复部分默认图标');
    const text=JSON.stringify(next);if(text.length>MAX_STORE)throw Error('图标空间已满，请先恢复部分默认图标');
    try{localStorage.setItem(KEY,text);}catch{throw Error('浏览器未能保存图标，请检查可用空间与存储权限');}
    preferences=next;++revision;refresh();
  }
  async function normalizeFile(file){
    if(!file||file.size>2*1024*1024)throw Error('请选择 2 MB 以内的图标');
    if(!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type))throw Error('支持 PNG、JPG、WebP 和 SVG 图片');
    if(file.type==='image/svg+xml'){
      const text=await file.text();
      const references=[...text.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi),...text.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/gi)];
      if(/<\s*(?:script|foreignObject|!DOCTYPE|!ENTITY)\b|\son[a-z]+\s*=|@import/i.test(text)||references.some(match=>!match[1].startsWith('#')))throw Error('SVG 含脚本或外部资源，请使用独立 SVG 或 PNG');
    }
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>16000000)throw Error('图片尺寸过大，请先缩小后上传');
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
      const ctx=canvas.getContext('2d'),ratio=Math.min(128/image.naturalWidth,128/image.naturalHeight);
      const w=image.naturalWidth*ratio,h=image.naturalHeight*ratio;
      ctx.drawImage(image,(128-w)/2,(128-h)/2,w,h);
      const data=canvas.toDataURL('image/png');if(!cleanChoice({image:data}))throw Error('图片未能转换为图标');
      return {image:data};
    }catch(error){throw Error(error.message.includes('图片')?error.message:'无法读取图片，请换一个有效图片文件');}
    finally{URL.revokeObjectURL(url);}
  }
  function edit({scope='agent',id='',agent:agentId=id,label=''}={}){
    if(!['agent','session','app'].includes(scope)||scope!=='app'&&!keyOK(id))return;
    const title=scope==='app'?'工作台图标':scope==='session'?'会话图标':'Agent 图标';
    const original=choiceFor(scope,id);let candidate=original,busy=false,loadSeq=0;
    const fallback=scope==='agent'?(defaultBrand(agentId)?{brand:defaultBrand(agentId)}:null):selected(agentId);
    const inherited=scope==='session'?'跟随 Agent':'默认图标';
    openDlg(title,`<div class="identity-editor"><div class="identity-intro"><span id="identityPreview" class="identity-preview" aria-hidden="true"></span><div><strong>${esc(label||title)}</strong><p>${scope==='app'?'用于工作台 Logo 和网页标签。':scope==='agent'?'用于这个 Agent 的会话列表、标签和消息。':'仅修改这个会话，其他会话保持原样。'}</p></div></div><div class="identity-upload"><button type="button" class="btn" id="identityUpload">${window.AgentHubIcons.svg('image')}上传图片</button><input type="file" id="identityFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden><span>PNG、JPG、WebP、SVG · 最大 2 MB</span></div>${scope==='app'?'':`<div class="identity-label">品牌标识</div><div class="identity-presets" role="group" aria-label="选择品牌图标">${Object.entries(brands).map(([key,item])=>`<button type="button" class="identity-choice" data-identity-choice="${key}" aria-pressed="false">${brandHtml(key)}<span>${esc(item.name)}</span></button>`).join('')}</div>`}<p class="identity-storage">保存在当前浏览器。图片会缩小为 128 × 128，保留透明背景。</p><div id="identityError" class="identity-error" role="alert" hidden></div><div class="dialog-actions identity-actions"><button type="button" class="btn ghost" id="identityReset">${scope==='app'?'恢复默认图标':inherited}</button><span></span><button type="button" class="btn ghost" id="identityCancel">取消</button><button type="button" class="btn" id="identitySave" disabled>保存图标</button></div></div>`);
    const root=document.querySelector('#dlgBody .identity-editor');if(!root)return;
    const file=root.querySelector('#identityFile'),saveButton=root.querySelector('#identitySave'),errorBox=root.querySelector('#identityError');
    const showError=message=>{errorBox.hidden=!message;errorBox.textContent=message;};
    function update(){
      const choice=candidate||fallback;
      root.querySelector('#identityPreview').innerHTML=scope==='app'?(candidate?.image?imageHtml(candidate.image):window.AgentHubIcons.svg('brand')):agent(agentId,'',choice);
      for(const button of root.querySelectorAll('[data-identity-choice]'))button.setAttribute('aria-pressed',String(candidate?.brand===button.dataset.identityChoice));
      saveButton.disabled=busy||JSON.stringify(original)===JSON.stringify(candidate);
      root.querySelector('#identityReset').disabled=busy;
      root.querySelector('#identityUpload').disabled=busy;
      saveButton.textContent=busy?'处理图片…':'保存图标';
    }
    root.querySelector('#identityUpload').onclick=()=>file.click();
    file.onchange=async()=>{
      const selectedFile=file.files?.[0];if(!selectedFile)return;
      const seq=++loadSeq;busy=true;showError('');update();
      try{const choice=await normalizeFile(selectedFile);if(seq!==loadSeq||!root.isConnected)return;candidate=choice;}
      catch(error){if(seq===loadSeq&&root.isConnected)showError(error.message);}
      finally{if(seq===loadSeq&&root.isConnected){busy=false;file.value='';update();}}
    };
    for(const button of root.querySelectorAll('[data-identity-choice]'))button.onclick=()=>{if(busy)return;candidate={brand:button.dataset.identityChoice};showError('');update();};
    root.querySelector('#identityReset').onclick=()=>{candidate=null;showError('');update();};
    root.querySelector('#identityCancel').onclick=()=>{++loadSeq;closeDlg();};
    saveButton.onclick=()=>{
      if(busy||saveButton.disabled)return;
      try{save(scope,id,candidate);closeDlg();toast('图标已保存');}catch(error){showError(error.message);}
    };
    update();
  }
  window.AgentHubIdentity=Object.freeze({agent,brand,provider,providerChoice:id=>choiceFor('provider',id),edit,save,normalizeFile,
    setAgents:agents=>{for(const item of agents||[])if(keyOK(item.id))names.set(item.id,String(item.name||''));},
    get revision(){return revision;},hasCustomBrand:()=>!!preferences.app?.image});
  window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){preferences=read();++revision;refresh();}});
  document.addEventListener('DOMContentLoaded',refresh,{once:true});
})();
