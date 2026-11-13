// ACP 目录与「能力探测」的单元测试。
//
// 这一组不依赖任何真实 CLI：探测 runner 是注入的，`cmdExists` 走的是真实
// `where`/`which`，所以我们在临时目录里放两个假 bin（一个 --help 里宣告 acp、
// 一个不宣告），把它挂到 PATH 上，验证「只有自己宣告支持的才登记」这条原则。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const acp = require('../lib/acp-presets');

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push('PASS ' + name); console.log('  PASS ' + name); }
  catch (e) { checks.push('FAIL ' + name); console.error('  FAIL ' + name + ': ' + (e && e.message || e)); process.exitCode = 1; }
}

const BIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-acpbin-'));
const IS_WIN = process.platform === 'win32';
function fakeBin(name, text) {
  // Windows 上 `where` 按 PATHEXT 找文件，所以要带 .cmd；POSIX 上要可执行位。
  const file = IS_WIN ? path.join(BIN_DIR, name + '.cmd') : path.join(BIN_DIR, name);
  fs.writeFileSync(file, IS_WIN ? '@echo off\r\necho ' + text + '\r\n' : '#!/bin/sh\necho "' + text + '"\n');
  if (!IS_WIN) fs.chmodSync(file, 0o755);
}
fakeBin('qwen', 'Usage: qwen [options] [acp|serve|chat]');
fakeBin('snow', 'Usage: snow --version --help');
process.env.PATH = BIN_DIR + path.delimiter + process.env.PATH;

// 注入的 runner：只回放预设好的 help 文本，绝不真的执行用户机器上的东西。
const run = async bin => ({
  code: 0,
  output: bin === 'qwen' ? 'Usage: qwen [options] [acp|serve|chat]' : 'Usage: snow --version --help',
});

(async () => {
  await check('helpDeclaresAcp：只认独立的 acp 词，不误判 acpx / 无关文本', () => {
    assert(acp.helpDeclaresAcp('Usage: foo [acp]'));
    assert(acp.helpDeclaresAcp('COMMANDS:\n  acp   run agent'));
    assert(acp.helpDeclaresAcp('Options:\n  --acp    Start ACP server'));
    assert(!acp.helpDeclaresAcp('--acp-helper starts a helper'));
    assert(!acp.helpDeclaresAcp('This tool does not support the ACP protocol'));
    assert(!acp.helpDeclaresAcp('acpx is a wrapper'));
    assert(!acp.helpDeclaresAcp('no such command'));
    assert(!acp.helpDeclaresAcp(''));
    assert(!acp.helpDeclaresAcp(null));
  });

  await check('resolveAcpAgent：预置项按 key 解析', () => {
    const p = acp.resolveAcpAgent('acp:goose-acp');
    assert(p, '预置 goose 应可解析');
    assert.equal(p.probed, false);
    assert.deepEqual(p.cmd, ['goose', 'acp']);
    assert.equal(p.id, 'acp:goose-acp');
  });

  await check('resolveAcpAgent：探测项 id 自带 bin，重启后仍能还原命令', () => {
    // 关键性质：不依赖任何运行时注册表 —— 服务重启、或首个请求早于探测完成时，
    // 只要 id 在，就能还原出「<bin> acp」，会话不会被判成未知 Agent。
    const p = acp.resolveAcpAgent('acp:b:qwen');
    assert(p, 'acp:b:qwen 应可解析');
    assert.equal(p.probed, true);
    assert.deepEqual(p.cmd, ['qwen', 'acp']);
    assert.equal(p.id, acp.probedAgentId('qwen'));
  });

  await check('resolveAcpAgent：拒绝路径、空白、超长与不存在的 key', () => {
    for (const bad of ['acp:b:../../etc/passwd', 'acp:b:a b', 'acp:b:', 'acp:no-such-preset', 'acp:b:' + 'x'.repeat(65), '']) {
      assert.equal(acp.resolveAcpAgent(bad), null, '应拒绝：' + JSON.stringify(bad));
    }
  });

  await check('probedAgentId 与 resolveAcpAgent 往返一致', () => {
    for (const bin of ['qwen', 'a.b-c_d', 'X1']) {
      const id = acp.probedAgentId(bin);
      const back = acp.resolveAcpAgent(id);
      assert(back, bin + ' 应可往返');
      assert.deepEqual(back.cmd, [bin, 'acp']);
    }
  });

  await check('detectAcpAgents：只登记自己宣告 acp 的 CLI', async () => {
    const list = await acp.detectAcpAgents([], { run });
    const ids = list.map(x => x.id);
    assert(ids.includes('acp:b:qwen'), 'qwen 的 --help 里有 acp，应被登记；实际：' + ids.join(','));
    assert(!ids.includes('acp:b:snow'), 'snow 的 --help 没有 acp，不应被登记');
    const qwen = list.find(x => x.id === 'acp:b:qwen');
    assert.equal(qwen.acp, true);
    assert.equal(qwen.found, true);
    assert.equal(qwen.probed, true);
    assert.equal(qwen.bin, 'qwen acp');
    assert.equal(qwen.args, 'acp');
    assert(qwen.discoveryNote, '来源说明应独立保存');
    assert.equal(qwen.version,'','帮助文本不能充当版本号');
  });

  await check('detectAcpAgents：没有 runner 时不做探测（只回预置）', async () => {
    const list = await acp.detectAcpAgents([]);
    assert(!list.some(x => x.probed), '未注入 runner 时不应出现探测项');
  });

  await check('detectAcpAgents：bin 不存在时即使 runner 说支持也不登记', async () => {
    const list = await acp.detectAcpAgents([], { run: async () => ({ code: 0, output: 'acp' }) });
    assert(!list.some(x => x.id === 'acp:b:qoder'), '本机没装 qoder，不该出现在列表里');
  });

  await check('detectAcpAgents：CLI 已装时跳过同名 ACP 预置（不出现两个同名 Agent）', async () => {
    const withCli = await acp.detectAcpAgents(['gemini'], { run });
    const without = await acp.detectAcpAgents([], { run });
    assert(!withCli.some(x => x.id === 'acp:gemini-acp'), 'gemini CLI 已装时应跳过 gemini-acp');
    // 反过来：不传 foundCli 时是否出现取决于本机是否装了 gemini，不断言
    assert(without.every(x => x.id !== 'acp:b:qwen' || x.probed), '健全性检查');
  });

  await check('ACP_PRESETS 结构完整（key/name/cmd 齐备，key 唯一）', () => {
    const keys = new Set();
    for (const p of acp.ACP_PRESETS) {
      assert(p.key && p.name && Array.isArray(p.cmd) && p.cmd.length, 'preset 结构不完整：' + JSON.stringify(p));
      assert(!keys.has(p.key), 'key 重复：' + p.key);
      keys.add(p.key);
      assert(/^[A-Za-z0-9._-]+$/.test(p.key), 'key 含非法字符：' + p.key);
    }
    for (const c of acp.ACP_PROBE_BINS) assert(/^[A-Za-z0-9._-]+$/.test(c.bin), '探测候选 bin 非法：' + c.bin);
  });
  await check('Qoder 两个命令别名均使用 --acp，并去重发现结果', async () => {
    for (const bin of ['qoder', 'qodercli']) assert.deepEqual(acp.resolveAcpAgent('acp:b:' + bin).cmd, [bin, '--acp']);
    const list = await acp.detectAcpAgents([], { exists: async bin => ['qoder', 'qodercli'].includes(bin), run: async () => ({ output: 'Options: --acp  Start agent client protocol' }) });
    const qoder = list.filter(item => /qoder/i.test(item.id));
    assert.equal(qoder.length, 1); assert.equal(qoder[0].id, 'acp:b:qoder');
    assert.equal(qoder[0].args, '--acp');
    const legacy = await acp.detectAcpAgents([], { exists: async bin => bin === 'qodercli', run: async () => ({ output: 'Options: --acp' }) });
    assert.equal(legacy.find(item => item.id === 'acp:b:qodercli').args, '--acp');
  });
  await check('Qoder CN 仅在 CLI 宣告 ACP 时发现，并保留实际参数', async () => {
    const available = ['qoder', 'qoderclicn', 'qodercn'];
    const list = await acp.detectAcpAgents([], {
      exists: async bin => available.includes(bin),
      run: async bin => ({ output: bin === 'qoder' ? 'Options: --acp' : 'Options: --experimental-acp' }),
    });
    const cn = list.filter(item => item.name.startsWith('Qoder CN'));
    assert.equal(cn.length, 1);
    assert.equal(cn[0].id, 'acp:e:qoderclicn');
    assert.deepEqual(acp.resolveAcpAgent(cn[0].id).cmd, ['qoderclicn', '--experimental-acp']);
    assert(list.some(item => item.id === 'acp:b:qoder'), 'Qoder and Qoder CN can coexist');
    const noCli = await acp.detectAcpAgents([], {
      exists: async bin => bin === 'qodercn',
      run: async () => ({ code: 127, output: 'QoderCN CLI is not installed' }),
    });
    assert(!noCli.some(item => item.name.startsWith('Qoder CN')));
  });
  await check('通用 --acp 探测保留参数形态，重启不变回子命令', async () => {
    const list = await acp.detectAcpAgents([], { exists: async bin => bin === 'qwen', run: async () => ({ output: 'Options: --acp' }) });
    const found = list.find(item => item.id === 'acp:f:qwen');
    assert(found); assert.deepEqual(acp.resolveAcpAgent(found.id).cmd, ['qwen', '--acp']);
    assert.equal(acp.resolveAcpAgent('acp:f:../bad'), null);
    const experimental = await acp.detectAcpAgents([], { exists: async bin => bin === 'qwen', run: async () => ({ output: 'Options: --experimental-acp' }) });
    assert.deepEqual(acp.resolveAcpAgent(experimental.find(item => item.id === 'acp:e:qwen').id).cmd, ['qwen', '--experimental-acp']);
  });

  const failed = checks.filter(c => c.startsWith('FAIL')).length;
  console.log(`\n[acp-detect] ${checks.length - failed}/${checks.length} checks passed`);
  try { fs.rmSync(BIN_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
})();
