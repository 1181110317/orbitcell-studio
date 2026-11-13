/* The remote catalog and the models selected by the user are separate state.
   Older providers have no selection field: keep all their existing models. */
(function(root) {
  'use strict';
  const clean = values => [...new Set((Array.isArray(values) ? values : []).filter(v => typeof v === 'string').map(v => v.trim()).filter(v => v && v.length <= 256))].slice(0, 2000);
  const available = p => clean([...clean(p.models), ...clean(p.manualModels), ...clean(p.enabledModels), p.model]);
  const selected = p => Array.isArray(p.enabledModels) ? clean(p.enabledModels) : available(p);
  const valid = values => Array.isArray(values) && values.length <= 2000 && values.every(v => typeof v === 'string' && !!v.trim() && v.length <= 256);
  const api = Object.freeze({clean, available, selected, valid});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentHubProviderModels = api;
})(typeof window === 'object' ? window : globalThis);
