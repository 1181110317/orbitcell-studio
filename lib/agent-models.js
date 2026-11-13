'use strict';

// Native model catalogs contain public model metadata only. Credentials and
// complete CLI configuration never leave this module.
const { execFile } = require('node:child_process');
const YAML = require('yaml');
const { defaultWorkspaceDir } = require('./workspace');

function cliOutput(bin, args, cwd) {
  const invocation = require('./agents').localInvocation(bin, args);
  return new Promise((resolve, reject) => execFile(invocation.bin, invocation.args, {
    ...invocation, cwd: cwd || defaultWorkspaceDir(), windowsHide: true,
    encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  }, (error, stdout) => error ? reject(new Error('原生模型目录读取失败，请检查 CLI 路径、登录状态和配置')) : resolve(stdout)));
}
const nativeAcpFlags = new Map();
async function acpArgs(agent,bin,cwd){
  if(agent==='opencode')return ['acp'];
  if(agent!=='gemini')return [];
  if(!nativeAcpFlags.has(bin))nativeAcpFlags.set(bin,cliOutput(bin,['--help'],cwd).then(help=>{
    if(/(^|[^\w-])--acp([^\w-]|$)/m.test(help))return ['--acp'];
    if(help.includes('--experimental-acp'))return ['--experimental-acp'];
    throw new Error('此 Gemini CLI 未声明 ACP 接口，请更新 CLI 后重新检测');
  }).catch(error=>{nativeAcpFlags.delete(bin);throw error;}));
  return nativeAcpFlags.get(bin);
}

const dshModelId = (provider, model) => encodeURIComponent(provider) + '/' + model;
function dshSelection(value) {
  const text = String(value || '').trim(), slash = text.indexOf('/');
  if (slash < 1 || slash === text.length - 1) throw new Error('DSH 模型需包含提供方路由，格式为“提供方/模型 ID”；请从原生目录选择');
  let provider;
  try { provider = decodeURIComponent(text.slice(0, slash)); } catch { throw new Error('DSH 提供方路由无效'); }
  return { provider, model: text.slice(slash + 1) };
}
const DSH_PERMISSIONS = ['default','read-only','workspace-write','danger-full-access'];
function dshEffort(value) { return value === 'none' ? 'off' : value === 'ultra' ? 'max' : value; }
function dshPatch(value, provider, effort = '') {
  const reasoning = effort ? {reasoningEffort:dshEffort(effort)} : {};
  if (!provider) return JSON.stringify([{ id: 'agent-default-model', config: {...(value?dshSelection(value):{}),...reasoning} }]);
  const model = String(value || provider.model || '').trim();
  if (!model) throw new Error('请先选择模型，或为此共享连接设置默认模型');
  const { endpoint, protocol } = require('./provider-endpoint');
  const anthropic = protocol(provider) === 'anthropic';
  const operation = anthropic ? 'messages' : 'chat/completions';
  const baseURL = endpoint(provider.baseUrl, operation).slice(0, -operation.length).replace(/\/$/, '');
  // A distinct internal route clears the headless runner's remembered effort
  // when the user returns to default, while retaining the native session.
  const route=effort?'agenthub-'+effort:'agenthub';
  const declared=require('./model-center').catalog([provider]).find(row=>row.id===model)?.efforts||[];
  const levels=[...new Set([...declared,...(effort?[effort]:[])])];
  if(effort==='none'&&!levels.some(level=>level!=='none'))throw new Error('此模型未声明可关闭推理的能力，请刷新模型目录后重新选择');
  const reasoningEfforts=Object.fromEntries(levels.map(level=>[dshEffort(level),level]));
  if(effort)reasoningEfforts[dshEffort(effort)]=effort;
  return JSON.stringify([
    { id: 'llm-pi-ai', config: { providers: { [route]: { api: anthropic ? 'anthropic-messages' : 'openai-completions',
      baseURL, apiKeyEnv: 'AGENTHUB_DSH_API_KEY', models: [{ id: model, name: model,
        ...(levels.length?{reasoningEfforts}:{}),
        ...(/minimax-m3[._-]1[-.]flash/i.test(model)?{compat:{forceAdaptiveThinking:true}}:{}) }] } } } },
    { id: 'agent-default-model', config: { provider: route, model, ...reasoning } },
  ]);
}
// Native routes keep their own auth and compatibility settings. An alias per
// effort prevents headless resume from restoring the previous explicit tier.
function dshProfilePatch(text,value,effort='') {
  const doc=YAML.parseDocument(text,{uniqueKeys:true});
  if(doc.errors.length)throw new Error('DSH 原生配置无法解析');
  const entries=doc.toJS({maxAliasCount:100});
  if(!Array.isArray(entries))throw new Error('DSH 原生配置格式无效');
  const defaults=entries.find(row=>row?.id==='agent-default-model'||/\/dsh-agent-default-model$/.test(row?.name||''))?.config||{};
  const selected=value?dshSelection(value):defaults;
  if(!selected.provider||!selected.model)throw new Error('DSH 未设置原生默认模型，请先选择模型');
  const adapter=entries.find(row=>!row?.disabled&&/\/dsh-llm-(?:pi-ai|deepseek)$/.test(row?.name||'')&&row.config?.providers?.[selected.provider]);
  if(!adapter)return dshPatch(dshModelId(selected.provider,selected.model),null,effort||defaults.reasoningEffort||'');
  const route='agenthub-native-'+require('node:crypto').createHash('sha256').update(selected.provider).digest('hex').slice(0,12)+'-'+(effort||'default');
  return JSON.stringify([
    {id:adapter.id,config:{providers:{[route]:adapter.config.providers[selected.provider]}}},
    {id:'agent-default-model',config:{provider:route,model:selected.model,...(effort?{reasoningEffort:dshEffort(effort)}:defaults.reasoningEffort?{reasoningEffort:defaults.reasoningEffort}:{})}}
  ]);
}
async function dshNativePatch(bin,cwd,value,effort='') {
  return dshProfilePatch(await cliOutput(bin,['headless','--dump-config'],cwd),value,effort);
}
function dshArgs(options, patchFile = options.dshPatchFile) {
  const args = ['headless'];
  if (patchFile) args.push('--patch', patchFile);
  args.push('--json');
  if (options.cliSessionId) args.push('--session-id', options.cliSessionId);
  if(options.dshPermission&&options.dshPermission!=='default'){
    if(!DSH_PERMISSIONS.includes(options.dshPermission))throw new Error('DSH 权限预设无效');
    args.push('--permission-mode',options.dshPermission,'--approval-policy','never');
  }
  args.push('-');
  return args;
}
function dshCatalog(text) {
  // Unknown !!js tags stay inert strings. Parsing a dump must never evaluate
  // the profile's executable configuration expressions.
  const document = YAML.parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw new Error('DSH 模型配置无法解析，请检查 Profile 配置');
  const entries = document.toJS({ maxAliasCount: 100 });
  if (!Array.isArray(entries)) throw new Error('DSH 返回了无法识别的模型配置');
  const models = new Map();
  const selection = entries.find(row => row?.id === 'agent-default-model' || /\/dsh-agent-default-model$/.test(row?.name || ''))?.config;
  for (const entry of entries) {
    if (entry?.disabled || !/\/dsh-llm-(?:pi-ai|deepseek)$/.test(entry?.name || '')) continue;
    for (const [provider, config] of Object.entries(entry.config?.providers || {})) {
      for (const item of Array.isArray(config?.models) ? config.models : []) {
        const model = typeof item === 'string' ? item : item?.id;
        if (typeof model !== 'string' || !model.trim()) continue;
        const id = dshModelId(provider, model);
        models.set(id, { id, name: typeof item.name === 'string' ? item.name : model,
          provider, model, contextWindow: Number(item.contextWindow) || undefined,
          reasoningLevels:Object.keys(item.reasoningEfforts||{}).map(level=>level==='off'?'none':level) });
      }
    }
  }
  const currentModelId = typeof selection?.provider === 'string' && typeof selection?.model === 'string'
    ? dshModelId(selection.provider, selection.model) : '';
  if (currentModelId && !models.has(currentModelId)) models.set(currentModelId, { id: currentModelId, name: selection.model, provider: selection.provider, model: selection.model });
  return { models: [...models.values()], currentModelId, source: 'dsh', note: '读取 DSH headless Profile；选择仅作用于本会话。' };
}
async function discoverDsh(bin, cwd) { return dshCatalog(await cliOutput(bin, ['headless', '--dump-config'], cwd)); }

const cache = new Map();
const pending = new Map();
function mount(app, { agents, settings, sessions }) {
  app.get('/api/agents/:agent/models', async (req, res) => {
    const agent = req.params.agent, hostId = req.query.hostId || '';
    const custom = settings.data.customAgents?.find(item => item.id === agent);
    const preset = String(agent).startsWith('acp:') ? require('./acp-presets').resolveAcpAgent(agent) : null;
    if (!Object.hasOwn(agents.DEFS, agent) && !custom && !preset) return res.status(404).json({ error: 'Agent 不存在' });
    // Do not accidentally read the local CLI for a different computer.
    if (hostId) return res.json({ models: [], currentModelId: '', source: 'remote', note: '请填写目标环境中的原生模型 ID；此处不会借用本机模型目录。' });
    const center = require('./agent-center');
    const runtime = center.runtimeSettings(settings.data, agent, '');
    const command = center.configuration(settings.data, agent, '').command;
    const bin = command || (preset ? preset.cmd[0] : await agents.resolveBinAsync(agent, custom || agents.agentSettings(runtime, agent)));
    if (!bin) return res.status(400).json({ error: '未找到此 Agent 的 CLI，请先在 Agent 管理中检查启动路径' });
    const session = typeof req.query.sessionId === 'string' ? sessions().find(s => s.id === req.query.sessionId && s.agent === agent) : null;
    const cwd = session?.cwd || (typeof req.query.cwd === 'string' ? req.query.cwd : '') || defaultWorkspaceDir();
    let args = preset ? preset.cmd.slice(1) : custom?.args || [];
    const model=typeof req.query.model==='string'?req.query.model.trim().slice(0,256):'';
    const key = JSON.stringify([agent, bin, args, cwd, model]);
    try {
      if(!preset&&!custom&&['gemini','opencode'].includes(agent))args=await acpArgs(agent,bin,cwd);
      if (req.query.refresh !== '1' && cache.has(key) && Date.now() - cache.get(key).at < 60000) return res.json(cache.get(key).value);
      if (!pending.has(key)) {
        const task = (async () => {
          let value;
          if (agent === 'dsh') value = await discoverDsh(bin, cwd);
          else if(agent==='acp:workbuddy'){
            // WorkBuddy publishes its catalog in product.ioa.json. Reading
            // that catalog does not require an authenticated ACP session.
            const installed=(await agents.detectAgentsCached(settings.data)).find(item=>item.id===agent);
            value={models:(installed?.models||[]).map(id=>({id,name:id})),currentModelId:center.configuration(settings.data,agent,'').model||'',
              source:'installation',note:'来自 WorkBuddy 安装目录；连接与登录状态在启动会话时验证。'};
            if(!value.models.length)throw new Error('WorkBuddy 安装目录中未找到模型，请检查桌面端安装');
            try{
              const native=await require('./acp-agent').discoverModels({id:agent,bin,args,cwd,model});
              value={...native,models:native.models.length?native.models:value.models};
            }catch(error){value.controlsError=error.message;value.note+=' 原生权限与推理配置尚未读取成功；请检查登录或启动方式后刷新。';}
          } else if (preset || custom?.acp || agent === 'gemini' || agent === 'opencode') {
            value = await require('./acp-agent').discoverModels({ id: agent, bin,
              args, cwd, model });
          } else {
            const meta = (await agents.detectAgentsCached(settings.data)).find(row => row.id === agent);
            value = { models: meta?.modelCatalog?.length ? meta.modelCatalog : (meta?.models || []).map(id => ({ id, name: id })), currentModelId: '', source: 'cli' };
          }
          cache.set(key, { at: Date.now(), value });
          return value;
        })().finally(() => pending.delete(key));
        pending.set(key, task);
      }
      res.json(await pending.get(key));
    } catch (error) {
      res.status(400).json({ error: String(error.message || '原生模型目录读取失败').slice(0, 400) });
    }
  });
}
module.exports = { mount, discoverDsh, dshCatalog, dshModelId, dshSelection, dshPatch, dshProfilePatch, dshNativePatch, dshArgs, acpArgs, DSH_PERMISSIONS };
