'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
require('./conversation-preferences.cjs');
require('./file-preview-references.cjs');
require('./file-diff-navigation.cjs');
require('./unified-tool-records.cjs');
require('./usage-live.cjs');
require('./display-details.cjs');
const conversationPreferences = require('../../public/conversation-preferences.js');
conversationPreferences.save({});
const app = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8');
const source = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const context = {
  S: { curAgent: '' },
  esc, md: value => '<p>' + esc(value) + '</p>', UI_ICONS: {}, UI_ICONS2: {},
  window: { AgentHubIcons: { svg: name => `<svg data-icon="${name}"></svg>` }, AgentHubConversationPreferences: conversationPreferences },
  configureThinkingDisclosure: card => card, applyConversationView() {},
  stepHeadHtml: b => esc(b.name || b.type), imagesHtml: () => '',
  toolIoHtml: (name, detail, output) => esc(output), hydrateArtifactImages() {},
  readableErrorText: value => String(value || ''),
  blockDur: b => b._durationMs ?? (b._t0 && b._t1 ? b._t1 - b._t0 : 0),
  turnAnswerHtml: value => '<p>' + esc(value) + '</p>',
  finishLiveText() {},
  SUBAGENT_TOOLS: /^Task$/,
  isBinaryFile: value => /\.(png|pdf)$/.test(value), hasBinaryText: file => String(file.newStr || '').includes('\0'),
  setTimeout: fn => { scheduledThinkPaints.push(fn); return scheduledThinkPaints.length; },
  clearTimeout: id => { scheduledThinkPaints[id - 1] = null; },
  document: { hidden: false, createElement: () => readerNode() },
};
const scheduledThinkPaints = [];
const ui = vm.runInNewContext(
  source(app, 'function conversationPref(', '\nfunction configureThinkingDisclosure(') +
  source(app, 'function fmtDur(', '\nfunction fmtDurShort(') +
  source(app, 'const fileOperationStatsCache =', '\nfunction filesRowHtml(') +
  source(app, 'const toolChangeStatsCache =', '\n// Keep the file name,') +
  source(app, 'function toolInput(', '\nfunction htmlToolArtifact(') +
  source(app, 'function hasThinkingText(', '\nconst MENTION_TOKEN_RE') +
  source(app, 'const pendingActivities =', '\nfunction finishLiveText(') +
  source(app, 'function liveActivity(', '\nfunction appendLiveStep(') +
  source(app, 'function appendLiveStep(', '\nfunction liveAnswer(') +
  source(app, 'function questionRecordHtml(', '\nfunction markPermResolved(') +
  ';({activityHtml,activityDurationText,updateActivityDuration,stepBlockHtml,pendingActivities,hydrateActivity,questionRecordHtml,questionReplyRecord,finishLiveThink,settleStreamActivities,appendLiveNotice,turnTimelineHtml,coalesceThoughts,liveActivity,appendLiveStep,isThinkingSnapshot,toolGroupInfo,toolGroupSummaryHtml,toolGroupBreakdownHtml,processContentHtml,thinkingPanelHtml,thinkingRenderer,thinkingSliceEnd,setThinkingSource,scheduleThinkingPaint,syncThinkingView})', context);
const narrative = ui.activityHtml([
  { type: 'text', text: '我先检查布局。' }, { type: 'tool', name: 'Read', output: 'result\n'.repeat(600) },
  { type: 'text', text: '目录已确认，继续修复。' },
]);
assert(narrative.includes('我先检查布局。') && narrative.includes('目录已确认，继续修复。'), 'process retains intermediate explanations in order');
assert.equal((narrative.match(/class="turn-activity/g) || []).length, 1, 'the whole turn uses one process, including separated tools and prose');
assert.equal((narrative.match(/class="tool-group"/g) || []).length, 1, 'consecutive tools sit below their commentary in one compact group');
assert(!/class="tool-group"[^>]* open/.test(narrative), 'tool groups start closed');
assert(!narrative.includes('result\nresult'), 'closed long tool results are deferred');
assert.equal(ui.pendingActivities.size, 1);
for (const text of [undefined, null, '', ' \t\n', '\u200B\u2060\uFEFF']) {
  assert.equal(ui.stepBlockHtml({ type: 'think', text }, true), '', 'empty thinking never creates a disclosure or blank body');
  assert.equal(ui.activityHtml([{ type: 'think', text }]), '', 'empty thinking does not leave an empty activity card');
}
const plainThought = ui.stepBlockHtml({ type: 'think', text: '有效的思考记录' }, true);
assert(plainThought.includes('<details class="step step-think"')&&plainThought.includes('<summary class="step-head"')&&plainThought.includes('data-expansion-level="3"'), 'thinking uses the same concrete-call disclosure as tools');
assert(plainThought.includes('class="step-chevron"')&&!plainThought.includes('thinking-chevron'), 'reasoning shares the tool chevron rather than a differently oriented arrow');
assert(!plainThought.includes('class="st-dur"')&&!ui.stepBlockHtml({type:'think',text:'零计时',_t0:100,_t1:100}).includes('class="st-dur"'), 'unknown and zero thinking durations do not clutter the shared row');
assert(ui.stepBlockHtml({type:'think',text:'有效计时',_t0:100,_t1:3100}).includes('class="st-dur">3 秒'), 'known positive thought timing stays visible beside the shared detail toggle');
assert(!/class="turn-activity"[^>]* open/.test(narrative), 'completed activities start closed');
assert(narrative.indexOf('turn-process') < narrative.indexOf('我先检查') && narrative.indexOf('我先检查') < narrative.indexOf('目录已确认'), 'intermediate prose belongs to the single chronological process');
const timeline = ui.turnTimelineHtml([
  { type: 'think', text: '先确认。' }, { type: 'text', text: '开始处理。' },
  { type: 'tool', name: 'Read' }, { type: 'text', text: '最终回答。' },
  { type: 'error', text: '后续连接已断开' },
], true, 3);
assert.equal((timeline.match(/class="turn-activity/g) || []).length, 1);
assert(timeline.indexOf('turn-final') > timeline.indexOf('</details>') && timeline.indexOf('后续连接已断开') > timeline.indexOf('turn-final'), 'final reply and trailing errors remain outside the closed process');
assert(!/class="turn-activity"[^>]* open/.test(timeline), 'legacy expansion preferences cannot open the whole completed turn');
assert(ui.activityHtml([{ type: 'tool', name: 'Read' }], true, true).includes(' open'), 'running process groups are visible');
const errorNotice = ui.activityHtml([{ type: 'error', text: '连接失败' }]);
assert(errorNotice.includes('连接失败') && !errorNotice.includes('turn-activity'), 'actionable errors are not buried in a closed process');
assert(ui.activityHtml([{ type: 'tool', name: 'Read' }, { type: 'stopped' }]).includes('activity-state">已停止'), 'the visible history status does not label a stopped turn completed');
assert(ui.activityHtml([{ type: 'tool', name: 'Read' }, { type: 'error', text: '连接失败' }]).includes('activity-state">执行结束'), 'the visible history status does not claim a failed turn succeeded');
const timedTimeline = ui.turnTimelineHtml([{ type: 'tool', name: 'Read' }, { type: 'text', text: '最终回答。' }], false, 1, 65000);
assert(timedTimeline.includes('title="整轮耗时，包含工具和等待">· 1 分 05 秒</span>'), 'history uses the recorded whole-turn elapsed time in the process summary');
for (const unknown of [undefined, null, NaN, Infinity, -1, '65000']) assert.equal(ui.activityDurationText(unknown), '', 'unknown or invalid elapsed time never becomes a fabricated duration');
assert.equal(ui.activityDurationText(0), '· 0 秒', 'an explicitly recorded zero duration is valid');
const durationLabel = { textContent: '', hidden: true };
const timedActivity = { querySelector: () => durationLabel };
ui.updateActivityDuration(timedActivity, 65000);
assert.equal(durationLabel.textContent, '· 1 分 05 秒');
assert.equal(durationLabel.hidden, false);
ui.updateActivityDuration(timedActivity, null);
assert.equal(durationLabel.textContent, '');
assert.equal(durationLabel.hidden, true);
let liveNotices = '';
const noticeState = { answer: {}, timeline: { insertAdjacentHTML(where, html) { liveNotices += html; } } };
ui.appendLiveNotice(noticeState, { type: 'error', text: '连接失败' });
ui.appendLiveNotice(noticeState, { type: 'stopped' });
assert(liveNotices.includes('连接失败') && liveNotices.includes('已停止') && !liveNotices.includes('turn-activity') && noticeState.answer === null,
  'live errors and stop notices stay outside any process disclosure');
let hydrated = '';
const lazyKey = /data-lazy-step="(\d+)"/.exec(narrative)[1];
const lazyStep = { dataset: { lazyStep: lazyKey }, querySelector: () => null, insertAdjacentHTML(where, html) { hydrated += html; } };
ui.hydrateActivity(lazyStep); ui.hydrateActivity(lazyStep);
assert(hydrated.includes('result') && ui.pendingActivities.size === 0, 'a step hydrates exactly once');
const thoughtBody = { textContent: '' }, thoughtSummary = { textContent: '', classList: { remove() {} } };
const countLabel = { textContent: '' }, stateLabel = { textContent: '' }, flags = new Set(['activity-live']);
const completedGroup = { open: true, dataset:{}, classList:{toggle(){}}, toggleAttribute(){}, querySelector: selector => selector === ':scope > summary' ? null : selector === '.tool-group-body'
  ? { children: [{ _activityBlock: { type: 'tool', name: 'Read', status: 'done' } }] } : { innerHTML: '' } };
const activity = { open: true, dataset:{}, toggleAttribute(){}, classList: { contains: name => flags.has(name), remove: name => flags.delete(name) },
  querySelector: selector => selector === ':scope > summary' ? null : selector === '.activity-count' ? countLabel : selector === '.turn-process' ? { childElementCount: 2 } : selector === '.activity-duration' ? durationLabel : stateLabel,
  querySelectorAll: selector => selector === '.step-tool' ? [{}] : selector === '.step-think' ? [thought] : selector === '.tool-group' ? [completedGroup] : [],
};
const thought = { open: true, dataset: { state: 'running' }, classList: { remove() {} },
  closest: selector => selector === '.turn-activity' ? activity : null, querySelector: selector => selector === '.think-body' ? thoughtBody : selector === '.st-sum' ? thoughtSummary : { remove() {} },
};
const streamingState = { thinkBlk: thought, thinkBuf: '只有增量，没有最终思考事件。', el: { querySelectorAll: () => [activity] } };
ui.settleStreamActivities(streamingState);
assert.equal(thought._thinkingText, '只有增量，没有最终思考事件。', 'completion retains delta-only reasoning for the next expansion');
assert.equal(thoughtBody.textContent, '', 'completion does not force materialization of a closed thought');
assert(!activity.open && !flags.has('activity-live'), 'completion closes the whole process before any history reload');
assert(!completedGroup.open, 'completion closes the live tool group together with the outer process');
assert.equal(stateLabel.textContent, '已完成');
assert.equal(countLabel.textContent, '1 次工具调用 · 1 组思考');
assert.equal(streamingState.thinkBuf, '');
const longThought = '长思考内容 <script> 不作为代码执行。\n'.repeat(40000);
const longReader = ui.thinkingPanelHtml(longThought);
assert(longReader.includes('&lt;script&gt;') && !longReader.includes('<script>'), 'complete inline reasoning remains escaped');
assert(!longReader.includes('data-think-more') && !longReader.includes('收起执行过程'), 'reasoning has neither a read-more control nor a separate process-close footer');
const longRunning = ui.stepBlockHtml({type:'think',text:longThought,status:'running'});
assert(!longRunning.includes('think-body') && longRunning.length < 1000, 'a closed running thought does not mount a huge text node');
const runningKey = /data-lazy-step="(\d+)"/.exec(longRunning)[1];
const deferred = {dataset:{lazyStep:runningKey},querySelector:()=>null,insertAdjacentHTML(where,html){this.html=html;}};
ui.setThinkingSource(deferred,longThought+'最新增量');
ui.hydrateActivity(deferred);
assert.equal(deferred._thinkingText,longThought+'最新增量','a deferred stream opens the newest complete reasoning, not its first snapshot');
assert(deferred.html.includes('最新增量'), 'opening the process makes the complete latest reasoning available');
assert.equal(ui.thinkingSliceEnd('x'.repeat(11999)+'😀end',0),11999,'chunk boundaries do not split surrogate pairs');
const deferredStream={thinkBlk:{dataset:{state:'running'},isConnected:false}};
for(let i=0;i<1000;i++)ui.scheduleThinkingPaint(deferredStream);
assert.equal(scheduledThinkPaints.length,1,'a thousand stream events schedule one coalesced paint');
scheduledThinkPaints[0]();
assert.equal(deferredStream.thinkTimer,0,'a detached background thought is skipped and releases its pending paint');
const longState={thinkBlk:thought,thinkBuf:longThought,thoughtBoundary:true};
ui.finishLiveThink(longState);
assert.equal(thought._thinkingText,longThought,'finishing a long thought does not silently cut it to 4000 characters');
function readerNode() {
  return {children:[],appendChild(node){this.children.push(node);},replaceChildren(){this.children=[];},
    get lastElementChild(){return this.children.at(-1);},get firstChild(){return this.children[0];},
    get textContent(){return this.children.map(node=>node.textContent).join('');},
    set textContent(value){this.children=[{nodeType:3,textContent:value,get length(){return this.textContent.length;},appendData(value){this.textContent+=value;}}];}};
}
const readerText=readerNode();readerText.appendChild(readerNode());readerText.lastElementChild.textContent='开始。';
const readerBody={querySelector:()=>readerText,scrollTop:37,scrollHeight:800,clientHeight:320};
const readerLabel={},readerMore={};
const readerAncestor={open:true};
const readerCard={isConnected:true,dataset:{},parentElement:{closest:()=>readerAncestor},querySelector:selector=>selector==='.think-body'?readerBody:selector==='.think-length'?readerLabel:readerMore};
ui.setThinkingSource(readerCard,'开始。'+longThought);
ui.syncThinkingView(readerCard);
assert.equal(readerText.textContent,'开始。'+longThought,'opening a once-short stream exposes the complete current text');
assert.equal(readerBody.scrollTop,37,'inline rendering does not manipulate an inner scrollbar');
ui.setThinkingSource(readerCard,'开始。'+longThought+'后续增量');ui.syncThinkingView(readerCard);
assert.equal(readerBody.scrollTop,37,'stream updates cannot pull a user reading earlier reasoning to the bottom');
assert(readerText.textContent.endsWith('后续增量'),'new reasoning remains directly available without a read-more action');
readerText.replaceChildren();readerText.appendChild(readerNode());readerText.lastElementChild.textContent='开始。';
readerBody._thinkingSource='开始。';readerBody._thinkingShown=3;
ui.setThinkingSource(readerCard,'开始。'+longThought);ui.syncThinkingView(readerCard);
assert.equal(readerText.textContent,'开始。'+longThought,'a large batched delta is appended completely in layout chunks');
readerAncestor.open=false;const beforeClosed=readerText.textContent;
ui.setThinkingSource(readerCard,'替换后的思考。');ui.syncThinkingView(readerCard);
assert.equal(readerText.textContent,beforeClosed,'closed thought bodies are not repainted by stream data');
readerAncestor.open=true;ui.syncThinkingView(readerCard);
assert.equal(readerText.textContent,'替换后的思考。','reopening reconciles a changed snapshot');
const rawThoughts = [
  { type: 'think', text: '第一段', _t0: 100, _t1: 200 },
  { type: 'think', text: '第二段', _t0: 250, _t1: 500 },
  { type: 'think', text: ' \n\u200B' },
  { type: 'tool', name: 'Read' },
  { type: 'think', text: '工具后保留边界' },
  { type: 'text', text: '中间说明' },
  { type: 'think', text: '正文后保留边界', messageId: 'one' },
  { type: 'think', text: '新消息', messageId: 'two' },
];
const groupedThoughts = ui.coalesceThoughts(rawThoughts);
assert.equal(groupedThoughts.length, 6);
assert.equal(groupedThoughts[0].text, '第一段\n\n第二段', 'adjacent thoughts retain paragraphs');
assert.equal(groupedThoughts[0]._thoughtCount, 2);
assert.equal(groupedThoughts[0]._durationMs, 350, 'thinking duration excludes the gap between thoughts');
assert.equal(rawThoughts[0].text, '第一段', 'display grouping does not mutate stored history');
assert.equal(ui.coalesceThoughts([{ type: 'think', text: '累计' }, { type: 'think', text: '累计内容' }])[0].text, '累计内容', 'cumulative snapshots do not duplicate thought text');
assert(ui.isThinkingSnapshot('累计', '累计内容'));
assert(ui.isThinkingSnapshot('累计内容', '累计'));
assert(!ui.isThinkingSnapshot('第一段只有增量', '第二段完整思考'), 'a distinct next thought must not overwrite an unfinished delta-only thought');
assert.equal(ui.coalesceThoughts([{ type: 'think', text: '有消息边界', messageId: 'one' }, { type: 'think', text: '来源未知' }]).length, 2, 'unknown identity does not erase an explicit message boundary');
const withBoundary = ui.turnTimelineHtml([
  { type: 'think', text: '之前' }, { type: 'error', text: '错误' },
  { type: 'think', text: '之后' }, { type: 'text', text: '最终' }, { type: 'think', text: '尾部' },
], false, 3);
assert.equal((withBoundary.match(/class="step step-think"/g) || []).length, 3, 'visible notices and the final reply still separate thoughts');
let movedAnswer;
const answerNode = { className: 'turn-answer md-body', listenerIdentity: {} };
const processNode = { isConnected: true, appendChild(node) { movedAnswer = node; } };
const oneProcess = { process: processNode, answer: answerNode, timeline: { contains: node => node === processNode, insertAdjacentHTML() { throw Error('second process created'); } } };
assert.equal(ui.liveActivity(oneProcess), processNode);
assert.equal(movedAnswer, answerNode, 'streaming commentary moves as the same node with its listeners intact');
assert.equal(answerNode.className, 'turn-commentary md-body');
assert.equal(oneProcess.answer, null);
assert.equal(ui.liveActivity(oneProcess), processNode, 'later tools continue in the same process');
processNode.isConnected = false;
assert.equal(ui.liveActivity(oneProcess), processNode, 'a detached background reply retains its single process');
assert.equal(ui.liveActivity(oneProcess), processNode, 'repeated background tools cannot create extra process fragments before reattachment');
const separatedTools = ui.activityHtml([
  { type: 'text', text: '先核对。' },
  { type: 'tool', name: 'Read' }, { type: 'think', text: '检查结果。' }, { type: 'tool', name: 'Bash' },
  { type: 'text', text: '继续修改。' },
  { type: 'tool', name: 'Edit', detail: JSON.stringify({ old_string: 'a\n', new_string: 'b\nc\n' }), status: 'done' },
  { type: 'tool', name: 'Write', detail: JSON.stringify({ content: 'one\ntwo\n' }), status: 'done' },
], true, true);
assert.equal((separatedTools.match(/class="tool-group"/g) || []).length, 2, 'narrative separates consecutive tool runs without adding turn cards');
assert.equal((separatedTools.match(/class="turn-activity/g) || []).length, 1);
assert.equal((separatedTools.match(/class="tool-group" open/g) || []).length, 2, 'running tool groups open beneath the live process');
assert(!/class="step step-tool[^>]* open/.test(ui.activityHtml([{ type: 'tool', name: 'Read' }], false, true)), 'opening a live group does not expand individual command bodies');
assert(!/class="tool-group"[^>]* open/.test(ui.activityHtml([{ type: 'tool', name: 'Read', status: 'done' }], true)), 'completed groups stay closed independently of the legacy preference');
assert(separatedTools.includes('读取 1 · 运行命令 1 · 思考 1 组') && separatedTools.includes('编辑 1 · 写入 1'));
assert(!separatedTools.includes('tool-group-change'), 'compact group captions do not add a competing cumulative file total');
const closedRunBody = { children: [], insertAdjacentHTML() { const step = {}; this.children.push(step); this.lastElementChild = step; } };
const closedRun = { open: false, classList: { contains: name => name === 'tool-group',toggle(){} }, querySelector: selector => selector === '.tool-group-body' ? closedRunBody : { innerHTML: '' } };
const preservedRun = { process: { lastElementChild: closedRun, closest: () => null, insertAdjacentHTML() { throw Error('existing group replaced'); } } };
ui.appendLiveStep(preservedRun, '<details></details>', { type: 'tool', name: 'Read', status: 'done' });
ui.appendLiveStep(preservedRun, '<details></details>', { type: 'tool', name: 'Bash', status: 'running' });
assert(!closedRun.open && closedRunBody.children.length === 2, 'streaming new steps into a manually closed group preserves its disclosure and existing nodes');
const groupInfo = ui.toolGroupInfo([
  { type: 'tool', name: 'Edit', status: 'error', detail: '{"old_string":"a","new_string":"b"}' },
  { type: 'tool', name: 'Edit', status: 'running', detail: '{"old_string":"a","new_string":"b"}' },
]);
assert.equal(groupInfo.errors, 1); assert.equal(groupInfo.running, 1);
assert.equal(groupInfo.stats, null, 'failed and in-progress edits never add to successful change totals');
const compactSummary = ui.toolGroupSummaryHtml(groupInfo);
assert(compactSummary.includes('tool-group-count">2') && compactSummary.includes('失败 1') && compactSummary.includes('进行中'), 'a compact total retains both pending and failed states');
assert(separatedTools.includes('aria-label="记录分类"'), 'operation categories remain available below the opened group');
for (const [blocks,label,count,unit] of [
  [[{type:'tool',name:'Bash'}],'运行命令',1,'次'],
  [[{type:'tool',name:'Read'},{type:'tool',name:'Read'}],'读取',2,'次'],
  [[{type:'think',text:'核对中。'}],'思考',1,'组'],
  [[{type:'stderr',text:'CLI notice'}],'CLI 输出',1,'条'],
]) {
  const info=ui.toolGroupInfo(blocks);
  assert(info.categories.some(item=>item.label===label&&item.count===count&&item.unit===unit),'the model retains each actual category and count');
  assert.equal(ui.toolGroupBreakdownHtml(info),'','a single category does not duplicate the summary or add another divider');
  assert(ui.toolGroupSummaryHtml(info).includes(`tool-group-count">${count} `),'the group summary retains the actual count');
}
const mixedCategories=ui.toolGroupBreakdownHtml(ui.toolGroupInfo([
  ...Array.from({length:6},()=>({type:'tool',name:'Bash'})),
  ...Array.from({length:4},()=>({type:'tool',name:'OtherTool'})),
  {type:'think',text:'核对中。'},{type:'stderr',text:'notice'},
]));
assert.equal((mixedCategories.match(/role="listitem"/g)||[]).length,4,'all nonzero categories use the same icon, label and count layout');
assert(mixedCategories.includes('<b>6</b><span>次</span>')&&mixedCategories.includes('<b>4</b><span>次</span>'));
assert.equal(ui.toolGroupBreakdownHtml(ui.toolGroupInfo([])),'','an empty group never invents zero-count categories');
const thoughtOnly = ui.toolGroupSummaryHtml(ui.toolGroupInfo([{ type: 'think', text: '核对中。' }]));
assert(thoughtOnly.includes('执行记录') && !thoughtOnly.includes('工具调用'), 'reasoning-only groups use the common execution record without claiming a real tool call');
const inlineThoughts = ui.processContentHtml([{type:'think',text:'直接显示的思考'}]);
assert(inlineThoughts.includes('class="tool-group"')&&inlineThoughts.includes('<details class="step step-think"')&&inlineThoughts.includes('data-expansion-level="3"')&&!/<details class="step step-think"[^>]* open/.test(inlineThoughts), 'thought-only history stays inside the common tool group and collapsed call');
assert.equal((ui.processContentHtml([{ type: 'tool', name: 'Read' }, { type: 'answer-boundary' }, { type: 'tool', name: 'Read' }]).match(/class="tool-group"/g) || []).length, 2, 'a final reply boundary cannot join unrelated tool runs');
const attachments = vm.runInNewContext(
  source(app, 'function conversationPref(', '\nfunction disclosureOpen(') +
  source(app, 'function fileParentPath(', '\nconst fileOperationStatsCache') +
  source(app, 'function messageImageUrls(', '\nfunction pagesRowHtml(') +
  ';({fileParentPath,artifactRowHtml,replyImagesHtml,messageImageUrls,imagesHtml})', {
    S: context.S, esc, window: context.window, previewDisplayPath:p=>p, FILE_PREVIEW_EXT: /\.(css|js|md|png)$/i, IMAGE_PREVIEW_EXT: /\.png$/i,
    baseName: p => p.split('/').at(-1), fileIconHtml: () => '<svg></svg>',
    artifactImageHtml: p => `<button class="artifact-image" data-imgfile="${esc(p)}"><img data-artifact-src="fixture"></button>`,
    isSafeImageUrl: url => /^\/uploads\/[a-z0-9.-]+$/i.test(url), assetUrl: url => url,
  });
const files = attachments.artifactRowHtml(['src/a.css', 'src/b.js', 'docs/readme.md', 'shot.png', 'a"<bad>.js']);
assert(files.startsWith('<details class="artifact-row"') && files.includes('<summary class="artifact-title">') && /^<details[^>]*\bopen\b/.test(files), 'referenced files have one native disclosure, open by default and manually collapsible');
assert.equal((files.match(/data-artifact-extra/g) || []).length, 1, 'extra files remain available');
assert(files.includes('data-imgfile="shot.png"') && files.includes('data-fileprev="src/a.css"'), 'image and file references keep their preview actions');
assert(files.includes('artifact-image-item') && files.includes('<img data-artifact-src='), 'mentioned image paths create a lazy thumbnail, not only a file button');
assert(!files.includes('<bad>') && files.includes('&quot;&lt;bad&gt;'), 'preview paths stay escaped');
assert(!files.includes('artifact-hint'), 'file references use the compact list');
assert.equal(attachments.artifactRowHtml([]), '', 'empty references do not leave a blank section');
assert.equal(attachments.fileParentPath('src/navigation.ts'), 'src');
assert.equal(attachments.fileParentPath('guide.md'), '当前项目');
assert.equal(attachments.fileParentPath('/guide.md'), '/');
assert.equal(attachments.fileParentPath('C:\\guide.md'), 'C:\\');
const urls = ['/uploads/a.png', '/uploads/b.png', '/uploads/c.png', { url: '/uploads/d.png' }, '/uploads/a.png', 'javascript:bad'];
const gallery = attachments.replyImagesHtml(urls);
assert(gallery.includes('4 张') && (gallery.match(/hidden data-reply-image-extra/g) || []).length === 1, 'image counts include only safe, unique URLs');
assert(!gallery.includes('<details') && !gallery.includes('<summary'), 'attachment thumbnails are directly visible');
assert(!attachments.replyImagesHtml(urls, true).includes('hidden data-reply-image-extra'), 'expanded attachments can survive a streaming update');
assert(!attachments.imagesHtml(urls).includes('hidden data-reply-image-extra'), 'ordinary message and tool images retain their default visibility');
assert.equal(attachments.replyImagesHtml(['javascript:bad']), '', 'invalid images do not produce a section');
const extractPaths = vm.runInNewContext(
  source(app, 'const EXT_IMAGE =', 'function fileExt(') +
  source(app, 'function extractArtifactPaths(', 'function artifactImageHtml(') + ';extractArtifactPaths');
assert.deepEqual(Array.from(extractPaths('`src/app.css`、`src/core.js`、`docs/readme.md`')), ['src/app.css', 'src/core.js', 'docs/readme.md'], 'adjacent Markdown references do not create a fake extra file');
const record = require('../../lib/question-record').fromReply({
  question: true, pid: 0, questions: [{ id: 'a', question: '选择风格', header: '外观', options: ['not recorded'] }],
}, { selections: { a: ['简洁', '紧凑'] }, attachments: ['design.md'] });
assert.deepEqual(record, { requestId: '0', answers: [{ header: '外观', question: '选择风格', answer: '简洁、紧凑' }], attachments: ['design.md'] });
assert.equal(require('../../lib/question-record').fromReply({ question: true }, { action: 'deny' }), null, 'rejected answers are not recorded as submitted');
assert.deepEqual(require('../../lib/question-record').fromReply({ question: true, pid: 'malformed', input: { questions: 'invalid' } },
  { freeText: '可继续回复' }).answers, [{ header: '', question: '回复', answer: '可继续回复' }], 'malformed native question lists cannot break a successful response');
const receipt = ui.questionRecordHtml({ ...record, answers: [{ question: '<script>', answer: '<img onerror="bad">' }] });
assert(receipt.includes('&lt;img') && !receipt.includes('<img'), 'answer records escape user text');
assert(!receipt.includes(' open'), 'answered questions default to one compact summary');
const plan = vm.runInNewContext(source(app, 'function planProgressState(', '\n// 可预览') + ';planCardHtml', context);
const planHtml = plan({ todos: [{ text: '验证', status: 'in_progress' }, { text: '完成', status: 'completed' }] });
assert(planHtml.includes(' open') && planHtml.includes('aria-valuenow="1"'), 'unfinished plans show progress and their current step');
assert(planHtml.includes('data-plan-action="review"') && planHtml.includes('data-plan-action="download"'), 'plan save/implementation/download stay available');
const documentLink = plan({ plan: '# 布局方案\n\n正文应在侧栏阅读。\n\n<script>bad</script>' });
assert(documentLink.includes('data-plan-action="open"') && !documentLink.includes('<details') && !documentLink.includes('<script>'), 'plan documents use a safe compact sidebar entry without another inline disclosure');
const planState = { review: { tabs: [], tabSeq: 0 } }, activated = [];
const openPlan = vm.runInNewContext(source(app, 'function openReviewPlanDocument(', '\nfunction closeReviewPanel(') + ';openReviewPlanDocument', {
  S: planState, $: () => ({}), resetReviewTabsForSession() {}, activateReviewTab: id => activated.push(id),
  ensureReviewTab(mode, path) { const tab = { id: 'plan-' + (++planState.review.tabSeq), mode, path }; planState.review.tabs.push(tab); return tab; },
});
openPlan({ sessionId: 'source-a', title: '方案', body: '# 方案' });
openPlan({ sessionId: 'source-a', title: '方案', body: '# 方案' });
assert.equal(planState.review.tabs.length, 1, 'reopening the same source plan reuses its tab');
assert.equal(planState.review.tabs[0].path, '', 'virtual plan content can never become a local or remote filesystem path');
openPlan({ sessionId: 'source-b', title: '方案', body: '# 方案' });
assert.equal(planState.review.tabs.length, 2, 'plans from different source sessions retain their own identity');

const paneEvents = [];
const pane = vm.runInNewContext(source(app, 'function showReviewPanel(', '\nfunction ensureReviewTab(') + ';showReviewPanel', {
  S: { review: { open: false } }, window: { AgentHubFeatures: { suspendBrowser: () => paneEvents.push('browser-suspended') } },
  $: selector => selector === '#reviewPanel' ? { classList: { remove: () => paneEvents.push('files-visible') } } : { classList: { add() {} } },
  setReviewMaximized() {}, syncReviewWidth() {}, syncReviewWorkspaceLayout() {}, syncTermReviewLayout() {},
});
assert(pane());
assert.deepEqual(paneEvents, ['browser-suspended', 'files-visible'], 'hidden browser frames and leases are suspended before switching documents');
const browserWorkspace = fs.readFileSync(path.resolve(__dirname, '../../public/browser-workspace.js'), 'utf8');
const browserState = { review: { tabs: [{id:'saved-file', mode:'edit',path:'/file.js'}] } };let activatedBrowser='';
const showBrowser = vm.runInNewContext(source(browserWorkspace, '  async function sharedBrowser(', '\n  async function openBrowserPage(') + ';sharedBrowser', {
  curSession: () => ({id:'current'}), S: browserState, $: () => ({classList:{contains:()=>true}}), resetReviewTabsForSession() {}, crypto:{randomUUID:()=> 'fixture'},
  ensureReviewTab(mode){const tab={id:'browser-tab',mode};browserState.review.tabs.push(tab);return tab;}, activateReviewTab:id=>{activatedBrowser=id;},
});
showBrowser({newTab:true});showBrowser();
assert.equal(browserState.review.tabs.length,2,'opening the browser retains files and reuses its existing tab');
assert.equal(activatedBrowser,'browser-tab');assert.equal(browserState.review.tabs[0].mode,'edit');
const explorerState = { review: { open: true, activeTabId: 'plan', tabs: [{ id: 'plan', mode: 'plan' }, { id: 'blank', mode: 'blank' }] } };
let explorerTab = '', explorerShown = false;
const openFiles = vm.runInNewContext(source(app, 'function openWorkspaceFilesTab(', '\nfunction wsRowHtml(') + ';openWorkspaceFilesTab', {
  S: explorerState, wsSessionId: () => 'session', resetReviewTabsForSession() {}, reviewLayout: 'explorer',
  ensureReviewTab:()=>({id:'files'}), activateReviewTab: id => { explorerTab = id; }, setReviewExplorerOpen: value => { explorerShown = value; },
  createBlankReviewTab() { throw Error('existing blank tab discarded'); },
});
openFiles();
assert.equal(explorerTab, 'files'); assert(explorerShown, 'the Files action can reveal the explorer while a plan is selected');
const savedEditorTab = { id: 'new-editor', mode: 'edit', path: '/new/workspace.js' };
const restorePaneState = { review: { sessionId: 'old-project', tabs: [], activeTabId: '', mode: '', open: false } };
const restoredProjectCache = new Map([['new-project', { tabs: [savedEditorTab], activeTabId: savedEditorTab.id, lastTabId: savedEditorTab.id, tabSeq: 1, open: true,
  files: { root: '/new', entries: [], children: new Map(), expanded: new Set() }, editors: new Map([['/new/workspace.js', { dirty: true, value: 'unsaved' }]]) }]]);
const restoreProject = vm.runInNewContext(source(app, 'function persistReviewTab(', '\nfunction resetReviewTabsForSession(')
  + source(app, 'function resetReviewTabsForSession(', '\n// 右侧预览/审查面板支持拖动调宽。') + ';({resetReviewTabsForSession,persistReviewTab})', {
  S: restorePaneState, projectReviewCache: restoredProjectCache, reviewProjectKey: () => 'new-project',
  wsFiles: { children: new Map(), childRequests: new Map(), expanded: new Set(), seq: 0, sessionSeq: 0, findSeq: 0 }, wsEditors: new Map(),
  closeReviewPanel() { restorePaneState.review.mode = ''; restorePaneState.review.path = ''; restorePaneState.review.activeTabId = ''; },
  stopPreviewWatch() {}, clearTimeout() {},
});
assert(restoreProject.resetReviewTabsForSession());
restoreProject.persistReviewTab();
assert.equal(savedEditorTab.mode, 'edit', 'restoring a project cannot persist the hidden pane blank mode over the saved editor');
assert.equal(savedEditorTab.path, '/new/workspace.js');
assert.equal(restorePaneState.review.open, false, 'cached document metadata is restored without displaying the pane over a task browser');

// Exercise native item boundaries, including a final turn snapshot repeated after item/completed.
const codex = fs.readFileSync(path.resolve(__dirname, '../../lib/codex-bridge.js'), 'utf8');
const received = [];
const native = vm.runInNewContext(
  source(codex, 'function flushAgentMessage(', '\nfunction usageFrom(') +
  source(codex, 'function handleNotification(', '\nfunction handleLine(') + ';({handleNotification,flushAgentMessage})', {
    itemKind: item => item?.type, toolStarted: (s, item) => { if (item?.type === 'commandExecution') s.emitter({ kind: 'tool', id: item.id }); },
    toolCompleted() {}, setTimeout() { return null; }, clearTimeout() {}, REQUEST_SETTLE_MS: 80,
  });
const state = { turnText: '', activeMessageId: '', deliveredMessages: new Set(), completedItems: [], emitter: ev => received.push(ev) };
const notify = (method, params) => native.handleNotification(state, { method, params });
notify('item/agentMessage/delta', { itemId: 'comment', delta: '先检查。' });
notify('item/completed', { item: { type: 'agentMessage', id: 'comment', text: '先检查。' } });
notify('item/started', { item: { type: 'commandExecution', id: 'tool' } });
notify('item/agentMessage/delta', { itemId: 'answer', delta: '已修复。' });
notify('item/completed', { item: { type: 'agentMessage', id: 'answer', text: '已修复。' } });
native.flushAgentMessage(state, { id: 'comment', text: '先检查。' });
native.flushAgentMessage(state, { id: 'answer', text: '已修复。' });
assert.deepEqual(received.filter(ev => ev.kind !== 'delta').map(ev => ev.kind === 'tool' ? 'tool' : ev.text), ['先检查。', 'tool', '已修复。'], 'commentary is completed before the tool and never repeated by turn snapshots');
notify('item/agentMessage/delta', { itemId: 'only-delta', delta: '未提供 completed 的兼容消息。' });
notify('item/started', { item: { type: 'commandExecution', id: 'next-tool' } });
assert.equal(received.at(-2).kind, 'text', 'a missing completion event cannot hide an explanation behind the next tool');

// Reparenting must use the same terminal node, preserving terminal input and PTY identity.
const classes = initial => {
  const set = new Set(initial || []);
  return { contains: n => set.has(n), toggle(n, yes) { if (yes) set.add(n); else set.delete(n); } };
};
const main = { classList: classes(['review-open']), style: { setProperty() {}, removeProperty() {} }, clientWidth: 1280,
  insertBefore(node) { node.parentElement = this; } };
const terminalHome = { insertBefore(node) { node.parentElement = this; } };
const review = { parentElement: terminalHome, classList: classes(['ah-max']), appendChild(node) { node.parentElement = this; }, offsetWidth: 1280 };
const terminal = { classList: classes(), parentElement: terminalHome, offsetHeight: 300, scrollback: 'preserved' };
const toggle = { setAttribute() {} };
const layout = vm.runInNewContext(source(app, 'function syncTermReviewLayout(', '\nfunction hideTermPanel(') + ';syncTermReviewLayout', {
  document: { getElementById: id => ({ main, reviewPanel: review, termPanel: terminal, reviewTerminal: toggle })[id] },
  window: { innerWidth: 1280 }, S: { readOnly: false }, scheduleTermRefit() {}, parseFloat,
  getComputedStyle: () => ({ getPropertyValue: () => '620' }),
});
layout(); assert.equal(terminal.parentElement, review, 'maximized files host the original terminal node');
review.classList.toggle('ah-max', false); layout();
assert.equal(terminal.parentElement, terminalHome, 'restoring files returns the same terminal to its actual content wrapper');
assert.equal(terminal.scrollback, 'preserved');
// Configured expansion is shared by history and real live rendering, not just
// the settings form. Completion has its own rule instead of reusing history.
conversationPreferences.save({...conversationPreferences.defaults,historyDepth:'3'});
const detailedHistory=ui.activityHtml([{type:'tool',name:'Read',output:'long result\n'.repeat(500)},{type:'think',text:'展开思考'}]);
assert(/class="turn-activity" open/.test(detailedHistory)&&/class="tool-group" open/.test(detailedHistory)&&/class="step step-tool" open/.test(detailedHistory));
assert(detailedHistory.includes('<details class="step step-think" open')&&detailedHistory.includes('long result'),'third-level history opens and hydrates actual tool content');
conversationPreferences.save({...conversationPreferences.defaults,processFold:false,groupFold:false,toolFold:false});
const flatHistory=ui.activityHtml([{type:'tool',name:'Read'},{type:'think',text:'可选择隐藏的思考'}]);
assert.equal((flatHistory.match(/data-fixed-open/g)||[]).length,4,'the process, group, tool and reasoning all follow common fixed-open rules');
assert(flatHistory.includes('aria-disabled="true" tabindex="-1"')&&/class="step step-think" open/.test(flatHistory)&&!/<details class="step step-think"[^>]* hidden/.test(flatHistory));
conversationPreferences.save({...conversationPreferences.defaults,completedDepth:'1'});
activity.open=true;completedGroup.open=true;ui.settleStreamActivities({el:{querySelectorAll:()=>[activity]}});
assert(activity.open&&!completedGroup.open,'completed depth one keeps only the process open');
conversationPreferences.save({...conversationPreferences.defaults,completedDepth:'keep'});
activity.open=true;completedGroup.open=false;ui.settleStreamActivities({el:{querySelectorAll:()=>[activity]}});
assert(activity.open&&!completedGroup.open,'keep mode retains distinct parent and group choices');
conversationPreferences.save({});
console.log('[conversation-controls] compact tool runs, accurate group totals, single turn process, thought boundaries, lazy steps, records, plan actions, Codex boundaries and terminal identity passed');
