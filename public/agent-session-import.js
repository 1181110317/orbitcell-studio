/* Agent-scoped import preview. The source stays read-only; only checked
   preview IDs are sent to the local commit endpoint. */
(() => {
  'use strict';
  const formats=[['claude','Claude / CodeBuddy JSONL'],['codex','Codex JSONL'],['gemini','Gemini JSON'],['pi','Pi JSONL'],['opencode','OpenCode 导出 JSON'],['json','通用 JSON / OrbitCell 导出']];
  function mount(root,{agent,hostId=''}){
    if(S.readOnly){root.innerHTML='<div class="ac-page-intro"><h3>会话导入</h3><p>只读身份不能扫描或导入会话。</p></div>';return;}
    if(hostId){root.innerHTML='<div class="ac-page-intro"><h3>会话导入</h3><p>当前导入读取 OrbitCell 本机文件。请从远程电脑导出 JSON / JSONL，再在此 Agent 的本机设置中选择文件。</p></div>';return;}
    const name=agentMeta(agent).name;
    let format=/codex/.test(agent)?'codex':/claude|codebuddy/.test(agent)?'claude':/gemini/.test(agent)?'gemini':/(?:^|:)pi$/.test(agent)?'pi':/opencode/.test(agent)?'opencode':'json';
    let items=[],selected=new Set(),query='',busy=false,revision=0;
    root.innerHTML=`<div class="ac-page-intro"><h3>会话导入</h3><p>导入到 ${esc(name)}，保留源文件。除 Claude 本机原生记录外，其他格式作为历史消息导入。</p></div><div class="agent-import-source"><div class="fld"><label for="aiFormat">源文件格式</label><select id="aiFormat">${formats.map(([id,label])=>`<option value="${id}" ${id===format?'selected':''}>${label}</option>`).join('')}</select></div><div class="fld"><label for="aiDirectory">源目录（可选）</label><div class="agent-import-path"><input id="aiDirectory" placeholder="留空查找此格式的默认目录"><button type="button" class="btn ghost" id="aiBrowse" aria-label="选择导入目录">${window.AgentHubIcons.svg('folder')}</button></div></div><div class="agent-import-source-actions"><button type="button" class="btn ghost" id="aiScan">${window.AgentHubIcons.svg('search')}扫描本机会话</button><button type="button" class="btn ghost" id="aiUpload">${window.AgentHubIcons.svg('upload')}选择导出文件</button><input type="file" id="aiFiles" accept=".json,.jsonl,application/json" multiple hidden></div><p id="aiSourceNote" role="status"></p></div><div class="agent-import-result"><div class="agent-import-toolbar"><label><input type="checkbox" id="aiSelectAll" aria-label="选择全部未导入会话"><span id="aiCount">尚未扫描</span></label><input type="search" id="aiSearch" placeholder="搜索标题或项目" aria-label="搜索待导入会话"></div><div id="aiItems" class="agent-import-list"></div><p id="aiStatus" role="status"></p><div class="ac-save-bar"><span id="aiSelection">未选择会话</span><button type="button" class="btn ghost" id="aiAll" disabled>全部导入</button><button type="button" class="btn" id="aiCommit" disabled>导入所选</button></div></div>`;
    const field=id=>root.querySelector('#'+id),active=()=>root.isConnected;
    const note=text=>{if(active())field('aiStatus').textContent=text;};
    const filtered=()=>items.filter(item=>!query||(item.title+' '+item.cwd+' '+item.path).toLowerCase().includes(query));
    function draw(){
      if(!active())return;
      const visible=filtered(),available=items.filter(item=>!item.existingId),selectable=visible.filter(item=>!item.existingId);
      field('aiItems').innerHTML=visible.length?visible.map(item=>`<label class="agent-import-item ${item.existingId?'imported':''}"><input type="checkbox" data-import-id="${esc(item.id)}" ${selected.has(item.id)?'checked':''} ${item.existingId||busy?'disabled':''}><span><strong data-i18n-ignore>${esc(item.title)}</strong><small data-i18n-ignore>${esc(item.cwd||item.path)}</small><em>${item.messages} 条消息 · ${esc(new Date(item.mtime).toLocaleString())}${item.truncated?' · 超长记录仅前 20,000 条':''}</em></span>${item.archived?'<i>已导入 · 已归档</i>':item.existingId?`<button type="button" class="btn-mini" data-import-open="${esc(item.existingId)}">已导入 · 打开</button>`:'<i>待导入</i>'}</label>`).join(''):'<div class="ac-empty">'+(items.length?'没有匹配的会话':'可扫描本机记录，或选择 JSON / JSONL 导出文件。')+'</div>';
      field('aiCount').textContent=items.length+' 个会话 · '+(items.length-available.length)+' 个已导入';
      field('aiSelection').textContent='已选 '+selected.size+' 个';
      field('aiCommit').disabled=busy||!selected.size;field('aiAll').disabled=busy||!available.length;field('aiAll').textContent='全部导入'+(available.length?' · '+available.length:'');
      field('aiSelectAll').checked=!!selectable.length&&selectable.every(item=>selected.has(item.id));field('aiSelectAll').indeterminate=selectable.some(item=>selected.has(item.id))&&!field('aiSelectAll').checked;field('aiSelectAll').disabled=busy||!selectable.length;
      for(const id of ['aiScan','aiUpload','aiBrowse'])field(id).disabled=busy;
      for(const checkbox of root.querySelectorAll('[data-import-id]'))checkbox.onchange=()=>{checkbox.checked?selected.add(checkbox.dataset.importId):selected.delete(checkbox.dataset.importId);draw();};
      for(const button of root.querySelectorAll('[data-import-open]'))button.onclick=()=>{window.AgentHubAgentCenter.close();openSession(button.dataset.importOpen);};
    }
    async function scan(){
      if(busy)return;const seq=++revision;busy=true;draw();note('正在只读扫描…');
      try{const data=await api('/api/agent-import/scan?'+new URLSearchParams({agent,format,directory:field('aiDirectory').value.trim()}),{timeoutMs:60000});if(!active()||seq!==revision)return;items=data.items||[];selected.clear();field('aiSourceNote').textContent=data.locations?.length?'查找位置：'+data.locations.join('；'):'此格式暂无默认扫描目录，请指定目录或选择导出文件。';note((data.truncated?'已达到扫描数量上限，请缩小源目录。 ':'')+(data.errors?.length?'有 '+data.errors.length+' 个文件未能解析；可检查格式后重试。':'扫描完成，选择要导入的会话。'));}
      catch(error){note(error.message==='404'?'当前后端尚未加载会话导入接口，请重启 OrbitCell 后重新打开此页面。':error.message);}finally{if(active()&&seq===revision){busy=false;draw();}}
    }
    async function commit(ids){
      if(busy||!ids.length)return;busy=true;draw();note('正在导入 '+ids.length+' 个会话…');
      try{const data=await api('/api/agent-import/commit',{method:'POST',body:{agent,ids},timeoutMs:120000});await refreshData();if(!active())return;
        for(const item of [...data.imported,...data.skipped]){const row=items.find(row=>row.id===item.id);if(row)row.existingId=item.sessionId;selected.delete(item.id);}
        note('已导入 '+data.imported.length+' 个，已存在 '+data.skipped.length+' 个，失败 '+data.errors.length+' 个。'+(data.errors.length?' '+data.errors.slice(0,3).map(e=>e.error).join('；'):''));
      }catch(error){note(error.message);}finally{if(active()){busy=false;draw();}}
    }
    enhanceDialogSelects(root);field('aiScan').onclick=scan;
    field('aiFormat').onchange=()=>{if(busy)return;format=field('aiFormat').value;items=[];selected.clear();note('格式已更改，请重新扫描或选择导出文件。');draw();};
    field('aiBrowse').onclick=()=>showWorkspacePicker({hostId:'',path:field('aiDirectory').value||'',onPick:directory=>{if(active()){field('aiDirectory').value=directory;scan();}}});
    field('aiUpload').onclick=()=>field('aiFiles').click();
    field('aiFiles').onchange=async()=>{
      const files=[...field('aiFiles').files];field('aiFiles').value='';if(!files.length||busy)return;
      if(files.length>20||files.some(f=>f.size>8*1024*1024))return note('每次最多选择 20 个文件，单个文件不超过 8 MB。');
      busy=true;draw();note('正在解析导出文件…');
      try{const failures=[];for(const file of files){const data=await api('/api/agent-import/preview',{method:'POST',body:{agent,format,files:[{name:file.name,content:await file.text()}]}});if(!active())return;items=[...new Map([...items,...data.items].map(item=>[item.fingerprint,item])).values()];failures.push(...data.errors);}if(active())note(failures.length?'部分文件无法导入：'+failures.map(e=>e.name+'：'+e.error).join('；'):'导出文件已预览，勾选后导入。');}
      catch(error){note(error.message);}finally{if(active()){busy=false;draw();}}
    };
    field('aiSearch').oninput=()=>{query=field('aiSearch').value.trim().toLowerCase();draw();};
    field('aiSelectAll').onchange=()=>{const checked=field('aiSelectAll').checked;for(const item of filtered())if(!item.existingId)checked?selected.add(item.id):selected.delete(item.id);draw();};
    field('aiCommit').onclick=()=>commit([...selected]);field('aiAll').onclick=()=>commit(items.filter(item=>!item.existingId).map(item=>item.id));draw();scan();
  }
  window.AgentHubAgentSessionImport=Object.freeze({mount});
})();
