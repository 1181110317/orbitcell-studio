/* Card order is independent from selection, enabled state and running tasks. */
(() => {
  'use strict';
  const storageKey = 'orbitcell.layout-order.v1', bindings = new WeakMap();
  let saved = {}, drag = null, agentQueue = Promise.resolve();
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) saved = value; } catch {}
  const clean = ids => [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && id.length > 0 && id.length < 1024))].slice(0, 2000);
  const publish = key => document.dispatchEvent(new CustomEvent('orbitcell:order-changed', { detail: { key } }));
  function arrange(key, items, id = item => item.id) {
    const order = new Map((Array.isArray(saved[key]) ? saved[key] : []).map((value, index) => [value, index]));
    return [...items].sort((a, b) => (order.get(id(a)) ?? Infinity) - (order.get(id(b)) ?? Infinity));
  }
  // A filtered list replaces only its existing slots; hidden items keep theirs.
  function merge(all, visible) {
    const wanted = clean(visible), set = new Set(wanted), rest = [...wanted];
    const next = clean(all).map(id => set.has(id) ? rest.shift() : id);
    return [...next, ...rest];
  }
  function store(key, ids) {
    const next = { ...saved, [key]: clean(ids) };
    localStorage.setItem(storageKey, JSON.stringify(next));
    saved = next; publish(key);
  }
  function agents(items, id = item => item.id, preferences = S.settings?.agentPreferences || {}) {
    return [...items].sort((a, b) => {
      const x = preferences[id(a)] || {}, y = preferences[id(b)] || {};
      return (x.order ?? 10000) - (y.order ?? 10000) || Number(!!y.pinned) - Number(!!x.pinned);
    });
  }
  function saveAgents(ids) {
    const requested = clean(ids);
    agentQueue = agentQueue.catch(() => {}).then(async () => {
      const all = agents(S.agents).map(item => item.id), next = merge(all, requested);
      const result = await api('/api/agent-center/order', { method: 'PUT', body: { agents: next } });
      S.settings.agentPreferences = result.preferences;
      publish('agents');
      return result.preferences;
    });
    return agentQueue;
  }
  function announce(text) {
    let el = document.querySelector('[data-layout-announcement]');
    if (!el) { el = document.createElement('span'); el.className = 'layout-order-announcement'; el.dataset.layoutAnnouncement = ''; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = text;
  }
  function replaceSlots(current, desired) {
    const slots = current.map(el => { const slot = document.createComment('order'); el.replaceWith(slot); return slot; });
    desired.forEach((el, index) => slots[index].replaceWith(el));
  }
  function bind(root, { key, selector, id, label, group = () => '', allIds, onChange, disabled = false } = {}) {
    if (!root) return;
    bindings.get(root)?.abort();
    if (drag?.root === root) drag.cancel();
    const controller = new AbortController(); bindings.set(root, controller);
    const original = [...root.querySelectorAll(selector)].filter(el => el.parentElement === root || el.parentElement.classList.contains('layout-sort-wrap') && el.parentElement.parentElement === root);
    const nodes = original.map(el => {
      const value = id(el), name = label?.(el) || el.querySelector('strong,h3')?.textContent || el.textContent.trim();
      let item = el;
      if (el.tagName === 'BUTTON') {
        if (el.parentElement.classList.contains('layout-sort-wrap')) item = el.parentElement;
        else { item = document.createElement('div'); item.className = 'layout-sort-wrap'; el.replaceWith(item); item.append(el); }
      }
      item.querySelector(':scope > .layout-drag-handle')?.remove();
      item.classList.add('layout-sort-item'); item.dataset.layoutKey = value;
      item.dataset.layoutGroup = group(el); item.dataset.layoutLabel = name;
      if (!disabled && original.length > 1) {
        const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'layout-drag-handle';
        handle.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3" r="1"/><circle cx="10.5" cy="3" r="1"/><circle cx="5.5" cy="8" r="1"/><circle cx="10.5" cy="8" r="1"/><circle cx="5.5" cy="13" r="1"/><circle cx="10.5" cy="13" r="1"/></svg>';
        handle.title = '拖动调整位置 · Alt + 方向键排序'; handle.setAttribute('aria-label', '调整 ' + name + ' 的位置');
        handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
        item.append(handle);
      }
      return item;
    });
    const items = () => [...root.children].filter(el => el.matches('.layout-sort-item'));
    root.dataset.layoutScope = key;
    root.dataset.layoutContext ||= root.id || [...root.classList].filter(name => !name.startsWith('layout-')).join(' ') + ':' + (root.querySelector(':scope > h3')?.textContent || '');
    if (key) {
      for (const kind of new Set(nodes.map(el => el.dataset.layoutGroup))) {
        const peers = nodes.filter(el => el.dataset.layoutGroup === kind);
        replaceSlots(peers, key === 'agents' ? agents(peers, el => el.dataset.layoutKey) : arrange(key, peers, el => el.dataset.layoutKey));
      }
    }
    if (disabled || nodes.length < 2) return;
    root.classList.add('layout-sortable');
    const listen = (type, fn, opts = {}) => root.addEventListener(type, fn, { ...opts, signal: controller.signal });
    let busy = false, suppressClick = false;
    const commit = async (before, moved) => {
      const after = items();
      if (before.every((el, i) => el === after[i])) return;
      const restoreFocus = document.activeElement === moved.querySelector(':scope > .layout-drag-handle');
      busy = true; root.setAttribute('aria-busy', 'true');
      try {
        const ids = after.filter(el => el.getClientRects().length).map(el => el.dataset.layoutKey);
        if (onChange) await onChange(ids);
        else store(key, merge(allIds ? arrange(key, allIds(), id => id) : saved[key] || before.map(el => el.dataset.layoutKey), ids));
        announce(moved.dataset.layoutLabel + '，第 ' + (ids.indexOf(moved.dataset.layoutKey) + 1) + ' / ' + ids.length + ' 项，顺序已保存');
      } catch (error) {
        if (root.isConnected && before.every(el => root.contains(el))) replaceSlots(items(), before);
        announce('位置未保存，已恢复原顺序'); if (typeof toast === 'function') toast(error.message || '排序保存失败', 'err');
      } finally {
        busy = false; root.removeAttribute('aria-busy');
        if (restoreFocus) {
          const current = root.isConnected ? root : [...document.querySelectorAll('[data-layout-scope]')].find(el => el.dataset.layoutScope === key && el.dataset.layoutContext === root.dataset.layoutContext && el.getClientRects().length);
          [...current?.children || []].find(el => el.dataset.layoutKey === moved.dataset.layoutKey)?.querySelector(':scope > .layout-drag-handle')?.focus({ preventScroll: true });
        }
      }
    };
    listen('click', event => {
      if (event.target.closest('.layout-drag-handle') || suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
    }, { capture: true });
    listen('keydown', event => {
      if (!event.altKey || busy || !event.target.closest('.layout-drag-handle')) return;
      const item = event.target.closest('.layout-sort-item'), peers = items().filter(el => el.dataset.layoutGroup === item.dataset.layoutGroup && el.getClientRects().length), i = peers.indexOf(item);
      const columns = peers.filter(el => Math.abs(el.getBoundingClientRect().top - peers[0].getBoundingClientRect().top) < 4).length || 1;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      const index = Math.max(0, Math.min(peers.length - 1, i + delta)); if (index === i) return;
      const before = items(); index > i ? peers[index].after(item) : peers[index].before(item);
      event.target.focus({ preventScroll: true }); commit(before, item);
    });
    listen('pointerdown', event => {
      const handle = event.target.closest('.layout-drag-handle'); if (!handle || busy || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); drag?.cancel();
      const item = handle.closest('.layout-sort-item'), before = items(), start = { x: event.clientX, y: event.clientY }, rect = item.getBoundingClientRect(), zoom = Number(getComputedStyle(document.body).zoom) || 1;
      let ghost, started = false, done = false, frame = 0, x = start.x, y = start.y;
      let scroll = root;
      while (scroll.parentElement && !(scroll.scrollHeight > scroll.clientHeight && /auto|scroll/.test(getComputedStyle(scroll).overflowY))) scroll = scroll.parentElement;
      root.setPointerCapture(event.pointerId);
      const autoScroll = () => {
        if (done || !started) return;
        const r = scroll.getBoundingClientRect(), edge = 36;
        const amount = y < r.top + edge ? -Math.ceil((r.top + edge - y) / 3) : y > r.bottom - edge ? Math.ceil((y - r.bottom + edge) / 3) : 0;
        if (amount) { scroll.scrollTop += Math.max(-20, Math.min(20, amount)); reorderAt(x, y); }
        frame = requestAnimationFrame(autoScroll);
      };
      const finish = cancelled => {
        if (done) return; done = true; cancelAnimationFrame(frame);
        root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', cancel); root.removeEventListener('lostpointercapture', cancel);
        if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
        ghost?.remove(); item.classList.remove('is-layout-dragging'); document.body.classList.remove('layout-is-dragging'); drag = null;
        if (!started) return;
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
        if (cancelled) { if (before.every(el => root.contains(el))) replaceSlots(items(), before); announce('已取消排序'); }
        else commit(before, item);
      };
      const move = e => {
        x = e.clientX; y = e.clientY;
        if (!started && Math.hypot(e.clientX - start.x, y - start.y) < 6) return;
        if (!started) {
          started = true; ghost = item.cloneNode(true); ghost.classList.add('layout-drag-preview');
          ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
          ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
          Object.assign(ghost.style, { width: rect.width / zoom + 'px', height: rect.height / zoom + 'px', left: rect.left / zoom + 'px', top: rect.top / zoom + 'px' });
          document.body.append(ghost); item.classList.add('is-layout-dragging'); document.body.classList.add('layout-is-dragging'); autoScroll();
        }
        ghost.style.transform = `translate(${(x - start.x) / zoom}px,${(y - start.y) / zoom}px)`;
        reorderAt(x, y);
      };
      function reorderAt(clientX, clientY) {
        const target = document.elementFromPoint(clientX, clientY)?.closest('.layout-sort-item');
        if (!target || target === item || target.parentElement !== root || target.dataset.layoutGroup !== item.dataset.layoutGroup) return;
        const order = items(); order.indexOf(item) < order.indexOf(target) ? target.after(item) : target.before(item);
      }
      const up = () => finish(false), cancel = () => finish(true);
      root.addEventListener('pointermove', move); root.addEventListener('pointerup', up); root.addEventListener('pointercancel', cancel); root.addEventListener('lostpointercapture', cancel);
      drag = { root, cancel };
    });
    controller.signal.addEventListener('abort', () => { if (drag?.root === root) drag.cancel(); });
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopImmediatePropagation(); drag.cancel(); } }, true);
  window.OrbitCellLayout = Object.freeze({ arrange, merge, store, agents, saveAgents, bind });
})();
