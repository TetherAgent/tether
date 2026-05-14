import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TetherConfig } from '@tether/config';
import * as terminal from '../terminal.js';
import { buildClaudeHudHookScript } from './claude-hud-hook-script.js';

export type EnsureClaudeHudHookOptions = {
  host: string;
  port: number;
  config?: TetherConfig;
  env?: NodeJS.ProcessEnv;
  settingsPath?: string;
  hookPath?: string;
  nodePath?: string;
};

export type EnsureClaudeHudHookResult =
  | { status: 'disabled' | 'skipped' | 'ready'; reason?: string }
  | { status: 'installed' | 'updated'; settingsBackupPath?: string };

const TETHER_HOOK_MARKER = 'claude-hud-hook.js';

export async function ensureClaudeHudHook(options: EnsureClaudeHudHookOptions): Promise<EnsureClaudeHudHookResult> {
  const env = options.env ?? process.env;
  if (isFalseEnv(env.TETHER_CLAUDE_HOOK_AUTO_INSTALL) || options.config?.claudeHook?.autoInstall === false) {
    terminal.line('Claude HUD hook', '已禁用');
    return { status: 'disabled', reason: 'disabled' };
  }
  if (!isLoopbackHost(options.host)) {
    terminal.line('Claude HUD hook', `跳过自动安装：Gateway 当前绑定 ${options.host}`);
    return { status: 'skipped', reason: 'non_loopback_gateway' };
  }
  if (!claudeCodeExists(env)) {
    terminal.line('Claude HUD hook', '跳过自动安装：未找到 claude 命令');
    return { status: 'skipped', reason: 'claude_not_found' };
  }

  const endpoint = `http://127.0.0.1:${options.port}/api/hook/claude/context`;
  const hookPath = options.hookPath ?? path.join(os.homedir(), '.tether', 'hooks', 'claude-hud-hook.js');
  await writeHookScript(hookPath, endpoint);

  const settingsPath = options.settingsPath ?? path.join(os.homedir(), '.claude', 'settings.json');
  const settings = await readSettings(settingsPath);
  const command = `${shellQuote(options.nodePath ?? process.execPath)} ${shellQuote(hookPath)} --endpoint ${shellQuote(endpoint)}`;
  const { next, changed, portChanged } = mergeStopHook(settings.value, command);
  if (!changed) {
    return { status: 'ready' };
  }

  terminal.line('Claude HUD hook', portChanged ? '正在更新 Claude HUD hook 端口...' : '正在安装 Claude HUD hook...');
  const settingsBackupPath = settings.exists ? await backupSettings(settingsPath) : undefined;
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { status: portChanged ? 'updated' : 'installed', settingsBackupPath };
}

function isFalseEnv(value: string | undefined): boolean {
  return value === '0' || value === 'false' || value === 'no';
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function claudeCodeExists(env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync('claude', ['--version'], { env, stdio: 'ignore' });
  return result.status === 0 || result.error === undefined;
}

async function writeHookScript(hookPath: string, endpoint: string): Promise<void> {
  const content = buildClaudeHudHookScript(endpoint);
  const existing = await readFile(hookPath, 'utf8').catch(() => undefined);
  if (existing === content) {
    return;
  }
  await mkdir(path.dirname(hookPath), { recursive: true });
  await writeFile(hookPath, content, { encoding: 'utf8', mode: 0o755 });
}

async function readSettings(settingsPath: string): Promise<{ exists: boolean; value: Record<string, unknown> }> {
  const raw = await readFile(settingsPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (raw === undefined) {
    return { exists: false, value: {} };
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid Claude settings JSON: ${settingsPath}`);
  }
  return { exists: true, value: parsed as Record<string, unknown> };
}

async function backupSettings(settingsPath: string): Promise<string> {
  const backupPath = `${settingsPath}.tether-backup-${timestamp()}`;
  if (existsSync(settingsPath)) {
    await writeFile(backupPath, await readFile(settingsPath));
  }
  return backupPath;
}

function mergeStopHook(settings: Record<string, unknown>, command: string): { next: Record<string, unknown>; changed: boolean; portChanged: boolean } {
  const hooks = objectValue(settings.hooks);
  const currentStop = Array.isArray(hooks?.Stop) ? hooks!.Stop : [];
  const retained = currentStop.filter((entry) => !isTetherStopHook(entry));
  const nextHook = { hooks: [{ type: 'command', command }] };
  const existing = currentStop.find(isTetherStopHook);
  const portChanged = existing !== undefined && JSON.stringify(existing) !== JSON.stringify(nextHook);
  const changed = portChanged || existing === undefined || retained.length !== currentStop.length - 1;
  if (!changed) {
    return { next: settings, changed: false, portChanged: false };
  }
  return {
    next: {
      ...settings,
      hooks: {
        ...(hooks ?? {}),
        Stop: [...retained, nextHook]
      }
    },
    changed: true,
    portChanged
  };
}

function isTetherStopHook(entry: unknown): boolean {
  const hooks = Array.isArray(objectValue(entry)?.hooks) ? objectValue(entry)!.hooks as unknown[] : [];
  return hooks.some((hook) => {
    const command = objectValue(hook)?.command;
    return typeof command === 'string' && command.includes(TETHER_HOOK_MARKER);
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}
