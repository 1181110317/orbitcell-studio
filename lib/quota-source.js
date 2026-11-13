// Declarative, read-only quota queries. Keys stay on the server; only selected
// numeric fields are returned, never the remote response or authentication.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function number(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function fieldPath(value) {
  const s = String(value || '').trim();
  return s.length <= 180 && /^[\w-]+(?:\.(?:[\w-]+))*$/.test(s)
    && !s.split('.').some(p => ['__proto__', 'prototype', 'constructor'].includes(p)) ? s : '';
}
function read(body, path) {
  if (!path) return null;
  for (const key of path.split('.')) {
    if (!body || typeof body !== 'object' || !own(body, key)) return null;
    body = body[key];
  }
  return body;
}
function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = String(raw.type || '').toLowerCase();
  if (!['newapi', 'json'].includes(type)) return null;
  let url = String(raw.url || '').trim();
  if (url) {
    try { const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || url.length > 2048) return null; }
    catch { return null; }
  }
  const out = { type, url, token: String(raw.token || '').trim().slice(0, 8192) };
  if (type === 'newapi') return out;
  if (!url) return null;
  out.auth = ['none', 'api-key'].includes(raw.auth) ? raw.auth : 'bearer';
  out.metrics = (Array.isArray(raw.metrics) ? raw.metrics : []).slice(0, 6).map((m, i) => {
    if (!m || typeof m !== 'object') return null;
    const valuePath = fieldPath(m.valuePath);
    if (!valuePath) return null;
    return {
      id: 'metric-' + i, label: String(m.label || '额度').trim().slice(0, 40),
      kind: ['balance', 'credits', 'window'].includes(m.kind) ? m.kind : 'balance',
      basis: ['used', 'remainingPercent', 'usedPercent'].includes(m.basis) ? m.basis : 'remaining',
      valuePath, limitPath: fieldPath(m.limitPath), resetPath: fieldPath(m.resetPath),
      unit: String(m.unit || '').trim().slice(0, 16),
      windowSeconds: Math.max(0, Math.min(366 * 86400, number(m.windowSeconds) || 0)),
    };
  }).filter(Boolean);
  return out.metrics.length ? out : null;
}
function epoch(value) {
  const n = number(value);
  if (n != null && n > 0) return Math.round(n > 1e12 ? n / 1000 : n);
  if (typeof value !== 'string' || !value.trim()) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.round(at / 1000) : null;
}
function parse(body, config) {
  const metrics = [], windows = [];
  for (const m of config.metrics || []) {
    const value = number(read(body, m.valuePath));
    if (value == null) continue;
    const limit = number(read(body, m.limitPath));
    const percent = m.basis.endsWith('Percent');
    // A literal 1 means 1%, never a guessed 100%. Inconsistent readings are
    // omitted so a missing/invalid API field cannot look like a full allowance.
    if (percent && (value < 0 || value > 100)) continue;
    let used = !percent && m.basis === 'used' ? value : null;
    let remaining = !percent && m.basis === 'remaining' ? value : null;
    if (!percent && limit != null && limit > 0) {
      if (used != null) remaining = Math.max(0, limit - used);
      else if (remaining != null) used = Math.max(0, limit - remaining);
    }
    let remainingPercent = m.basis === 'remainingPercent' ? value : m.basis === 'usedPercent' ? 100 - value
      : limit > 0 && remaining != null ? Math.max(0, Math.min(100, remaining / limit * 100)) : null;
    const metric = { id: m.id, label: m.label, kind: m.kind, unit: m.unit, remaining, used, limit,
      remainingPercent, usedPercent: remainingPercent == null ? null : 100 - remainingPercent,
      resetAt: epoch(read(body, m.resetPath)), limitWindowSeconds: m.windowSeconds || null };
    if (m.kind === 'window') windows.push(metric); else metrics.push(metric);
  }
  if (!metrics.length && !windows.length) return { supported: false, reason: '额度接口未返回所配置的数值字段，请检查字段路径' };
  return { supported: true, kind: 'custom-json', metrics, windows };
}
async function query(provider, fetchJson) {
  const config = sanitize(provider.quotaApi);
  if (!config) return { supported: false, reason: '额度接口配置不完整' };
  const token = config.token || provider.apiKey || '';
  if (config.auth !== 'none' && !token) return { supported: false, reason: '额度接口缺少查询密钥' };
  const headers = { Accept: 'application/json' };
  if (config.auth === 'bearer') headers.Authorization = 'Bearer ' + token;
  if (config.auth === 'api-key') headers['x-api-key'] = token;
  const result = await fetchJson(config.url, { headers, redirect: 'error' }, 10000);
  if (!result.ok || !result.json) return { supported: false, reason: '额度接口 HTTP ' + result.status };
  return parse(result.json, config);
}
module.exports = { sanitize, parse, query, number };
