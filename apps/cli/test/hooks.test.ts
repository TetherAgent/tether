import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureClaudeHudHook } from '../src/gateway/hooks.js';

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-cli-hooks-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function installFakeClaude(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'claude');
  writeFileSync(bin, '#!/usr/bin/env node\nconsole.log("1.0.0");\n', 'utf8');
  chmodSync(bin, 0o755);
}

test('ensureClaudeHudHook installs and updates only the Tether-managed Stop hook', async () => {
  const { dir, cleanup } = tempDir();
  const binDir = path.join(dir, 'bin');
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  const hookPath = path.join(dir, '.tether', 'hooks', 'claude-hud-hook.js');
  installFakeClaude(binDir);
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'echo user-hook' }] }
      ]
    }
  }), 'utf8');
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };
  try {
    const first = await ensureClaudeHudHook({ host: '127.0.0.1', port: 4789, env, settingsPath, hookPath, nodePath: '/usr/bin/node' });
    assert.equal(first.status, 'installed');
    const installed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(installed.hooks.Stop.length, 2);
    assert.equal(installed.hooks.Stop[0].hooks[0].command, 'echo user-hook');
    assert.match(installed.hooks.Stop[1].hooks[0].command, /claude-hud-hook\.js/);
    assert.match(readFileSync(hookPath, 'utf8'), /127\.0\.0\.1:4789\/api\/hook\/claude\/context/);

    const second = await ensureClaudeHudHook({ host: '127.0.0.1', port: 4790, env, settingsPath, hookPath, nodePath: '/usr/bin/node' });
    assert.equal(second.status, 'updated');
    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(updated.hooks.Stop.length, 2);
    assert.match(updated.hooks.Stop[1].hooks[0].command, /claude-hud-hook\.js/);
    assert.match(readFileSync(hookPath, 'utf8'), /127\.0\.0\.1:4790\/api\/hook\/claude\/context/);
  } finally {
    cleanup();
  }
});

test('ensureClaudeHudHook skips non-loopback gateway bindings', async () => {
  const { dir, cleanup } = tempDir();
  const binDir = path.join(dir, 'bin');
  installFakeClaude(binDir);
  try {
    const result = await ensureClaudeHudHook({
      host: '0.0.0.0',
      port: 4789,
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
      settingsPath: path.join(dir, '.claude', 'settings.json'),
      hookPath: path.join(dir, '.tether', 'hooks', 'claude-hud-hook.js')
    });
    assert.deepEqual(result, { status: 'skipped', reason: 'non_loopback_gateway' });
  } finally {
    cleanup();
  }
});
