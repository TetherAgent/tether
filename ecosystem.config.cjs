const fs = require('node:fs');
const path = require('node:path');

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readShellEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    env[match[1]] = unquote(match[2]);
  }
  return env;
}

const repoRoot = fs.existsSync('/data/tether') ? '/data/tether' : __dirname;
const runtimeEnv = {
  ...readShellEnv(path.join(repoRoot, 'env.sh')),
  ...readShellEnv('/data/env/tether.sh')
};

module.exports = {
  apps: [
    {
      name: 'tether-relay',
      script: './apps/relay/dist/main.js',
      cwd: repoRoot,
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        ...runtimeEnv
      },
    },
  ],
};
