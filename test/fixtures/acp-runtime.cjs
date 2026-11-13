if(process.argv.includes('--help')){process.stdout.write('Fixture supports --acp and --experimental-acp\n');process.exit(0);}
const fs = require('fs');
const readline = require('readline');
const report = process.argv[2];
if(report&&process.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE==='1')fs.appendFileSync(report,JSON.stringify({event:'desktop-lite-bundle',enabled:true})+'\n');
const path = require('path');
let nextClientId = 500, sessionCwd = '';
const clientPending = new Map();
function requestClient(method, params) {
  const id = nextClientId++;
  return new Promise((resolve, reject) => { clientPending.set(id, { resolve, reject }); out({ jsonrpc: '2.0', id, method, params }); });
}
async function runClientTools(msg) {
  const sessionId = msg.params.sessionId, file = path.join(sessionCwd, 'client-edit.txt');
  const update = value => out({ method: 'session/update', params: { sessionId, update: value } });
  const input = { path: file, content: 'after\n' };
  update({ sessionUpdate: 'tool_call', toolCallId: 'edit-1', kind: 'edit', title: '更新示例文件', rawInput: input, locations: [{ path: file }], status: 'in_progress' });
  const read = await requestClient('fs/read_text_file', { sessionId, path: file });
  if (read.content !== 'before\n') throw Error('read mismatch');
  let failure;
  try { await requestClient('fs/read_text_file', { sessionId: 'another-session', path: file }); } catch (error) { failure = error; }
  if (failure?.code !== -32602) throw Error('session ownership not checked');
  failure = null;
  try { await requestClient('unsupported/method', { sessionId }); } catch (error) { failure = error; }
  if (failure?.code !== -32601) throw Error('unsupported method silently accepted');
  const approval = await requestClient('session/request_permission', { sessionId, toolCall: { toolCallId: 'edit-1' }, options: [{ optionId: 'yes', name: 'Allow once', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] });
  if (approval.outcome.optionId !== 'yes') throw Error('expected approval');
  await requestClient('fs/write_text_file', { sessionId, ...input });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: 'completed', content: [{ type: 'diff', path: file, oldText: 'before\n', newText: 'after\n' }, { type: 'content', content: { type: 'text', text: '已保存文件' } }] });
  const terminal = await requestClient('terminal/create', { sessionId, command: process.execPath, args: ['-e', 'process.stdout.write("ACP terminal ✓")'], cwd: sessionCwd });
  update({ sessionUpdate: 'tool_call', toolCallId: 'cmd-1', title: '运行验证命令', kind: 'execute', rawInput: { command: process.execPath }, status: 'in_progress', content: [{ type: 'terminal', terminalId: terminal.terminalId }] });
  const status = await requestClient('terminal/wait_for_exit', { sessionId, ...terminal });
  if (status.exitCode !== 0) throw Error('terminal did not complete');
  const output = await requestClient('terminal/output', { sessionId, ...terminal });
  if (!output.output.includes('ACP terminal ✓')) throw Error('terminal output lost');
  await requestClient('terminal/release', { sessionId, ...terminal });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd-1', status: 'completed' });
  update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Reasoning '.repeat(600) } });
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'CLIENT TOOLS OK' } });
  out({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
}
function out(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
const modes = { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }] };
if(process.argv.includes('--modern-modes')){modes.availableModes=[];delete modes.currentModeId;}
const models = { currentModelId: 'model-a', availableModels: [{ modelId: 'model-a', name: 'A' }, { modelId: 'model-b', name: 'B' }] };
const configOptions = [{ id: 'effort', name: 'Effort', type: 'select', category: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }];
if(process.argv.includes('--modern-modes'))configOptions.push({id:'mode-choice',name:'Mode',type:'select',category:'mode',currentValue:'agent',options:[{value:'agent',name:'Agent'},{value:'plan',name:'Plan'},{value:'yolo',name:'Full access'}]});
if(process.argv.includes('--uncategorized-controls'))for(const option of configOptions){delete option.category;if(option.id==='mode-choice')option.id='mode';}
if(process.argv.includes('--modern-models')){
  models.availableModels=[];
  configOptions.push({id:'model-option',name:'Model',type:'select',category:'model',currentValue:'modern-a',options:[{value:'modern-a',name:'Modern A'},{group:'Other',options:[{value:'modern-b',name:'Modern B'}]}]});
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (report) fs.appendFileSync(report, JSON.stringify(msg) + '\n');
  if (clientPending.has(msg.id) && !msg.method) { const item = clientPending.get(msg.id); clientPending.delete(msg.id); msg.error ? item.reject(msg.error) : item.resolve(msg.result); return; }
  if (msg.method === 'session/prompt' && msg.params.prompt.some(block => block.text === 'client-tools')) {
    runClientTools(msg).catch(error => out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: error.message } })); return;
  }
  let result = {};
  if (msg.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } }, authMethods: [] };
  if (msg.method === 'session/new') {
    sessionCwd = msg.params.cwd;
    result = { sessionId: 'acp-session-fixture', modes, models, configOptions };
    out({ method: 'session/update', params: { sessionId: result.sessionId, update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'explain', description: 'Explain code' }] } } });
  }
  if (msg.method === 'session/load') {
    result = { modes, models, configOptions };
    out({ method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD HISTORY' } } } });
  }
  if (msg.method === 'session/set_model') models.currentModelId = msg.params.modelId;
  if (msg.method === 'session/set_mode') modes.currentModeId = msg.params.modeId;
  if (msg.method === 'session/set_config_option') { const option=configOptions.find(item=>item.id===msg.params.configId);if(option)option.currentValue = msg.params.value; result = { configOptions }; }
  if (msg.method === 'session/prompt') out({ method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP OK' } } } });
  if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, result });
});
