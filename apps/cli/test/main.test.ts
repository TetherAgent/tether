import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PROVIDERS } from '@tether/core';
import { buildCreateSessionPayload } from '../src/forwarding.js';

const mainSource = () => readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

test('does not include command-shaped fields in forwarded create payload', () => {
  const payload = buildCreateSessionPayload(
    PROVIDERS.codex,
    { providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450'] },
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

test('run command declares --title before provider args passthrough', () => {
  const source = mainSource();
  assert.match(source, /command\('run'\)[\s\S]*\.argument\('\[providerArgs\.\.\.\]'\)[\s\S]*\.option\('--title <title>', '前端展示的 session 标题'\)/);
});

test('top-level login wiring is present in main.ts', () => {
  const source = mainSource();
  assert.match(source, /program\s*[\s\S]*command\('login'\)/);
  assert.match(source, /TETHER_SERVER_URL/);
  assert.match(source, /auth\.json/);
  assert.match(source, /0o600/);
});

test('top-level login defaults to prod and keeps local as an explicit environment', () => {
  const source = mainSource();
  assert.match(source, /\.option\('--env <env>'/);
  assert.match(source, /process\.env\.TETHER_SERVER_URL/);
  assert.match(source, /options\.env === 'local' \? LOCAL_SERVER_URL : DEFAULT_SERVER_URL/);
  assert.match(source, /performGatewayLogin\(\{ \.\.\.options, env: parseGatewayLoginEnvOption\(options\.env\) \}\)/);
});

test('gateway login callback server closes after auth without dropping the pending callback wait', () => {
  const source = mainSource();
  assert.match(source, /const finish = \(result: GatewayAuthCallbackResult \| undefined, error: Error \| undefined\): void =>/);
  assert.match(source, /clearTimeout\(timer\);[\s\S]*server\.close\(\(\) =>/);
  assert.doesNotMatch(source, /timer\.unref\(\)/);
  assert.doesNotMatch(source, /server\.unref\(\)/);
  assert.match(source, /connection: 'close'/);
  assert.match(source, /req\.socket\.destroy\(\)/);
});

test('foreground gateway checks port before prompting for auth', () => {
  const source = mainSource();
  assert.match(source, /assertGatewayPortAvailable\(resolved\.gateway\.host, resolved\.gateway\.port\);[\s\S]*ensureGatewayAuthForProfile/);
  assert.match(source, /EADDRINUSE/);
  assert.match(source, /pnpm tether gateway stop/);
});

test('top-level start uses launchd gateway profile wiring', () => {
  const source = mainSource();
  assert.match(source, /gatewayProfileFromEnv/);
  assert.match(source, /process\.env\.TETHER_GATEWAY_PROFILE/);
  assert.match(source, /command\('start'\)[\s\S]*startGatewayBackground\(\)/);
});

test('debug-only commands are not exposed as top-level commands', () => {
  const source = mainSource();
  assert.match(source, /command\('debug'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('doctor'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('clients'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('url'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('send'\)/);
  assert.doesNotMatch(source, /gatewayCommand\s*\n\s*\.command\('logs'\)/);
});

test('provider shortcut commands are not registered as top-level commands', () => {
  const source = mainSource();
  assert.doesNotMatch(source, /function addProviderCommand/);
  assert.doesNotMatch(source, /for \(const provider of Object\.values\(PROVIDERS\)\)\s*\{[\s\S]*addProviderCommand/);
});

test('run command rejects unknown providers and disallows shell args', () => {
  const source = mainSource();
  assert.match(source, /不支持的 provider：\$\{providerName\}/);
  assert.doesNotMatch(source, /\{ name: providerName, command: providerName \}/);
  assert.match(source, /providerName === 'shell' && providerArgs\.length > 0/);
  assert.match(source, /shell provider 不接受额外参数/);
});

test('gateway restart reuses background startup profile wiring', () => {
  const source = mainSource();
  assert.match(source, /command\('restart'\)[\s\S]*stopGatewayBackground\(\);[\s\S]*startGatewayBackground\(\);/);
  assert.doesNotMatch(source, /command\('restart'\)[\s\S]{0,240}restartLaunchAgent\(\);/);
});

test('background gateway start verifies daemon and relay readiness before success', () => {
  const source = mainSource();
  assert.match(source, /waitForStartedGateway\(profile\)/);
  assert.match(source, /profile !== 'relay' \|\| stringValue\(status\.relay\?\.state\) === 'connected'/);
  assert.match(source, /当前未确认启动成功，未打印/);
});

test('gateway delete-db command and sqlite cleanup path are removed', () => {
  const source = mainSource();
  assert.doesNotMatch(source, /command\('delete-db'\)/);
  assert.doesNotMatch(source, /删除数据库会清空 session 历史和回放数据/);
  assert.doesNotMatch(source, /\$\{dbPath\}-wal/);
  assert.doesNotMatch(source, /\$\{dbPath\}-shm/);
  assert.doesNotMatch(source, /defaultDbPath/);
});

test('pty attach defaults to reconnect with fresh tickets and event cursor', () => {
  const source = mainSource();
  assert.match(source, /\.option\('--no-reconnect'/);
  assert.match(source, /const reconnect = options\.reconnect !== false/);
  assert.match(source, /attempt = await attachPtySessionOnce/);
  assert.match(source, /type: 'client\.auth'/);
  assert.match(source, /type: 'client\.subscribe'/);
  assert.match(source, /\.\.\.\(after > 0 \? \{ after \} : \{\}\)/);
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
  assert.match(source, /type: 'client\.stop', sessionId: id/);
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

test('stop prints success and uses relay only', () => {
  const source = mainSource();
  assert.match(source, /已关闭 \$\{id\}/);
  assert.match(source, /stopSessionViaRelay/);
  assert.doesNotMatch(source, /stopPtySessionViaGateway/);
  assert.doesNotMatch(source, /stopPtySessionViaRunner/);
  assert.doesNotMatch(source, /SessionRunnerClient/);
});

test('provider session creation goes through relay websocket frames', () => {
  const source = mainSource();
  assert.match(source, /createSessionViaRelay/);
  assert.match(source, /relayClientUrl\(relayUrl\)/);
  assert.match(source, /type: 'client\.new-pty-session'/);
  assert.match(source, /type: 'client\.auth'/);
});
