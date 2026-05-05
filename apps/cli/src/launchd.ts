import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAUNCHD_LABEL = 'sh.tether.gateway';

export type GatewayPlistOptions = {
  nodePath?: string;
  launcherPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  env?: NodeJS.ProcessEnv;
};

export type GatewayRuntimeInfo = {
  nodePath: string;
  nodeVersion: string;
  launcherPath: string;
  installedAt: number;
};

export type LaunchAgentStatus = {
  label: string;
  path: string;
  installed: boolean;
  loaded: boolean;
  pid?: number;
  raw?: string;
  error?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function launchAgentPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'sh.tether.gateway.plist');
}

export function launchdServiceTarget(uid = process.getuid?.()): string {
  if (typeof uid !== 'number') {
    throw new Error('launchd gui uid is unavailable');
  }
  return `gui/${uid}`;
}

export function buildGatewayPlist(options: GatewayPlistOptions = {}): string {
  const args = gatewayProgramArguments(options);
  const stdoutPath = options.stdoutPath ?? path.join(os.homedir(), '.tether', 'logs', 'gateway.out.log');
  const stderrPath = options.stderrPath ?? path.join(os.homedir(), '.tether', 'logs', 'gateway.err.log');
  const environment = launchdEnvironment(options.env);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapePlist(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((arg) => `    <string>${escapePlist(arg)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(environment).map(([key, value]) => `    <key>${escapePlist(key)}</key>\n    <string>${escapePlist(value)}</string>`).join('\n')}
  </dict>
  <key>StandardOutPath</key>
  <string>${escapePlist(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapePlist(stderrPath)}</string>
</dict>
</plist>
`;
}

export async function installLaunchAgent(options: GatewayPlistOptions = {}): Promise<string> {
  const plistPath = launchAgentPath();
  await mkdir(path.dirname(plistPath), { recursive: true });
  await mkdir(path.join(os.homedir(), '.tether', 'logs'), { recursive: true });
  await writeFile(plistPath, buildGatewayPlist(options), 'utf8');
  // 记录当前 runtime 快照，供 doctor 检测 nodePath / launcher 是否仍存在
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const launcherPath = resolveLauncherPath(options.launcherPath);
  await writeGatewayRuntimeInfo({
    nodePath,
    nodeVersion: process.version,
    launcherPath,
    installedAt: Date.now()
  });
  return plistPath;
}

export async function startLaunchAgent(options: GatewayPlistOptions = {}): Promise<LaunchAgentStatus> {
  const plistPath = await installLaunchAgent(options);
  const target = launchdServiceTarget();
  const bootstrap = await runLaunchctl(['bootstrap', target, plistPath]);
  if (bootstrap.code !== 0 && !/already|exists|in progress/i.test(bootstrap.stderr + bootstrap.stdout)) {
    const current = await launchAgentStatus();
    if (!current.loaded) {
      throw new Error(`launchctl bootstrap failed: ${bootstrap.stderr || bootstrap.stdout || `exit ${bootstrap.code}`}`);
    }
  }

  const service = `${target}/${LAUNCHD_LABEL}`;
  const kickstart = await runLaunchctl(['kickstart', '-k', service]);
  if (kickstart.code !== 0) {
    throw new Error(`launchctl kickstart failed: ${kickstart.stderr || kickstart.stdout || `exit ${kickstart.code}`}`);
  }
  return launchAgentStatus();
}

export async function stopLaunchAgent(): Promise<LaunchAgentStatus> {
  const target = launchdServiceTarget();
  const result = await runLaunchctl(['bootout', `${target}/${LAUNCHD_LABEL}`]);
  if (result.code !== 0 && !/not found|No such process|Could not find/i.test(result.stderr + result.stdout)) {
    throw new Error(`launchctl bootout failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
  return launchAgentStatus();
}

export async function restartLaunchAgent(options: GatewayPlistOptions = {}): Promise<LaunchAgentStatus> {
  await stopLaunchAgent();
  return startLaunchAgent(options);
}

export async function uninstallLaunchAgent(): Promise<string> {
  await stopLaunchAgent();
  const plistPath = launchAgentPath();
  await rm(plistPath, { force: true });
  return plistPath;
}

export async function launchAgentStatus(): Promise<LaunchAgentStatus> {
  const plistPath = launchAgentPath();
  const installed = fs.existsSync(plistPath);
  const target = launchdServiceTarget();
  const result = await runLaunchctl(['print', `${target}/${LAUNCHD_LABEL}`]);
  if (result.code !== 0) {
    return {
      label: LAUNCHD_LABEL,
      path: plistPath,
      installed,
      loaded: false,
      error: result.stderr || result.stdout || `exit ${result.code}`
    };
  }

  const raw = result.stdout;
  return {
    label: LAUNCHD_LABEL,
    path: plistPath,
    installed,
    loaded: true,
    pid: parseLaunchctlPid(raw),
    raw
  };
}

function gatewayProgramArguments(options: GatewayPlistOptions): string[] {
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const launcherPath = resolveLauncherPath(options.launcherPath);
  return [nodePath, launcherPath, 'gateway'];
}

export function resolveLauncherPath(override?: string): string {
  if (override) return path.resolve(override);
  // dev: __dirname = apps/cli/src/, launcher 在 repo 根 bin/tether (../../../bin/tether)
  // prod: __dirname = dist/cli/, launcher 在包根 bin/tether (../../bin/tether)
  const candidates = [
    path.resolve(__dirname, '..', '..', 'bin', 'tether'),
    path.resolve(__dirname, '..', '..', '..', 'bin', 'tether')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`tether launcher 路径未找到，候选：${candidates.join(', ')}`);
}

export function gatewayRuntimeJsonPath(): string {
  return path.join(os.homedir(), '.tether', 'gateway-runtime.json');
}

export async function writeGatewayRuntimeInfo(info: GatewayRuntimeInfo): Promise<string> {
  const filePath = gatewayRuntimeJsonPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  return filePath;
}

export function readGatewayRuntimeInfo(): GatewayRuntimeInfo | undefined {
  try {
    const raw = fs.readFileSync(gatewayRuntimeJsonPath(), 'utf8');
    return JSON.parse(raw) as GatewayRuntimeInfo;
  } catch {
    return undefined;
  }
}

function launchdEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const pathValue = env.PATH && env.PATH.length > 0
    ? env.PATH
    : '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const result: Record<string, string> = {
    HOME: os.homedir(),
    PATH: pathValue
  };
  for (const key of [
    'TETHER_GATEWAY_PROFILE',
    'TETHER_SERVER_URL',
    'TETHER_RELAY_URL',
    'TETHER_RELAY_SECRET',
    'TETHER_AUTH_PATH'
  ]) {
    const value = env[key];
    if (value) {
      result[key] = value;
    }
  }
  return result;
}

function runLaunchctl(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('launchctl', args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseLaunchctlPid(raw: string): number | undefined {
  const match = /(?:pid|PID)\s*=\s*(\d+)/.exec(raw);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

function escapePlist(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
