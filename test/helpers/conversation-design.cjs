'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const app = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8');
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = { svg: name => `<svg data-icon="${name}"></svg>` };
const progress = require('../../lib/plan-progress');
assert.equal(progress.clean({ todos: [{ text: '步骤', status: '__proto__' }] }).todos[0].status, 'pending');
const normalized = progress.clean({ todos: [
  { content: '整理界面', status: 'completed' }, { step: '编辑文件', activeForm: '正在编辑文件', status: 'inProgress' },
  { text: '测试', status: 'pending' }, null,
], explanation: '先处理共用组件' });
assert.deepEqual(normalized.todos.map(t => t.status), ['completed', 'in_progress', 'pending']);
assert.equal(normalized.todos[1].activeForm, '正在编辑文件');
assert.deepEqual(progress.clean({ todos: [{ activeForm: '只有执行描述', status: 'unknown' }] }).todos, [{ text: '只有执行描述', status: 'pending' }], 'older native todo payloads keep their activeForm-only text');
assert.equal(progress.latest([{ plan: normalized }, { role: 'assistant' }]).todos[1].status, 'in_progress', 'a later turn without an update does not erase progress');
const completed = { todos: [{ text: '已完成', status: 'completed' }] };
assert.deepEqual(progress.latest([{ plan: normalized }, { plan: completed }]), completed, 'the newest completed plan cannot resurrect an older unfinished one');
assert(progress.promptFor({ messages: [{ plan: normalized }] }).includes('[in_progress] 编辑文件'), 'continuation receives actual last-reported status');
assert(!progress.promptFor({ messages: [{ plan: normalized }, { plan: completed }] }).includes('[in_progress]'), 'completed work is not injected as still running');
assert.equal(progress.promptFor({ agent: 'chat', messages: [] }), '', 'ordinary chat is not forced into a coding plan');

const plan = vm.runInNewContext(slice('function planProgressState(', '\n// 可预览') + ';({planProgressState,planCardHtml})', { esc, md: esc, window: { AgentHubIcons: icons } });
assert.equal(plan.planProgressState(normalized, true).label, '正在执行 · 第 2 步');
assert.equal(plan.planProgressState(normalized, false).label, '上次进度 · 第 2 步', 'idle history does not pretend the Agent is still executing');
assert.equal(plan.planProgressState({ todos: [{ text: '等待', status: 'pending' }] }, true).label, '等待开始');
assert.equal(plan.planProgressState(completed, false).complete, true);
assert(plan.planCardHtml(normalized).includes('aria-current="step"'));
assert(!plan.planCardHtml(completed).includes(' open'));
assert(plan.planCardHtml({ plan: '<img onerror="bad">' }).includes('data-plan-kind="document"'), 'a Markdown document is not fake execution progress');

const stats = vm.runInNewContext(slice('const fileOperationStatsCache =', '\nfunction filesRowHtml(') + ';({fileOperationStats,fileGroupStats,fileCollectionStats,fileStatsHtml})', {
  esc, isBinaryFile: p => /\.(png|pdf)$/.test(p), hasBinaryText: f => String(f.newStr || '').includes('\0'),
});
const count = file => stats.fileOperationStats({ path: 'app.css', tool: 'Edit', ...file });
assert.deepEqual(JSON.parse(JSON.stringify(count({ oldStr: 'a\nb\nc\n', newStr: 'a\nB\nC\nc\n' }))), { known: true, additions: 2, deletions: 1, partial: false });
assert.equal(count({ oldStr: 'a\n', newStr: 'a\n' }).additions, 0);
assert.deepEqual([count({ oldStr: 'a', newStr: 'a\n' }).additions, count({ oldStr: 'a', newStr: 'a\n' }).deletions], [1, 1], 'terminal newlines never manufacture an extra blank line');
assert.equal(count({ oldStr: 'a\r\n', newStr: 'a\n' }).additions, 0);
assert.equal(count({ tool: 'Write', created: true, oldStr: '', newStr: 'one\ntwo\n' }).additions, 2);
const unknownWrite = count({ tool: 'Write', oldStr: '', newStr: 'one\ntwo\n' });
assert.equal(unknownWrite.known, false, 'an unknown pre-write snapshot is not a newly created file');
assert.equal(unknownWrite.writtenLines, 2);
assert.equal(count({ snapshotUnavailable: true, writtenLines: 12 }).writtenLines, 12, 'remote Write retains its reported output length');
assert.equal(count({ path: 'plot.png', oldStr: '', newStr: 'binary', created: true }).known, false);
assert.equal(count({ oldStr: 'x\n'.repeat(900), newStr: 'y\n'.repeat(900) }).known, false, 'large replacements use a bounded calculation');
const patch = 'diff --git a/app.css b/app.css\n--- a/app.css\n+++ b/app.css\n@@ -1,2 +1,3 @@\n ctx\n-removed\n+++content\n+new\n';
assert.deepEqual([count({ diff: patch }).additions, count({ diff: patch }).deletions], [2, 1], 'a content line beginning with +++ inside a hunk is counted');
assert(count({ diff: patch, diffTruncated: true }).partial);
assert(count({ oldStr: 'old', newStr: 'new', replaceAll: true }).partial, 'replace_all cannot claim a full-file count from one fragment');
const mixed = stats.fileGroupStats([{ f: { path: 'a.css', oldStr: 'a\n', newStr: 'b\n' } }, { f: { path: 'b.css', snapshotUnavailable: true } }]);
assert(mixed.known && mixed.partial && mixed.additions === 1);
assert(stats.fileStatsHtml(mixed).includes('部分'));
assert(stats.fileStatsHtml({ known: false, writtenLines: null }).includes('行数未返回'));
const group=files=>stats.fileGroupStats(files.map(f=>({f:{path:'app.css',...f}})));
const createThenEdit=group([{tool:'Write',created:true,oldStr:'',newStr:'a\nb\n'},{tool:'Edit',oldStr:'a\n',newStr:'A\n'},{tool:'Edit',oldStr:'A\n',newStr:'a\n'}]);
assert.deepEqual([createThenEdit.scope,createThenEdit.additions,createThenEdit.deletions],['net',2,0],'creation plus repeated edits counts final content once');
const overwriteThenRevert=group([{tool:'Write',created:false,oldStr:'a\nb\n',newStr:'A\nb\n'},{tool:'Edit',oldStr:'A\n',newStr:'a\n'}]);
assert.deepEqual([overwriteThenRevert.scope,overwriteThenRevert.additions,overwriteThenRevert.deletions],['net',0,0],'returning to the before snapshot has no net changes');
const multiple=group([{tool:'Write',created:false,oldStr:'old\nold\n',newStr:'old\nold\n'},{tool:'Edit',oldStr:'old',newStr:'new',replaceAll:true}]);
assert.deepEqual([multiple.scope,multiple.additions,multiple.deletions],['net',2,2],'a known full snapshot permits exact replace-all replay');
const partialWrite=group([{tool:'Write',snapshotUnavailable:true,writtenLines:724},{tool:'Edit',oldStr:'a\n',newStr:'b\nc\n'}]);
assert.equal(partialWrite.scope,'operations');assert(partialWrite.partial);assert.equal(partialWrite.writtenLines,724);assert(stats.fileStatsHtml(partialWrite).includes('部分编辑')&&stats.fileStatsHtml(partialWrite).includes('写入 724 行'),'unknown initial writes retain coverage and written-length explanations in the compact count tooltip');
const ambiguous=group([{tool:'Write',created:true,oldStr:'',newStr:'same\nsame\n'},{tool:'Edit',oldStr:'same',newStr:'other'}]);
assert.equal(ambiguous.scope,'operations','ambiguous edit placement never pretends to be an exact whole-file replay');
const overlapping=group([{tool:'Write',created:true,oldStr:'',newStr:'aaa'},{tool:'Edit',oldStr:'aa',newStr:'b'}]);
assert.equal(overlapping.scope,'operations','overlapping matches also prevent an unambiguous replay');
const collection=stats.fileCollectionStats([{items:[{f:{path:'a.css',tool:'Write',snapshotUnavailable:true,writtenLines:724}}]},{items:[{f:{path:'b.css',tool:'Edit',oldStr:'a\n',newStr:'b\n'}}]}]);
assert.equal(collection.writtenLines,null,'a collection total never claims the last file written length as every file total');
assert.equal(collection.scope,'operations');assert.equal(collection.additions,1);assert.equal(collection.deletions,1);
const undoFiles=[{f:{path:'app.css',tool:'Write',created:true,oldStr:'',newStr:'a\n'}}];assert.equal(stats.fileGroupStats(undoFiles).scope,'net');undoFiles[0].f.undone=true;assert.equal(stats.fileGroupStats(undoFiles).scope,'operations','undo invalidates the net snapshot cache');

const toolStats = vm.runInNewContext(
  slice('const fileOperationStatsCache =', '\nfunction filesRowHtml(') +
  slice('function blockDur(', '\nfunction htmlToolArtifact(') + ';({toolChangeStats,stepHeadHtml,withToolFileStats,toolReferencePaths})', {
    esc, isBinaryFile: p => /\.(png|pdf)$/.test(p), hasBinaryText: f => String(f.newStr || '').includes('\0'),
    baseName: p => p.split(/[\\/]/).at(-1), UI_ICONS: {}, UI_ICONS2: {}, window: { AgentHubIcons: icons }, fmtDur: value => value + 'ms',
  });
const edit = { type: 'tool', name: 'Edit', status: 'done', detail: JSON.stringify({ file_path: 'app.css', old_string: 'a\nb\n', new_string: 'a\nB\nC\n' }) };
assert(toolStats.stepHeadHtml(edit).includes('file-lines-add">+2') && toolStats.stepHeadHtml(edit).includes('file-lines-del">−1'), 'edit counts are visible before opening the tool');
assert.deepEqual(Array.from(toolStats.toolReferencePaths({name:'Read',detail:'src/main.py'})),['src/main.py'],'plain native read paths stay actionable');
assert.deepEqual(Array.from(toolStats.toolReferencePaths({name:'ImageView',detail:'images/chart.png'})),['images/chart.png'],'native image-view paths are retained');
assert.deepEqual(Array.from(toolStats.toolReferencePaths({name:'Edit',detail:'src/a.js, src/b.js'})),['src/a.js','src/b.js'],'native multi-file changes expose every file');
assert.deepEqual(Array.from(toolStats.toolReferencePaths({name:'apply_patch',detail:JSON.stringify({patch:'*** Begin Patch\n*** Update File: src/a.js\n@@\n-a\n+b\n*** Add File: src/b.js\n+x\n*** End Patch'})})),['src/a.js','src/b.js'],'patch tools expose their explicit target files');
assert.equal(toolStats.toolChangeStats(edit), toolStats.toolChangeStats(edit), 'unchanged tool objects reuse bounded diff results');
const multi = { name: 'MultiEdit', detail: JSON.stringify({ edits: [{ old_string: 'a', new_string: 'A\nB' }, { old_string: 'b', new_string: 'C' }] }) };
assert.deepEqual([toolStats.toolChangeStats(multi).additions, toolStats.toolChangeStats(multi).deletions], [3, 2]);
assert(toolStats.toolChangeStats({ name: 'Edit', detail: '{"old_string":"a","new_string":"b","replace_all":true}' }).partial);
const partialMulti = { name: 'MultiEdit', detail: '{"edits":[{"old_string":"a","new_string":"b"},{}]}' };
assert(toolStats.toolChangeStats(partialMulti).partial, 'incomplete MultiEdit members cannot silently count as zero');
const write = { type: 'tool', name: 'Write', status: 'done', detail: '{"file_path":"app.js","content":"one\\ntwo\\n"}' };
assert(toolStats.stepHeadHtml(write).includes('写入 2 行') && !toolStats.stepHeadHtml(write).includes('file-lines-add'), 'a write with no old snapshot shows output length');
const created = toolStats.withToolFileStats([write], [{ path: 'app.js', tool: 'Write', created: true, oldStr: '', newStr: 'one\ntwo\n' }])[0];
assert.equal(toolStats.toolChangeStats(created).additions, 2, 'a confirmed newly created file can show additions');
const overwrite = toolStats.withToolFileStats([write], [{ path: 'app.js', tool: 'Write', created: false, oldStr: 'one\nold\n', newStr: 'one\ntwo\n' }])[0];
assert.deepEqual([toolStats.toolChangeStats(overwrite).additions, toolStats.toolChangeStats(overwrite).deletions], [1, 1], 'overwriting a known file reports the actual difference');
const mismatch = toolStats.withToolFileStats([write], [{ path: 'app.js', tool: 'Write', created: true, oldStr: '', newStr: 'different contents\n' }])[0];
assert(!toolStats.toolChangeStats(mismatch).known, 'a different write snapshot must not be attributed merely because the path matches');
assert(toolStats.stepHeadHtml({ ...write, name: 'create_file' }).includes('step-title">写入'), 'file creation aliases retain the same friendly operation label');
const nativeEdit = { type: 'tool', name: 'Edit', status: 'done', detail: 'app.css' };
const native = toolStats.withToolFileStats([nativeEdit], [{ path: 'app.css', tool: 'Edit', diff: patch }])[0];
assert.equal(toolStats.toolChangeStats(native).additions, 2, 'native path-only changes use their unambiguous unified snapshot');
assert.equal(toolStats.toolChangeStats(toolStats.withToolFileStats([nativeEdit, { ...nativeEdit }], [{ path: 'app.css', tool: 'Edit', diff: patch }])[0]).known, false, 'ambiguous same-path history cannot borrow another operation snapshot');
assert.equal(toolStats.toolChangeStats({ ...edit, status: 'error' }), null, 'failed edits do not claim applied additions');
assert(toolStats.stepHeadHtml({ ...edit, status: 'running' }).includes('待完成'), 'requested edits are visibly distinguished from completed changes');
assert(toolStats.stepHeadHtml({ name: 'Write', type: 'tool', detail: '{"file_path":"app.js","content":"truncated' }).includes('行数未返回') === false, 'a truncated write must not fabricate a zero count');

const source = fs.readFileSync(path.resolve(__dirname, '../../public/plan-artifacts.js'), 'utf8');
const draft = vm.runInNewContext(source.slice(source.indexOf('  function implementationDraft('), source.indexOf('  function download(')) + ';implementationDraft');
const prompt = draft({ id: 'source-task' }, { title: '实施', revision: 3 }, '# 正文');
assert(prompt.includes('原生计划工具') && prompt.includes('@@source-task') && prompt.includes('第 3 版') && prompt.endsWith('# 正文'));

function element() {
  const attrs = new Map(), buttons = [];
  const e = { dataset: {}, buttons, classList: { add() {}, remove() {} }, innerHTML: '', disabled: false,
    getAttribute: n => attrs.get(n), setAttribute: (n, v) => attrs.set(n, v), removeAttribute: n => attrs.delete(n),
    querySelector: () => ({ appendChild(button) { buttons.push(button); } }), appendChild(button) { buttons.push(button); },
  };
  return e;
}
(async () => {
  const requests = [], resolved = [], state = { readOnly: false };
  const permissions = vm.runInNewContext(
    slice('function permissionCardShell(', '\n// Claude / ZCode') +
    slice('function bridgePermCardHtml(', '\nfunction lockPermCard(') + ';({bridgePermCardHtml,acpPermCardHtml,apiAgentPermCardHtml,permissionRecordHtml})', {
      esc, S: state, window: { AgentHubIcons: icons }, document: { createElement: element },
      api: async (url, options) => { requests.push({ url, ...options.body }); return { remembered: true }; },
      lockPermCard: card => card.setAttribute('aria-busy', 'true'),
      unlockPermCard: card => card.removeAttribute('aria-busy'),
      markPermResolved: (card, label) => resolved.push({ label, ...card.__permissionRecord }), toast() {},
    });
  const event = { pid: 0, title: '请求使用 Edit', input: { file_path: '<unsafe>.css' }, suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] };
  let card = permissions.bridgePermCardHtml(event, 'native');
  assert(card.innerHTML.includes('&lt;unsafe&gt;') && !card.innerHTML.includes('<unsafe>'));
  await card.buttons[0].onclick();
  assert.deepEqual(requests.at(-1), { url: '/api/bridge/respond', sessionId: 'native', requestId: 0, action: 'allow' });
  card = permissions.bridgePermCardHtml(event, 'native'); await card.buttons[1].onclick();
  assert.equal(requests.at(-1).suggestionIndex, 0, 'session mode is never confused with project memory');
  card = permissions.bridgePermCardHtml(event, 'native'); await card.buttons[2].onclick();
  assert.equal(requests.at(-1).remember, 'project');
  card = permissions.bridgePermCardHtml(event, 'native'); await card.buttons[3].onclick();
  assert.equal(requests.at(-1).action, 'deny'); assert.equal(resolved.at(-1).label, '已拒绝');
  const option = { optionId: 'native:session/1', name: '允许本会话', response: { decision: 'acceptForSession' } };
  card = permissions.bridgePermCardHtml({ ...event, options: [option, { optionId: 'native:deny', name: '拒绝', kind: 'reject' }] }, 'zcode');
  await card.buttons[0].onclick(); assert.equal(requests.at(-1).optionId, option.optionId);
  card = permissions.acpPermCardHtml({ pid: 0, options: [{ optionId: 'acp/once', name: '允许一次', kind: 'allow_once' }] }, 'acp');
  await card.buttons[0].onclick(); assert.equal(requests.at(-1).pid, '0'); assert.equal(requests.at(-1).optionId, 'acp/once');
  card = permissions.apiAgentPermCardHtml(event, 'builtin'); await card.buttons[2].onclick();
  assert.equal(requests.at(-1).action, 'deny');
  state.readOnly = true;
  card = permissions.bridgePermCardHtml(event, 'native'); const before = requests.length;
  await card.buttons[0].onclick(); assert.equal(requests.length, before); assert(card.buttons.every(b => b.disabled));
  const receipt = permissions.permissionRecordHtml({ title: '<script>', detail: '<img>', choice: '允许本次' }, '已允许本次');
  assert(!receipt.includes(' open') && !receipt.includes('<button') && receipt.includes('&lt;img&gt;'), 'permission receipts collapse safely into one row');
  console.log('[conversation-design] native progress, continuation, accurate bounded line counts, implementation draft and approval scopes passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
