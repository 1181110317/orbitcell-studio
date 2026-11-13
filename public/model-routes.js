(() => {
  const open = () => AgentHubFeatures.modelCenter('agents');
  // Reuse the catalog card registered by features.js instead of showing a
  // second "model" card that unexpectedly navigates to Agent management.
  AgentHubFeatures.register('models', '模型与供应商', '模型目录、共享连接与配置预设', () => AgentHubFeatures.modelCenter('models'), '常用工具');
  Object.assign(AgentHubFeatures, { modelRoutes: open });
})();
