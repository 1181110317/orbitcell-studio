/* Add models to an existing provider without touching authentication. */
(() => {
  'use strict';
  const models = window.AgentHubProviderModels, icon = name => window.AgentHubIcons.svg(name);
  function mount(root, {available = [], selected = [], onChange = () => {}} = {}) {
    let values = models.clean(available), chosen = new Set(models.clean(selected)), manual = new Set(), limit = 80;
    root.innerHTML = `<div class="provider-picker-toolbar"><label class="manage-search">${icon('search')}<input type="search" data-pm-search placeholder="搜索模型名称或 ID" aria-label="搜索供应商模型"></label><span data-pm-count></span></div><div class="provider-picker-select"><button type="button" class="btn-mini" data-pm-all>选择全部</button><button type="button" class="btn-mini" data-pm-clear>清空选择</button></div><div class="provider-picker-list" data-pm-list></div><div class="provider-picker-manual"><input data-pm-manual placeholder="找不到？输入模型 ID" aria-label="手动添加模型 ID" maxlength="256"><button type="button" class="btn ghost" data-pm-add>添加</button></div>`;
    const query = () => root.querySelector('[data-pm-search]').value.trim().toLowerCase();
    const filtered = () => values.filter(id => id.toLowerCase().includes(query()));
    const notify = () => {onChange([...chosen]);draw();};
    function draw() {
      const rows = filtered();
      root.querySelector('[data-pm-count]').textContent = '已选 '+chosen.size+' / '+values.length;
      root.querySelector('[data-pm-all]').textContent = query() ? '选择搜索结果' : '选择全部';
      root.querySelector('[data-pm-list]').innerHTML = rows.slice(0,limit).map(id => `<label class="provider-model-option ${chosen.has(id)?'is-selected':''}"><input type="checkbox" data-pm-id="${esc(id)}" ${chosen.has(id)?'checked':''}><span class="provider-model-check">${icon('check')}</span><span data-i18n-ignore title="${esc(id)}">${esc(id)}</span></label>`).join('') + (rows.length>limit?'<button type="button" class="btn-mini provider-picker-more" data-pm-more>显示更多模型</button>':'') + (!rows.length?'<div class="manage-empty">'+(query()?'没有匹配的模型':'获取目录后勾选模型，也可以在下方手动添加。')+'</div>':'');
      root.querySelectorAll('[data-pm-id]').forEach(input => input.onchange = () => {input.checked?chosen.add(input.dataset.pmId):chosen.delete(input.dataset.pmId);notify();});
      root.querySelector('[data-pm-more]')?.addEventListener('click',()=>{limit+=80;draw();});
    }
    root.querySelector('[data-pm-search]').oninput=()=>{limit=80;draw();};
    root.querySelector('[data-pm-all]').onclick=()=>{filtered().forEach(id=>chosen.add(id));notify();};
    root.querySelector('[data-pm-clear]').onclick=()=>{if(query())filtered().forEach(id=>chosen.delete(id));else chosen.clear();notify();};
    const add=()=>{const input=root.querySelector('[data-pm-manual]'),id=input.value.trim();if(!id)return;if(!values.includes(id)){values.push(id);manual.add(id);}chosen.add(id);input.value='';root.querySelector('[data-pm-search]').value='';notify();};
    root.querySelector('[data-pm-add]').onclick=add;
    root.querySelector('[data-pm-manual]').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();add();}};
    draw();
    return {selected:()=>[...chosen], available:()=>[...values], manual:()=>[...manual], update:rows=>{values=models.clean([...rows,...chosen,...manual]);draw();}};
  }
  function open(provider,{onSaved=async()=>{}}={}) {
    if(S.readOnly)return;
    openDlg('添加与管理模型',`<div class="management-editor provider-model-editor"><div class="provider-editor-title"><i class="managed-model-mark">${icon('network')}</i><div><strong data-i18n-ignore>${esc(provider.name)}</strong><p>使用已保存的 API，勾选要在 OrbitCell 中使用的模型。</p></div><button type="button" class="btn ghost" id="pmRefresh">${icon('refresh')}获取模型</button></div><div id="pmStatus" class="connection-catalog-status" role="status"></div><button type="button" class="btn-mini provider-picker-reference" id="pmReference" hidden>使用官方参考型号</button><div id="pmPicker"></div><div class="dialog-actions"><span class="connection-save-note">影响可选模型列表；已有会话保留原配置。</span><button type="button" class="btn ghost" id="pmCancel">取消</button><button type="button" class="btn" id="pmSave">保存模型</button></div></div>`);
    const guard=dialogGuard(),picker=mount(document.getElementById('pmPicker'),{available:models.available(provider),selected:models.selected(provider)});
    if(provider.modelSync?.error)document.getElementById('pmStatus').textContent=provider.modelSync.error+'；已保留原有型号，可使用参考型号或手动添加。';
    const references=new Set();
    api('/api/provider-presets').then(data=>{
      if(!guard())return;
      let hostname='';try{hostname=new URL(provider.baseUrl).hostname;}catch{}
      const reference=data.presets?.find(p=>p.id==='minimax'&&p.modelSourceUrl&&/^api\.(?:minimaxi\.com|minimax\.(?:cn|io))$/i.test(hostname));
      if(!reference)return;
      const button=document.getElementById('pmReference');button.hidden=false;
      button.onclick=()=>{reference.models.forEach(id=>references.add(id));picker.update([...picker.available(),...reference.models]);document.getElementById('pmStatus').textContent='已载入官方文档中的参考型号，请勾选后保存。账户权限尚未验证。';};
    }).catch(()=>{});
    document.getElementById('pmCancel').onclick=closeDlg;
    document.getElementById('pmRefresh').onclick=()=>withPendingButton(document.getElementById('pmRefresh'),async()=>{
      const status=document.getElementById('pmStatus');status.textContent='正在使用已保存的连接读取目录…';
      try{const result=await api('/api/providers/models',{method:'POST',body:{id:provider.id,refresh:true},timeoutMs:30000});if(!guard())return;if(!result.ok)throw Error(result.error||'获取模型失败');picker.update(result.models||[]);status.textContent='获取到 '+(result.models||[]).length+' 个模型。勾选后保存即可添加。';}
      catch(error){if(guard())status.textContent=error.message+'；已选模型已保留，可手动添加模型 ID。';}
    },'获取中…');
    document.getElementById('pmSave').onclick=()=>withPendingButton(document.getElementById('pmSave'),async()=>{
      try{
        const selected=picker.selected();
        const body={enabledModels:selected,model:provider.model&&!selected.includes(provider.model)?selected[0]||'':provider.model||''};
        const added=models.clean([...picker.manual(),...selected.filter(id=>references.has(id))]);
        if(added.length&&provider.source!=='magpie')body.models=models.clean([...(provider.manualModels||[]),...added]);
        const saved=await api('/api/providers/'+encodeURIComponent(provider.id),{method:'PUT',body});
        if(guard())closeDlg();await onSaved(saved);toast('已保存 '+selected.length+' 个模型','ok');
      }catch(error){if(guard())document.getElementById('pmStatus').textContent=error.message;}
    },'保存中…');
  }
  window.AgentHubProviderModelPicker=Object.freeze({mount,open});
})();
