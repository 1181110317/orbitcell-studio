// Desktop-packaged ZCode 0.17.x keeps its public provider catalog in
// resources/config/provider, beside resources/glm rather than inside it.
// Help/version can succeed even when the CLI's own startup locator misses it.
const fs = require('fs');
const path = require('path');
function installationEnv(bin, env = process.env) {
  if (env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE?.trim()) return {};
  if (typeof bin !== 'string' || !bin || !/\.(?:cjs|mjs|js)$/i.test(bin)) return {};
  let entry;
  try { entry = fs.realpathSync(bin); } catch { return {}; }
  const dir = path.dirname(entry);
  for (const file of [path.join(dir, 'provider', 'zcode-builtin.json'), path.resolve(dir, '../config/provider/zcode-builtin.json')]) {
    try { if (fs.statSync(file).isFile()) return { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: file }; } catch {}
  }
  return {};
}
module.exports = { installationEnv };
