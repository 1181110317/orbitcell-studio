(() => {
  function bodyFor(plan) {
    const parts = [];
    if (typeof plan?.plan === 'string' && plan.plan.trim()) parts.push(plan.plan);
    const steps = (Array.isArray(plan?.todos) ? plan.todos : []).filter(t => t && typeof t.text === 'string' && t.text.trim());
    if (steps.length) parts.push(steps.map(t => '- [' + (t.status === 'completed' ? 'x' : ' ') + '] ' + t.text + (t.status === 'in_progress' ? '（进行中）' : '')).join('\n'));
    return parts.join('\n\n');
  }
  function implementationDraft(source, plan, text) {
    return '请按照以下已确认的计划实施，完成后运行相关验证并说明结果。\n'
      + '开始前请用当前 Agent 的原生计划工具建立执行清单；开始某一步时标为进行中，实际完成后更新为已完成。'
      + '核对已有成果，保留真实的未完成项。若当前工具不支持结构化计划，请直接说明当前步骤。\n\n'
      + '来源任务：@@' + source.id + '\n计划：' + plan.title + '（第 ' + plan.revision + ' 版）\n\n' + text;
  }
  function download(title, body) {
    const filename = (title || '计划').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') || '计划';
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename + '.md';
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function plans() {
    openDlg('已保存的计划', '<div class="feature-loading" role="status">正在读取计划…</div>');
    const guard = dialogGuard();
    try {
      const data = await api('/api/plans'); if (!guard()) return;
      $('#dlgBody').innerHTML = `<div class="plan-library"><div class="plan-library-intro">${window.AgentHubIcons.svg('list')}<span><b>计划库</b><p>查看方案、编辑正文，再创建实施草稿。</p></span></div><div class="feature-toolbar"><input id="planSearch" placeholder="搜索计划" aria-label="搜索计划"><button type="button" class="btn ghost" id="planReload">${window.AgentHubIcons.svg('refresh')}<span>刷新</span></button></div>${data.loadError ? `<div class="feature-error" role="alert">计划文件不可读，原文件已保留：${esc(data.loadError)}</div>` : ''}<div class="plan-saved-list" id="planList"></div></div>`;
      $('#planReload').onclick = plans;
      const draw = () => {
        const q = $('#planSearch').value.toLowerCase();
        $('#planList').innerHTML = data.items.filter(p => (p.title + ' ' + p.excerpt).toLowerCase().includes(q)).map(p => `<button type="button" class="plan-saved-card" data-open-plan="${esc(p.id)}">${window.AgentHubIcons.svg('file')}<span class="plan-saved-copy"><strong>${esc(p.title)}</strong><span>${esc(p.excerpt)}</span><small>第 ${p.revision} 版 · ${esc(new Date(p.updatedAt).toLocaleDateString())}</small></span>${window.AgentHubIcons.svg('chevronRight')}</button>`).join('') || '<div class="feature-loading">还没有匹配的已保存计划</div>';
        $$('#planList [data-open-plan]').forEach(button => button.onclick = async () => {
          button.disabled = true;
          try { const item = await api('/api/plans/' + encodeURIComponent(button.dataset.openPlan)); if (guard()) await editor(item.plan); }
          catch (error) { if (guard()) toast(error.message, 'err'); }
          finally { button.disabled = false; }
        });
      };
      $('#planSearch').oninput = draw; draw();
    } catch (error) { if (guard()) $('#dlgBody').innerHTML = `<div class="feature-error" role="alert">${esc(error.message)}</div>`; }
  }
  async function editor(item) {
    const originKey = S.curSessionId;
    openDlg(item.id ? '计划详情' : '保存计划', '<div class="feature-loading" role="status">正在读取来源任务…</div>');
    const guard = dialogGuard();
    let source = null;
    try { source = await api('/api/sessions/' + encodeURIComponent(item.sessionId)); }
    catch {} // Saved plans remain readable and downloadable if their source was deleted.
    if (!guard()) return;
    const disabled = S.readOnly ? 'disabled' : '';
    const permission = source?.permMode === 'plan' ? 'edits' : ['ask', 'edits', 'auto'].includes(source?.permMode) ? source.permMode : 'ask';
    const icon = name => window.AgentHubIcons.svg(name);
    $('#dlgBody').innerHTML = `<div class="plan-editor"><div class="plan-source">${icon('folder')}<span><b>${esc(source?.title || '来源任务不可用')}</b><small>${source ? esc((source.remoteHostId ? '远程项目 · ' : '项目 · ') + (source.cwd || '默认目录')) : '计划正文仍可下载；创建实施任务需要恢复来源任务。'}</small></span></div><div class="fld"><label for="planTitle">计划名称</label><input id="planTitle" maxlength="200" value="${esc(item.title || '实施计划')}" ${disabled}></div><div class="plan-document-editor"><div class="plan-editor-bar"><label for="planBody">计划正文</label><span>Markdown</span><button type="button" id="planPreviewToggle" class="btn-mini" aria-pressed="false">${icon('file')}<span>预览</span></button></div><textarea id="planBody" rows="10" maxlength="131072" spellcheck="false" ${disabled}>${esc(item.body || '')}</textarea><div id="planPreview" class="md-body" hidden></div></div><div class="plan-implementation"><span class="plan-implementation-icon">${icon('shield')}</span><label for="planPermission">实施权限</label><select id="planPermission" ${disabled}>${[['ask', '每次询问'], ['edits', '接受编辑'], ['auto', '自动执行']].map(([value, label]) => `<option value="${value}" ${permission === value ? 'selected' : ''}>${label}</option>`).join('')}</select><small>创建草稿后，发送才会开始实施。</small></div><div class="feature-error hidden" id="planError" role="alert"></div><div class="dialog-actions plan-actions"><span id="planSaveState" class="plan-save-state" role="status">${item.id ? '已保存 · 第 ' + item.revision + ' 版' : '尚未保存'}</span><button type="button" class="btn ghost" id="planDownload" title="下载 Markdown" aria-label="下载计划 Markdown">${icon('download')}</button>${item.id ? `<button type="button" class="btn ghost" id="planDelete" ${disabled}>删除</button>` : ''}<button type="button" class="btn ghost" id="planSave" ${disabled}>${icon('save')}<span>保存计划</span></button><button type="button" class="btn" id="planImplement" ${S.readOnly || !source ? 'disabled' : ''}>${icon('play')}<span>创建实施草稿</span></button></div></div>`;
    enhanceDialogSelects($('#dlgBody'));
    $('#planPreviewToggle').onclick = () => {
      const button = $('#planPreviewToggle'), show = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(show));
      button.innerHTML = icon(show ? 'edit' : 'file') + '<span>' + (show ? '编辑' : '预览') + '</span>';
      $('#planBody').hidden = show;
      const preview = $('#planPreview'); preview.hidden = !show;
      if (show) { preview.innerHTML = md($('#planBody').value); highlightIn(preview); }
    };
    let current = item, version = 0;
    const error = value => { if (guard()) { $('#planError').textContent = value.message; $('#planError').classList.remove('hidden'); } };
    const value = () => ({ sessionId: item.sessionId, title: $('#planTitle').value, body: $('#planBody').value, ...(current.id ? { id: current.id, expectedRevision: current.revision } : {}) });
    for (const id of ['planTitle', 'planBody']) $('#' + id).addEventListener('input', () => { version++; $('#planSaveState').textContent = '有未保存的修改'; });
    $('#planDownload').onclick = () => download($('#planTitle').value, $('#planBody').value);
    async function save() {
      const revision = version;
      const result = await api('/api/plans', { method: 'POST', body: value() });
      current = result.plan;
      if (guard()) { $('#planError').classList.add('hidden'); $('#planSaveState').textContent = revision === version ? '已保存 · 第 ' + current.revision + ' 版' : '有未保存的修改'; }
      return revision === version;
    }
    // Both actions share a gate: saving and creating cannot race revisions.
    let busy = false;
    const action = async (button, fn) => {
      if (busy || S.readOnly || !guard()) return;
      busy = true; button.disabled = true;
      try { await fn(); } catch (e) { error(e); }
      finally { busy = false; if (button.isConnected) button.disabled = button.id === 'planImplement' && !source || S.readOnly; }
    };
    $('#planSave').onclick = e => action(e.currentTarget, save);
    $('#planImplement').onclick = e => action(e.currentTarget, async () => {
      if (!source) return;
      const text = $('#planBody').value, title = $('#planTitle').value, permMode = $('#planPermission').value;
      if (!await save() || !guard()) return;
      if (S.curSessionId !== originKey) throw Error('当前会话已切换，请重新打开计划后创建任务');
      const navigation = ++openSessionSeq;
      const session = await api('/api/sessions', { method: 'POST', body: { agent: source.agent, title: ('实施 · ' + title).slice(0, 200), cwd: source.cwd || '', remoteHostId: source.remoteHostId || '', model: source.model || '', providerId: source.providerId || '', effort: source.effort || '', assistantId: source.assistantId || '', permMode, autoPerms: permMode === 'auto' } });
      if (!S.sessions.some(s => s.id === session.id)) S.sessions.unshift(session);
      const draft = implementationDraft(source, current, text);
      const saved = saveComposerDraft(session.id, draft, []); if (saved === false) preserveDraft(draft, []);
      renderSessions();
      if (!guard() || navigation !== openSessionSeq) return;
      while (!$('#overlay').classList.contains('hidden')) closeDlg();
      await openSession(session.id);
      if (S.curSessionId === session.id && openSessionSeq === navigation + 1 && saved === false) { $('#inpText').value = draft; autoGrow(); }
      toast(saved === false ? '实施任务已创建，正文保留在输入框与恢复区' : '实施草稿已创建，确认后发送', saved === false ? 'err' : 'ok');
    });
    if ($('#planDelete')) $('#planDelete').onclick = e => action(e.currentTarget, async () => {
      if (!await uiConfirm('删除这个已保存的计划？', { title: '删除计划', danger: true }) || !guard()) return;
      await api('/api/plans/' + encodeURIComponent(current.id) + '?revision=' + current.revision, { method: 'DELETE' }); if (guard()) await plans();
    });
  }
  function openDocument(plan, source, trigger) {
    const body = bodyFor(plan);
    if (!body || !source) return;
    const summary = planDocumentSummary(plan);
    openReviewPlanDocument({ sessionId: source.id, sourceTitle: source.title, title: summary.title, body, triggerRef: trigger && typeof WeakRef === 'function' ? new WeakRef(trigger) : null });
    $('#reviewDiff .plan-reader')?.focus({ preventScroll: true });
  }
  function renderDocument(root, document) {
    if (!document) { root.innerHTML = '<div class="review-empty">计划正文不可用，请从消息重新打开。</div>'; return; }
    const icon = name => window.AgentHubIcons.svg(name);
    root.innerHTML = `<article class="plan-reader" tabindex="-1" aria-label="计划文档：${esc(document.title)}"><div class="plan-reader-toolbar"><span>${icon('file')}<span>方案文档</span></span><button type="button" class="btn-mini" data-plan-reader-action="review" ${S.readOnly ? 'disabled' : ''}>${icon('edit')}<span>保存或实施</span></button><button type="button" class="btn-mini" data-plan-reader-action="download" title="下载 Markdown" aria-label="下载计划 Markdown">${icon('download')}</button></div><div class="plan-reader-source">${icon('chat')}<span>${esc(document.sourceTitle || '来源任务')}</span></div><div class="plan-reader-body md-body">${md(document.body)}</div></article>`;
    root.querySelector('.plan-reader').onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeReviewPanel(); } };
    root.querySelector('[data-plan-reader-action="download"]').onclick = () => download(document.title, document.body);
    root.querySelector('[data-plan-reader-action="review"]').onclick = () => editor({ sessionId: document.sessionId, title: document.title, body: document.body });
    highlightIn(root); renderMermaids(root);
  }
  window.AgentHubPlanDocuments = Object.freeze({ render: renderDocument });
  $('#messages').addEventListener('click', e => {
    const button = e.target.closest('[data-plan-action]'); if (!button) return;
    const card = button.closest('.plan-card'), source = curSession(); if (!card || !source) return;
    let plan; try { plan = JSON.parse(card.dataset.plan); } catch { return; }
    const body = bodyFor(plan); if (!body) return;
    if (button.dataset.planAction === 'open') openDocument(plan, source, button);
    else if (button.dataset.planAction === 'download') download(source.title + ' · 计划', body);
    else editor({ sessionId: source.id, title: (source.title + ' · 计划').slice(0, 200), body });
  });
  AgentHubFeatures.register('plans', '已保存的计划', '保存和下载计划，创建实施任务草稿', plans);
  AgentHubFeatures.plans = plans;
})();
