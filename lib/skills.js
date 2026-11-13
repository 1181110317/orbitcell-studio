const fs = require('fs/promises');
const crypto = require('crypto');

async function inventory(cwd, disabled = [], options = {}) {
  return require('./capability-inventory').scanSkills(cwd, disabled, options);
}
async function prepare(session, disabled, prompt = '') {
  if (session.remoteHostId || session.agent === 'chatgpt-web') return { prompt: '', skills: [], nativePolicy: [], hash: '' };
  const discovered = await inventory(session.cwd || require('./workspace').defaultWorkspaceDir(), disabled, {agent:session.agent});
  const seen = new Set();
  const all = discovered.filter(skill => {if(seen.has(skill.name))return false;seen.add(skill.name);return true;}).slice(0,80);
  const selected = Array.isArray(session.skillSelection) ? new Set(session.skillSelection) : null;
  const mentioned = new Set([...String(prompt).matchAll(/(?:^|\s)[$/]([A-Za-z0-9._-]{1,160})(?=\s|$)/g)].map(m => m[1]));
  const skills = all.filter(s => s.enabled && (!selected || selected.has(s.name)));
  let text = '';
  if (skills.length) {
    text = 'OrbitCell 本轮可用技能（仅在与任务相关时使用，先读取对应 SKILL.md；用户明确要求优先于技能说明）：\n' + skills.map(s => '- ' + s.name + ': ' + s.description + '\n  SKILL.md: ' + s.path).join('\n');
    let budget = 64 * 1024;
    for (const s of skills.filter(s => mentioned.has(s.name) || selected?.has(s.name)).slice(0, 8)) {
      let raw;
      try { raw = await fs.readFile(s.path, 'utf8'); }
      catch { text += '\n技能 ' + s.name + ' 已不可读取，本轮跳过。'; continue; }
      if (raw.length > budget) { text += '\n技能 ' + s.name + ' 正文较长，请按路径读取。'; continue; }
      text += '\n\n[技能 ' + s.name + '，来源 ' + s.path + ']\n' + raw;
      budget -= raw.length;
    }
  }
  const nativePolicy = all.map(s => ({ name: s.name, path: s.path, enabled: s.enabled && (!selected || selected.has(s.name)) }));
  return { prompt: text, skills, nativePolicy, hash: crypto.createHash('sha256').update(text + JSON.stringify(nativePolicy)).digest('hex') };
}
function selection(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 80 || value.some(n => typeof n !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(n))) throw new Error('技能选择无效');
  return [...new Set(value)];
}
module.exports = { inventory, prepare, selection };
