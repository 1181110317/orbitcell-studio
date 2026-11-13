// ACP v1 client filesystem / terminal services. Session ownership and OrbitCell
// permission decisions apply before touching the host. No extra workspace jail.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const MAX_FILE = 8 * 1024 * 1024;
const MAX_SNAPSHOT = 100000;
function rpcError(message, code = -32602) { return Object.assign(new Error(message), { code }); }
function absolute(value, label = '路径') {
  if (typeof value !== 'string' || !value || value.length > 32768 || /[\0\r\n]/.test(value) || !path.isAbsolute(value)) throw rpcError(label + '必须是有效的绝对路径');
  return path.normalize(value);
}
function operationKey(name, input = {}) {
  const file = input.path || input.file_path;
  if (name === 'write_file' && typeof file === 'string' && path.isAbsolute(file) && typeof input.content === 'string') {
    return crypto.createHash('sha256').update(JSON.stringify([name, path.normalize(file), input.content])).digest('hex');
  }
  if (name === 'run_cmd' && typeof input.command === 'string') return crypto.createHash('sha256').update(JSON.stringify([name, input.command, input.args || [], input.cwd || '', input.env || []])).digest('hex');
  return '';
}
function createClientTools({ cwd, authorize, emit, cancelled = () => false, invocation }) {
  let sessionId = '', closed = false;
  const terminals = new Map(), changes = new Set();
  const guard = params => {
    if (closed || cancelled()) throw rpcError('本轮已结束或取消', -32000);
    if (!params || typeof params !== 'object' || !sessionId || params.sessionId !== sessionId) throw rpcError('ACP 会话不匹配');
  };
  const allow = async (name, input) => {
    if (!await authorize(name, input)) throw rpcError('当前权限未允许此操作', -32001);
    if (closed || cancelled()) throw rpcError('本轮已取消', -32000);
  };
  const term = params => {
    guard(params);
    const value = terminals.get(params.terminalId);
    if (!value) throw rpcError('终端不存在或已释放');
    return value;
  };
  function kill(item) {
    if (item.exitStatus || !item.child?.pid) return;
    // These PIDs are only children created by this service, never host services.
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(item.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { try { item.child.kill(); } catch {} });
    } else { try { process.kill(-item.child.pid, 'SIGTERM'); } catch { try { item.child.kill(); } catch {} } }
  }
  async function readFile(params) {
    guard(params);
    const file = absolute(params.path);
    for (const key of ['line', 'limit']) if (params[key] != null && (!Number.isSafeInteger(params[key]) || params[key] < 1)) throw rpcError(key + ' 必须是正整数');
    await allow('read_file', { path: file });
    const handle = await fs.promises.open(file, 'r');
    let data;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw rpcError('目标不是普通文件');
      if (stat.size > MAX_FILE) throw rpcError('文本文件超过 8 MiB，请使用 Agent 自身的分段读取工具');
      const buffer = Buffer.alloc(Math.min(MAX_FILE + 1, stat.size + 1));
      let size = 0, read;
      do { read = (await handle.read(buffer, size, buffer.length - size, null)).bytesRead; size += read; } while (read && size < buffer.length);
      if (size > MAX_FILE) throw rpcError('文本文件超过 8 MiB，请使用 Agent 自身的分段读取工具');
      if (size === buffer.length) throw rpcError('读取时文件已变化，请重试');
      data = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
      if (data.includes('\0')) throw rpcError('目标不是 UTF-8 文本文件');
    } finally { await handle.close(); }
    if (params.line != null || params.limit != null) {
      const lines = data.match(/[^\n]*\n|[^\n]+$/g) || [];
      const start = (params.line || 1) - 1;
      data = lines.slice(start, params.limit == null ? undefined : start + params.limit).join('');
    }
    return { content: data };
  }
  async function writeFile(params) {
    guard(params);
    const file = absolute(params.path);
    if (typeof params.content !== 'string' || params.content.includes('\0') || Buffer.byteLength(params.content) > MAX_FILE) throw rpcError('写入内容必须是 8 MiB 以内的 UTF-8 文本');
    await allow('write_file', { path: file, content: params.content });
    let oldStr, created = false;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw rpcError('目标不是普通文件');
      if (stat.size <= MAX_SNAPSHOT) oldStr = await fs.promises.readFile(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; created = true; oldStr = ''; }
    if (closed || cancelled()) throw rpcError('本轮已取消', -32000);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, params.content, 'utf8');
    const complete = typeof oldStr === 'string' && oldStr.length + params.content.length <= MAX_SNAPSHOT;
    const change = { path: file, tool: 'Write', kind: created ? 'create' : 'update', created, writtenLines: params.content ? params.content.split('\n').length - (params.content.endsWith('\n') ? 1 : 0) : 0,
      ...(complete ? { oldStr, newStr: params.content } : { snapshotUnavailable: true }) };
    changes.add(operationKey('write_file', { path: file, content: params.content }));
    emit({ kind: 'files', files: [change] });
    return {};
  }
  async function createTerminal(params) {
    guard(params);
    if (typeof params.command !== 'string' || !params.command.trim() || /[\0\r\n]/.test(params.command) || params.command.length > 32768) throw rpcError('终端命令格式无效');
    if (params.args != null && (!Array.isArray(params.args) || params.args.length > 1024 || params.args.some(value => typeof value !== 'string' || value.includes('\0') || value.length > 131072))) throw rpcError('终端参数格式无效');
    if (params.env != null && (!Array.isArray(params.env) || params.env.length > 128 || params.env.some(e => !e || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name) || typeof e.value !== 'string' || e.value.includes('\0') || e.value.length > 32768))) throw rpcError('终端环境变量格式无效');
    if (params.outputByteLimit != null && (!Number.isSafeInteger(params.outputByteLimit) || params.outputByteLimit < 1)) throw rpcError('输出限制必须是正整数');
    if (terminals.size >= 20) throw rpcError('活动终端过多，请先释放终端');
    const dir = absolute(params.cwd || cwd, '工作目录');
    const input = { command: params.command, args: params.args || [], cwd: dir, env: params.env || [] };
    await allow('run_cmd', input);
    const env = { ...process.env, ...Object.fromEntries(input.env.map(item => [item.name, item.value])) };
    const inv = invocation(params.command, input.args, env);
    const child = spawn(inv.bin, inv.args, { ...inv, env: inv.env || env, cwd: dir, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const id = 'acpt-' + crypto.randomBytes(9).toString('hex');
    const item = { child, output: '', truncated: false, limit: Math.min(params.outputByteLimit || 1024 * 1024, 4 * 1024 * 1024), exitStatus: null, listeners: new Set() };
    item.done = new Promise(resolve => { item.resolve = resolve; });
    terminals.set(id, item);
    const changed = () => { for (const fn of item.listeners) fn(item); };
    const append = value => {
      item.output += value;
      const bytes = Buffer.from(item.output);
      if (bytes.length > item.limit) {
        let start = bytes.length - item.limit;
        while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
        item.output = bytes.subarray(start).toString('utf8'); item.truncated = true;
      }
      changed();
    };
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      stream.on('data', data => append(decoder.write(data)));
      stream.on('end', () => { const last = decoder.end(); if (last) append(last); });
    }
    const finish = (exitCode, signal) => {
      if (item.exitStatus) return;
      item.exitStatus = { exitCode, signal: signal || null }; item.resolve(item.exitStatus); changed();
    };
    child.on('error', error => { append('终端启动失败：' + (error.code || '未知错误')); finish(1, null); });
    child.on('close', finish);
    return { terminalId: id };
  }
  const handlers = {
    'fs/read_text_file': readFile, 'fs/write_text_file': writeFile,
    'terminal/create': createTerminal,
    'terminal/output': params => { const item = term(params); return { output: item.output, truncated: item.truncated, ...(item.exitStatus ? { exitStatus: item.exitStatus } : {}) }; },
    'terminal/wait_for_exit': params => term(params).done,
    'terminal/kill': params => { kill(term(params)); return {}; },
    'terminal/release': params => { const item = term(params); kill(item); item.listeners.clear(); terminals.delete(params.terminalId); return {}; },
  };
  return {
    handlers, capabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    setSession(id) { sessionId = id; },
    hasWritten(file, content) { return changes.has(operationKey('write_file', { path: file, content })); },
    watchTerminal(id, fn) { const item = terminals.get(id); if (!item) return false; item.listeners.add(fn); fn(item); return true; },
    close() { closed = true; for (const item of terminals.values()) { kill(item); item.listeners.clear(); } terminals.clear(); },
  };
}
module.exports = { createClientTools, operationKey, rpcError };
