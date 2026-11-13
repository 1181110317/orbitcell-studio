'use strict';

// Agent identity stays independent from its installation and defaults on a
// particular computer. Reading this catalog never connects to an SSH host.
const { execFile } = require('child_process');
const crypto = require('crypto');
const nativeRuntime = require('./native-runtime');

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const badKey = key => ['__proto__', 'prototype', 'constructor'].includes(key);
const targetKey = hostId => String(hostId || 'local');
const configuration = (settings, agent, hostId = '') => {
  const target = targetKey(hostId);
  if (badKey(target) || badKey(agent)) return {};
  const value = settings?.agentTargets?.[target]?.[agent];
  return record(value) ? value : {};
};

function preferences(settings, agent) {
  if (badKey(agent)) return {};
  const value = settings?.agentPreferences?.[agent];
  return record(value) ? value : {};
}
function isEnabled(settings, agent) { return preferences(settings, agent).enabled !== false; }
function featureEnabled(settings, agent, feature) {
  const global = feature === 'agenthubTools' ? settings?.mcpTools : feature === 'browserTools' ? settings?.browserTools : true;
  return global !== false && preferences(settings, agent).tools?.[feature] !== false;
}
function managesOwnModels(settings, agent) {
  return !require('./model-access').supportsShared(agent,settings);
}
function cleanPreferences(value, previous = {}) {
  if (!record(value)) error('Agent 偏好格式无效');
  const out = { ...previous };
  for (const field of ['enabled', 'pinned', 'hidden']) if (own(value, field)) {
    if (typeof value[field] !== 'boolean') error(field + ' 必须是布尔值');
    out[field] = value[field];
  }
  if (own(value, 'order')) {
    if (!Number.isInteger(value.order) || value.order < 0 || value.order > 10000) error('排序值无效');
    out.order = value.order;
  }
  if (own(value, 'tools')) {
    if (!record(value.tools)) error('工具偏好格式无效');
    out.tools = { ...(previous.tools || {}) };
    for (const feature of ['mcpServers', 'agenthubTools', 'browserTools', 'permissionMemory']) if (own(value.tools, feature)) {
      if (typeof value.tools[feature] !== 'boolean') error('工具开关必须是布尔值');
      out.tools[feature] = value.tools[feature];
    }
  }
  return out;
}

function routeDefaults(settings, agent, hostId = '') {
  if (managesOwnModels(settings,agent)) {
    const cfg=configuration(settings,agent,hostId);
    return {providerId:'',model:cfg.model||'',effort:hostId?'':cfg.effort||'',permMode:cfg.permMode||'',...(cfg.acpMode?{acpMode:cfg.acpMode}:{}),...(record(cfg.acpConfig)?{acpConfig:{...cfg.acpConfig}}:{})};
  }
  const global = record(settings?.modelDefaults) ? settings.modelDefaults : {};
  const legacy = settings?.agentRoutes?.[agent] || {};
  const sameGlobal = !legacy.providerId || legacy.providerId === global.providerId;
  const base = {
    providerId: legacy.providerId || global.providerId || settings?.currentProvider?.[agent] || '',
    model: legacy.model || (sameGlobal ? global.model : '') || '', effort: legacy.effort || (sameGlobal ? global.effort : '') || '',
  };
  const cfg = configuration(settings, agent, hostId);
  const sameConnection = !cfg.providerId || cfg.providerId === base.providerId;
  return {
    providerId: cfg.providerId || base.providerId || '',
    model: cfg.model || (sameConnection ? base.model : '') || '',
    effort: cfg.effort || (sameConnection ? base.effort : '') || '',
    permMode: cfg.permMode || '',
    ...(agent==='dsh'?{dshPermission:cfg.dshPermission||'default'}:{}),
  };
}

function runtimeSettings(settings, agent, hostId = '') {
  const { command, upgradeCommand } = configuration(settings, agent, hostId);
  if (!command && !upgradeCommand) return settings;
  return { ...settings, agents: { ...settings.agents, [agent]: {
    ...(settings.agents?.[agent] || {}),
    ...(command ? { [hostId ? 'remoteBin' : 'bin']: command } : {}),
    ...(upgradeCommand ? { [hostId ? 'remoteUpgradeCommand' : 'upgradeCommand']: upgradeCommand } : {}),
  } } };
}

function runtimeCustom(custom, settings, agent, hostId = '') {
  const command = configuration(settings, agent, hostId).command;
  return custom && command ? { ...custom, bin: command } : custom;
}

function error(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function cleanConfiguration(value, { agent, hostId, knownAgents, validHost, provider, fits, efforts, localOnly = false }) {
  if (!record(value)) error('Agent 配置格式无效');
  if (typeof agent !== 'string' || badKey(agent) || !knownAgents.has(agent)) error('Agent 不存在', 404);
  if (typeof hostId !== 'string' || hostId.length > 128 || badKey(hostId) || !validHost(hostId)) error('运行环境不存在', 404);
  if (hostId && (['builtin', 'chatgpt-web'].includes(agent) || agent.startsWith('acp:') || localOnly)) error('此 Agent 在 OrbitCell 本机接入');
  const clean = {};
  for (const field of ['command', 'upgradeCommand', 'providerId', 'model', 'effort', 'permMode', 'dshPermission','acpMode']) {
    if (!own(value, field)) continue;
    if (typeof value[field] !== 'string') error(field + ' 必须是文本');
    const text = value[field].trim();
    if (text.length > (field === 'command' || field === 'upgradeCommand' ? 2048 : 256) || /[\0\r\n]/.test(text)) error(field + ' 格式无效或过长');
    if (text) clean[field] = text;
  }
  if ((clean.command || clean.upgradeCommand) && (['builtin', 'chatgpt-web'].includes(agent) || agent.startsWith('acp:'))) error('此 Agent 的启动方式由内置适配器管理');
  if (clean.permMode && !['auto', 'edits', 'plan', 'ask'].includes(clean.permMode)) error('权限模式无效');
  if(clean.dshPermission&&(agent!=='dsh'||!require('./agent-models').DSH_PERMISSIONS.includes(clean.dshPermission)))error('DSH 权限预设无效');
  if (clean.effort && !efforts.includes(clean.effort)) error('推理强度无效');
  const native=agent.startsWith('acp:')||localOnly||['gemini','opencode'].includes(agent);
  if(clean.acpMode&&(!native||clean.acpMode.length>128))error('原生模式无效');
  if(own(value,'acpConfig')){
    if(!native||!record(value.acpConfig)||Object.keys(value.acpConfig).length>32||Object.keys(value.acpConfig).some(badKey)||Object.values(value.acpConfig).some(item=>typeof item!=='string'||item.length>512))error('原生配置无效');
    clean.acpConfig={...value.acpConfig};
  }
  const apiEngine = ['builtin', 'chatgpt-web'].includes(agent);
  for (const field of ['webMode', 'webMaxCalls', 'webTimeoutMs', 'historyMessages']) if (own(value, field) && value[field] !== '') {
    if (!apiEngine) error('此设置由 Agent 自身管理');
    if (field === 'webMode') {
      if (!['auto', 'off'].includes(value[field])) error('联网策略无效');
    } else {
      const bounds = { webMaxCalls: [1, 48], webTimeoutMs: [3000, 30000], historyMessages: [2, 100] }[field];
      if (!Number.isInteger(value[field]) || value[field] < bounds[0] || value[field] > bounds[1]) error(field + ' 超出允许范围');
    }
    clean[field] = value[field];
  }
  if (clean.providerId) {
    const selected = provider(clean.providerId);
    if (!selected) error('模型连接不存在', 404);
    if (!fits(agent, selected)) error('该模型连接不适用于此 Agent');
  }
  return clean;
}

function localVersion(agents, bin, args) {
  return new Promise(resolve => {
    const inv = agents.localInvocation(bin, args);
    execFile(inv.bin, inv.args, { shell: inv.shell, env: inv.env, windowsVerbatimArguments: inv.windowsVerbatimArguments,
      windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.killed ? 124 : err.code === 'ENOENT' ? 127 : typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || err?.message || '' });
    });
  });
}

function windowsCommandWords(command, splitArgs) {
  const value=String(command||'').trim();
  // A Windows executable path is one value even when the user did not put
  // quotes around a directory with spaces. Launchers may still include args.
  if (/^(?:[A-Za-z]:[\\/]|\\\\).+\.(?:exe|cmd|bat|com|ps1)$/i.test(value)) return [value];
  return splitArgs(value);
}

function windowsVersion(ssh, cfg, command, args, splitArgs) {
  const words = windowsCommandWords(command,splitArgs).concat(args);
  const script = "$ErrorActionPreference='Stop'; try { & " + words.map(ssh.windowsPowerShellLiteral).join(' ')
    + '; if ($LASTEXITCODE) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 127 }';
  return new Promise(resolve => {
    const handle = ssh.execStream(cfg, ssh.windowsPowerShellCommand(script), '');
    let stdout = '', stderr = '', done = false;
    const append = (old, text) => (old + String(text || '')).slice(-32768);
    handle.onStdout(text => { stdout = append(stdout, text); });
    handle.onStderr(text => { stderr = append(stderr, text); });
    const finish = code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); };
    const timer = setTimeout(() => { try { handle.kill(); } catch {} finish(124); }, 15000);
    Promise.resolve(handle.done).then(code => finish(Number(code)), err => { stderr = append(stderr, err.message); finish(1); });
  });
}

function mount(app, deps) {
  const checks = new Map(), pending = new Map(), discovered = new Set();
  const knownAgents = () => new Set([...Object.keys(deps.agents.DEFS), ...(deps.settings.data.customAgents || []).map(a => a.id), ...discovered]);
  const validHost = id => !id || id === 'wsl' || !!deps.ssh.getHostCfg(id);
  const keyOf = (agent, hostId) => JSON.stringify([targetKey(hostId), agent]);
  const wrap = fn => async (req, res) => {
    try { const result = await fn(req); if (!res.headersSent) res.json(result); }
    catch (err) { res.status(err.status || 500).json({ error: err.message || 'Agent 管理操作失败' }); }
  };

  app.get('/api/agent-center', wrap(async req => {
    const detected = await deps.agents.detectAgentsCached(deps.settings.data,{refresh:req.query?.refresh==='1'});
    detected.forEach(agent => discovered.add(agent.id));
    const providers = deps.providers ? deps.providers() : [];
    return {
      version: 3, agents: detected.map(agent=>({...agent,sharedModels:require('./model-access').supportsShared(agent.id,deps.settings.data)})), hosts: deps.ssh.listHosts(),
      preferences: deps.settings.data.agentPreferences || {},
      toolPolicy: { agenthubTools: deps.settings.data.mcpTools !== false, browserTools: deps.settings.data.browserTools !== false },
      toolCounts: deps.toolCounts ? deps.toolCounts(detected) : {},
      configurations: deps.settings.data.agentTargets || {},
      modelDefaults: { providerId: deps.settings.data.modelDefaults?.providerId || '', model: deps.settings.data.modelDefaults?.model || '', effort: deps.settings.data.modelDefaults?.effort || '' },
      routes: Object.fromEntries(detected.map(agent => [agent.id, deps.settings.data.agentRoutes?.[agent.id] || { providerId: '', model: '', effort: '' }])),
      commands: deps.settings.data.agents || {},
      providers: providers.map(provider => ({id:provider.id,name:provider.name,model:provider.model||'',effort:provider.effort||'',models:(provider.models||[]).map(model=>typeof model==='string'?model:{id:model.id,name:model.name||model.id})})),
      checks: Object.fromEntries(checks), checkedAt: Date.now(),
      providerIds: Object.fromEntries(detected.map(agent => [agent.id, providers.filter(provider => deps.fits(agent.id, provider)).map(provider => provider.id)])),
    };
  }));

  app.patch('/api/agent-center/preferences', wrap(req => {
    if (!record(req.body) || typeof req.body.agent !== 'string' || badKey(req.body.agent) || !knownAgents().has(req.body.agent)) error('Agent 不存在', 404);
    const agent = req.body.agent, clean = cleanPreferences(req.body.preferences, preferences(deps.settings.data, agent));
    deps.settings.data.agentPreferences = { ...(deps.settings.data.agentPreferences || {}), [agent]: clean };
    deps.settings.save();
    return { ok: true, preferences: clean };
  }));
  app.put('/api/agent-center/order', wrap(req => {
    const ids = req.body?.agents;
    if (!Array.isArray(ids) || ids.length > 256 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || badKey(id) || !knownAgents().has(id))) error('Agent 排序列表无效');
    const next = { ...(deps.settings.data.agentPreferences || {}) };
    ids.forEach((id, index) => { next[id] = { ...(next[id] || {}), order: index }; });
    deps.settings.data.agentPreferences = next; deps.settings.save();
    return { ok: true, preferences: next };
  }));

  app.put('/api/agent-center/config', wrap(req => {
    const body = req.body;
    if (!record(body)) error('Agent 配置格式无效');
    const agent = body.agent, hostId = body.hostId ?? '';
    const clean = cleanConfiguration(body.config, { agent, hostId, knownAgents: knownAgents(), validHost,
      provider: deps.provider, fits: deps.fits, efforts: deps.efforts, localOnly: deps.settings.data.customAgents?.find(item=>item.id===agent)?.acp === true });
    const commandChanged = (configuration(deps.settings.data,agent,hostId).command || '') !== (clean.command || '');
    const upgradeChanged = (configuration(deps.settings.data,agent,hostId).upgradeCommand || '') !== (clean.upgradeCommand || '');
    const target = targetKey(hostId), previous = deps.settings.data.agentTargets || {};
    const next = { ...(previous[target] || {}) };
    if (Object.keys(clean).length) next[agent] = clean; else delete next[agent];
    const all = { ...previous };
    if (Object.keys(next).length) all[target] = next; else delete all[target];
    deps.settings.data.agentTargets = all;
    deps.settings.save();
    checks.delete(keyOf(agent, hostId));
    if (commandChanged || upgradeChanged) {
      deps.agents.clearNativeRouteCache();
      if (!hostId && commandChanged) deps.agents.clearAgentsCache();
    }
    return { ok: true, config: clean, defaults: routeDefaults(deps.settings.data, agent, hostId) };
  }));

  app.post('/api/agent-center/custom', wrap(req => {
    const body = req.body;
    if (!record(body)) error('自定义 Agent 格式无效');
    const result = {};
    for (const [field, max] of [['name', 120], ['bin', 2048], ['args', 4096]]) {
      if (typeof (body[field] ?? '') !== 'string') error(field + ' 必须是文本');
      result[field] = String(body[field] || '').trim();
      if (result[field].length > max || /[\0\r\n]/.test(result[field])) error(field + ' 格式无效或过长');
    }
    if (!result.name || !result.bin) error('请填写名称与启动命令');
    if (body.acp != null && typeof body.acp !== 'boolean') error('协议标记无效');
    const current = deps.settings.data.customAgents || [];
    if (current.length >= 100) error('自定义 Agent 数量已达上限');
    result.id = 'c_' + crypto.randomBytes(8).toString('hex');
    result.color = '#64748b'; result.acp = body.acp === true;
    deps.settings.data.customAgents = [...current, result];
    deps.settings.save(); deps.agents.clearAgentsCache();
    return { ok: true, agent: result };
  }));

  app.post('/api/agent-center/inherit-model', wrap(req => {
    const body=req.body;
    if(!record(body))error('Agent 参数无效');
    const agent=body.agent,hostId=body.hostId??'';
    cleanConfiguration({}, {agent,hostId,knownAgents:knownAgents(),validHost,provider:deps.provider,fits:deps.fits,efforts:deps.efforts,
      localOnly:deps.settings.data.customAgents?.find(item=>item.id===agent)?.acp===true});
    const cfg={...configuration(deps.settings.data,agent,hostId)};
    for(const field of ['providerId','model','effort'])delete cfg[field];
    const targets=deps.settings.data.agentTargets||{};
    deps.settings.data.agentTargets={...targets,[targetKey(hostId)]:{...(targets[targetKey(hostId)]||{}),[agent]:cfg}};
    if(deps.settings.data.agentRoutes)delete deps.settings.data.agentRoutes[agent];
    if(deps.settings.data.currentProvider)delete deps.settings.data.currentProvider[agent];
    deps.settings.save();
    return {ok:true,config:cfg,defaults:routeDefaults(deps.settings.data,agent,hostId)};
  }));

  app.post('/api/agent-center/probe', wrap(async req => {
    const body = req.body;
    if (!record(body)) error('检测参数无效');
    const agent = body.agent, hostId = body.hostId ?? '';
    cleanConfiguration({}, { agent, hostId, knownAgents: knownAgents(), validHost, provider: deps.provider, fits: deps.fits, efforts: deps.efforts, localOnly: deps.settings.data.customAgents?.find(item=>item.id===agent)?.acp === true });
    const key = keyOf(agent, hostId);
    const startingConfig = JSON.stringify(configuration(deps.settings.data,agent,hostId));
    if (pending.get(key)?.config === startingConfig) return pending.get(key).promise;
    const entry = { config: startingConfig };
    const task = (async () => {
      const startedAt = Date.now();
      const settings = runtimeSettings(deps.settings.data, agent, hostId);
      const custom = runtimeCustom((settings.customAgents || []).find(a => a.id === agent), settings, agent, hostId);
      const result = { checkedAt: 0, elapsedMs: 0, host: hostId ? 'unchecked' : 'ready', cli: 'unchecked', model: 'unchecked', version: '', command: '', error: '' };
      try {
        if (['builtin', 'chatgpt-web'].includes(agent)) { result.cli = 'not-required'; return result; }
        if (agent.startsWith('acp:') || custom?.acp) { result.cli='managed'; result.note='ACP 的实际协议连接在会话启动时验证。'; return result; }
        const args = (custom ? deps.agents.splitArgs(custom.args || '') : []).concat('--version');
        let command, version;
        if (!hostId) {
          command = await deps.agents.resolveBinAsync(agent, custom || deps.agents.agentSettings(settings, agent), true);
          if (!command) { result.cli = 'missing'; result.error = '未找到 CLI，请安装或填写启动路径。'; return result; }
          result.command = command;
          version = await localVersion(deps.agents, command, args);
        } else if (hostId === 'wsl') {
          command = custom?.bin || nativeRuntime.remoteBin({settings}, agent);
          result.command = command;
          version = await nativeRuntime.runOneShot({wsl:true}, nativeRuntime.commandLine(command,args), 15000);
          // A missing CLI is a healthy WSL transport with an unavailable
          // executable.  Only a missing/failed WSL channel is a host error.
          result.host = version.code === 124 || /没有可用的 WSL|wsl\.exe|WSL 命令超时/i.test(version.stderr || '') ? 'failed' : 'ready';
        } else {
          const cfg = deps.ssh.getHostCfg(hostId);
          const connection = await deps.ssh.testHost(cfg);
          if (!connection.ok) { result.host = 'failed'; result.error = connection.error; return result; }
          result.host = 'ready';
          command = custom?.bin || nativeRuntime.remoteBin({settings},agent);
          result.command = command;
          version = connection.platform === 'windows' ? await windowsVersion(deps.ssh,cfg,command,args,deps.agents.splitArgs)
            : await nativeRuntime.runOneShot({remote:{exec:(cmd,stdin)=>deps.ssh.execStream(cfg,cmd,stdin)}}, nativeRuntime.commandLine(command,args),15000);
        }
        const output = String(version.stdout || '').trim();
        result.version = deps.agents.parseCliVersion(output).slice(0,160);
        if (!result.version && version.code === 0) result.version = deps.agents.parseCliVersion(String(version.stderr || '')).slice(0,160);
        result.cli = version.code === 0 ? 'ready' : version.code === 127 ? 'missing' : 'failed';
        if (result.cli === 'ready' && !result.version) { result.cli='unverified'; result.note='命令已退出，但没有返回可识别的版本；协议与认证将在会话启动时验证。'; }
        if (result.cli !== 'ready') result.error = version.code === 124 ? '检测超时；检查目标电脑上的 CLI 与运行环境。' : String(version.stderr || output || 'CLI 未能正常启动').slice(0,800);
      } catch (err) { result.error = String(err.message || '检测失败').slice(0,800); if (result.host !== 'ready') result.host = 'failed'; else result.cli = 'failed'; }
      finally {
        result.checkedAt = Date.now();
        result.elapsedMs = Math.max(0, result.checkedAt - startedAt);
      }
      return result;
    })().then(result => {
      if(startingConfig===JSON.stringify(configuration(deps.settings.data,agent,hostId)))checks.set(key,result);
      else result.stale=true;
      if(checks.size>512)checks.delete(checks.keys().next().value);
      return result;
    }).finally(()=>{ if (pending.get(key) === entry) pending.delete(key); });
    entry.promise=task;pending.set(key,entry);
    return task;
  }));
}

module.exports = { mount, configuration, routeDefaults, runtimeSettings, runtimeCustom, cleanConfiguration, targetKey, windowsCommandWords,
  preferences, cleanPreferences, isEnabled, featureEnabled, managesOwnModels };
