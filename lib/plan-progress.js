'use strict';

// Only native plan events change progress. A tool call or the end of a turn
// cannot tell us that a step has completed.
const statusOf = value => value === 'completed' ? 'completed' : value === 'in_progress' || value === 'inProgress' ? 'in_progress' : 'pending';
function clean(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  if (typeof value.plan === 'string' && value.plan.trim()) out.plan = value.plan.slice(0, 131072);
  if (typeof value.explanation === 'string' && value.explanation.trim()) out.explanation = value.explanation.slice(0, 4000);
  if (Array.isArray(value.todos)) {
    out.todos = value.todos.filter(t => t && typeof t === 'object' && !Array.isArray(t)).map(t => {
      const text = [t.text, t.content, t.step, t.activeForm].find(v => typeof v === 'string' && v.trim()) || '';
      const item = { text: text.slice(0, 2000), status: statusOf(t.status) };
      if (typeof t.activeForm === 'string' && t.activeForm.trim() && t.activeForm !== text) item.activeForm = t.activeForm.slice(0, 2000);
      return item;
    }).filter(t => t.text).slice(0, 100);
  }
  return out.plan || out.todos?.length ? out : undefined;
}
function latest(messages) {
  for (let i = (messages?.length || 0) - 1; i >= 0; i--) {
    const plan = clean(messages[i]?.plan);
    if (plan?.todos?.length) return plan;
  }
  return null;
}
function promptFor(session) {
  if (session?.agent === 'chat') return '';
  const instruction = '多步骤实施任务请使用当前 Agent 已提供的原生计划工具维护执行清单：开始某一步时标为进行中，实际完成后再标为已完成。执行清单与计划正文是两回事；不要只写一份 Markdown 计划后一直不更新。工具不支持结构化计划时，用正文说明当前步骤，不要声称界面已经更新。简单问答无需创建计划。';
  const plan = latest(session?.messages);
  if (!plan || plan.todos.every(t => t.status === 'completed')) return instruction;
  const rows = plan.todos.map((t, i) => `${i + 1}. [${t.status}] ${t.text}`).join('\n').slice(0, 12000);
  return instruction + '\n\n当前会话上次报告的执行清单如下。先核对本轮任务是否仍在继续这份计划；需要调整时通过原生计划工具更新，不要擅自把未完成项标为完成。\n' + rows;
}
module.exports = { clean, latest, promptFor };
