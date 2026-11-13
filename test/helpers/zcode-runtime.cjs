const assert = require('assert');
const path = require('path');
const fs = require('fs');
module.exports = async function verifyZcode(cwd) {
  const { installationEnv } = require('../../lib/zcode-installation');
  const resources = path.join(cwd, 'zcode-install', 'resources'), entry = path.join(resources, 'glm', 'zcode.cjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, '');
  const catalog = path.join(resources, 'config', 'provider', 'zcode-builtin.json');
  fs.mkdirSync(path.dirname(catalog), { recursive: true }); fs.writeFileSync(catalog, '{}');
  assert.equal(installationEnv(entry, {}).ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, catalog);
  assert.deepEqual(installationEnv(entry, { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: '/explicit/catalog.json' }), {});
  assert.deepEqual(installationEnv('/missing/zcode.cjs', {}), {});
  assert.deepEqual(installationEnv(entry.replace(/cjs$/, 'exe'), {}), {});
  const agents = require('../../lib/agents');
  assert.equal(agents.buildZcodeEnv({ settings: { agents: { zcode: { bin: entry } } } }).env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, catalog);
  if (!process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE) assert(!agents.buildZcodeEnv({ remoteHostId: 'ssh-fixture', settings: { agents: { zcode: { bin: entry } } } }).env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, 'local installation paths never reach a remote environment');
  const bridge = require('../../lib/zcode-bridge'),controlReport=path.join(cwd,'zcode-controls.jsonl');
  bridge.initBridge({ resolveBin: () => process.execPath, agentSettings: () => ({}), zcodeMode: () => 'build', buildZcodeEnv: () => ({ env: {...process.env,AGENTHUB_ZCODE_CONTROL_REPORT:controlReport} }),
    localInvocation: (bin, args, env) => ({ bin, args: [path.join(__dirname, '../fixtures/zcode-runtime.cjs'), ...args], env, shell: false }) });
  const options = { agent: 'zcode', sessionKey: 'zcode-fixture-turn', cwd, model: 'fixture-model', effort:'high', permMode: 'ask' }, events = [];
  let timer;
  try {
    const turn = bridge.runStreamTurn(options, event => {
      events.push(event);
      if (event.kind === 'permission') assert(bridge.respond(options.sessionKey, event.pid, { optionId: 'allow' }).ok);
    });
    assert.equal(await Promise.race([turn.done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('ZCode fixture timeout')), 6000); })]), 0);
    const write = events.find(event => event.kind === 'tool' && event.detail);
    assert.equal(JSON.parse(write.detail).content.length, 10011, 'large Write arguments remain valid JSON');
    assert(events.some(event => event.kind === 'tooloutput' && event.output === 'file written'));
    assert(events.some(event => event.kind === 'text' && event.text === 'ZCODE FIXTURE OK'));
    assert.equal(bridge.getPending(options.sessionKey).length, 0);
    const nativeLog=fs.readFileSync(controlReport,'utf8').trim().split('\n').map(JSON.parse);assert.equal(nativeLog.find(e=>e.method==='session/create').params.thoughtLevel,'high','high remains high in the native protocol');
    console.log('[zcode-runtime] native startup / permission / large tool input / result / completion passed');
  } finally { clearTimeout(timer); bridge.destroySession(options.sessionKey, 'test-fixture-cleanup'); }
};
