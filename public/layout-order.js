/* Display order is edited separately; cards retain their native DOM and layout. */
(() => {
  'use strict';
  const storageKey = 'orbitcell.layout-order.v1', bindings = new WeakMap();
  const clean = ids => [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id.length > 0 && id.length < 1024))].slice(0, 2000);
  let saved = {}, agentQueue = Promise.resolve();
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch {}
  function arrange(key, items, id = item => item.id) {
    const order = new Map(clean(saved[key]).map((value, index) => [value, index]));
    return [...items].sort((a, b) => (order.get(id(a)) ?? Infinity) - (order.get(id(b)) ?? Infinity));
  }
  function merge(all, visible) {
    const wanted = clean(visible), set = new Set(wanted), rest = [...wanted];
    return [...clean(all).map(id => set.has(id) ? rest.shift() : id), ...rest];
  }
  function agents(items, id = item => item.id, preferences = S.settings?.agentPreferences || {}) {
    return [...items].sort((a, b) => {
      const x = preferences[id(a)] || {}, y = preferences[id(b)] || {};
      return (x.order ?? 10000) - (y.order ?? 10000) || Number(!!y.pinned) - Number(!!x.pinned);
    });
  }
  function refresh(key) {
    for (const root of document.querySelectorAll('[data-layout-scope]')) if ((!key || root.dataset.layoutScope === key) && bindings.has(root)) apply(root, bindings.get(root));
  }
  function publish(key) { refresh(key); document.dispatchEvent(new CustomEvent('orbitcell:order-changed', { detail: { key } })); }
  function store(key, ids) {
    const next = { ...saved, [key]: clean(ids) };
    localStorage.setItem(storageKey, JSON.stringify(next)); saved = next; publish(key);
  }
  function saveAgents(ids) {
    const requested = clean(ids);
    agentQueue = agentQueue.catch(() => {}).then(async () => {
      const next = merge(agents(S.agents).map(item => item.id), requested);
      const result = await api('/api/agent-center/order', { method: 'PUT', body: { agents: next } });
      S.settings.agentPreferences = result.preferences; publish('agents'); return result.preferences;
    });
    return agentQueue;
  }
  function apply(root, { key, selector, id, group = () => '' }) {
    const nodes = [...root.children].filter(el => el.matches(selector));
    for (const value of new Set(nodes.map(group))) {
      const current = nodes.filter(el => group(el) === value);
      const next = key === 'agents' ? agents(current, id) : arrange(key, current, id);
      if (current.every((el, index) => el === next[index])) continue;
      const slots = current.map(el => { const slot = document.createComment('order'); el.replaceWith(slot); return slot; });
      next.forEach((el, index) => slots[index].replaceWith(el));
    }
  }
  // Applying an order never wraps a card, adds a handle, or binds pointer events.
  function bind(root, options) {
    if (!root) return;
    root.dataset.layoutScope = options.key; bindings.set(root, options); apply(root, options);
  }
  function open({ key, title = '调整显示顺序', items, onSave, disabled = false }) {
    if (disabled) return;
    const seen = new Set(), base = (items || []).filter(item => item && typeof item.id === 'string' && !seen.has(item.id) && seen.add(item.id));
    const index = new Map(base.map(item => [item.id, item])), groups = [...new Set(base.map(item => item.group || ''))];
    const flatten = rows => groups.flatMap(group => rows.filter(item => (item.group || '') === group));
    const initial = flatten(key === 'agents' ? agents(base) : arrange(key, base)).map(item => item.id), defaults = flatten(base).map(item => item.id);
    let draft = [...initial], query = '', limit = 80, pending = false;
    openDlg(title, `<form class="layout-order-editor" id="layoutOrderEditor"><p class="order-intro">使用上下箭头，或直接输入位置。点击保存后生效。</p><label class="order-search">${AgentHubIcons.svg('search')}<input type="search" id="layoutOrderSearch" placeholder="搜索名称…" aria-label="搜索排序项目" data-initial-focus></label><div class="order-list" id="layoutOrderList" role="list" aria-label="显示顺序"></div><div class="order-error" id="layoutOrderError" role="alert" hidden></div><div class="order-footer"><button type="button" class="btn-mini" id="layoutOrderReset">恢复默认顺序</button><span class="order-count" id="layoutOrderCount"></span><button type="button" class="btn ghost" id="layoutOrderCancel">取消</button><button type="submit" class="btn" id="layoutOrderSave" disabled>保存顺序</button></div></form>`);
    const guard = dialogGuard(), form = document.getElementById('layoutOrderEditor'), list = form.querySelector('#layoutOrderList');
    const search = form.querySelector('#layoutOrderSearch'), error = form.querySelector('#layoutOrderError');
    const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
    const peers = id => draft.filter(value => (index.get(value).group || '') === (index.get(id).group || ''));
    function move(id, position, focus) {
      if (pending) return;
      const group = peers(id), value = Number(position);
      if (!Number.isInteger(value)) { render(id, focus); return; }
      const from = group.indexOf(id), to = Math.max(0, Math.min(group.length - 1, value - 1));
      if (from !== to) { group.splice(from, 1); group.splice(to, 0, id); draft = merge(draft, group); error.hidden = true; }
      render(id, focus);
    }
    function render(focusId, focusControl) {
      const scroll = list.scrollTop, matches = draft.filter(id => [index.get(id).name, index.get(id).detail].join(' ').toLowerCase().includes(query));
      if (focusId) limit = Math.max(limit, matches.indexOf(focusId) + 1);
      const visible = new Set(matches.slice(0, limit));
      list.innerHTML = groups.map(group => {
        const values = draft.filter(id => (index.get(id).group || '') === group);
        const rows = values.filter(id => visible.has(id)).map(id => {
          const item = index.get(id), position = values.indexOf(id) + 1, name = item.name || id;
          return `<div class="order-row" role="listitem" data-order-id="${esc(id)}"><i class="order-mark" aria-hidden="true">${item.icon || AgentHubIcons.svg('list')}</i><span class="order-copy"><strong title="${esc(name)}">${esc(name)}</strong>${item.detail ? `<small title="${esc(item.detail)}">${esc(item.detail)}</small>` : ''}</span><button type="button" class="order-step" data-order-up aria-label="${esc(name)} 上移" ${position === 1 || pending ? 'disabled' : ''}>${AgentHubIcons.svg('chevronUp')}</button><input type="number" class="order-position" data-order-position aria-label="${esc(name)} 位置" value="${position}" min="1" max="${values.length}" inputmode="numeric" ${pending ? 'disabled' : ''}><button type="button" class="order-step" data-order-down aria-label="${esc(name)} 下移" ${position === values.length || pending ? 'disabled' : ''}>${AgentHubIcons.svg('chevronDown')}</button></div>`;
        }).join('');
        return rows ? (group ? `<div class="order-group">${esc(group)}</div>` : '') + rows : '';
      }).join('') || '<p class="order-empty">没有匹配的项目</p>';
      if (matches.length > limit) list.insertAdjacentHTML('beforeend', '<button type="button" class="btn-mini order-more" data-order-more>显示更多</button>');
      list.querySelector('[data-order-more]')?.addEventListener('click', () => { limit += 80; render(); });
      list.querySelectorAll('[data-order-id]').forEach(row => {
        const id = row.dataset.orderId;
        row.querySelector('[data-order-up]').onclick = () => move(id, peers(id).indexOf(id), 'up');
        row.querySelector('[data-order-down]').onclick = () => move(id, peers(id).indexOf(id) + 2, 'down');
        const input = row.querySelector('[data-order-position]');
        input.onchange = () => move(id, input.value === '' ? NaN : Number(input.value), 'position');
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } };
      });
      const save = form.querySelector('#layoutOrderSave'); save.disabled = pending || same(initial, draft); save.textContent = pending ? '保存中…' : '保存顺序';
      form.querySelector('#layoutOrderReset').disabled = pending || same(defaults, draft);
      form.querySelector('#layoutOrderCancel').disabled = pending; search.disabled = pending;
      form.querySelector('#layoutOrderCount').textContent = query ? matches.length + ' / ' + draft.length + ' 项' : draft.length + ' 项';
      list.scrollTop = scroll;
      if (focusId) {
        const row = [...list.querySelectorAll('[data-order-id]')].find(el => el.dataset.orderId === focusId), control = row?.querySelector(`[data-order-${focusControl}]`);
        (control?.disabled ? row.querySelector('[data-order-position]') : control)?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
    search.oninput = () => { query = search.value.trim().toLowerCase(); limit = 80; render(); };
    form.querySelector('#layoutOrderCancel').onclick = closeDlg;
    form.querySelector('#layoutOrderReset').onclick = () => { draft = [...defaults]; error.hidden = true; render(); };
    form.onsubmit = async event => {
      event.preventDefault(); if (pending || same(initial, draft)) return;
      pending = true; error.hidden = true; render();
      try {
        if (onSave) await onSave([...draft]);
        else store(key, merge(arrange(key, clean([...clean(saved[key]), ...base.map(item => item.id)]), id => id), draft));
        initial.splice(0, initial.length, ...draft);
        if (guard()) { closeDlg(); refresh(key); toast('显示顺序已保存', 'ok'); }
        else form.querySelector('.order-intro').textContent = '显示顺序已保存。';
      } catch (reason) { error.textContent = reason.message || '保存失败，请重试'; error.hidden = false; }
      finally { pending = false; render(); }
    };
    render();
  }
  function openAgents() {
    open({ key: 'agents', title: '调整 Agent 顺序', disabled: S.readOnly, items: S.agents.filter(a => !a.unavailable).map(a => ({ id: a.id, name: a.name, detail: S.settings.agentPreferences?.[a.id]?.hidden ? '已隐藏' : S.settings.agentPreferences?.[a.id]?.enabled === false ? '已停用' : '', icon: AgentHubIcons.agent(a.id) })), onSave: saveAgents });
  }
  window.OrbitCellLayout = Object.freeze({ arrange, merge, store, agents, saveAgents, bind, open, openAgents, refresh });
})();
