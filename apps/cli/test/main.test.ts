import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PROVIDERS } from '@tether/core';
import { buildNewPtySessionFrame } from '../src/relay/sessions.js';

const mainSource = () => readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const commandSource = (name: string) => readFileSync(new URL(`../src/commands/${name}.ts`, import.meta.url), 'utf8');
const gatewaySource = (name: string) => readFileSync(new URL(`../src/gateway/${name}.ts`, import.meta.url), 'utf8');
const authStoreSource = () => readFileSync(new URL('../src/auth/gateway-auth-store.ts', import.meta.url), 'utf8');
const gatewayLoginSource = () => readFileSync(new URL('../src/auth/gateway-login.ts', import.meta.url), 'utf8');
const relaySessionsSource = () => readFileSync(new URL('../src/relay/sessions.ts', import.meta.url), 'utf8');
const attachSource = () => readFileSync(new URL('../src/attach/pty-attach.ts', import.meta.url), 'utf8');
const terminalStateSource = () => readFileSync(new URL('../src/attach/terminal-state.ts', import.meta.url), 'utf8');
const splitCliSource = () => [
  mainSource(),
  ...['login', 'logout', 'start', 'serve', 'restart', 'status', 'debug', 'run', 'ls', 'stop'].map(commandSource),
  ...['supervisor', 'status', 'doctor', 'logs', 'probe', 'urls'].map(gatewaySource)
].join('\n');

test('new PTY session frame keeps only allowed command-shaped fields', () => {
  const frame = buildNewPtySessionFrame(
    PROVIDERS.codex,
    { providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450'] },
    'gw_test',
    { columns: 100, rows: 30 }
  );

  assert.deepEqual(Object.keys(frame).sort(), ['cols', 'command', 'cwd', 'gatewayId', 'provider', 'providerArgs', 'rows', 'type']);
  for (const key of ['args', 'argv', 'env', 'shell', 'providerCommand']) {
    assert.equal(Object.hasOwn(frame, key), false);
  }
  assert.equal(frame.type, 'client.new-pty-session');
  assert.equal(frame.provider, 'codex');
  assert.equal(frame.command, PROVIDERS.codex.command);
  assert.equal(frame.gatewayId, 'gw_test');
  assert.deepEqual(frame.providerArgs, ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']);
  assert.equal(frame.cols, 100);
  assert.equal(frame.rows, 30);
});

test('session title is Tether metadata and is not forwarded as provider args', () => {
  const frame = buildNewPtySessionFrame(
    PROVIDERS.codex,
    {
      title: '登录问题',
      providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']
    },
    'gw_test',
    { columns: 100, rows: 30 }
  );

  assert.equal(frame.title, '登录问题');
  assert.deepEqual(frame.providerArgs, ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']);
  assert.equal(frame.providerArgs?.includes('--title'), false);
  assert.equal(frame.providerArgs?.includes('登录问题'), false);
});

test('run command declares --title before provider args passthrough', () => {
  const source = commandSource('run');
  assert.match(source, /command\('run'\)[\s\S]*\.argument\('\[providerArgs\.\.\.\]'\)[\s\S]*\.option\('--title <title>', '前端展示的 session 标题'\)/);
});

test('run command supports detached start and prints terminal route', () => {
  const source = commandSource('run');
  assert.match(source, /\.option\('-d, --detach', '创建 session 后不本地 attach'\)/);
  assert.match(source, /const remoteTerminalUrl = terminalUrlFromBase\(auth\.serverUrl \|\| relay\.url, session\.id\)/);
  assert.match(source, /const localTerminalUrl = terminalUrlFromBase\(gatewayUrl, session\.id\)/);
  assert.match(source, /terminal\.section\('Tether session'\)/);
  assert.match(source, /terminal\.line\('Open', remoteTerminalUrl\)/);
  assert.match(source, /terminal\.line\('Local', localTerminalUrl\)/);
  assert.match(source, /terminal\.success\('已创建后台 session，可从 Terminal 页面接管。'\)/);
  assert.match(source, /if \(options\.detach\) \{[\s\S]*return;/);
  assert.match(source, /attachPtySession\(session\.id/);
  assert.doesNotMatch(source, /\/remote\/session\/\$\{session\.id\}/);
});

test('top-level login wiring is present in main.ts', () => {
  const source = mainSource();
  const loginCommand = commandSource('login');
  const authStore = authStoreSource();
  assert.match(source, /registerLoginCommand\(program\)/);
  assert.match(loginCommand, /command\('login'\)/);
  assert.match(loginCommand, /performGatewayLogin\(\{ \.\.\.options, env: parseGatewayLoginEnvOption\(options\.env\) \}\)/);
  assert.match(authStore, /auth\.json/);
  assert.match(authStore, /0o600/);
});

test('top-level login defaults to prod and keeps local as an explicit environment', () => {
  const source = commandSource('login');
  const loginSource = gatewayLoginSource();
  assert.match(source, /\.option\('--env <env>'/);
  assert.match(loginSource, /process\.env\.TETHER_SERVER_URL/);
  assert.match(loginSource, /options\.env === 'local' \? LOCAL_SERVER_URL : DEFAULT_SERVER_URL/);
  assert.match(source, /performGatewayLogin\(\{ \.\.\.options, env: parseGatewayLoginEnvOption\(options\.env\) \}\)/);
});

test('gateway login callback server closes after auth without dropping the pending callback wait', () => {
  const source = gatewayLoginSource();
  assert.match(source, /const finish = \(result: GatewayAuthCallbackResult \| undefined, error: Error \| undefined\): void =>/);
  assert.match(source, /clearTimeout\(timer\);[\s\S]*server\.close\(\(\) =>/);
  assert.doesNotMatch(source, /timer\.unref\(\)/);
  assert.doesNotMatch(source, /server\.unref\(\)/);
  assert.match(source, /connection: 'close'/);
  assert.match(source, /req\.socket\.destroy\(\)/);
});

test('foreground gateway checks port before prompting for auth', () => {
  const source = gatewaySource('supervisor');
  assert.match(source, /assertGatewayPortAvailable\(resolved\.gateway\.host, resolved\.gateway\.port\);[\s\S]*ensureGatewayAuthForProfile/);
  assert.match(source, /EADDRINUSE/);
  assert.match(source, /pnpm tether stop/);
});

test('top-level start uses launchd gateway profile wiring', () => {
  const source = mainSource();
  const startCommand = commandSource('start');
  const serveCommand = commandSource('serve');
  const supervisor = gatewaySource('supervisor');
  assert.match(source, /registerStartCommand\(program\)/);
  assert.match(serveCommand, /gatewayProfileFromEnv/);
  assert.match(supervisor, /process\.env\.TETHER_GATEWAY_PROFILE/);
  assert.match(startCommand, /command\('start'\)[\s\S]*startGatewayBackground\(\)/);
});

test('top-level stop without id stops gateway', () => {
  const source = commandSource('stop');
  assert.match(source, /if \(!id && !options\.all\) \{[\s\S]*stopGatewayBackground\(\)/);
  assert.match(source, /Gateway 已停止。/);
});

test('gateway namespace is removed and debug-only commands are not exposed as top-level commands', () => {
  const source = splitCliSource();
  assert.match(commandSource('debug'), /command\('debug'\)/);
  assert.doesNotMatch(source, /command\('gateway'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('doctor'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('clients'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('url'\)/);
  assert.doesNotMatch(source, /program\s*\n\s*\.command\('send'\)/);
});

test('provider shortcut commands are not registered as top-level commands', () => {
  const source = splitCliSource();
  assert.doesNotMatch(source, /function addProviderCommand/);
  assert.doesNotMatch(source, /for \(const provider of Object\.values\(PROVIDERS\)\)\s*\{[\s\S]*addProviderCommand/);
});

test('run command rejects unknown providers and disallows shell args', () => {
  const source = commandSource('run');
  assert.match(source, /不支持的 provider：\$\{providerName\}/);
  assert.doesNotMatch(source, /\{ name: providerName, command: providerName \}/);
  assert.match(source, /providerName === 'shell' && providerArgs\.length > 0/);
  assert.match(source, /shell provider 不接受额外参数/);
});

test('top-level restart reuses background startup profile wiring', () => {
  const source = commandSource('restart');
  assert.match(source, /command\('restart'\)[\s\S]*stopGatewayBackground\(\);[\s\S]*startGatewayBackground\(\);/);
  assert.doesNotMatch(source, /command\('restart'\)[\s\S]{0,240}restartLaunchAgent\(\);/);
});

test('background start verifies daemon and relay readiness before success', () => {
  assert.match(gatewaySource('supervisor'), /waitForStartedGateway\(profile\)/);
  const probe = gatewaySource('probe');
  assert.match(probe, /profile !== 'relay' \|\| stringValue\(status\.relay\?\.state\) === 'connected'/);
  assert.match(probe, /当前未确认启动成功，未打印/);
});

test('background start is idempotent when gateway is already running', () => {
  const source = gatewaySource('supervisor');
  assert.match(source, /const existing = await fetchGatewayStatusBody/);
  assert.match(source, /Gateway 状态', `已运行/);
  assert.match(source, /return;[\s\S]*const status = await startLaunchAgent/);
});

test('gateway delete-db command and sqlite cleanup path are removed', () => {
  const source = splitCliSource();
  assert.doesNotMatch(source, /command\('delete-db'\)/);
  assert.doesNotMatch(source, /删除数据库会清空 session 历史和回放数据/);
  assert.doesNotMatch(source, /\$\{dbPath\}-wal/);
  assert.doesNotMatch(source, /\$\{dbPath\}-shm/);
  assert.doesNotMatch(source, /defaultDbPath/);
});

test('pty attach defaults to reconnect with fresh tickets and event cursor', () => {
  const source = attachSource();
  const runCommand = commandSource('run');
  const terminalState = terminalStateSource();
  assert.match(runCommand, /\.option\('--no-reconnect'/);
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
  assert.match(terminalState, /\\x1b\[<u/);
});

test('pty attach maps Ctrl-C to session stop and Ctrl-A to local detach', () => {
  const source = attachSource();
  assert.match(source, /Press Ctrl-C to stop, Ctrl-A to detach/);
  assert.match(source, /const stopAttachedSession = \(\) =>/);
  assert.match(source, /type: 'client\.stop', sessionId: id/);
  assert.match(source, /chunk\.includes\(0x03\)/);
  assert.match(terminalStateSource(), /const LOCAL_DETACH_KEY = '\\x01'/);
  assert.match(source, /chunk\.includes\(LOCAL_DETACH_KEY\.charCodeAt\(0\)\)/);
  assert.match(source, /status: 'stopped'/);
});

test('pty attach prints explicit terminal closeout for stop, exit, detach and lost states', () => {
  const source = attachSource();
  const runCommand = commandSource('run');
  assert.match(source, /Session 已停止：\$\{id\}/);
  assert.match(source, /已退出本地 attach，session 继续运行：\$\{id\}/);
  assert.match(source, /Session 已失联：\$\{id\}/);
  assert.match(source, /console\.error\(`\\n\$\{result\.message\}`\)/);
  assert.match(runCommand, /if \(result === 'detached'\)/);
});

test('stop prints success and uses relay only', () => {
  const source = commandSource('stop');
  assert.match(source, /已关闭 \$\{id\}/);
  assert.match(source, /stopSessionViaRelay/);
  assert.match(source, /--all/);
  assert.match(source, /function runningSessionIds/);
  assert.doesNotMatch(source, /stopPtySessionViaGateway/);
  assert.doesNotMatch(source, /stopPtySessionViaRunner/);
  assert.doesNotMatch(source, /SessionRunnerClient/);
});

test('provider session creation goes through relay websocket frames', () => {
  const source = commandSource('run');
  const relaySource = relaySessionsSource();
  assert.match(source, /createSessionViaRelay/);
  assert.match(relaySource, /relayClientUrl\(relayUrl\)/);
  assert.match(relaySource, /type: 'client\.new-pty-session'/);
  assert.match(relaySource, /type: 'client\.auth'/);
});
