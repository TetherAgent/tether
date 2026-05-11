import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PROVIDERS } from '@tether/core';
import { buildCreateSessionPayload } from '../src/forwarding.js';

const mainSource = () => readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('does not include command-shaped fields in forwarded create payload', () => {
  const payload = buildCreateSessionPayload(
    PROVIDERS.codex,
    { project: '.', providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450'] },
    { columns: 100, rows: 30 }
  );

  assert.deepEqual(Object.keys(payload).sort(), ['cols', 'projectPath', 'provider', 'providerArgs', 'rows']);
  for (const key of ['command', 'args', 'argv', 'env', 'shell', 'providerCommand']) {
    assert.equal(Object.hasOwn(payload, key), false);
  }
  assert.equal(payload.provider, 'codex');
  assert.deepEqual(payload.providerArgs, ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']);
  assert.equal(payload.cols, 100);
  assert.equal(payload.rows, 30);
});

test('session title is Tether metadata and is not forwarded as provider args', () => {
  const payload = buildCreateSessionPayload(
    PROVIDERS.codex,
    {
      project: '.',
      title: '登录问题',
      providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']
    },
    { columns: 100, rows: 30 }
  );

  assert.equal(payload.title, '登录问题');
  assert.deepEqual(payload.providerArgs, ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']);
  assert.equal(payload.providerArgs?.includes('--title'), false);
  assert.equal(payload.providerArgs?.includes('登录问题'), false);
});

test('provider command declares --title before provider args passthrough', () => {
  const source = mainSource();
  assert.match(source, /\.option\('--title <title>', '前端展示的 session 标题'\)[\s\S]*\.argument\('\[providerArgs\.\.\.\]'\)/);
});

test('gateway login wiring is present in main.ts', () => {
  const source = mainSource();
  assert.match(source, /gateway'\)\s*[\s\S]*command\('login'\)/);
  assert.match(source, /TETHER_SERVER_URL/);
  assert.match(source, /auth\.json/);
  assert.match(source, /0o600/);
});

test('gateway login defaults to prod and keeps local as an explicit environment', () => {
  const source = mainSource();
  assert.match(source, /\.option\('--env <env>'/);
  assert.match(source, /process\.env\.TETHER_SERVER_URL/);
  assert.match(source, /options\.env === 'local' \? LOCAL_SERVER_URL : DEFAULT_SERVER_URL/);
  assert.match(source, /performGatewayLogin\(\{\}\)/);
});

test('gateway login callback server does not keep the cli process alive after auth', () => {
  const source = mainSource();
  assert.match(source, /const finish = \(result: GatewayAuthCallbackResult \| undefined, error: Error \| undefined\): void =>/);
  assert.match(source, /timer\.unref\(\)/);
  assert.match(source, /server\.unref\(\)/);
  assert.match(source, /connection: 'close'/);
  assert.match(source, /req\.socket\.destroy\(\)/);
});

test('foreground gateway checks port before prompting for auth', () => {
  const source = mainSource();
  assert.match(source, /assertGatewayPortAvailable\(resolved\.gateway\.host, resolved\.gateway\.port\);[\s\S]*ensureGatewayAuthForProfile/);
  assert.match(source, /EADDRINUSE/);
  assert.match(source, /pnpm tether gateway stop/);
});

test('launchd gateway profile skips interactive prompt', () => {
  const source = mainSource();
  assert.match(source, /gatewayProfileFromEnv/);
  assert.match(source, /process\.env\.TETHER_GATEWAY_PROFILE/);
  assert.match(source, /startGatewayForeground\(launchdProfile\)/);
});

test('gateway restart reuses background startup profile wiring', () => {
  const source = mainSource();
  assert.match(source, /command\('restart'\)[\s\S]*stopLaunchAgent\(\);[\s\S]*startGatewayBackground\(\);/);
  assert.doesNotMatch(source, /command\('restart'\)[\s\S]{0,240}restartLaunchAgent\(\);/);
});

test('background gateway start verifies daemon and relay readiness before success', () => {
  const source = mainSource();
  assert.match(source, /waitForStartedGateway\(profile\)/);
  assert.match(source, /profile !== 'relay' \|\| stringValue\(status\.relay\?\.state\) === 'connected'/);
  assert.match(source, /当前未确认启动成功，未打印/);
});

test('gateway delete-db requires confirmation and removes sqlite sidecar files', () => {
  const source = mainSource();
  assert.match(source, /command\('delete-db'\)/);
  assert.match(source, /\.option\('--yes'/);
  assert.match(source, /删除数据库会清空 session 历史和回放数据/);
  assert.match(source, /\`\$\{dbPath\}-wal\`/);
  assert.match(source, /\`\$\{dbPath\}-shm\`/);
  assert.match(source, /Gateway 仍在运行/);
});

test('pty attach defaults to reconnect with fresh tickets and event cursor', () => {
  const source = mainSource();
  assert.match(source, /\.option\('--no-reconnect'/);
  assert.match(source, /const reconnect = options\.reconnect !== false/);
  assert.match(source, /attempt = await attachPtySessionOnce/);
  assert.match(source, /requestWsTicket\(options, id, options\.mode\)/);
  assert.match(source, /params\.set\('after', String\(after\)\)/);
  assert.match(source, /Gateway 连接断开/);
  assert.match(source, /当前输入不会发送/);
  assert.match(source, /Ctrl-C 停止 session/);
  assert.match(source, /Ctrl-A 只退出本地 attach/);
  assert.match(source, /TERMINAL_RESET_SEQUENCE/);
  assert.match(source, /\\x1b\[<u/);
});

test('pty attach maps Ctrl-C to session stop and Ctrl-A to local detach', () => {
  const source = mainSource();
  assert.match(source, /Press Ctrl-C to stop, Ctrl-A to detach/);
  assert.match(source, /const stopAttachedSession = \(\) =>/);
  assert.match(source, /stopPtySessionViaGateway\(id, `http:\/\/\$\{options\.host\}:\$\{options\.port\}`\)/);
  assert.match(source, /chunk\.includes\(0x03\)/);
  assert.match(source, /const LOCAL_DETACH_KEY = '\\x01'/);
  assert.match(source, /chunk\.includes\(LOCAL_DETACH_KEY\.charCodeAt\(0\)\)/);
  assert.match(source, /status: 'stopped'/);
});

test('pty attach prints explicit terminal closeout for stop, exit, detach and lost states', () => {
  const source = mainSource();
  assert.match(source, /Session 已停止：\$\{id\}/);
  assert.match(source, /已退出本地 attach，session 继续运行：\$\{id\}/);
  assert.match(source, /Session 已失联：\$\{id\}/);
  assert.match(source, /console\.error\(`\\n\$\{result\.message\}`\)/);
  assert.match(source, /if \(result === 'detached'\)/);
});

test('stop prints success and can fall back to runner socket', () => {
  const source = mainSource();
  assert.match(source, /console\.log\(result === 'already-stopped'/);
  assert.match(source, /已关闭 \$\{id\}/);
  assert.match(source, /stopPtySessionViaGateway/);
  assert.match(source, /stopPtySessionViaRunner\(session\.runnerSocketPath\)/);
  assert.match(source, /new SessionRunnerClient\(\{ socketPath \}\)/);
});
