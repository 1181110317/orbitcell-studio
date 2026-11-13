'use strict';

// Display-only receipts. This module never grants or changes permissions.
const LIMIT = 200;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const toolName = value => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/.test(value) ? value : '';

function cleanRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const requestId = typeof value.requestId === 'string' || Number.isSafeInteger(value.requestId) ? String(value.requestId).slice(0, 256) : '';
  if (!requestId) return null;
  return {
    requestId, tool: toolName(value.tool), title: text(value.title, 500),
    detail: text(value.detail, 4000), reason: text(value.reason, 4000),
    choice: text(value.choice, 500), label: text(value.label, 200),
    rejected: value.rejected === true, memoryWarning: value.memoryWarning === true,
  };
}

function clean(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const automatic = Object.create(null);
  if (value.automatic && typeof value.automatic === 'object' && !Array.isArray(value.automatic)) {
    for (const [tool, n] of Object.entries(value.automatic).slice(0, 64)) {
      if (toolName(tool) && count(n)) automatic[tool] = count(n);
    }
  }
  const records = [], seen = new Set();
  for (const raw of (Array.isArray(value.records) ? value.records.slice(-LIMIT) : [])) {
    const record = cleanRecord(raw);
    if (record && !seen.has(record.requestId)) { records.push(record); seen.add(record.requestId); }
  }
  const manualCount = Math.max(count(value.manualCount), records.length);
  return records.length || manualCount || Object.keys(automatic).length ? { automatic, records, manualCount } : undefined;
}

function add(value, record) {
  const audit = clean(value) || { automatic: Object.create(null), records: [], manualCount: 0 };
  const entry = cleanRecord(record);
  if (!entry || audit.records.some(row => row.requestId === entry.requestId)) return audit;
  audit.manualCount = Math.min(Number.MAX_SAFE_INTEGER, audit.manualCount + 1);
  audit.records.push(entry);
  if (audit.records.length > LIMIT) audit.records.shift();
  return audit;
}

function automaticTool(value) {
  const match = /^已按项目权限记忆允许[：:]\s*(.{1,128})$/.exec(typeof value === 'string' ? value : '');
  return toolName(match?.[1]?.trim());
}

function addAutomatic(value, tool) {
  const audit = clean(value) || { automatic: Object.create(null), records: [], manualCount: 0 };
  if (!toolName(tool) || !Object.hasOwn(audit.automatic, tool) && Object.keys(audit.automatic).length >= 64) return audit;
  audit.automatic[tool] = Math.min(Number.MAX_SAFE_INTEGER, (audit.automatic[tool] || 0) + 1);
  return audit;
}

function fromReply(card, body = {}, memory = {}) {
  if (!card || card.question === true) return null;
  const input = card.input && typeof card.input === 'object' ? card.input : {};
  const option = Array.isArray(card.options) ? card.options.find(o => String(o.optionId) === String(body.optionId)) : null;
  const decision = [body.action, option?.kind, option?.response?.decision, option?.name].filter(Boolean).join(' ');
  const rejected = /deny|reject|decline|cancel|拒绝|取消/i.test(decision);
  const mode = card.suggestions?.[body.suggestionIndex];
  const modeName = mode?.type === 'setMode' ? ({ acceptEdits: '自动接受编辑', plan: '计划模式', bypassPermissions: '免确认', default: '默认' })[mode.mode] || mode.mode : '';
  const choice = rejected ? option?.name || '拒绝' : body.remember === 'project' ? '记住本项目'
    : modeName ? `本会话${modeName}` : option?.name || '允许本次';
  return cleanRecord({
    requestId: card.pid ?? body.requestId ?? body.pid,
    tool: card.tool, title: card.title || (card.tool ? '请求使用 ' + card.tool : '工具审批'),
    detail: input.command || input.file_path || input.url || input.pattern || input.query || input.prompt || card.detail || '',
    reason: card.reason || '', choice,
    label: rejected ? '已拒绝' : memory.remembered ? '已记住本项目'
      : body.remember === 'project' ? '已允许 · 记忆未保存' : modeName ? `已切换到${modeName}` : option ? '已允许' : '已允许本次',
    rejected, memoryWarning: body.remember === 'project' && memory.remembered !== true,
  });
}

module.exports = { clean, cleanRecord, add, automaticTool, addAutomatic, fromReply };
