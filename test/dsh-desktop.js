'use strict';

// Exercise desktop discovery and the Windows .cmd launch path without using
// the user's installed Harness, profile or model credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.log('[dsh-desktop] Windows desktop discovery skipped');
} else {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-dsh-desktop-'));
  const local = path.join(work, 'local appdata');
  const roaming = path.join(work, 'roaming appdata');
  const launcher = path.join(local, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
  process.env.LOCALAPPDATA = local;
  process.env.APPDATA = roaming;
  process.env.AGENTHUB_DATA_DIR = path.join(work, 'data');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  const fixture = path.join(work, 'fake-dsh.js');
  fs.writeFileSync(fixture, `
    if (process.argv[2] === '--version') {
      console.log('0.2.2');
    } else if(process.argv.includes('--dump-config')) {
      console.log(JSON.stringify([{id:'agent-default-model',config:{provider:'fixture',model:'default-model'}}]));
    } else {
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        const patchIndex=process.argv.indexOf('--patch');
        if(patchIndex>=0)require('fs').writeFileSync(require('path').join(process.cwd(),'model-route.json'),JSON.stringify({args:process.argv.slice(2),patch:JSON.parse(require('fs').readFileSync(process.argv[patchIndex+1],'utf8')),keyReceived:process.env.AGENTHUB_DSH_API_KEY==='test-only-key'}));
        for (const event of [
          { type: 'session', sessionId: 'desktop-fixture' },
          { type: 'tool_call', callId: 'read-1', tool: 'Read', input: { path: 'example.txt' } },
          { type: 'tool_result', callId: 'read-1', status: 'completed', result: input },
          { type: 'text', text: 'DONE' },
          { type: 'final', text: 'DONE' }
        ]) console.log(JSON.stringify(event));
      });
    }
  `);
  fs.writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);

  const { resolveBin, resolveBinAsync, runAgent } = require('../lib/agents');
  (async () => {
    assert.equal(await resolveBinAsync('dsh'), launcher);
    assert.equal(resolveBin('dsh'), launcher);
    const explicit = path.join(work, 'explicit.cmd');
    fs.writeFileSync(explicit, '@echo off\r\nexit /b 0\r\n');
    assert.equal(await resolveBinAsync('dsh', { bin: explicit }), explicit);

    const events = [];
    const handle = await runAgent({ agent: 'dsh', prompt: '测试 stdin', cwd: work, settings: {} }, event => events.push(event));
    assert.equal(await handle.done, 0);
    assert(events.some(event => event.kind === 'session' && event.id === 'desktop-fixture'));
    assert(events.some(event => event.kind === 'tool' && event.name === 'Read'));
    assert(events.some(event => event.kind === 'tooloutput' && event.output === '测试 stdin'));
    assert.equal(events.filter(event => event.kind === 'text').map(event => event.text).join(''), 'DONE');
    const selected=await runAgent({agent:'dsh',prompt:'route check',model:'selected-model',cliSessionId:'resume-fixture',cwd:work,
      provider:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'test-only-key',protocol:'openai'},settings:{}},()=>{});
    assert.equal(await selected.done,0);
    const routed=JSON.parse(fs.readFileSync(path.join(work,'model-route.json'),'utf8'));
    assert.equal(routed.patch[1].config.model,'selected-model');assert(routed.keyReceived);
    assert(routed.args.includes('resume-fixture'),'selecting a new model keeps the native session identity');
    assert(!fs.existsSync(routed.args[routed.args.indexOf('--patch')+1]),'session overlay is removed after the turn');
    console.log('[dsh-desktop] discovery / explicit override / launcher / tool events passed');
  })().catch(error => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => {
    const target = path.resolve(work);
    const temp = path.resolve(os.tmpdir()) + path.sep;
    if (target.startsWith(temp)) fs.rmSync(target, { recursive: true, force: true });
  });
}
