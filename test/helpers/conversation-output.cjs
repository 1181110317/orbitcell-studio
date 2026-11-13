'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeClaudeParser } = require('../../lib/claude-parser');
function parse(messages) {
  const events = [], feed = makeClaudeParser(event => events.push(event));
  for (const message of messages) feed(JSON.stringify(message));
  return events;
}
const assistant = content => ({ type: 'assistant', message: { id: 'message', content } });
const command = assistant([{ type: 'tool_use', id: 'command', name: 'Bash', input: { command: 'node --check sample.js' } }]);
const result = text => ({ type: 'result', is_error: false, result: text });
assert.deepEqual(parse([result('只在结束事件中返回的正文。')]).filter(e => e.kind === 'text').map(e => e.text), ['只在结束事件中返回的正文。']);
assert.deepEqual(parse([assistant([{ type: 'text', text: '我先检查。' }]), command, result('检查完毕。')]).filter(e => e.kind === 'text').map(e => e.text), ['我先检查。', '检查完毕。'], 'earlier commentary cannot suppress a result-only answer after tools');
assert.equal(parse([command, assistant([{ type: 'text', text: '检查完毕。' }]), result('检查完毕。')]).filter(e => e.kind === 'text').length, 1, 'a normal final message is never duplicated');
assert.deepEqual(parse([assistant([{ type: 'text', text: '先说明。' }]), result('最终结论。')]).filter(e => e.kind === 'text').map(e => e.text), ['先说明。', '最终结论。'], 'a distinct result answer is not suppressed by commentary without tools');
assert.equal(parse([assistant([{ type: 'text', text: '第一段。' }, { type: 'text', text: '第二段。' }]), result('第一段。\n\n第二段。')]).filter(e => e.kind === 'text').length, 2, 'a result repeating multiple complete text blocks is not added again');
assert.equal(parse([command, { ...result('错误详情'), is_error: true }]).filter(e => e.kind === 'text').length, 0, 'an error result is not presented as a successful answer');
assert.equal(parse([result('第一轮'), result('第二轮')]).filter(e => e.kind === 'text').length, 2, 'completion state is reset between turns');
const streamed = parse([
  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '流式正文。' } } },
  { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
  result('流式正文。'),
]);
assert.equal(streamed.filter(e => e.kind === 'text').at(-1).text, '流式正文。', 'result completes a delta-only answer');

const app = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8');
const extract = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const normBlocks = vm.runInNewContext(extract('function normBlocks(', '\nfunction blockDur(') + ';normBlocks', {
  isCliModelDiagnostic: () => false,
});
const snapshotEchoBlocks = normBlocks({ blocks: [
  { type: 'think', text: '同一条思考', _t0: 100, _t1: 100 },
  { type: 'think', text: '同一条思考', _t0: 108, _t1: 108 },
  { type: 'text', text: '同一条回答', _t0: 120, _t1: 140 },
  { type: 'text', text: '同一条回答', _t0: 148, _t1: 148 },
] });
assert.deepEqual(snapshotEchoBlocks.map(block => block.type), ['think', 'text'], 'adjacent instant thinking and answer snapshots are hidden without removing real blocks');
const state = vm.runInNewContext(extract('function streamProgressState(', '\nfunction renderStreamProgress(') + ';streamProgressState', { fmtDur: ms => Math.floor(ms / 1000) + ' 秒' });
assert.equal(state({ startAt: 1000 }, 2000).title, '等待 Agent 输出');
assert.equal(state({ startAt: 1000, lastEventAt: 1500, activity: { phase: 'tool', title: '正在运行命令', detail: '检查文件' } }, 2000).detail, '检查文件');
assert.equal(state({ startAt: 1000, lastEventAt: 1000 }, 31000).phase, 'idle');
assert(state({ startAt: 1000 }, 31000).detail.includes('尚未返回正文'), 'silence is explicit and does not invent an answer');
assert(!state({ startAt: 1000, hasNarrative: true }, 31000).detail.includes('尚未返回正文'));
assert.equal(state({ startAt: 1000, awaitingPermission: true }, 90000).phase, 'user', 'waiting for approval is not a supplier timeout');
assert.equal(state({ awaitingPermission: true, awaitingQuestion: true }, 90000).title, '等待你的回答');
assert.equal(state({ protocolDone: true, startAt: 1000 }, 90000).phase, 'saving', 'a completed protocol no longer claims to be generating');
const rememberedTool = vm.runInNewContext(extract('function rememberedPermissionTool(', '\nfunction ensurePermissionAudit(') + ';rememberedPermissionTool');
assert.equal(rememberedTool('已按项目权限记忆允许： Bash'), 'Bash');
assert.equal(rememberedTool('已按项目权限记忆允许：Read'), 'Read');
for (const text of ['连接失败', '没有权限', '已按项目权限记忆允许：', '已按项目权限记忆允许：' + 'x'.repeat(129)]) assert.equal(rememberedTool(text), '', 'other statuses are not hidden in the permission audit');
const stderrHtml = vm.runInNewContext(extract('function stepBlockHtml(', '\nfunction toolGroupInfo(') + ';stepBlockHtml', {
  disclosureAttrs: () => '', disclosureHeadAttrs: () => '', esc: value => String(value), cliDiagnosticSummary: value => String(value),
  UI_ICONS2: { term: '<svg class="term"></svg>' }, UI_ICONS: { chevDown: '<svg class="chev"></svg>' },
});
const stderr = stderrHtml({ type: 'stderr', text: 'CLI 输出' });
assert(stderr.includes('class="icon-idle"') && stderr.includes('class="step-chevron"') && !stderr.includes('class="chev-hover"'), 'CLI output keeps its terminal icon on hover and uses the shared trailing disclosure arrow');

const audit = require('../../lib/permission-audit');
const read = { pid: 0, tool: 'Read', input: { file_path: '<unsafe>.css' } };
const record = audit.fromReply(read, { action: 'allow', remember: 'project' }, { remembered: true });
assert.equal(record.requestId, '0', 'native request zero is a valid receipt');
assert.equal(record.label, '已记住本项目');
assert.equal(audit.fromReply({ ...read, question: true }, {}), null, 'question answers keep their own record semantics');
assert(audit.fromReply(read, { action: 'deny' }).rejected);
assert(audit.fromReply(read, { action: 'allow', remember: 'project' }, { remembered: false }).memoryWarning);
const modeRecord = audit.fromReply({ ...read, suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] }, { action: 'allow', suggestionIndex: 0 });
assert.equal(modeRecord.label, '已切换到自动接受编辑');
const optionRecord = audit.fromReply({ ...read, options: [{ optionId: 'native/session', name: '允许本会话', response: { decision: 'acceptForSession' } }] }, { optionId: 'native/session' });
assert.equal(optionRecord.choice, '允许本会话');
let savedAudit = audit.add(undefined, record);
savedAudit = audit.add(savedAudit, record);
assert.equal(savedAudit.manualCount, 1, 'a repeated receipt does not count twice');
savedAudit = audit.addAutomatic(savedAudit, 'Read');
savedAudit = audit.addAutomatic(savedAudit, 'Read');
assert.equal(savedAudit.automatic.Read, 2);
assert.equal(audit.automaticTool('连接失败'), '');
assert.equal(audit.clean(null), undefined);
assert.equal(audit.clean({ records: [{ requestId: 'x', detail: 'a'.repeat(9000), password: 'discard' }] }).records[0].detail.length, 4000);
assert(!('password' in audit.clean({ records: [{ requestId: 'x', password: 'discard' }] }).records[0]));
for (let i = 0; i < 205; i++) savedAudit = audit.add(savedAudit, { requestId: 'receipt-' + i });
assert.equal(savedAudit.records.length, 200, 'stored detail growth is bounded');
assert.equal(savedAudit.manualCount, 206, 'bounded details do not undercount the total');
const auditHtml = vm.runInNewContext(extract('function permissionAuditHtml(', '\nfunction ensurePermissionAudit(') + ';permissionAuditHtml', {
  esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  window: { AgentHubIcons: { svg: () => '<svg></svg>' } }, UI_ICONS: { chevDown: '<svg></svg>' },
  permissionRecordHtml: value => '<details>' + String(value.detail || '').replace(/</g, '&lt;') + '</details>',
});
const history = auditHtml(audit.addAutomatic(audit.add(undefined, record), 'Read'));
assert(history.includes('2 次') && history.includes('本次确认 1 · 项目规则 1'));
assert(!history.includes(' open') && !history.includes('<button') && history.includes('&lt;unsafe>'), 'persisted audit stays collapsed and non-interactive');
console.log('[conversation-output] result-only answers, deduplication, truthful progress, bounded durable permission receipts and approval scope labels passed');
