'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8');
const part = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

// A small DOM double lets these identity checks run in the ordinary Node suite.
class ViewNode {
  constructor(name, children = [], attributes = {}) {
    this.nodeName = name;
    this.nodeType = name === '#text' ? 3 : 1;
    this.childNodes = [];
    this.attributeValues = new Map(Object.entries(attributes));
    children.forEach(child => this.appendChild(child));
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get attributes() { return [...this.attributeValues].map(([name, value]) => ({ name, value })); }
  get length() { return this.data.length; }
  getAttribute(name) { return this.attributeValues.get(name) ?? null; }
  hasAttribute(name) { return this.attributeValues.has(name); }
  setAttribute(name, value) { this.attributeValues.set(name, value); }
  removeAttribute(name) { this.attributeValues.delete(name); }
  appendData(value) { this.data += value; }
  appendChild(node) {
    node.remove();
    this.childNodes.push(node);
    node.parentNode = this;
  }
  insertBefore(node, reference) {
    node.remove();
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, node);
    node.parentNode = this;
  }
  remove() {
    if (this.parentNode) {
      const siblings = this.parentNode.childNodes;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    }
  }
  replaceWith(node) {
    const parent = this.parentNode, index = parent.childNodes.indexOf(this);
    node.remove();
    parent.childNodes[index] = node;
    node.parentNode = parent;
    this.parentNode = null;
  }
  isEqualNode(other) {
    return this.nodeName === other.nodeName && this.data === other.data
      && this.attributes.length === other.attributes.length
      && this.attributes.every(attribute => other.getAttribute(attribute.name) === attribute.value)
      && this.childNodes.length === other.childNodes.length
      && this.childNodes.every((child, index) => child.isEqualNode(other.childNodes[index]));
  }
}
function text(value) {
  const node = new ViewNode('#text');
  node.data = value;
  return node;
}
const element = (name, ...children) => new ViewNode(name, children);
const patch = vm.runInNewContext(part('function patchViewChildren(', '\nfunction patchLiveMarkdown(') + ';patchViewChildren');
const originalText = text('正在输出');
const image = new ViewNode('IMG', [], { src: '/images/result.png' });
image.loaded = true;
const paragraph = element('P', originalText);
paragraph.scrollLeft = 17;
const original = element('DIV', image, paragraph);
patch(original, element('DIV', new ViewNode('IMG', [], { src: '/images/result.png' }), element('P', text('正在输出新的内容'))));
assert.equal(original.firstChild, image, 'an unchanged image is not destroyed and reloaded for every text delta');
assert.equal(original.childNodes[1], paragraph, 'streaming prose keeps its paragraph and scroll state');
assert.equal(paragraph.scrollLeft, 17);
assert.equal(paragraph.firstChild, originalText, 'an appended delta retains the same text node');
assert.equal(originalText.data, '正在输出新的内容');
patch(original, element('DIV', new ViewNode('IMG', [], { src: '/images/result.png' }), element('P', text('修正后的内容')), element('UL', element('LI', text('下一步')))));
assert.equal(paragraph.firstChild, originalText, 'a corrected text snapshot updates the retained node');
assert.equal(originalText.data, '修正后的内容');
assert.equal(original.childNodes[2].nodeName, 'UL', 'new Markdown blocks are appended');
patch(original, element('DIV', element('H2', text('变为标题'))));
assert.equal(original.firstChild.nodeName, 'H2', 'Markdown block changes replace the affected structure');
assert.equal(original.childNodes.length, 1, 'obsolete trailing Markdown blocks are removed');
const details = new ViewNode('DETAILS', [text('图表源码')], { open: '' });
const controls = element('DIV', details);
patch(controls, element('DIV', element('DETAILS', text('更新后的图表源码'))));
assert(details.hasAttribute('open'), 'a manually opened source disclosure stays open during generation');
assert.equal(details.firstChild.data, '更新后的图表源码');
const boundary = element('#comment'), frozen = element('P', text('已完成的段落'));
const currentTail = element('P', text('末尾'));
const incremental = element('DIV', frozen, boundary, currentTail);
patch(incremental, element('DIV', element('P', text('末尾正在更新'))), boundary.nextSibling);
assert.equal(incremental.firstChild, frozen, 'updates after a stream boundary never walk or replace completed blocks');
assert.equal(incremental.childNodes[2], currentTail);
incremental.insertBefore(currentTail, boundary);
assert.equal(incremental.childNodes[1], currentTail, 'promoting a completed block retains the same DOM node');

let clock = 1000, timerId = 0;
const timers = new Map(), contexts = [], paints = [];
const liveBlock = {
  live: true,
  classList: { contains() { return liveBlock.live; }, remove() { liveBlock.live = false; } },
};
const streamContext = {
  Date: { now: () => clock },
  setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
  clearTimeout(id) { timers.delete(id); },
  liveMdHtml(value, context) { contexts.push(context); return 'LIVE:' + value; },
  patchLiveMarkdown(block, html) { paints.push(html); block.rendered = html; },
  md(value, context) { contexts.push(context); return 'FINAL:' + value; },
  replaceMarkdownView(block, html) { block.rendered = html; },
  highlightIn() {}, renderMermaids() {}, followMessagesToEnd() {},
};
const renderer = vm.runInNewContext(
  part('const MD_LIVE_MS =', '\nfunction setMermaidView(')
  + part('function finishLiveText(', '\nfunction liveActivity(')
  + ';({scheduleLiveMarkdown,finishLiveText})', streamContext);
const stream = { sessionId: 'fixture', textBlk: liveBlock, textBuf: '第一段', mdTimer: 0, mdLiveAt: 995 };
renderer.scheduleLiveMarkdown(stream);
stream.textBuf += '，新的文字';
renderer.scheduleLiveMarkdown(stream);
assert.equal(timers.size, 1, 'bursts of small deltas share one pending paint');
const pending = timers.get(stream.mdTimer);
assert.equal(pending.delay, 45);
timers.delete(stream.mdTimer);
clock += pending.delay;
pending.callback();
assert.deepEqual(paints, ['LIVE:第一段，新的文字'], 'a scheduled paint uses the newest buffer');
stream.textBuf += '，最后一段';
renderer.scheduleLiveMarkdown(stream);
assert.equal(timers.get(stream.mdTimer).delay, 50, 'long responses do not acquire a 240–650ms text-length delay');
renderer.finishLiveText(stream);
assert.equal(timers.size, 0, 'completion cancels the pending paint');
assert.equal(liveBlock.rendered, 'FINAL:第一段，新的文字，最后一段', 'completion flushes the entire final buffer');
assert.equal(stream.textBlk, null);
assert.equal(liveBlock.live, false);
assert.equal(contexts[0], contexts[1], 'streaming and final Markdown share one document identity');
assert.equal(paints.at(-1), 'FINAL:第一段，新的文字，最后一段', 'completion patches retained Markdown nodes instead of replacing the subtree');

const tools = [], parseTool = require('../../lib/claude-parser').makeClaudeParser(event => tools.push(event));
const feed = event => parseTool(JSON.stringify({ type: 'stream_event', event }));
feed({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'stream-write', name: 'Write', input: {} } });
assert.equal(tools[0].kind, 'tool', 'a tool row appears at content_block_start, before its arguments are available');
assert.equal(tools[0].detail, '', 'partial arguments are never presented as valid input');
feed({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"result.txt",' } });
feed({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"content":"complete"}' } });
assert.equal(tools.length, 1, 'parameter fragments do not trigger repeated expensive tool renders');
feed({ type: 'content_block_stop', index: 1 });
assert.equal(JSON.parse(tools.at(-1).detail).content, 'complete');
assert.equal(tools.at(-1).id, tools[0].id, 'complete arguments update the same tool row');
feed({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'stream-empty', name: 'NoArgs', input: {} } });
feed({ type: 'content_block_stop', index: 2 });
assert.equal(tools.at(-1).detail, '{}', 'tools without parameter deltas still complete their input');
feed({ type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'stream-input', name: 'Read', input: { file_path: 'source.txt' } } });
feed({ type: 'content_block_stop', index: 3 });
assert.equal(JSON.parse(tools.at(-1).detail).file_path, 'source.txt', 'compatible providers can send input directly in the start event');

const mixedEvents = [], mixedParser = require('../../lib/claude-parser').makeClaudeParser(event => mixedEvents.push(event));
const mixedStream = event => mixedParser(JSON.stringify({ type: 'stream_event', event }));
const thought = '先检查启动项。', prose = '已找到相关记录，继续验证。';
mixedStream({ type: 'message_start', message: { id: 'mixed-message' } });
mixedStream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
mixedStream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thought } });
mixedStream({ type: 'content_block_stop', index: 0 });
mixedStream({ type: 'content_block_start', index: 1, content_block: { type: 'text' } });
mixedStream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: prose } });
mixedStream({ type: 'content_block_stop', index: 1 });
assert.equal(mixedEvents.at(-1).kind, 'text', 'a prose block is finalized before any following tool can move it');
mixedStream({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'mixed-tool', name: 'Read', input: {} } });
mixedStream({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":"source.txt"}' } });
mixedStream({ type: 'content_block_stop', index: 2 });
mixedParser(JSON.stringify({ type: 'assistant', message: { id: 'mixed-message', content: [
  { type: 'thinking', thinking: thought }, { type: 'text', text: prose },
  { type: 'tool_use', id: 'mixed-tool', name: 'Read', input: { file_path: 'source.txt' } },
] } }));
assert.equal(mixedEvents.filter(e => e.kind === 'text').length, 1, 'the late full assistant snapshot never duplicates earlier streamed commentary');
assert.equal(mixedEvents.filter(e => e.kind === 'think').length, 1, 'the late full assistant snapshot never inserts a repeated thought after a tool');
mixedParser(JSON.stringify({ type: 'result', result: '检查完成。' }));
assert.equal(mixedEvents.filter(e => e.kind === 'text').at(-1).text, '检查完成。', 'a distinct result after tools is still displayed');
mixedStream({ type: 'message_start', message: { id: 'next-message' } });
mixedParser(JSON.stringify({ type: 'assistant', message: { id: 'next-message', content: [{ type: 'text', text: prose }] } }));
assert.equal(mixedEvents.filter(e => e.kind === 'text' && e.text === prose).length, 2, 'identical prose from a later message is not suppressed');

// CLI snapshots can arrive for each block before its stream stop, rather than
// as one full assistant message at the end of the API request.
const interleaved = [], interleavedParser = require('../../lib/claude-parser').makeClaudeParser(e => interleaved.push(e));
const wire = e => interleavedParser(JSON.stringify({ type: 'stream_event', event: e }));
const snapshot = content => interleavedParser(JSON.stringify({ type: 'assistant', message: { id: 'interleaved', content } }));
wire({ type: 'message_start', message: { id: 'interleaved' } });
for (const [index, type, value] of [[0, 'thinking', thought], [1, 'text', prose]]) {
  wire({ type: 'content_block_start', index, content_block: { type } });
  wire({ type: 'content_block_delta', index, delta: type === 'text' ? { type: 'text_delta', text: value } : { type: 'thinking_delta', thinking: value } });
  snapshot([{ type, [type === 'text' ? 'text' : 'thinking']: value }]);
  wire({ type: 'content_block_stop', index });
}
snapshot([{ type: 'thinking', thinking: thought }, { type: 'text', text: prose }]);
wire({ type: 'message_start', message: { id: 'later' } });
snapshot([{ type: 'text', text: prose }]);
assert.equal(interleaved.filter(e => e.kind === 'think').length, 1, 'a per-block snapshot followed by stream stop and a full snapshot finalizes the thought only once');
assert.equal(interleaved.filter(e => e.kind === 'text').length, 1, 'late snapshots are matched by message identity even after the next message starts');
interleavedParser(JSON.stringify({ type: 'assistant', message: { id: 'later', content: [{ type: 'text', text: prose }] } }));
assert.equal(interleaved.filter(e => e.kind === 'text').length, 2, 'an equal answer from a distinct message is retained');
const multipart = [], multipartParser = require('../../lib/claude-parser').makeClaudeParser(e => multipart.push(e));
const partWire = e => multipartParser(JSON.stringify({ type: 'stream_event', event: e }));
partWire({ type: 'message_start', message: {} });
for (const [index, value] of ['第一段。', '第二段。'].entries()) {
  partWire({ type: 'content_block_start', index, content_block: { type: 'text' } });
  partWire({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } });
  partWire({ type: 'content_block_stop', index });
  multipartParser(JSON.stringify({ type: 'assistant', message: { id: 'late-id', content: [{ type: 'text', text: value }] } }));
}
multipartParser(JSON.stringify({ type: 'result', result: '第一段。\n\n第二段。' }));
assert.deepEqual(multipart.filter(e => e.kind === 'text').map(e => e.text), ['第一段。', '第二段。'], 'CLIs without a stream message ID and per-block snapshots retain one multipart answer without a result echo');

const aliases = [], aliasParser = require('../../lib/claude-parser').makeClaudeParser(e => aliases.push(e));
const aliasWire = event => aliasParser(JSON.stringify({ type:'stream_event',event }));
aliasWire({type:'message_start',message:{id:'api-message'}});
for (const [index,type,value] of [[0,'thinking',thought],[1,'text',prose]]) {
  aliasWire({type:'content_block_start',index,content_block:{type}});
  aliasWire({type:'content_block_delta',index,delta:type==='text'?{type:'text_delta',text:value}:{type:'thinking_delta',thinking:value}});
  aliasWire({type:'content_block_stop',index});
}
const wrapped={type:'assistant',message:{id:'cli-wrapper',content:[{type:'thinking',thinking:thought},{type:'text',text:prose}]}};
aliasParser(JSON.stringify(wrapped));aliasParser(JSON.stringify(wrapped));
assert.equal(aliases.filter(e=>e.kind==='text').length,1,'a different wrapper ID and repeated snapshots cannot duplicate streamed prose');
assert.equal(aliases.filter(e=>e.kind==='think').length,1,'a different wrapper ID cannot duplicate streamed thinking');
aliasWire({type:'message_start',message:{id:'actually-new'}});
aliasParser(JSON.stringify({type:'assistant',message:{id:'actually-new',content:[{type:'text',text:prose}]}}));
assert.equal(aliases.filter(e=>e.kind==='text').length,2,'an identical answer in a genuinely new message remains visible');

const header = { isConnected: true, children: [], appendChild(node) { this.children.push(node); } };
const startElapsed = vm.runInNewContext(part('function startElapsed(', '\n// ---------- 权限/') + ';startElapsed', {
  document: { hidden: false, createTextNode: value => ({ nodeValue: value }) },
  Date: { now: () => 2000 }, fmtDur: value => value / 1000 + ' 秒',
  setInterval: () => 1, updateActivityDuration() {}, renderStreamProgress() {}, renderLiveUsage() {},
});
startElapsed({ el: { querySelector: selector => selector === '.elapsed' ? header : null } }, 1000);
assert.equal(header.children.length, 1, 'the header contains only its elapsed time');
assert.equal(header.children[0].nodeValue, '工作中 · 1 秒');
console.log('[streaming-output] retained DOM/text/image identity, structural changes, disclosure state, coalesced paints, ordered tool starts, mixed snapshot deduplication and header cleanup passed');
