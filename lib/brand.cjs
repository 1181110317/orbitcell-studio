'use strict';
// Keep existing installations and integrations working while new deployments
// use the product's current environment prefix. An explicit new name wins.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('ORBITCELL_')) process.env['AGENTHUB_' + name.slice(10)] = value;
}
module.exports = Object.freeze({ name: 'OrbitCell', product: 'OrbitCell Studio',
  description: 'Unify Agents, Models, Tools and Workflows.',
  slogan: 'One Orbit. Infinite Possibilities.' });
