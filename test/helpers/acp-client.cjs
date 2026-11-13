const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createClientTools, operationKey } = require('../../lib/acp-client-tools');
const { createToolPresenter } = require('../../lib/acp-content');
const { decideToolPermission } = require('../../lib/permission-policy');
function bounded(promise, ms = 6000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('ACP fixture timeout')), ms); })]).finally(() => clearTimeout(timer));
}
module.exports = async function checkClientTools(temp, acp, agents) {
  const cwd = path.join(temp, 'acp-tools'); fs.mkdirSync(cwd);
  let checks = 0;
  const client = createClientTools({ cwd, authorize: async () => true, emit() {}, invocation: agents.localInvocation });
  client.setSession('unit');
  const invoke = (method, params = {}) => client.handlers[method]({ sessionId: 'unit', ...params });
  const file = path.join(cwd, 'unit.txt');
  fs.writeFileSync(file, 'one\n第二行\nthree\n');
  try {
    assert.equal(operationKey('write_file', { path: 'unit.txt', content: 'replacement' }), '', 'relative permission input cannot grant a host file write');
    checks++;
    assert.deepEqual(await invoke('fs/read_text_file', { path: file, line: 2, limit: 1 }), { content: '第二行\n' }); checks++;
    await assert.rejects(() => invoke('fs/read_text_file', { path: file, sessionId: 'wrong' }), /会话不匹配/); checks++;
    await assert.rejects(() => invoke('fs/read_text_file', { path: file, limit: 0 }), /正整数/); checks++;
    fs.writeFileSync(path.join(cwd, 'binary'), Buffer.from([0, 255]));
    await assert.rejects(() => invoke('fs/read_text_file', { path: path.join(cwd, 'binary') })); checks++;
    const fresh = path.join(cwd, 'sub', 'new.txt');
    await invoke('fs/write_text_file', { path: fresh, content: 'new\n' }); assert.equal(fs.readFileSync(fresh, 'utf8'), 'new\n'); checks++;
    const cmd = await invoke('terminal/create', { command: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', '中文😀&echo NOT_A_SHELL'], cwd, outputByteLimit: 23 });
    assert.equal((await bounded(invoke('terminal/wait_for_exit', cmd))).exitCode, 0);
    const output = await invoke('terminal/output', cmd);
    assert(output.truncated); assert(!output.output.includes('�')); assert(Buffer.byteLength(output.output) <= 23); assert(output.output.includes('NOT_A_SHELL')); checks++;
    await invoke('terminal/release', cmd);
    assert.throws(() => invoke('terminal/output', cmd), /不存在或已释放/); checks++;
    const missing = await invoke('terminal/create', { command: 'ah-nonexistent-command-xyz', cwd });
    assert.equal((await bounded(invoke('terminal/wait_for_exit', missing))).exitCode, 1); checks++;
    const running = await invoke('terminal/create', { command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd });
    await invoke('terminal/kill', running); await bounded(invoke('terminal/wait_for_exit', running)); checks++;
    const events = [], presenter = createToolPresenter(e => events.push(e), client);
    presenter.update({ toolCallId: 'status', kind: 'execute', title: 'run', rawInput: { command: 'example' }, status: 'in_progress', content: [{ type: 'content', content: { type: 'text', text: 'structured result' } }] });
    presenter.update({ toolCallId: 'status', rawOutput: null });
    assert(events.filter(e => e.kind === 'tooloutput').every(e => e.status === 'running' && e.output === 'structured result')); checks++;
    presenter.update({ toolCallId: 'status', status: 'failed' }); assert.equal(events.at(-1).status, 'error'); checks++;
    presenter.update({ toolCallId: 'diff', kind: 'edit', status: 'completed', content: [{ type: 'diff', path: file, oldText: 'before', newText: 'after' }] });
    assert(events.some(e => e.kind === 'files' && e.files[0].oldStr === 'before')); checks++;
    presenter.update({ toolCallId: 'unknown-before', kind: 'edit', status: 'completed', content: [{ type: 'diff', path: file, newText: 'after' }] });
    assert(events.at(-1).files[0].snapshotUnavailable); presenter.close(); checks++;
  } finally { client.close(); }
  let cancelled = false, releasePermission;
  const cancelClient = createClientTools({ cwd, cancelled: () => cancelled, emit() {}, invocation: agents.localInvocation,
    authorize: () => new Promise(resolve => { releasePermission = resolve; }) });
  cancelClient.setSession('cancel-unit');
  const beforeCancel = fs.readFileSync(file, 'utf8');
  const cancelledWrite = cancelClient.handlers['fs/write_text_file']({ sessionId: 'cancel-unit', path: file, content: 'must not write' });
  cancelled = true; releasePermission(true);
  await assert.rejects(() => cancelledWrite, /取消/); assert.equal(fs.readFileSync(file, 'utf8'), beforeCancel); cancelClient.close(); checks++;
  for (const mode of ['ask', 'edits', 'plan']) {
    const denied = createClientTools({ cwd, authorize: async name => decideToolPermission(name, mode) === 'allow', emit() {}, invocation: agents.localInvocation });
    denied.setSession('guard');
    const before = fs.readFileSync(file, 'utf8');
    if (mode !== 'edits') { await assert.rejects(() => denied.handlers['fs/write_text_file']({ sessionId: 'guard', path: file, content: 'blocked' }), /未允许/); assert.equal(fs.readFileSync(file, 'utf8'), before); checks++; }
    await assert.rejects(() => denied.handlers['terminal/create']({ sessionId: 'guard', command: process.execPath, cwd }), /未允许/); checks++;
    denied.close();
  }
  fs.writeFileSync(path.join(cwd, 'client-edit.txt'), 'before\n');
  const events = [], permissions = [];
  const options = { sessionKey: 'acp-tools-integration', prompt: 'client-tools', cwd, permMode: 'ask', externalMcp: false, custom: { id: 'custom:fixture-tools', bin: process.execPath, args: [path.join(__dirname, '../fixtures/acp-runtime.cjs')], acp: true } };
  try {
    const turn = acp.runAcpAgent(options, e => {
      events.push(e);
      if (e.kind === 'permission') {
        permissions.push(e);
        assert.equal(acp.respondPermission(options.sessionKey, e.pid, 'not-an-option'), false);
        assert.equal(acp.respondPermission(options.sessionKey, e.pid, e.options.find(option => option.kind === 'allow_once').optionId), true);
      }
    });
    assert.equal(await bounded(turn.done), 0); checks++;
    assert.equal(permissions.length, 2, 'matching ACP approval is reused once for the write; command gets its own approval'); checks++;
    assert.equal(fs.readFileSync(path.join(cwd, 'client-edit.txt'), 'utf8'), 'after\n'); checks++;
    assert.equal(events.filter(e => e.kind === 'files').length, 1, 'same write is not counted again from the ACP diff'); checks++;
    assert(events.filter(e => e.kind === 'tool' && e.id === 'edit-1').every(e => e.name === 'Write'), 'whole-file input keeps the Write identity used by file snapshot matching'); checks++;
    assert(events.some(e => e.kind === 'tooloutput' && e.id === 'cmd-1' && e.output.includes('ACP terminal ✓'))); checks++;
    assert(events.some(e => e.kind === 'think' && e.text.length === 6000)); checks++;
    assert(!events.some(e => /\[object Object\]/.test(e.detail || e.output || e.text || ''))); checks++;
    assert(events.some(e => e.kind === 'text' && e.text === 'CLIENT TOOLS OK')); checks++;
  } finally { acp.destroySession(options.sessionKey, 'test-client-cleanup'); }
  console.log('[acp-client] ' + checks + ' filesystem / terminal / permission / structured-content checks passed');
};
