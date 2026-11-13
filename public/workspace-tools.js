(() => {
  async function remoteGit() {
    const s = curSession(); if (!s?.remoteHostId) return toast('先打开远程任务', 'err');
    const icon = name => window.AgentHubIcons.svg(name);
    openDlg('远程变更中心', '<p class="feature-loading">读取目标仓库…</p>'); const guard = dialogGuard();
    const call = body => ['status','diff','history','show'].includes(body.action) ? api('/api/sessions/' + encodeURIComponent(s.id) + '/remote-git?' + new URLSearchParams(body), { timeoutMs:75000 }) : api('/api/sessions/' + encodeURIComponent(s.id) + '/remote-git', {method:'POST',timeoutMs:75000,body});
    let state, tab = 'changes', draft = '', historyLimit = 40, all = false, historySeq = 0, diffSeq = 0, refreshSeq = 0;
    async function history() {
      const seq = ++historySeq, box = $('#remoteGitHistory');
      if (!box) return;
      box.innerHTML = '<p class="feature-loading">读取提交图谱…</p>';
      try {
        const data = await call({action:'history',limit:historyLimit,all:all?'1':'0'});
        if (!guard() || seq !== historySeq || !box.isConnected) return;
        box.innerHTML = data.commits.length ? gitGraphRows(data.commits) : '<div class="git-empty">仓库还没有提交。</div>';
        const more = $('#remoteHistoryMore'); more.hidden = !data.hasMore || historyLimit >= 160;
        more.onclick = () => {historyLimit = Math.min(160,historyLimit + 40);history();};
        box.querySelectorAll('[data-git-commit]').forEach(b => bindDialogAction(b,()=>showDiff({action:'show',sha:b.dataset.gitCommit}),'读取中…'));
      } catch(e) { if(guard() && box.isConnected) box.innerHTML = `<div class="feature-error" role="alert">${esc(e.message)}</div>`; }
    }
    async function showDiff(body) {
      const seq=++diffSeq;
      const box = $('#remoteGitOutput'); if(!box)return;
      box.hidden = false; box.textContent = '正在读取差异…';
      try { const result=await call(body); if(!guard()||!box.isConnected||seq!==diffSeq)return;box.innerHTML = `<div class="git-diff-head"><b>${body.sha?'提交 '+esc(body.sha.slice(0,12)):esc(body.path||'工作区差异')}</b><button type="button" class="btn-mini" data-diff-close aria-label="关闭差异">${icon('close')}</button></div>${renderGitDiffText(result.diff||'没有文本差异。')}${result.truncated?'<p class="dialog-note">差异过长，已截断。</p>':''}`;box.querySelector('[data-diff-close]')?.addEventListener('click',()=>{diffSeq++;box.hidden=true;}); }
      catch(e) {if(guard() && box.isConnected&&seq===diffSeq)box.innerHTML=`<p class="feature-error" role="alert">${esc(e.message)}</p>`;}
    }
    async function refresh() {
      const seq=++refreshSeq,result=await call({action:'status'});if(!guard()||seq!==refreshSeq)return;state=result;draw();
    }
    function draw() {
      const st=state, staged=st.files.filter(f=>f.staged).length;
      $('#dlgBody').innerHTML=`<div class="remote-git-workspace"><div class="workspace-target">${icon('branch')}<div><strong>${esc(st.branch)}</strong><span>${esc(hostName(s))} · ${esc(st.repoRoot||st.cwd)}</span></div><code>${esc((st.head||'').slice(0,8)||'无提交')}</code></div><div class="feature-toolbar"><button class="btn-mini" id="remoteGitRefresh">${icon('refresh')}刷新</button>${[['fetch','download','获取'],['pull','download','拉取'],['push','upload','推送']].map(([action,glyph,label])=>`<button class="btn-mini" data-remote-git="${action}" ${S.readOnly?'disabled':''}>${icon(glyph)}${label}</button>`).join('')}<span class="dialog-note">拉取仅允许快进</span></div><nav class="section-tabs" aria-label="远程 Git 分区"><button data-remote-tab="changes" class="${tab==='changes'?'active':''}">${icon('file')}工作区 <span>${st.files.length}</span></button><button data-remote-tab="history" class="${tab==='history'?'active':''}">${icon('branch')}提交图谱</button></nav><section id="remoteChanges" ${tab==='changes'?'':'hidden'}><div class="git-status-summary"><strong>${st.files.length} 个改动文件</strong><span>已暂存 ${staged} · 未暂存 ${st.files.filter(f=>f.unstaged).length}</span></div><div class="feature-checklist remote-git-files">${st.files.map(f=>`<div class="feature-row">${fileIconHtml(f.path,'row')}<div class="feature-row-main"><b>${esc(f.path)}</b><small>${esc(f.status)} · ${f.staged?'已暂存':''}${f.staged&&f.unstaged?' / ':''}${f.unstaged?'未暂存':''}</small></div><span class="git-file-lines">${Number.isFinite(f.added)?'<i>+'+f.added+'</i> <em>−'+f.deleted+'</em>':esc(f.lineNote||'行数不可用')}</span><button class="btn-mini" data-remote-diff="${esc(f.path)}">差异</button><button class="btn-mini" data-remote-stage="${esc(f.path)}" ${S.readOnly?'disabled':''}>${f.staged?'取消暂存':'暂存'}</button></div>`).join('')||`<div class="compact-empty">${icon('check')}<strong>工作区干净</strong><p>切换到提交图谱查看已有记录。</p></div>`}</div><div class="remote-git-compose"><div class="fld"><label for="remoteGitMessage">提交暂存区 · ${staged} 个文件</label><textarea id="remoteGitMessage" rows="2" placeholder="说明本次改动">${esc(draft)}</textarea></div><button class="btn" id="remoteGitCommit" ${S.readOnly||!staged?'disabled':''}>${icon('check')}提交</button></div></section><section id="remoteHistory" ${tab==='history'?'':'hidden'}><div class="feature-toolbar"><label class="ctrl-label"><input id="remoteHistoryAll" type="checkbox" ${all?'checked':''}>所有本地与远端分支</label></div><div id="remoteGitHistory"></div><button class="btn-mini" id="remoteHistoryMore" hidden>加载更多提交</button></section><div id="remoteGitError" role="alert"></div><div id="remoteGitOutput" class="remote-git-diff" hidden></div></div>`;
      $('#remoteGitMessage').oninput=e=>{draft=e.target.value;};
      bindDialogAction('#remoteGitRefresh',refresh,'读取中…');
      $$('#dlgBody [data-remote-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.remoteTab;draw();});
      $('#remoteHistoryAll').onchange=e=>{all=e.target.checked;historyLimit=40;history();};
      const run=async body=>{try{await call({...body,expectedHead:st.head});if(!guard())return;if(body.action==='commit')draft='';toast('Git 操作完成','ok');await refresh();}catch(e){if(guard())$('#remoteGitError').innerHTML=`<p class="feature-error">${esc(e.message)}</p>`;}};
      $$('#dlgBody [data-remote-stage]').forEach(b=>bindDialogAction(b,()=>run({action:'stage',path:b.dataset.remoteStage,stage:!st.files.find(f=>f.path===b.dataset.remoteStage).staged}),'处理中…'));
      $$('#dlgBody [data-remote-diff]').forEach(b=>bindDialogAction(b,()=>showDiff({action:'diff',path:b.dataset.remoteDiff}),'读取中…'));
      $$('#dlgBody [data-remote-git]').forEach(b=>bindDialogAction(b,async()=>{if(b.dataset.remoteGit==='push'&&!await uiConfirm('把当前分支推送到远程仓库？',{title:'推送分支',okLabel:'推送'}))return;await run({action:b.dataset.remoteGit});},'执行中…'));
      bindDialogAction('#remoteGitCommit',()=>run({action:'commit',message:draft}),'提交中…');
      if(tab==='history')history();
    }
    try {await refresh();}catch(e){if(guard())$('#dlgBody').innerHTML=`<div class="workspace-error" role="alert">${icon('branch')}<strong>无法读取远程仓库</strong><p>${esc(e.message)}</p><button class="btn ghost" id="remoteGitRetry">重试</button></div>`;$('#remoteGitRetry')?.addEventListener('click',remoteGit);}
  }
  const sharedBrowser = options => window.AgentHubBrowserWorkspace.sharedBrowser(options);
  AgentHubFeatures.register('sharedBrowser', '共享浏览器', '查看实时画面、接管、选择元素与页面诊断', sharedBrowser, '工作环境');
  AgentHubFeatures.register('remoteGit', '远程 Git', '目标主机的差异、暂存、提交、拉取和推送', remoteGit, '工作环境');
  Object.assign(AgentHubFeatures, { ...window.AgentHubBrowserWorkspace, sharedBrowser, remoteGit });
  document.getElementById('btnBrowserDock')?.addEventListener('click', () => sharedBrowser());
})();
