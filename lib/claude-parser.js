// claude/zcode stream-json 输出解析器（从 agents.js 抽出，供一次性路径与常驻桥共用）
const OUTPUT_CAP = 9000;
const usageMetrics = require('./usage-metrics');
// 清理工具输出：null 字节（wmic 等 UTF-16 命令的产物）、控制字符（保留 \n \r \t）
function sanitizeToolOutput(s) {
  return String(s || '')
    .replace(/\0/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
function capOutput(s) {
  s = sanitizeToolOutput(s);
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, 6500) + '\n\n…（中间内容过长已截断）…\n\n' + s.slice(-2000);
}
function shortJson(v) { try { return JSON.stringify(v).slice(0, 131072); } catch { return String(v).slice(0, 131072); } }
function normClaudeUsage(u, model) {
  return usageMetrics.fromWire(u,'anthropic',model);
}

function makeClaudeParser(emit) {
  // 流式块状态：content_block index -> {type, id, name, json}
  const blocks = new Map();
  const pendingFiles = new Map();
  const webUrls = new Map(); // tool_use_id -> url（WebFetch）
  const toolInfo = new Map();
  let lastModel = '', lastContext = 0, requestCount = 0;
  // Some compatible CLIs only return the final answer on `result`, after tools.
  // A prior commentary message must not suppress that answer.
  let completeTextParts = [];
  // Claude can send one assistant snapshot per block, before or after that
  // block's stream stop. Keep the stream's identity across those snapshots.
  // Never suppress equal prose belonging to another API message.
  const streamedMessages = new Map();
  let streamMessageId = '';
  function finishContent(b) {
    if (b.finished || !b.text) return;
    b.finished = true;
    if (b.type === 'text') completeTextParts.push(b.text);
    emit({ kind: b.type === 'text' ? 'text' : 'think', text: b.text });
  }
  function consumedStreamSnapshot(messageId, type, text, used) {
    // Compatible CLIs may replace the API message ID when wrapping the full
    // assistant snapshot. Match only the current stream, and bind that alias;
    // a later message_start has a separate record and is never content-deduped.
    const records = streamedMessages.get(messageId || streamMessageId)
      || streamedMessages.get(streamMessageId) || [];
    const block = records.find(b => !used.has(b) && b.type === type && b.text === text);
    if (!block) return false;
    if (messageId && !streamedMessages.has(messageId)) streamedMessages.set(messageId, records);
    used.add(block);
    finishContent(block);
    return true;
  }
  const usageMessages = new Set();
  let requestDetails=[];
  let messageUsage=null;
  function recordMessageUsage(msg, streamed=false) {
    if(!msg?.usage||msg.id&&usageMessages.has(msg.id))return;
    if(msg.id)usageMessages.add(msg.id);
    const usage=normClaudeUsage(msg.usage,msg.model||lastModel);
    if(!usage.usageKnown)return;
    requestCount++;
    const row={...usage,id:msg.id||'claude-'+requestCount,ts:new Date(msg.startedAt||Date.now()).toISOString(),success:true};
    if(streamed&&msg.startedAt){row.elapsedMs=Date.now()-msg.startedAt;if(msg.firstText){row.ttftMs=msg.firstText-msg.startedAt;row.ttftRequests=1;}}
    requestDetails.push(row);lastContext=usage.context;
    emit({kind:'usage',usage:{...usage,requests:1,lastRequest:row,requestDetails:[row]}});
  }
  return (line) => {
    let obj; try { obj = JSON.parse(line); } catch { return; }
    // ---- 部分消息（真流式）----
    if (obj.type === 'stream_event' && obj.event) {
      const ev = obj.event;
      const idx = ev.index;
      if(ev.type==='message_start'){
        blocks.clear();
        streamMessageId = ev.message?.id || Symbol('message');
        streamedMessages.set(streamMessageId, []);
        while (streamedMessages.size > 32) streamedMessages.delete(streamedMessages.keys().next().value);
        messageUsage={...ev.message,usage:{...ev.message?.usage},startedAt:Date.now()};
        if(messageUsage.model)lastModel=messageUsage.model;
      } else if(ev.type==='message_delta'){
        if(messageUsage&&ev.usage)Object.assign(messageUsage.usage,ev.usage);
      } else if(ev.type==='message_stop'){
        recordMessageUsage(messageUsage,true);messageUsage=null;
      } else if (ev.type === 'content_block_start') {
        const b = ev.content_block || {};
        const record = { type: b.type, id: b.id || '', name: b.name || '', input: b.input, json: '', text: b.text || b.thinking || '' };
        blocks.set(idx, record);
        if (b.type === 'text' || b.type === 'thinking') {
          if (!streamedMessages.has(streamMessageId)) streamedMessages.set(streamMessageId, []);
          streamedMessages.get(streamMessageId).push(record);
          if (record.text) emit({ kind: b.type === 'text' ? 'delta' : 'thinkdelta', text: record.text });
        }
        // Announce the row before large Write/Edit arguments finish streaming.
        // File and plan metadata still require the complete, valid JSON input.
        if (b.type === 'tool_use' && b.id) {
          completeTextParts = [];
          emit({ kind: 'tool', id: b.id, name: b.name, detail: '', status: 'running' });
        }
      } else if (ev.type === 'content_block_delta') {
        const b = blocks.get(idx) || {};
        const d = ev.delta || {};
        if (d.type === 'text_delta' && d.text) { b.text = (b.text || '') + d.text; if(messageUsage&&!messageUsage.firstText)messageUsage.firstText=Date.now();emit({ kind: 'delta', text: d.text });}
        else if (d.type === 'thinking_delta' && d.thinking) { b.text = (b.text || '') + d.thinking; emit({ kind: 'thinkdelta', text: d.thinking }); }
        else if (d.type === 'input_json_delta' && d.partial_json) b.json += d.partial_json;
      } else if (ev.type === 'content_block_stop') {
        const b = blocks.get(idx);
        if (b && b.type === 'tool_use') {
          try { handleToolUse(b.name, b.json ? JSON.parse(b.json) : b.input || {}, b.id); } catch {}
        } else if (b?.text && (b.type === 'text' || b.type === 'thinking')) {
          // Finish prose before the next tool starts. The complete assistant
          // message repeats these blocks later and must not insert them again.
          finishContent(b);
        }
        blocks.delete(idx);
      }
      return;
    }
    if (obj.type === 'system' && obj.subtype === 'init') {
      if (obj.session_id) emit({ kind: 'session', id: obj.session_id });
      if (Array.isArray(obj.slash_commands)) emit({ kind: 'runtime', protocol: 'claude', commands: obj.slash_commands.slice(0, 100).map(c => typeof c === 'string' ? { name: c } : c).filter(c => c && typeof c.name === 'string') });
    }
    if(obj.type==='system'&&['task_started','task_progress','task_notification'].includes(obj.subtype)){
      emit({kind:'background-task',id:obj.task_id||'',toolUseId:obj.tool_use_id||'',status:obj.subtype==='task_notification'?(obj.status==='completed'?'done':obj.status==='failed'?'error':obj.status==='stopped'?'stopped':'unknown'):'running',description:obj.description||'',output:obj.summary||''});
    }
    if (obj.type === 'assistant' && obj.message) {
      const msg = obj.message;
      if (msg.model && !/^<|^(unknown|synthetic)$/i.test(msg.model)) lastModel = msg.model;
      if (Array.isArray(msg.content)) {
        let messageTextParts = [];
        const used = new Set();
        for (const b of msg.content) {
          if (b.type === 'text' && b.text) {
            const streamed = consumedStreamSnapshot(msg.id, 'text', b.text, used);
            messageTextParts.push(b.text);
            if (!streamed) { emit({ kind: 'text', text: b.text }); completeTextParts = messageTextParts; }
          }
          else if (b.type === 'tool_use') { handleToolUse(b.name, b.input, b.id); messageTextParts = []; }
          else if (b.type === 'thinking' && b.thinking && !consumedStreamSnapshot(msg.id, 'thinking', b.thinking, used)) emit({ kind: 'think', text: b.thinking });
        }
      }
      if(messageUsage&&msg.id===messageUsage.id){
        if(msg.usage)Object.assign(messageUsage.usage,msg.usage);
      }else recordMessageUsage(msg);
    }
    if (obj.type === 'user' && obj.message && Array.isArray(obj.message.content)) {
      for (const b of obj.message.content) {
        if (b.type === 'tool_result') {
          const id = b.tool_use_id;
          if (pendingFiles.has(id)) {
            const files = pendingFiles.get(id);
            pendingFiles.delete(id);
            if (!b.is_error) emit({ kind: 'files', files });
          }
          if (id && webUrls.has(id)) { emit({ kind: 'webview', url: webUrls.get(id) }); webUrls.delete(id); }
          // 工具结果里的图片（如截图、Read 图片）
          const imgs = [];
          let textParts = [];
          if (Array.isArray(b.content)) {
            for (const c of b.content) {
              if (c.type === 'image' && c.source && c.source.data) {
                imgs.push('data:' + (c.source.media_type || 'image/png') + ';base64,' + c.source.data);
              } else if (c.type === 'text' && c.text) textParts.push(c.text);
            }
          } else if (typeof b.content === 'string') textParts.push(b.content);
          if (imgs.length) emit({ kind: 'image', images: imgs, id, origin: 'tool', ...(toolInfo.get(id) || {}) });
          const out = capOutput(textParts.join('\n'));
          if (out.trim()) emit({ kind: 'tooloutput', id, output: out, status: b.is_error ? 'error' : 'done' });
          else if (id) emit({ kind: 'tooloutput', id, output: '', status: b.is_error ? 'error' : 'done' });
        }
      }
    }
    if (obj.type === 'result') {
      recordMessageUsage(messageUsage,true);messageUsage=null;
      const repeatsText = typeof obj.result === 'string' && [completeTextParts.join(''), completeTextParts.join('\n\n')].some(text => text.trim() === obj.result.trim());
      if (!obj.is_error && !repeatsText && typeof obj.result === 'string' && obj.result.trim()) {
        emit({ kind: 'text', text: obj.result });
      }
      // 整轮合计随 done 事件一次性带回，不再单独发 usage——避免与各条消息的 usage 重复累加
      pendingFiles.clear();
      // result.usage is a bill for the whole turn; it is never a context window.
      const modelUsage = obj.modelUsage && Object.entries(obj.modelUsage);
      if (!lastModel && modelUsage?.length) lastModel = modelUsage.sort((a,b) => (b[1]?.inputTokens || 0) - (a[1]?.inputTokens || 0))[0][0];
      emit({ kind: 'done', text: obj.result || '', isError: !!obj.is_error, sessionId: obj.session_id || null,
        usage: obj.usage ? { ...normClaudeUsage(obj.usage, lastModel), context: lastContext, requestDetails, lastRequest:requestDetails.at(-1), ...(requestCount ? { requests: requestCount } : {}) } : null });
      toolInfo.clear(); usageMessages.clear(); lastModel = ''; lastContext = 0; requestCount = 0;
      requestDetails=[]; completeTextParts = []; streamedMessages.clear(); blocks.clear(); streamMessageId = '';
    }
  };

  function handleToolUse(name, input, toolId) {
    input = input || {};
    completeTextParts = [];
    if (toolId) toolInfo.set(toolId, { toolName: name, path: input.file_path || input.path || '' });
    emit({ kind: 'tool', id: toolId || '', name, detail: shortJson(input), status: 'running' });
    if (toolId && name === 'WebFetch' && input.url) webUrls.set(toolId, input.url);
    if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      const plan = require('./plan-progress').clean({ todos: input.todos });
      if (plan) emit({ kind: 'plan', ...plan });
    } else if (name === 'ExitPlanMode' && input.plan) {
      emit({ kind: 'plan', plan: input.plan });
    } else if (name === 'Write') {
      if (toolId) pendingFiles.set(toolId, [{ path: input.file_path, tool: 'Write', oldStr: '', newStr: String(input.content ?? '') }]);
    } else if (name === 'Edit') {
      if (toolId) pendingFiles.set(toolId, [{ path: input.file_path, tool: 'Edit', oldStr: String(input.old_string ?? ''), newStr: String(input.new_string ?? ''), ...(input.replace_all === true ? { replaceAll: true } : {}) }]);
    } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
      if (toolId) pendingFiles.set(toolId, input.edits.map(e => ({ path: input.file_path, tool: 'Edit', oldStr: String(e.old_string ?? ''), newStr: String(e.new_string ?? '') })));
    }
  }
}

module.exports = { makeClaudeParser, normClaudeUsage, capOutput, sanitizeToolOutput, shortJson, OUTPUT_CAP };
