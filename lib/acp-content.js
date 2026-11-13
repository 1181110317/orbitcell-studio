// Present ACP's structured content through OrbitCell's existing tool/file events.
function jsonText(value, max = 100000) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, max);
  try {
    const text = JSON.stringify(value, null, 2);
    if (text.length <= max) return text;
    return JSON.stringify({ preview: text.slice(0, Math.max(0, max - 150)), truncated: true });
  } catch { return ''; }
}
function blockText(block) {
  if (typeof block === 'string') return block;
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'content') return blockText(block.content);
  if (typeof block.text === 'string') return block.text;
  if (block.resource) return blockText(block.resource) || block.resource.uri || '';
  if (typeof block.content === 'string') return block.content;
  if (block.type === 'resource_link') return [block.name, block.uri].filter(Boolean).join(' · ');
  return '';
}
function toolStatus(status) {
  return ({ pending: 'pending', in_progress: 'running', completed: 'done', failed: 'error' })[status] || 'running';
}
function permissionTool(call = {}) {
  return call.kind === 'read' || call.kind === 'search' || call.kind === 'fetch' || call.kind === 'think' ? 'read_file'
    : call.kind === 'edit' ? 'write_file' : call.kind === 'execute' ? 'run_cmd' : 'unknown';
}
function createToolPresenter(emit, client) {
  const calls = new Map(), published = new Set(), watched = new Set(), frames = new Map(), outputs = new Map();
  function update(update) {
    const id = String(update.toolCallId || ''); if (!id) return;
    const previous = calls.get(id) || {};
    const call = { ...previous };
    for (const [key, value] of Object.entries(update)) if (value != null) call[key] = value;
    calls.set(id, call);
    const blocks = Array.isArray(call.content) ? call.content : [];
    const diffs = blocks.filter(b => b?.type === 'diff' && typeof b.path === 'string' && typeof b.newText === 'string');
    const raw = call.rawInput;
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : raw == null ? {} : { input: raw };
    const firstPath = call.locations?.find(location => typeof location?.path === 'string')?.path || diffs[0]?.path;
    if (firstPath && !input.path && !input.file_path) input.file_path = firstPath;
    if (diffs.length === 1) {
      if (diffs[0].oldText != null) input.old_string ??= diffs[0].oldText;
      input.new_string ??= diffs[0].newText;
    }
    if (call.title && !input.description) input.description = String(call.title);
    const wholeWrite = raw && typeof raw === 'object' && typeof raw.content === 'string';
    const name = call.name || ({ read: 'Read', edit: wholeWrite || diffs[0]?.oldText === null ? 'Write' : 'Edit', execute: 'Bash', search: 'Grep', fetch: 'WebFetch' })[call.kind] || call.title || 'tool';
    const status = toolStatus(call.status || 'pending');
    emit({ kind: 'tool', id, name, detail: jsonText(input), status });
    const output = blocks.map(blockText).filter(Boolean).join('\n') || jsonText(call.rawOutput, 16000) || outputs.get(id) || '';
    emit({ kind: 'tooloutput', id, output: output.slice(0, 16000), status });
    for (const block of blocks) {
      const content = block?.type === 'content' ? block.content : block;
      if (content?.type === 'image' && typeof content.data === 'string' && content.data.length <= 12 * 1024 * 1024 && /^image\/(png|jpe?g|gif|webp)$/i.test(content.mimeType || '') && /^[A-Za-z0-9+/]*={0,2}$/.test(content.data)) {
        const key = id + ':' + content.data;
        if (!published.has(key)) { published.add(key); emit({ kind: 'image', id, origin: 'tool', toolName: name, path: firstPath || '', images: ['data:' + content.mimeType + ';base64,' + content.data] }); }
      }
      if (block?.type === 'terminal' && typeof block.terminalId === 'string') {
        const key = id + ':' + block.terminalId;
        if (watched.has(key)) continue;
        const attached = client.watchTerminal(block.terminalId, item => {
          const flush = () => {
            frames.delete(key);
            const output = item.output.slice(-16000); outputs.set(id, output);
            emit({ kind: 'tooloutput', id, output, status: item.exitStatus ? item.exitStatus.exitCode === 0 ? 'done' : 'error' : 'running' });
          };
          if (item.exitStatus) { clearTimeout(frames.get(key)); flush(); }
          else if (!frames.has(key)) { const timer = setTimeout(flush, 100); timer.unref?.(); frames.set(key, timer); }
        });
        if (attached) watched.add(key);
      }
    }
    if (status === 'done') for (const diff of diffs) {
      const key = JSON.stringify([id, diff.path, diff.oldText, diff.newText]);
      if (published.has(key) || client.hasWritten(diff.path, diff.newText)) continue;
      published.add(key);
      const complete = Object.prototype.hasOwnProperty.call(diff, 'oldText') && (diff.oldText?.length || 0) + diff.newText.length <= 100000;
      emit({ kind: 'files', files: [{ path: diff.path, tool: 'Edit', kind: diff.oldText === null ? 'create' : 'update', created: diff.oldText === null,
        ...(complete ? { oldStr: diff.oldText ?? '', newStr: diff.newText } : { snapshotUnavailable: true }) }] });
    }
  }
  return { update, get(id) { return calls.get(id); }, close() { for (const timer of frames.values()) clearTimeout(timer); frames.clear(); } };
}
module.exports = { blockText, jsonText, toolStatus, permissionTool, createToolPresenter };
