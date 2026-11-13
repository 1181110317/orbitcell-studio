/* A connection owns authentication and a catalog. Reading the catalog is a
   draft operation; only a matching saved connection can adopt its result. */
(() => {
  'use strict';
  const icon=name=>window.AgentHubIcons.svg(name);
  const efforts=[['','跟随模型'],['none','关闭'],['minimal','最低'],['low','低'],['medium','中'],['high','高'],['xhigh','超高'],['max','最大'],['ultra','极高']];
  function open(original,{onSaved=async()=>{}}={}) {
    if(S.readOnly)return;
    const provider=original||{},editing=!!original&&(provider.managed!==false||provider.source==='magpie'),prefix=editing?'ep':'np';
    const manual=provider.manualModels||provider.models||[],linked=provider.source==='magpie';
    let remote=[...new Set(provider.models||[])],preview=null,readError='',saved=false,picker,iconBusy=false,iconRevision=0;
    let iconChoice=window.AgentHubIdentity.providerChoice(provider.id);
    const originalIcon=JSON.stringify(iconChoice);
    const fieldHtml=(name,label,content,full=false)=>`<div class="fld${full?' full':''}"><label for="${prefix+name}">${label}</label>${content}</div>`;
    const input=(name,extra='')=>`<input id="${prefix+name}" ${extra}>`;
    openDlg(editing?'供应商连接设置':'添加供应商',`<form id="modelConnectionForm" class="management-editor connection-editor">
      <div class="connection-identity"><span id="${prefix}IconPreview" class="connection-icon-preview" aria-hidden="true"></span><div class="connection-identity-copy"><strong>供应商图标</strong><p>自动匹配品牌，也可上传自己的图片。</p><small>PNG、JPG、WebP、SVG · 最大 2 MB · 图标保存在当前浏览器</small></div><div class="connection-icon-actions"><button type="button" class="btn ghost" id="${prefix}IconUpload">${icon('image')}上传图标</button><button type="button" class="btn-mini" id="${prefix}IconReset">恢复默认</button></div><input type="file" id="${prefix}IconFile" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></div>
      ${!editing?'<div class="fld connection-preset"><label for="npPreset">快速填写</label><select id="npPreset"><option value="">自定义 API</option></select></div>':''}
      <section class="connection-block"><h3>${icon('network')}连接信息</h3><div class="management-editor-grid connection-main-fields">
        ${fieldHtml('Name','供应商名称',input('Name',`maxlength="120" value="${esc(provider.name||'')}" placeholder="可留空，自动使用服务地址"`))}
        ${fieldHtml('Protocol','请求协议',`<select id="${prefix}Protocol">${[['','自动识别'],['openai','OpenAI 兼容'],['anthropic','Anthropic Messages']].map(([id,name])=>`<option value="${id}" ${provider.protocol===id?'selected':''}>${name}</option>`).join('')}</select>`)}
        ${fieldHtml('Base','API 地址',input('Base',`required maxlength="2048" value="${esc(provider.baseUrl||'')}" placeholder="https://api.example.com/v1" spellcheck="false"`),true)}
        ${fieldHtml('Key','API Key',`<div class="connection-key-input">${input('Key',`type="password" autocomplete="new-password" maxlength="4096" placeholder="${editing?'留空保留已保存的密钥':'填写服务提供的密钥；本地服务可留空'}"`)}<button type="button" class="connection-key-toggle" id="${prefix}KeyToggle" aria-label="显示 API Key" aria-pressed="false">${icon('permissionRead')}</button></div>`+(editing?`<label class="connection-check"><input type="checkbox" id="${prefix}ClearKey">清除已保存密钥</label>`:''),true)}
      </div></section>
      <section class="connection-model-section"><div class="connection-section-title"><div><h3>可用模型 <span id="${prefix}Count">${remote.length}</span></h3><p>勾选要添加的模型；以后可在此供应商页面继续添加。</p></div><button type="button" class="btn ghost" id="${prefix}Fetch">${icon('refresh')}获取模型</button></div>
        <div class="connection-catalog-status" id="${prefix}Status" role="status">${remote.length?'已载入现有目录；更改地址或密钥后请重新获取。':'填写 API 后获取目录，再勾选需要的模型。也可先保存供应商。'}</div>
        <button type="button" class="btn-mini connection-reference" id="${prefix}Reference" hidden>使用官方参考型号</button>
        <input type="search" id="${prefix}Search" class="connection-model-search" placeholder="搜索此连接的模型…" aria-label="搜索此连接的模型" ${remote.length<12?'hidden':''}>
        <div id="${prefix}Catalog"></div>
        <details class="connection-default-options"><summary>供应商默认值（可选）</summary><div class="management-editor-grid connection-model-defaults">
          ${fieldHtml('Model','连接默认模型',input('Model',`maxlength="256" value="${esc(provider.model||'')}" placeholder="选择上方模型，或输入模型 ID" autocomplete="off"`))}
          ${fieldHtml('Effort','默认推理强度',`<select id="${prefix}Effort">${efforts.map(([id,name])=>`<option value="${id}" ${provider.effort===id?'selected':''}>${name}</option>`).join('')}</select>`)}
        </div></details>
        <details class="connection-manual"><summary>手动维护模型 ID <small>目录接口不可用时也能添加</small></summary><textarea id="${prefix}Models" rows="3" spellcheck="false" placeholder="每行一个模型 ID" ${linked?'readonly':''}>${esc(manual.join('\n'))}</textarea><small>手动模型单独保存，读取失败不会覆盖它们。</small></details>
      </section>
      <details class="management-editor-section connection-advanced" ${readError?'open':''}><summary>高级设置 <small>目录地址、密钥池与图片能力</small></summary><div class="management-editor-grid">
        ${editing&&provider.scope==='agent'?`<label class="connection-check full"><input type="checkbox" id="${prefix}Share">改为共享连接，允许所有兼容 Agent 使用</label>`:''}
        ${fieldHtml('ModelsUrl','自定义模型目录地址（可选）',input('ModelsUrl',`maxlength="2048" value="${esc(provider.modelsUrl||'')}" placeholder="https://api.example.com/custom/models" spellcheck="false"`),true)}
        <p class="connection-field-hint full">留空会自动尝试版本化和原路径目录；只影响获取模型，不改变聊天请求地址。</p>
        ${fieldHtml('Keys','备用密钥池',`<textarea id="${prefix}Keys" rows="2" spellcheck="false" autocomplete="off" placeholder="每行一个新密钥；留空保留已保存的密钥池"></textarea>`+(editing?`<label class="connection-check"><input type="checkbox" id="${prefix}ClearPool">清空已保存的备用密钥</label>`:''),true)}
        ${fieldHtml('ImageModel','独立图片模型',input('ImageModel',`maxlength="256" value="${esc(provider.imageModel||'')}"`))}
        ${fieldHtml('ImageBase','图片 API 地址',input('ImageBase',`maxlength="2048" value="${esc(provider.imageBaseUrl||'')}"`))}
        ${fieldHtml('ImageKey','独立图片 API Key',input('ImageKey',`type="password" maxlength="4096" autocomplete="new-password" placeholder="留空保留已保存密钥"`)+(editing?`<label class="connection-check"><input type="checkbox" id="${prefix}ClearImageKey">清除独立图片密钥</label>`:''),true)}
        <label class="connection-check full"><input type="checkbox" id="${prefix}ImageInput" ${provider.imageInput===true?'checked':''}>此连接支持图片输入</label>
        <div class="connection-advanced-test full"><span>检查只读取目录，不发送聊天请求。</span><button type="button" class="btn ghost" id="${prefix}Test">${icon('refresh')}检查目录接口</button><p id="${prefix}AdvancedStatus" role="status" hidden></p></div>
      </div></details>
      <div id="modelConnectionError" class="manage-notice" hidden role="alert"></div>
      <div class="dialog-actions"><span class="connection-save-note">${editing?'留空密钥会保留原值。':'API 只需填写一次。'}</span><button type="button" class="btn ghost" id="connectionCancel">取消</button><button type="submit" class="btn" id="${prefix}Save">${editing?'保存设置':'添加供应商'}</button></div>
    </form>`);
    const guard=dialogGuard(),form=document.getElementById('modelConnectionForm'),field=name=>form.querySelector('#'+prefix+name);
    const ids=()=>[...new Set([...remote,...field('Models').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)])];
    const draft=()=>({...(editing?{id:provider.id}:{}),agent:provider.agent||'builtin',baseUrl:field('Base').value.trim(),modelsUrl:field('ModelsUrl').value.trim(),protocol:field('Protocol').value,apiKey:field('Key').value.trim(),clearApiKey:!!field('ClearKey')?.checked});
    const status=(text,kind='')=>{if(guard())for(const name of ['Status','AdvancedStatus']){field(name).textContent=text;field(name).className='connection-catalog-status '+kind;field(name).hidden=false;}};
    function drawIcon(){
      field('IconPreview').innerHTML=window.AgentHubIcons.provider({id:provider.id,baseUrl:field('Base').value},iconChoice);
      field('IconUpload').disabled=iconBusy;field('IconReset').disabled=iconBusy||!iconChoice;field('Save').disabled=iconBusy;
    }
    field('IconUpload').onclick=()=>field('IconFile').click();
    field('IconFile').onchange=async()=>{
      const file=field('IconFile').files?.[0];if(!file)return;
      const revision=++iconRevision;iconBusy=true;drawIcon();
      try{const choice=await window.AgentHubIdentity.normalizeFile(file);if(guard()&&revision===iconRevision)iconChoice=choice;}
      catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('modelConnectionError'),error.message);}
      finally{if(guard()&&revision===iconRevision){iconBusy=false;field('IconFile').value='';drawIcon();}}
    };
    field('IconReset').onclick=()=>{iconChoice=null;drawIcon();};
    field('Base').addEventListener('input',drawIcon);drawIcon();
    field('KeyToggle').onclick=()=>{const visible=field('Key').type==='password';field('Key').type=visible?'text':'password';field('KeyToggle').setAttribute('aria-pressed',String(visible));field('KeyToggle').setAttribute('aria-label',visible?'隐藏 API Key':'显示 API Key');};
    function drawCatalog() {
      field('Count').textContent=ids().length;
      if(picker)picker.update(ids());
    }
    async function readCatalog() {
      const snapshot=draft();status('正在获取模型目录…');
      try{
        const result=await api('/api/providers/models/preview',{method:'POST',body:snapshot,timeoutMs:30000});
        if(!guard()||JSON.stringify(snapshot)!==JSON.stringify(draft()))return;
        if(!result.ok)throw Error(result.error||'无法读取目录');
        remote=result.models||[];preview={...result,snapshot:JSON.stringify(snapshot)};readError='';

        drawCatalog();status(remote.length?'已获取 '+remote.length+' 个模型，请勾选需要添加的模型。':'接口返回空目录；可手动填写模型 ID。','ok');
      }catch(error){if(guard()&&JSON.stringify(snapshot)===JSON.stringify(draft())){readError=error.message;preview=null;status(error.message+'。现有模型已保留；可手动填写，或在高级设置指定目录地址。','error');}}
    }
    picker=window.AgentHubProviderModelPicker.mount(field('Catalog'),{available:ids(),selected:editing?window.AgentHubProviderModels.selected(provider):[],onChange:values=>{if(!values.includes(field('Model').value))field('Model').value=values[0]||'';}});
    if(editing)form.querySelector('.connection-model-section').hidden=true;
    field('Search').hidden=true;
    enhanceDialogSelects(form);enhanceModelInput(field('Model'),()=>picker.selected());drawCatalog();
    document.getElementById('connectionCancel').onclick=closeDlg;
    field('Search').oninput=drawCatalog;field('Models').oninput=drawCatalog;field('Model').addEventListener('input',drawCatalog);
    for(const name of ['Base','Key','Protocol','ModelsUrl','ClearKey'])field(name)?.addEventListener('input',()=>{preview=null;remote=[];drawCatalog();status('连接信息已更改，请获取新目录；手动模型继续保留。');});
    for(const name of ['Fetch','Test'])field(name).onclick=()=>withPendingButton(field(name),readCatalog,'获取中…');
    if(linked){form.querySelector('.connection-advanced').hidden=true;}
    api('/api/provider-presets').then(data=>{
      if(!guard())return;
      const reference=data.presets?.find(p=>p.id==='minimax'&&p.modelSourceUrl);
      const updateReference=()=>{let host='';try{host=new URL(field('Base').value).hostname;}catch{}field('Reference').hidden=!reference||!/^api\.(?:minimaxi\.com|minimax\.(?:cn|io))$/i.test(host);};
      field('Reference').onclick=()=>{const manualIds=field('Models').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);field('Models').value=[...new Set([...manualIds,...reference.models])].join('\n');drawCatalog();status('已加入官方文档中的参考型号，作为手动模型保存；当前账户权限尚未验证。');};
      field('Base').addEventListener('input',updateReference);updateReference();
      if(editing)return;
      const select=document.getElementById('npPreset');select.innerHTML+=(data.presets||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');select.syncControl?.();
      select.onchange=()=>{const preset=data.presets?.find(p=>p.id===select.value);if(!preset)return;field('Name').value=preset.name||'';field('Base').value=preset.baseUrl||'';field('Protocol').value=preset.protocol||'';field('Protocol').syncControl?.();preview=null;remote=[];drawCatalog();drawIcon();updateReference();status('已填入平台设置；填写密钥后获取模型。');};
    }).catch(()=>{});
    form.onsubmit=event=>{event.preventDefault();if(saved||iconBusy)return;withPendingButton(field('Save'),async()=>{
      try{
        const snapshot=draft(),body={...snapshot,name:field('Name').value.trim()||new URL(snapshot.baseUrl).hostname,model:field('Model').value.trim(),effort:field('Effort').value,models:field('Models').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),imageInput:field('ImageInput').checked};
        delete body.id;if(!editing){body.agent='shared';body.scope='shared';body.enabledModels=window.AgentHubProviderModels.clean([...picker.selected(),...(body.model?[body.model]:[])]);body.models=window.AgentHubProviderModels.clean([...body.models,...picker.selected().filter(id=>!remote.includes(id))]);}
        if(field('Share')?.checked)body.scope='shared';
        if(preview?.snapshot===JSON.stringify(snapshot))body.modelPreviewId=preview.modelPreviewId;
        const pool=field('Keys').value.trim();if(pool)body.apiKeys=pool.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);else if(field('ClearPool')?.checked)body.apiKeys=[];
        for(const [key,name]of [['imageModel','ImageModel'],['imageBaseUrl','ImageBase']])if(field(name).value.trim()!==(provider[key]||''))body[key]=field(name).value.trim();
        if(field('ClearImageKey')?.checked)body.imageApiKey='';else if(field('ImageKey').value)body.imageApiKey=field('ImageKey').value;
        const result=await api(editing?'/api/providers/'+encodeURIComponent(provider.id):'/api/providers',{method:editing?'PUT':'POST',body});saved=true;
        let syncError='';
        if(result.id&&JSON.stringify(iconChoice)!==originalIcon){try{window.AgentHubIdentity.save('provider',result.id,iconChoice);}catch(error){syncError='连接已保存，图标未能保存：'+error.message;toast(syncError,'err');}}
        if(guard())closeDlg();await onSaved(result,{syncError});
      }catch(error){if(guard())window.AgentHubManagement.notice(document.getElementById('modelConnectionError'),error.message);}
    },'保存中…');};
  }
  window.AgentHubConnectionEditor=Object.freeze({open});
})();
