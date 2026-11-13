const readline = require('readline');
const path = require('path');
const out = message => process.stdout.write(JSON.stringify(message) + '\n');
let sid = 'fixture-zcode-session', pendingTurn;
const event = (type, payload) => out({ method: 'session/event', params: { sessionId: sid, type, payload } });
function complete() {
  event('tool.updated', { toolCallId: 'write-1', toolName: 'Write', kind: 'result', result: { output: 'file written' } });
  event('model.streaming', { kind: 'text_delta', delta: 'ZCODE FIXTURE OK' });
  event('turn.completed', { response: 'ZCODE FIXTURE OK', usage: { input_tokens: 120, output_tokens: 40 } });
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if(process.env.AGENTHUB_ZCODE_CONTROL_REPORT)require('fs').appendFileSync(process.env.AGENTHUB_ZCODE_CONTROL_REPORT,JSON.stringify(msg)+'\n');
  if (!msg.method) { if (String(msg.id) === 'permission-1' && msg.result?.decision === 'allow') complete(); return; }
  if (msg.method === 'session/create' || msg.method === 'session/resume') { out({ id: msg.id, result: { sessionId: sid } }); return; }
  if (msg.method === 'session/send') {
    out({ id: msg.id, result: { accepted: true } });
    event('tool.updated', { toolCallId: 'write-1', toolName: 'Write', kind: 'scheduled', input: { file_path: path.join(process.cwd(), 'example.html'), content: '<svg>' + 'x'.repeat(10000) + '</svg>' } });
    out({ id: 'permission-1', method: 'interaction/requestPermission', params: { sessionId: sid, toolName: 'Write', input: { file_path: path.join(process.cwd(), 'example.html') }, options: [{ optionId: 'allow', name: 'Allow once', response: { decision: 'allow' } }] } });
    return;
  }
  out({ id: msg.id, result: {} });
});
