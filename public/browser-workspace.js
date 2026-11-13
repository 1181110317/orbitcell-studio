/* Browser pages use the same tab strip as files, previews and plans. Only the
   visible page polls frames; leases and screenshots are never cached in tabs. */
(() => {
  'use strict';
  const icon = name => window.AgentHubIcons.svg(name);
  const releases = new Map();
  let active = null;
  function suspend() { active?.dispose(); active = null; $('#btnBrowserDock')?.setAttribute('aria-pressed', 'false'); }
  function address(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return safeHttpUrl(value);
    if (/^(?:localhost|127\.\d+\.\d+\.\d+|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(value) || /^[\w.-]+:\d+(?:[/?#]|$)/.test(value)) return safeHttpUrl('http://' + value);
    if (/^[^\s/]+\.[^\s/]+(?:[/?#]|$)/.test(value)) return safeHttpUrl('https://' + value);
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) return '';
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(value);
  }
  async function sharedBrowser(options = {}) {
    const session = curSession(); if (!session) return toast('先打开一个会话', 'err');
    while (!$('#overlay').classList.contains('hidden')) closeDlg();
    resetReviewTabsForSession();
    let tab = !options.newTab && S.review.tabs.find(item => item.mode === 'browser' && item.browser?.sessionId === session.id);
    if (!tab && !options.newTab) {
      try {
        const result = await api('/api/browser/pages?sessionId=' + encodeURIComponent(session.id));
        if (S.curSessionId !== session.id) return;
        for (const page of result.pages || []) {
          const restored = ensureReviewTab('browser', '', [], 'browser:' + session.id + ':' + page.id);
          restored.browser = { sessionId: session.id, pageId: page.id, url: page.url, title: page.title };
          if (!tab) tab = restored;
        }
      } catch { if (S.curSessionId !== session.id) return; /* Old backend is explained when navigation is attempted. */ }
    }
    if (!tab) {
      const blank = S.review.open && S.review.mode === 'blank' ? S.review.tabs.find(item => item.id === S.review.activeTabId) : null;
      if (blank) { persistReviewTab(); tab = blank; tab.mode = 'browser'; tab.key = 'browser:' + crypto.randomUUID(); }
      else tab = ensureReviewTab('browser', '', [], 'browser:' + crypto.randomUUID());
      tab.browser = { sessionId: session.id, pageId: '', url: '', text: '', pick: false, title: '' };
      if (blank) applyReviewTab(tab);
    }
    if (options.url) tab.browser.pendingUrl = options.url;
    activateReviewTab(tab.id);
    return tab;
  }
  async function openBrowserPage(raw) {
    const url = address(raw); if (!url) return toast('请输入网址或搜索内容', 'err');
    resetReviewTabsForSession();
    const existing = (S.review.tabs || []).find(tab => tab.mode === 'browser' && tab.browser?.sessionId === S.curSessionId && tab.browser.url === url);
    if (existing) return activateReviewTab(existing.id);
    return sharedBrowser({ newTab: true, url });
  }
  function release(browser, token) {
    if (!token || !browser.pageId) return Promise.resolve();
    const key = browser.sessionId + ':' + browser.pageId;
    const task = api('/api/browser/claim', { method: 'POST', body: { sessionId: browser.sessionId, pageId: browser.pageId, controllerToken: token, mode: 'agent' } }).catch(() => {}).finally(() => { if (releases.get(key) === task) releases.delete(key); });
    releases.set(key, task); return task;
  }
  async function closeTab(tab) {
    const browser = tab.browser; if (!browser) return;
    if (active?.tab === tab) suspend();
    if (browser.creatingPage) await browser.creatingPage.catch(() => {});
    const pending = releases.get(browser.sessionId + ':' + browser.pageId); if (pending) await pending;
    if (browser.pageId) try { await api('/api/browser/page-close', { method: 'POST', body: { sessionId: browser.sessionId, pageId: browser.pageId } }); }
    catch (error) { toast('标签已关闭，浏览器页面未能结束：' + error.message, 'err'); }
  }
  function mount(root, tab) {
    suspend();
    const browser = tab.browser; if (!browser) return;
    let closed = false, token = '', revision = 0, navigationRevision = 0, interactiveUntil = 0, timer, polling = false, navigating = false, recording = !!browser.recording, viewport = {width:1280,height:800};
    const el = selector => root.querySelector(selector);
    const valid = () => !closed && root.isConnected && S.review.open && S.review.activeTabId === tab.id;
    root.innerHTML = `<div class="workspace-browser" id="browserDock"><div class="workspace-browser-address"><div class="workspace-browser-nav">${[['back','chevronLeft','后退'],['forward','chevronRight','前进'],['reload','refresh','刷新网页']].map(([action,glyph,label])=>`<button type="button" data-browser-nav="${action}" aria-label="${label}" ${S.readOnly?'disabled':''}>${icon(glyph)}</button>`).join('')}</div><form id="sharedBrowserForm"><span>${icon('globe')}</span><input id="sharedBrowserUrl" aria-label="浏览器地址" placeholder="搜索或输入网址" autocomplete="off" value="${esc(browser.addressDraft??browser.url??'')}"><button type="submit" id="sharedBrowserOpen" aria-label="前往" ${S.readOnly?'disabled':''}>${icon('arrowRight')}</button></form><button type="button" id="sharedBrowserExternal" aria-label="在系统浏览器打开">${icon('external')}</button></div><div class="workspace-browser-control"><span id="sharedBrowserStatus" role="status">${browser.pageId?'正在连接页面…':'在此标签打开网页'}</span><button type="button" class="btn-mini" id="sharedBrowserClaim" ${S.readOnly?'disabled':''}>接管</button><button type="button" class="btn-mini" id="sharedBrowserRelease" hidden ${S.readOnly?'disabled':''}>归还 Agent</button><label><input type="checkbox" id="sharedBrowserPick" ${browser.pick?'checked':''}>选取元素</label><button type="button" class="btn-mini" id="sharedBrowserSize" aria-pressed="${browser.displayMode==='actual'}">${browser.displayMode==='actual'?'适应侧栏':'原始尺寸'}</button><button type="button" class="btn-mini" id="sharedBrowserDiagnostics" title="页面诊断">${icon('info')}</button></div><div class="workspace-browser-view"><div class="workspace-browser-empty" id="sharedBrowserEmpty">${icon('globe')}<strong>每个网页都有自己的标签</strong><p>输入网址开始浏览，文件和计划仍保留在上方。</p><button type="button" class="btn-mini" id="sharedBrowserImport">查看 Agent 打开的页面</button></div><img id="sharedBrowserImage" alt="浏览器实时画面" tabindex="0" hidden></div><form class="workspace-browser-input" id="sharedBrowserInputForm"><input id="sharedBrowserText" aria-label="输入到网页的文字" placeholder="接管后输入到网页" value="${esc(browser.text||'')}" ${S.readOnly?'disabled':''}><button type="submit" id="sharedBrowserType" class="btn-mini" ${S.readOnly?'disabled':''}>输入</button><button type="button" class="btn-mini" id="sharedBrowserEnter" ${S.readOnly?'disabled':''}>Enter</button></form><details class="workspace-browser-details" id="sharedBrowserDetails" hidden><summary>页面诊断</summary><pre></pre></details></div>`;
    const post = async (op, body = {}) => { const result = await api('/api/browser/' + op, { method: 'POST', timeoutMs: 75000, body: { ...body, sessionId: browser.sessionId, pageId: browser.pageId || undefined, controllerToken: token || undefined } }); if (['keyboard','pointer','pick'].includes(op) && valid()) { interactiveUntil = Date.now() + 700; poll(); } return result; };
    const get = (op, extra = {}) => api('/api/browser/' + op + '?' + new URLSearchParams({ sessionId: browser.sessionId, ...(browser.pageId ? { pageId: browser.pageId } : {}), ...extra }), { timeoutMs: 30000, cache: 'no-store' });
    const recordButton = document.createElement('button'); recordButton.type = 'button'; recordButton.className = 'btn-mini'; recordButton.id = 'sharedBrowserRecord'; recordButton.title = '记录页面操作'; recordButton.setAttribute('aria-label', '记录页面操作'); recordButton.innerHTML = icon('clock'); recordButton.disabled = S.readOnly;
    recordButton.setAttribute('aria-pressed',String(recording)); el('.workspace-browser-control').appendChild(recordButton);
    const report = error => { if (!valid()) return; el('#sharedBrowserStatus').textContent = error.message === '404' ? '多标签浏览器需要加载新版后端，请重启 OrbitCell 后再试。' : error.message; if (/浏览器标签不存在|浏览器已关闭/.test(error.message)) { browser.pageId = ''; el('#sharedBrowserImage').hidden = true; el('#sharedBrowserImage').removeAttribute('src'); el('#sharedBrowserEmpty').hidden = false; el('#sharedBrowserStatus').textContent = '网页已结束，可在地址栏重新打开'; } };
    const meta = value => {
      if (!valid()) return;
      if (value.url && value.url !== 'about:blank') {
        browser.url = value.url;
        if (!browser.addressDirty && document.activeElement !== el('#sharedBrowserUrl')) { el('#sharedBrowserUrl').value = value.url; browser.addressDraft = value.url; }
      }
      if (value.title && value.title !== browser.title) { browser.title = value.title; renderReviewTabs(); }
      renderReviewHead();
    };
    const control = (human, occupied = false) => { if (!valid()) return; el('#sharedBrowserClaim').hidden = human; el('#sharedBrowserRelease').hidden = !human; el('#sharedBrowserStatus').textContent = human ? '用户接管中' : occupied ? '其他窗口正在接管此页' : 'Agent 可操作 · 接管后可点击和输入'; };
    const ensurePage = async () => {
      if (browser.pageId) return;
      if (!browser.creatingPage) browser.creatingPage = post('page-new').then(result => { browser.pageId = result.page.id; }).finally(() => { delete browser.creatingPage; });
      await browser.creatingPage;
    };
    const poll = async () => {
      clearTimeout(timer);
      if (!valid() || polling) return;
      if (!document.hidden && root.getClientRects().length && $('#overlay').classList.contains('hidden') && browser.pageId && !navigating) {
        polling = true; const controlAt = revision, navigationAt = navigationRevision;
        try { const viewBox = el('.workspace-browser-view').getBoundingClientRect();
          const size = browser.displayMode==='actual' ? {width:1280,height:800} : {width:Math.max(320,Math.min(1920,Math.round(viewBox.width))),height:Math.max(200,Math.min(1440,Math.round(viewBox.height)))};
          const frame = await get('frame',size); if (!valid() || navigationAt !== navigationRevision) return; viewport = {width:frame.width,height:frame.height}; meta(frame); el('#sharedBrowserImage').src = frame.image; el('#sharedBrowserImage').hidden = false; el('#sharedBrowserEmpty').hidden = true;
          if (controlAt === revision) { if (frame.control.mode !== 'human') token = ''; control(frame.control.mode === 'human' && !!token, frame.control.mode === 'human'); }
        } catch (error) { report(error); } finally { polling = false; }
      }
      if (valid()) timer = setTimeout(poll, Date.now() < interactiveUntil ? 180 : 1600);
    };
    const bind = (selector, fn) => { el(selector).onclick = () => withPendingButton(el(selector), async () => { try { await fn(); } catch (error) { report(error); } }, '…'); };
    const navigate = async raw => {
      const url = address(raw); if (!url) throw new Error('请输入有效的 http(s) 网址或搜索内容');
      if (navigating) return; navigationRevision++; browser.pendingUrl = url;
      browser.addressDirty = false; browser.addressDraft = url;
      navigating = true; if (valid()) el('#sharedBrowserStatus').textContent = '正在打开网页…';
      try { await ensurePage(); if (!valid()) return; const result = await post('open', { url }); browser.url = result.page.url; browser.title = result.page.title || ''; delete browser.pendingUrl; meta(result.page); if (valid()) renderReviewTabs(); if (valid()) control(!!token); }
      finally { navigating = false; if (valid()) poll(); }
    };
    el('#sharedBrowserUrl').oninput = () => { browser.addressDraft = el('#sharedBrowserUrl').value; browser.addressDirty = true; };
    el('#sharedBrowserForm').onsubmit = event => { event.preventDefault(); const button = event.submitter || el('#sharedBrowserForm button'); withPendingButton(button, () => navigate(el('#sharedBrowserUrl').value).catch(report), '…'); };
    el('#sharedBrowserInputForm').onsubmit = event => { event.preventDefault(); if (!token) return toast('先接管页面', 'err'); withPendingButton(el('#sharedBrowserType'), () => post('keyboard', { text: el('#sharedBrowserText').value }).catch(report), '…'); };
    bind('#sharedBrowserClaim', async () => {
      if (!browser.pageId) throw new Error('请先打开网页');
      await releases.get(browser.sessionId + ':' + browser.pageId);
      const ownRevision = ++revision, result = await post('claim', { mode: 'human' });
      if (!valid() || ownRevision !== revision) { await release(browser, result.token); return; }
      token = result.token; control(true); el('#sharedBrowserImage').focus();
    });
    bind('#sharedBrowserRelease', async () => { revision++; const previous = token; token = ''; await release(browser, previous); control(false); });
    bind('#sharedBrowserEnter', async () => { if (!token) throw new Error('先接管页面'); await post('keyboard', { key: 'Enter' }); });
    el('.workspace-browser-view').dataset.size = browser.displayMode || 'fit';
    el('#sharedBrowserSize').onclick = () => { navigationRevision++; browser.displayMode = browser.displayMode==='actual'?'fit':'actual'; el('.workspace-browser-view').dataset.size = browser.displayMode; const button = el('#sharedBrowserSize'); button.setAttribute('aria-pressed',String(browser.displayMode==='actual')); button.textContent = browser.displayMode==='actual'?'适应侧栏':'原始尺寸'; poll(); };
    bind('#sharedBrowserExternal', async () => { const url = safeHttpUrl(browser.url); if (url) window.open(url, '_blank', 'noopener,noreferrer'); });
    bind('#sharedBrowserDiagnostics', async () => { const data = await get('diagnostics'); if (valid()) { const box = el('#sharedBrowserDetails'); box.hidden = false; box.open = true; box.querySelector('pre').textContent = JSON.stringify(data.entries, null, 2); } });
    bind('#sharedBrowserRecord', async () => { if (!browser.pageId) throw new Error('请先打开网页'); const data = await post('recording', { enabled: !recording }); recording = data.recording; browser.recording = recording; if (valid()) { recordButton.setAttribute('aria-pressed', String(recording)); recordButton.title = recording ? '结束记录' : '记录页面操作'; const box = el('#sharedBrowserDetails'); box.hidden = false; box.open = true; box.querySelector('pre').textContent = JSON.stringify(data.actions, null, 2); } });
    bind('#sharedBrowserImport', async () => {
      const result = await get('pages'); if (!valid()) return;
      if (!result.pages.length) throw new Error('Agent 还没有打开网页');
      for (const page of result.pages) {
        let known = S.review.tabs.find(item => item.mode === 'browser' && item.browser?.sessionId === browser.sessionId && item.browser.pageId === page.id);
        if (!known) { known = ensureReviewTab('browser', '', [], 'browser:' + browser.sessionId + ':' + page.id); known.browser = { sessionId: browser.sessionId, pageId: page.id, url: page.url, title: page.title }; }
      }
      const first = S.review.tabs.find(item => item.mode === 'browser' && item.browser?.sessionId === browser.sessionId && item.browser.pageId === result.pages[0].id);
      if (first) activateReviewTab(first.id);
    });
    root.querySelectorAll('[data-browser-nav]').forEach(button => button.onclick = () => withPendingButton(button, async () => { try { if (!browser.pageId || navigating) return; navigationRevision++; meta(await post('navigate', { direction: button.dataset.browserNav })); if (valid()) poll(); } catch (error) { report(error); } }, '…'));
    const view = el('#sharedBrowserImage');
    const point = event => { const box = view.getBoundingClientRect(); return { x: Math.max(0, Math.min(viewport.width, (event.clientX - box.left) * viewport.width / box.width)), y: Math.max(0, Math.min(viewport.height, (event.clientY - box.top) * viewport.height / box.height)) }; };
    view.onclick = async event => { try { if (!browser.pageId) return; if (el('#sharedBrowserPick').checked) { const data = await post('pick', point(event)); if (valid()) { const box = el('#sharedBrowserDetails'); box.hidden = false; box.open = true; box.querySelector('pre').textContent = JSON.stringify(data, null, 2); } }
      else { if (!token) return toast('先接管页面', 'err'); await post('pointer', { type: 'mousePressed', ...point(event) }); await post('pointer', { type: 'mouseReleased', ...point(event) }); if (valid()) view.focus(); }
    } catch (error) { report(error); } };
    view.onkeydown = event => { if (!token || S.readOnly) return; if (['Enter','Tab','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); post('keyboard', { key: event.key }).catch(report); } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) { event.preventDefault(); post('keyboard', { text: event.key }).catch(report); } };
    let wheelBusy = false, wheel = null;
    view.onwheel = event => { if (!token || S.readOnly) return; event.preventDefault(); wheel = { type: 'mouseWheel', ...point(event), deltaX: (wheel?.deltaX || 0) + event.deltaX, deltaY: (wheel?.deltaY || 0) + event.deltaY }; flushWheel(); };
    async function flushWheel() { if (wheelBusy || !wheel || !valid() || !token) return; wheelBusy = true; const next = wheel; wheel = null; try { await post('pointer', next); } catch (error) { report(error); } finally { wheelBusy = false; if (wheel) flushWheel(); } }
    active = { tab, dispose() { if (closed) return; closed = true; revision++; clearTimeout(timer); browser.text = el('#sharedBrowserText')?.value || ''; browser.pick = !!el('#sharedBrowserPick')?.checked; release(browser, token); token = ''; wheel = null; } };
    $('#btnBrowserDock')?.setAttribute('aria-pressed', 'true');
    if (browser.pendingUrl) { const url = browser.pendingUrl; delete browser.pendingUrl; navigate(url).catch(report); } else poll();
  }
  window.AgentHubBrowserWorkspace = { sharedBrowser, openBrowserPage, mountWorkspaceBrowser: mount, suspendBrowser: suspend, closeBrowserTab: closeTab, closeSharedBrowser: () => { if (S.review.mode === 'browser') closeReviewPanel(); else suspend(); } };
})();
