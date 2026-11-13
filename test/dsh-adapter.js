'use strict';
const assert = require('node:assert/strict');
const { makeDshParser } = require('../lib/dsh-parser');
const { DEFS } = require('../lib/agents');
const { makeClaudeParser } = require('../lib/claude-parser');

const events = [];
const parse = makeDshParser(event => events.push(event));
for (const line of [
  { type: 'session', sessionId: 'session-test', cwd: 'C:/agent' },
  { type: 'thinking', text: '分析' },
  { type: 'tool_call', callId: 'call-1', tool: 'Read', input: { path: 'README.md' } },
  { type: 'tool_result', callId: 'call-1', status: 'completed', result: '内容' },
  { type: 'status', phase: 'step_end', usage: { inputTokens: 9, outputTokens: 4, cacheReadTokens: 2 } },
  { type: 'text', text: '完成' },
  { type: 'final', text: '完成' },
].map(JSON.stringify)) parse(line);
assert.equal(DEFS.dsh.style, 'dsh');
assert.deepEqual(events.map(e => e.kind), ['session', 'think', 'tool', 'tooloutput', 'usage', 'text']);
assert.deepEqual(events[4].usage, { input: 9, output: 4, cacheRead: 2, cacheCreate: 0 });
assert.equal(events[2].detail, '{"path":"README.md"}');
parse(JSON.stringify({ type: 'status', phase: 'turn_end', reason: { kind: 'error', error: { message: 'missing credential' } } }));
assert.match(events.at(-1).text, /missing credential/);
console.log('[dsh-adapter] event mapping and final dedup passed');

function rendered(records) {
  const output = [];
  const consume = makeDshParser(e => { if (e.kind === 'text') output.push(e.text); });
  records.forEach(e => consume(JSON.stringify(e)));
  return output.join('');
}
assert.equal(rendered([
  { type: 'text', text: '第一段' }, { type: 'text', text: '第二段' },
  { type: 'final', text: '第一段第二段' }, { type: 'final', text: '第一段第二段' },
]), '第一段第二段');
assert.equal(rendered([
  { type: 'text', text: '长回复前缀', truncated: true },
  { type: 'final', text: '长回复前缀和剩余内容' },
]), '长回复前缀和剩余内容');
assert.equal(rendered([
  { type: 'text', text: '完成' }, { type: 'status', phase: 'step_start' },
  { type: 'final', text: '完成' },
]), '完成完成');
console.log('[dsh-adapter] multi-block final, long reply suffix and step boundaries passed');

const claudeEvents = [];
const claude = makeClaudeParser(e => claudeEvents.push(e));
const sendClaude = (type, content) => claude(JSON.stringify({ type, message: { content } }));
sendClaude('assistant', [{ type:'tool_use', id:'write-ok', name:'Write', input:{file_path:'ok.md',content:'ok'} }]);
sendClaude('assistant', [{ type:'tool_use', id:'write-failed', name:'Write', input:{file_path:'failed.md',content:'bad'} }]);
assert.equal(claudeEvents.filter(e=>e.kind==='files').length, 0, 'pending writes must not be reported as completed');
sendClaude('user', [{ type:'tool_result', tool_use_id:'write-failed', is_error:true, content:'denied' }]);
assert.equal(claudeEvents.filter(e=>e.kind==='files').length, 0, 'failed writes must not be recorded as edits');
sendClaude('user', [{ type:'tool_result', tool_use_id:'write-ok', content:'created' }]);
assert.deepEqual(claudeEvents.filter(e=>e.kind==='files').flatMap(e=>e.files).map(f=>f.path), ['ok.md']);
console.log('[dsh-adapter] only successful Claude file writes are recorded');

const nativeModels=require('../lib/agent-models');
const catalog=nativeModels.dshCatalog(`
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config: {provider: route-a, model: native/model-a}
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      route-a: {apiKeyEnv: PRIVATE_REFERENCE, models: [{id: native/model-a, name: Model A}]}
      route-b: {models: [{id: native/model-a, name: Model A elsewhere}]}
- id: inert-expression
  config: {value: !!js process.exit(99)}
`);
assert.equal(catalog.models.length,2);assert.equal(catalog.models[0].id,'route-a/native/model-a');
assert(!JSON.stringify(catalog).includes('PRIVATE_REFERENCE'),'native catalogs never return credential references');
assert.deepEqual(JSON.parse(nativeModels.dshPatch('route-b/native/model-a'))[0].config,{provider:'route-b',model:'native/model-a'});
const sharedPatch=JSON.parse(nativeModels.dshPatch('shared-model',{baseUrl:'https://api.example.test/v1',apiKey:'test-secret',protocol:'openai'}));
assert.equal(sharedPatch[0].config.providers.agenthub.baseURL,'https://api.example.test/v1');
assert.equal(sharedPatch[0].config.providers.agenthub.api,'openai-completions');
assert(!JSON.stringify(sharedPatch).includes('test-secret'),'DSH overlays use an environment reference instead of persisting the API key');
assert.deepEqual(nativeModels.dshArgs({cliSessionId:'resume-me',dshPatchFile:'/tmp/session.json'}),['headless','--patch','/tmp/session.json','--json','--session-id','resume-me','-']);
assert.throws(()=>nativeModels.dshSelection('missing-provider'),/提供方/);
console.log('[dsh-adapter] native catalogs, shared API overlays and resumed model arguments passed');

assert.deepEqual(nativeModels.dshArgs({dshPermission:'read-only'}),['headless','--json','--permission-mode','read-only','--approval-policy','never','-']);
assert.deepEqual(nativeModels.dshArgs({dshPermission:'default'}),['headless','--json','-']);
assert.throws(()=>nativeModels.dshArgs({dshPermission:'auto'}),/预设/);
const highPatch=JSON.parse(nativeModels.dshPatch('reasoner',{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai'},'high'));
assert.equal(highPatch[1].config.reasoningEffort,'high');assert.equal(highPatch[0].config.providers['agenthub-high'].models[0].reasoningEfforts.high,'high');
const ultraPatch=JSON.parse(nativeModels.dshPatch('reasoner',{baseUrl:'http://127.0.0.1:1/v1',protocol:'openai'},'ultra'));
assert.equal(ultraPatch[1].config.reasoningEffort,'max');assert.equal(ultraPatch[0].config.providers['agenthub-ultra'].models[0].reasoningEfforts.max,'ultra');
assert.notEqual(highPatch[1].config.provider,sharedPatch[1].config.provider,'resetting effort uses a new route so resumed headless runs cannot reuse stale effort');
console.log('[dsh-adapter] native permission flags and reasoning selection/wire mapping passed');

const nativeProfile=JSON.stringify([{id:'agent-default-model',config:{provider:'native',model:'reasoner'}},{id:'llm-pi-ai',name:'@deepseek-ai/dsh-llm-pi-ai',config:{providers:{native:{api:'openai-completions',apiKeyEnv:'NATIVE_AUTH_REF',baseURL:'http://127.0.0.1:1/v1',models:[{id:'reasoner',reasoningEfforts:{low:'low',high:'high'}}]}}}}]);
const nativeHigh=JSON.parse(nativeModels.dshProfilePatch(nativeProfile,'native/reasoner','high'));
const nativeDefault=JSON.parse(nativeModels.dshProfilePatch(nativeProfile,'native/reasoner',''));
assert.notEqual(nativeHigh[1].config.provider,nativeDefault[1].config.provider);assert.equal(nativeHigh[1].config.reasoningEffort,'high');
assert.equal(nativeDefault[0].config.providers[nativeDefault[1].config.provider].apiKeyEnv,'NATIVE_AUTH_REF');
assert.equal(nativeDefault[1].config.reasoningEffort,undefined);console.log('[dsh-adapter] native effort aliases preserve auth references and clear resumed strength');
