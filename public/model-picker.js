/* Available slider stops come from the selected model's own catalog. */
(function (root, factory) {
  const picker = factory();
  if (typeof module === 'object' && module.exports) module.exports = picker;
  else root.AgentHubModelPicker = picker;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const labels = { none: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极高' };
  const descriptions = { none: '关闭额外推理。', minimal: '更快响应，适合简单任务。', low: '更快响应，适合日常问题。', medium: '兼顾响应速度与推理深度。', high: '更深入推理，适合复杂任务。', xhigh: '加深分析，适合多步问题。', max: '优先推理深度，可能需要更长时间。', ultra: '加大推理投入，可能需要更长时间。' };
  function policy({ agent, style, model, providerId, agentCatalog = [], providerCatalog = [], nativeReasoning = null, nativeNote = '', loading = false, failed = false } = {}) {
    const native = !!nativeReasoning || String(agent||'').startsWith('acp:') || ['gemini','opencode'].includes(agent);
    const supported = native || ['claude', 'codex', 'zcode', 'dsh', 'builtin', 'chatgpt-web'].includes(agent) || ['claude', 'codex'].includes(style);
    if (!supported) return { levels: [], note: '推理由 Agent 自身管理', supported: false };
    const entry = providerId ? providerCatalog.find(row => row.providerId === providerId && row.id === model) : agentCatalog.find(row => row.id === model);
    const raw = nativeReasoning ? nativeReasoning.options.map(item=>item.value==='off'?'none':item.value) : entry && (providerId ? entry.efforts : entry.reasoningLevels);
    // ZCode has no native disable switch; never offer a nonfunctional stop.
    const levels = order.filter(value => raw?.includes(value)
      && (agent !== 'zcode' || ['low','high','max'].includes(value))
      && (agent !== 'claude' || ['none','low','medium','high','xhigh','max'].includes(value)));
    const note = levels.length ? (providerId ? '模型连接目录' : 'Agent 模型目录')
      : loading ? '正在读取模型档位…' : failed ? '目录读取失败，可重试'
        : native ? nativeNote || 'Agent 尚未公布可调推理档位，可刷新原生配置。'
          : entry?.reasoning ? '此模型未提供可调档位' : '未提供推理档位，使用模型默认设置';
    return { levels, note, supported: true };
  }
  return { order, labels, label: value => labels[value] || '默认', shortLabel: value => order.includes(value) ? value : 'default', description: value => descriptions[value] || '使用模型或 Agent 的默认推理强度。', policy };
});
