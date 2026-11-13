/* One quota view shared by provider management and conversations. */
(() => {
  'use strict';
  const icon = name => window.AgentHubIcons.svg(name);
  const pending = new Map(), cache = new Map(), queue = [];
  let working = 0;
  const stamp = p => JSON.stringify([p.baseUrl, p.apiKey, p.quotaApi, p.source]);
  const finite = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v));
  const fmt = v => Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  function amount(v, unit) {
    if (!finite(v)) return '—';
    return ({ CNY: '¥', RMB: '¥', USD: '$' }[unit] || '') + fmt(v)
      + (unit && !['CNY', 'RMB', 'USD'].includes(unit) ? ' ' + unit : '');
  }
  function money(q) {
    const list = [...(q.metrics || [])];
    if (q.remaining != null || q.unlimited) list.unshift({ label: q.currency === '额度' ? '可用额度' : '余额', remaining: q.remaining, unit: q.currency, unlimited: q.unlimited });
    if (q.credits && (q.credits.unlimited || finite(q.credits.balance))) list.push({ label: '积分', remaining: q.credits.balance, unit: '积分', unlimited: q.credits.unlimited });
    return list;
  }
  function reset(w, timestamp) {
    const seconds = w.resetAt ? w.resetAt - Date.now() / 1000 : finite(w.resetAfterSeconds) ? w.resetAfterSeconds - (timestamp ? (Date.now() - timestamp) / 1000 : 0) : null;
    if (!finite(seconds)) return '';
    if (seconds <= 0) return '等待更新';
    if (seconds < 3600) return Math.ceil(seconds / 60) + ' 分钟后重置';
    if (seconds < 86400) return Math.ceil(seconds / 3600) + ' 小时后重置';
    return new Date(w.resetAt ? w.resetAt * 1000 : Date.now() + seconds * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' 重置';
  }
  function summary(q) {
    if (!q || q.supported !== true) return [];
    const parts = money(q).map(m => ({ label: m.label, text: m.unlimited ? '不限额' : finite(m.remaining) ? amount(m.remaining, m.unit) : finite(m.remainingPercent) ? fmt(m.remainingPercent) + '%' : finite(m.used) ? '已用 ' + amount(m.used, m.unit) : '—' }));
    for (const w of q.windows || []) {
      if (finite(w.remainingPercent)) parts.push({ label: w.label, text: fmt(w.remainingPercent) + '%' });
      else if (finite(w.remaining)) parts.push({ label: w.label, text: amount(w.remaining, w.unit) });
      else if (finite(w.used)) parts.push({ label: w.label, text: '已用 ' + amount(w.used, w.unit) });
    }
    return parts.filter(p => p.text !== '—');
  }
  function glance(q) {
    const amounts = money(q).filter(m => m.unlimited || finite(m.remaining) || finite(m.used));
    const balances = amounts.length ? `<span class="pq-card-amounts">${amounts.map(m => `<span><small>${esc(m.label || '余额')}</small><b class="${finite(m.remaining) && Number(m.remaining) < 0 ? 'pq-negative' : ''}">${esc(m.unlimited ? '不限额' : finite(m.remaining) ? amount(m.remaining, m.unit) : '已用 ' + amount(m.used, m.unit))}</b></span>`).join('')}</span>` : '';
    const windows = (q.windows || []).filter(w => finite(w.remainingPercent) || finite(w.remaining) || finite(w.used));
    const periods = windows.length ? `<span class="pq-card-periods" style="--pq-columns:${Math.min(3, windows.length)}">${windows.map(w => {
      const pct = finite(w.remainingPercent) ? Math.max(0, Math.min(100, Number(w.remainingPercent))) : null;
      const value = pct != null ? fmt(pct) + '%' : finite(w.remaining) ? amount(w.remaining, w.unit) : '已用 ' + amount(w.used, w.unit);
      return `<span class="pq-mini-window ${pct != null && pct <= 20 ? 'is-low' : ''}"><span><small>${esc(w.label || '用量窗口')}</small><b>${esc(value)}</b></span>${pct == null ? '' : `<span class="pq-mini-track" role="meter" aria-label="${esc(w.label || '用量窗口')}剩余" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>`}</span>`;
    }).join('')}</span>` : '';
    const remaining = windows.length && windows.every(w => finite(w.remainingPercent) || finite(w.remaining));
    return `<span class="pq-card-caption"><span>账户额度${remaining ? '<small>剩余</small>' : ''}</span><span>详情 ${icon('chevronRight')}</span></span>${periods}${balances}`;
  }
  function pump() {
    while (working < 3 && queue.length) {
      const job = queue.shift(); working++;
      job().finally(() => { working--; pump(); });
    }
  }
  function read(provider, force = false) {
    const key = provider.id + ':' + stamp(provider), saved = cache.get(key);
    if (!force && saved && Date.now() - saved.at < 300000) return Promise.resolve(saved.item);
    if (pending.has(key)) return pending.get(key);
    const promise = new Promise(resolve => {
      queue.push(async () => {
        let item;
        try {
          const response = await api('/api/quota?providerId=' + encodeURIComponent(provider.id) + (force ? '&force=1' : ''), { timeoutMs: 35000 });
          item = response.item || { supported: false, reason: response.error || '供应商未返回额度' };
        } catch (e) { item = { supported: false, reason: e.message || '额度查询失败' }; }
        cache.set(key, { item, at: Date.now() });
        if (typeof S !== 'undefined') S.quotaCache[provider.id] = { item, at: Date.now() };
        resolve(item);
      });
    }).finally(() => pending.delete(key));
    pending.set(key, promise); pump(); return promise;
  }
  function detail(q) {
    if (!q) return '<p class="pq-empty">正在读取供应商额度…</p>';
    if (q.supported !== true) return '<p class="pq-empty">' + esc(q.reason || '此供应商未提供额度接口') + '</p>';
    const balances = money(q).map(m => `<div class="pq-amount"><small>${esc(m.label || '余额')}</small><strong>${m.unlimited ? '不限额' : finite(m.remaining) ? esc(amount(m.remaining, m.unit)) : '—'}</strong>${finite(m.used) ? `<span>已用 ${esc(amount(m.used, m.unit))}</span>` : ''}</div>`).join('');
    const windows = (q.windows || []).map(w => {
      const pct = finite(w.remainingPercent) ? Math.max(0, Math.min(100, Number(w.remainingPercent))) : null;
      const value = pct != null ? fmt(pct) + '<small>% 剩余</small>' : finite(w.remaining) ? esc(amount(w.remaining, w.unit)) + '<small>剩余</small>' : finite(w.used) ? esc(amount(w.used, w.unit)) + '<small>已用</small>' : '未知';
      return `<div class="pq-window${pct != null && pct <= 20 ? ' is-low' : ''}"><div><span>${esc(w.label || '用量窗口')}</span><b>${value}</b></div>${pct == null ? '' : `<div class="pq-track" role="meter" aria-label="${esc(w.label || '用量窗口')}剩余" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`}<small>${finite(w.used) && finite(w.limit) ? esc('已用 ' + amount(w.used, w.unit) + ' / ' + amount(w.limit, w.unit)) : ''}${reset(w, q.ts) ? esc((finite(w.used) && finite(w.limit) ? ' · ' : '') + reset(w, q.ts)) : ''}</small></div>`;
    }).join('');
    return (balances ? '<div class="pq-balances">' + balances + '</div>' : '') + (windows ? '<div class="pq-windows">' + windows + '</div>' : '')
      + (!balances && !windows ? '<p class="pq-empty">接口没有返回可显示的额度</p>' : '');
  }
  function panel(el, provider) {
    if (!el) return;
    el.classList.add('provider-quota-panel');
    const writable = !S.readOnly && provider.managed !== false;
    el.innerHTML = `<header><div>${icon('chart')}<h3>账户额度</h3><span data-pq-time></span></div><div>${writable ? '<button type="button" class="btn-mini" data-pq-settings>额度设置</button>' : ''}<button type="button" class="btn-mini" data-pq-refresh aria-label="刷新 ${esc(provider.name)} 额度">${icon('refresh')}刷新</button></div></header><div data-pq-detail aria-live="polite">${detail(null)}</div><footer>来自供应商接口${provider.quotaApi?.type === 'json' ? ' · 自定义字段' : ''} · 缓存 5 分钟${provider.source === 'magpie' ? '' : ' · 实际扣费以供应商为准'}</footer>`;
    const draw = q => {
      if (!el.isConnected) return;
      el.querySelector('[data-pq-detail]').innerHTML = detail(q);
      el.querySelector('[data-pq-time]').textContent = q?.ts ? new Date(q.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + ' 更新' : '';
    };
    el.querySelector('[data-pq-settings]')?.addEventListener('click', () => settings(provider, () => refresh(true)));
    const refresh = async force => {
      const button = el.querySelector('[data-pq-refresh]'); button.disabled = true;
      try { draw(await read(provider, force)); } finally { if (button.isConnected) button.disabled = false; }
    };
    el.querySelector('[data-pq-refresh]').onclick = () => refresh(true);
    refresh(false);
  }
  function open(provider) {
    openDlg(provider.name + ' · 账户额度', '<div class="provider-quota-dialog" id="pqDialogPanel"></div>');
    panel(document.getElementById('pqDialogPanel'), provider);
  }
  function mount(el, provider, mode = 'card') {
    if (!el || !provider) return;
    const revision = provider.id + ':' + stamp(provider); el.dataset.quotaProvider = revision;
    el.classList.add('pq-glance'); el.classList.toggle('pq-card', mode === 'card'); el.style.display = '';
    el.innerHTML = `<button type="button" class="pq-glance-button" aria-label="查看 ${esc(provider.name)} 额度">${icon('chart')}<span>额度</span><small>读取中</small></button>`;
    el.querySelector('button').onclick = () => open(provider);
    const update = q => {
      if (!el.isConnected || el.dataset.quotaProvider !== revision) return;
      const parts = summary(q);
      el.classList.toggle('pq-has-values', parts.length > 0);
      if (mode === 'chip' && !parts?.length) { el.style.display = 'none'; return; }
      const button = el.querySelector('button');
      button.classList.toggle('pq-unavailable', !parts?.length);
      button.title = parts?.length ? parts.map(p => p.label + ' ' + p.text).join(' · ') + ' · 点击查看详情'
        : q?.reason || '供应商未提供额度接口';
      button.setAttribute('aria-label', '查看 ' + provider.name + ' 额度' + (parts.length ? '：' + parts.map(p => p.label + ' ' + p.text).join('，') : ''));
      if (mode === 'card') button.innerHTML = parts.length ? glance(q) : '<span class="pq-card-unavailable">' + icon('chart') + '<span>额度未提供</span>' + icon('chevronRight') + '</span>';
      else button.innerHTML = icon('chart') + (parts.length ? parts.map(p => `<span><small>${esc(p.label)}</small><b>${esc(p.text)}</b></span>`).join('') : '<span>额度未提供</span>');
    };
    read(provider).then(update);
  }
  const metricForm = (m = {}) => `<section class="pq-metric-form"><div class="pq-metric-title"><strong>显示项目</strong><button type="button" class="btn-mini" data-pq-remove aria-label="移除此显示项目">${icon('close')}</button></div><div class="pq-fields"><label>名称<input data-pq-field="label" value="${esc(m.label || '余额')}" placeholder="余额 / 5 小时 / 每月" maxlength="40"></label><label>类型<select data-pq-field="kind"><option value="balance" ${m.kind === 'balance' ? 'selected' : ''}>余额</option><option value="credits" ${m.kind === 'credits' ? 'selected' : ''}>积分 / 额度</option><option value="window" ${m.kind === 'window' ? 'selected' : ''}>周期用量</option></select></label><label>数值字段<input data-pq-field="valuePath" value="${esc(m.valuePath || '')}" placeholder="data.balance" maxlength="180" spellcheck="false" required></label><label>数值含义<select data-pq-field="basis">${[['remaining','剩余数量'],['used','已用数量'],['remainingPercent','剩余百分比（0–100）'],['usedPercent','已用百分比（0–100）']].map(([v, t]) => `<option value="${v}" ${m.basis === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>单位<input data-pq-field="unit" value="${esc(m.unit || '')}" placeholder="CNY / USD / 积分" maxlength="16"></label><label>总量字段（可选）<input data-pq-field="limitPath" value="${esc(m.limitPath || '')}" placeholder="data.limit" maxlength="180" spellcheck="false"></label><label>重置时间字段（可选）<input data-pq-field="resetPath" value="${esc(m.resetPath || '')}" placeholder="data.reset_at" maxlength="180" spellcheck="false"></label><label>周期<select data-pq-field="windowSeconds">${[[0,'不指定'],[18000,'5 小时'],[86400,'每日'],[604800,'每周'],[2592000,'每月']].map(([v,t]) => `<option value="${v}" ${Number(m.windowSeconds || 0) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div></section>`;
  function settings(provider, onSaved = async () => {}) {
    if (S.readOnly || provider.managed === false) return;
    let saved = provider.quotaApi || {};
    openDlg('额度设置 · ' + provider.name, `<form id="pqSettings" class="pq-settings"><p>自动识别 DeepSeek、OpenRouter、MiniMax Token Plan、Moonshot 、智谱 / Z.ai、Kimi Code、OpenCode Go 和 Codex OAuth。其他供应商可填写官方只读额度接口。</p><div class="pq-fields"><label class="pq-full">查询方式<select id="pqType"><option value="auto">自动识别供应商</option><option value="newapi" ${saved.type === 'newapi' ? 'selected' : ''}>New API / One API 令牌额度</option><option value="json" ${saved.type === 'json' ? 'selected' : ''}>自定义 JSON 接口</option></select></label></div><div id="pqCustom" ${!saved.type ? 'hidden' : ''}><div class="pq-fields"><label class="pq-full">额度接口地址<input id="pqUrl" type="url" maxlength="2048" value="${esc(saved.url || '')}" placeholder="https://api.example.com/account/usage" spellcheck="false"></label><label>认证方式<select id="pqAuth"><option value="bearer" ${saved.auth === 'bearer' ? 'selected' : ''}>Bearer Token</option><option value="api-key" ${saved.auth === 'api-key' ? 'selected' : ''}>x-api-key</option><option value="none" ${saved.auth === 'none' ? 'selected' : ''}>无需认证</option></select></label><label>独立查询密钥（可选）<input id="pqToken" type="password" autocomplete="new-password" placeholder="${saved.hasToken ? '已保存 · 留空保留' : '留空使用供应商 API Key'}"></label></div><div id="pqMappings" ${saved.type === 'json' ? '' : 'hidden'}><p class="pq-help">按接口返回的 JSON 填写字段路径，例如 <code>data.balance</code>。只显示指定字段，不执行脚本，不猜测单位。</p><div id="pqMetrics">${(saved.metrics?.length ? saved.metrics : [{}]).map(metricForm).join('')}</div><button type="button" class="btn-mini" id="pqAdd">${icon('plus')}添加显示项目</button></div></div><div id="pqError" class="manage-notice" hidden role="alert"></div><div class="dialog-actions"><button type="button" class="btn ghost" id="pqCancel">取消</button><button type="submit" class="btn" id="pqSave">保存并查询</button></div></form>`);
    const form = document.getElementById('pqSettings'), guard = dialogGuard();
    const type = form.querySelector('#pqType'), custom = form.querySelector('#pqCustom');
    const bind = () => {
      enhanceDialogSelects(form);
      form.querySelectorAll('[data-pq-remove]').forEach(b => b.onclick = () => b.closest('.pq-metric-form').remove());
    };
    type.onchange = () => {
      custom.hidden = type.value === 'auto';
      form.querySelector('#pqMappings').hidden = type.value !== 'json';
      form.querySelector('#pqAuth').disabled = type.value === 'newapi';
      if (type.value === 'newapi') { form.querySelector('#pqAuth').value = 'bearer'; form.querySelector('#pqAuth').syncControl?.(); }
      form.querySelector('#pqUrl').required = type.value === 'json';
      form.querySelectorAll('[data-pq-field=valuePath]').forEach(i => i.required = type.value === 'json');
    };
    form.querySelector('#pqAdd').onclick = () => { if (form.querySelectorAll('.pq-metric-form').length >= 6) return; form.querySelector('#pqMetrics').insertAdjacentHTML('beforeend', metricForm({kind:'window',label:'5 小时',basis:'usedPercent',windowSeconds:18000})); bind(); type.onchange(); };
    form.querySelector('#pqCancel').onclick = closeDlg; bind(); type.onchange();
    form.onsubmit = event => {
      event.preventDefault();
      withPendingButton(form.querySelector('#pqSave'), async () => {
        try {
          const metrics = [...form.querySelectorAll('.pq-metric-form')].map(row => Object.fromEntries([...row.querySelectorAll('[data-pq-field]')].map(i => [i.dataset.pqField, i.value])));
          if (type.value === 'json' && !metrics.length) throw Error('请至少添加一个显示项目');
          const config = type.value === 'auto' ? { clear: true } : { type: type.value, url: form.querySelector('#pqUrl').value.trim(), auth: form.querySelector('#pqAuth').value, token: form.querySelector('#pqToken').value.trim(), metrics };
          const updated = await api('/api/providers/' + encodeURIComponent(provider.id), { method: 'PUT', body: { quotaApi: config } });
          Object.assign(provider, updated); cache.clear();
          if (guard()) { closeDlg(); await onSaved(); open(provider); }
        } catch (e) { if (guard()) window.AgentHubManagement.notice(form.querySelector('#pqError'), e.message || '保存失败'); }
      }, '保存中…');
    };
  }
  window.OrbitCellQuota = Object.freeze({ mount, panel, open, settings, read, summary });
})();
