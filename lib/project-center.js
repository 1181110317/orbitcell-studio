'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { durable, fail, record } = require('./workflow-store');
function location(cwd, hostId = '') {
  if (typeof cwd !== 'string' || !cwd.trim() || cwd.length > 4096 || /[\0\r\n]/.test(cwd)) fail('项目目录必须是非空绝对路径');
  const raw = cwd.trim(), windows = /^[a-z]:[\\/]|^\\\\/i.test(raw);
  if (!windows && !path.posix.isAbsolute(raw)) fail('项目目录必须使用绝对路径');
  const normal = windows ? path.win32.normalize(raw.replace(/\//g, '\\')) : path.posix.normalize(raw);
  const root = windows ? path.win32.parse(normal).root : '/';
  const display = normal.length > root.length ? normal.replace(/[\\/]+$/, '') : normal;
  const key = String(hostId || 'local') + '|' + (windows ? display.toLowerCase() : display);
  return { cwd: display, hostId: hostId || '', key, id: 'project-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 20) };
}
function createCatalog(deps, storage) {
  const store = storage || durable('projects', { items: [] }, value => record(value) && Array.isArray(value.items) && value.items.length <= 1000 && value.items.every(item => record(item) && typeof item.id === 'string' && typeof item.cwd === 'string' && typeof item.name === 'string'));
  function labels() { return store.read().items.map(({ id, name, cwd, hostId, archived, pinned }) => ({ id, name, cwd, hostId, archived, pinned })); }
  function list() {
    const groups = new Map();
    for (const saved of store.read().items) groups.set(saved.id, { ...saved, registered: true, sessions: [], agents: [], lastAt: saved.updatedAt || 0 });
    for (const session of deps.sessions()) {
      if (!session.cwd) continue;
      let info; try { info = location(session.cwd, session.remoteHostId || ''); } catch { continue; }
      if (!groups.has(info.id)) groups.set(info.id, { ...info, name: path.win32.basename(info.cwd) || info.cwd, description: '', agentIds: [], defaultAgent: '', archived: false, pinned: false, registered: false, sessions: [], agents: [], lastAt: 0 });
      const project = groups.get(info.id);
      project.sessions.push({ id: session.id, title: session.title || '未命名会话', agent: session.agent, updatedAt: session.updatedAt || 0, archived: !!session.archived, running: !!deps.isRunning?.(session.id) });
      project.lastAt = Math.max(project.lastAt, session.updatedAt || 0);
    }
    for (const project of groups.values()) {
      project.agents = [...new Set([...project.agentIds || [], ...project.sessions.map(session => session.agent)])];
      project.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      project.hostMissing = !!project.hostId && project.hostId !== 'wsl' && !deps.hosts().some(host => host.id === project.hostId);
    }
    return [...groups.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt || a.name.localeCompare(b.name));
  }
  function clean(input, previous = {}) {
    if (!record(input)) fail('项目格式无效');
    const next = { ...previous };
    for (const field of ['name', 'description', 'defaultAgent']) if (Object.hasOwn(input, field)) {
      if (typeof input[field] !== 'string' || input[field].length > (field === 'description' ? 2000 : 160) || /[\0\r]/.test(input[field]) || field !== 'description' && /\n/.test(input[field])) fail('项目' + field + '格式无效');
      next[field] = input[field].trim();
    }
    if (!next.name) fail('请填写项目名称');
    for (const field of ['archived', 'pinned']) if (Object.hasOwn(input, field)) { if (typeof input[field] !== 'boolean') fail('项目开关格式无效'); next[field] = input[field]; }
    if (Object.hasOwn(input, 'agentIds')) {
      if (!Array.isArray(input.agentIds) || input.agentIds.length > 128 || input.agentIds.some(id => typeof id !== 'string' || !deps.validAgent(id))) fail('项目 Agent 列表无效');
      next.agentIds = [...new Set(input.agentIds)];
    }
    if (next.defaultAgent && (!deps.validAgent(next.defaultAgent) || next.agentIds?.length && !next.agentIds.includes(next.defaultAgent))) fail('默认 Agent 必须在项目 Agent 列表中');
    if (next.hostId && [...next.agentIds || [], next.defaultAgent].filter(Boolean).some(id => !deps.compatibleAgent(id, next.hostId))) fail('此 Agent 不支持该项目的运行环境');
    return next;
  }
  async function add(input) {
    if (!record(input) || typeof (input.hostId ?? '') !== 'string') fail('项目格式无效');
    const hostId = input.hostId || '';
    if (hostId && hostId !== 'wsl' && !deps.hosts().some(host => host.id === hostId)) fail('项目运行环境不存在', 404);
    const info = location(input.cwd, hostId);
    if (!hostId) { let stat; try { stat = await fs.promises.stat(info.cwd); } catch { fail('项目目录不存在或无法访问'); } if (!stat.isDirectory()) fail('项目路径不是文件夹'); }
    const metadata = clean(input, { hostId, agentIds: [], defaultAgent: '', archived: false, pinned: false, description: '' });
    return store.change(value => { if (value.items.some(item => item.id === info.id)) fail('此目录已登记为项目', 409); const project = { ...info, ...metadata, createdAt: Date.now(), updatedAt: Date.now() }; value.items.push(project); return project; });
  }
  function update(id, input) {
    const current = list().find(project => project.id === id); if (!current) fail('项目不存在', 404);
    if (!record(input) || ['cwd', 'hostId', 'id'].some(field => Object.hasOwn(input, field))) fail('项目目录和运行环境不能在编辑时变更，请另行登记项目');
    const { sessions, agents, registered, hostMissing, lastAt, ...metadata } = current;
    const next = { ...clean(input, metadata), updatedAt: Date.now() };
    return store.change(value => { const index = value.items.findIndex(item => item.id === id); if (index < 0) value.items.push(next); else value.items[index] = next; return next; });
  }
  return { list, labels, add, update };
}
function mount(app, deps) {
  const catalog = createCatalog(deps);
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/api/projects', wrap(() => ({ version: 1, projects: catalog.list(), hosts: deps.hosts() })));
  app.get('/api/projects/labels', wrap(() => ({ projects: catalog.labels() })));
  app.post('/api/projects', wrap(req => catalog.add(req.body)));
  app.patch('/api/projects/:id', wrap(req => catalog.update(req.params.id, req.body)));
  return catalog;
}
module.exports = { location, createCatalog, mount };
