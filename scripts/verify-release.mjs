#!/usr/bin/env node
// M5 自动化验证脚本
// 跑可以无副作用验证的检查项（V1-V4、V7-V8、V16、V19、V20、V23、V24、V26-V29）。
// 不修改用户全局 npm、不启动后台 Gateway、不创建 session。
// 需要 user 介入的检查项（V5/V6 全局安装、V9-V15 Gateway 生命周期、V17/V18 切 Node 版本）
// 见 docs/working/M5-VERIFY.md。

import { spawn } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const releaseDir = path.join(repoRoot, 'release');
const releaseLauncher = path.join(releaseDir, 'bin', 'tether');
const distMain = path.join(releaseDir, 'dist', 'cli', 'main.js');
const distRunner = path.join(releaseDir, 'dist', 'gateway', 'session-runner-process.js');
const distMainMap = path.join(releaseDir, 'dist', 'cli', 'main.js.map');

const results = [];

function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  const label = status === 'PASS' ? '\x1b[32mPASS\x1b[0m' : status === 'FAIL' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mSKIP\x1b[0m';
  console.log(`  ${label}  ${id} ${name}: ${detail}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    if (opts.input && child.stdin) {
      child.stdin.end(opts.input);
    }
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }));
  });
}

async function checkV1NodeHardCheck() {
  // V1 需要在低版本 Node 下跑。当前是 22.22，无法直接验证。
  // 退而求其次：grep main.ts 确认 hard-check 代码存在。
  const main = readFileSync(path.join(repoRoot, 'apps/cli/src/main.ts'), 'utf8');
  const hasCheck = main.includes('Tether 需要 Node.js 22.13');
  record('V1', 'Node 版本 hard-check 代码', hasCheck ? 'PASS' : 'FAIL',
    hasCheck ? '存在于 main.ts' : '未找到 hard-check 代码');
}

async function checkV2PackContents() {
  const r = await run('npm', ['pack', '--dry-run'], { cwd: releaseDir });
  const lines = (r.stdout + r.stderr).split('\n');
  const fileLines = lines.filter((l) => l.includes('npm notice') && /\d/.test(l));
  const badPaths = fileLines.filter((l) =>
    /apps\/|packages\/|node_modules\/|tsconfig|\.test\./.test(l));
  if (badPaths.length === 0 && r.code === 0) {
    record('V2', 'npm pack 文件清单干净', 'PASS', `${fileLines.length} 行文件清单，无 apps/packages`);
  } else {
    record('V2', 'npm pack 文件清单干净', 'FAIL', `bad: ${badPaths.join(' | ')}`);
  }
}

async function checkV3BundleIntegrity() {
  if (!existsSync(distMain)) {
    record('V3', 'bundle 完整性', 'FAIL', `dist/cli/main.js 不存在，先 pnpm build:release`);
    return;
  }
  const content = readFileSync(distMain, 'utf8');
  const matches = content.match(/from\s*["']@tether\//g) ?? [];
  if (matches.length === 0) {
    record('V3', 'bundle 完整性', 'PASS', '@tether/* 全部 bundle，零外部引用');
  } else {
    record('V3', 'bundle 完整性', 'FAIL', `${matches.length} 处仍 import @tether/*`);
  }
}

async function checkV4BinExecutable() {
  if (!existsSync(releaseLauncher)) {
    record('V4', 'launcher 可执行', 'FAIL', '不存在');
    return;
  }
  const stat = statSync(releaseLauncher);
  const isExec = (stat.mode & 0o111) !== 0;
  record('V4', 'launcher 可执行', isExec ? 'PASS' : 'FAIL', `mode ${stat.mode.toString(8)}`);
}

async function checkV7NodeSqliteOk() {
  const r = await run(releaseLauncher, ['debug'], { input: '1\n' });
  const ok = r.stdout.includes('Gateway 状态存储') && r.stdout.includes('本地 SQLite 已移除');
  record('V7', 'doctor 显示无本地 SQLite 状态', ok ? 'PASS' : 'FAIL',
    ok ? '确认本地 SQLite 已移除' : `输出未含本地 SQLite 移除状态\n${r.stdout.slice(0, 200)}`);
}

async function checkV8HistoryDb() {
  const r = await run(releaseLauncher, ['ls']);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('tth_'));
  if (lines.length > 0) {
    record('V8', '历史数据兼容', 'PASS', `release launcher 列出 ${lines.length} 个 session`);
  } else {
    record('V8', '历史数据兼容', 'FAIL', `tether ls 无输出：${r.stdout.slice(0, 200)}`);
  }
}

async function checkV16NoExperimentalWarning() {
  const r = await run(releaseLauncher, ['--version']);
  const hasWarning = /ExperimentalWarning/i.test(r.stderr) || /ExperimentalWarning/i.test(r.stdout);
  record('V16', '启动无 ExperimentalWarning', hasWarning ? 'FAIL' : 'PASS',
    hasWarning ? '出现警告' : '无警告');
}

async function checkV19PlistPath() {
  const plistPath = path.join(process.env.HOME ?? '', 'Library/LaunchAgents/sh.tether.gateway.plist');
  if (!existsSync(plistPath)) {
    record('V19', 'plist PATH 含 brew/local', 'SKIP', `plist 不存在，先 tether gateway install`);
    return;
  }
  const plist = readFileSync(plistPath, 'utf8');
  const okBrew = plist.includes('/opt/homebrew/bin');
  const okLocal = plist.includes('/usr/local/bin');
  record('V19', 'plist PATH 含 brew/local', (okBrew && okLocal) ? 'PASS' : 'FAIL',
    `homebrew=${okBrew} local=${okLocal}`);
}

async function checkV20Providers() {
  const r = await run(releaseLauncher, ['debug'], { input: '1\n' });
  const expected = ['claude 命令', 'codex 命令', 'copilot 命令', 'shell 命令'];
  const missing = expected.filter((item) => !r.stdout.includes(item));
  if (missing.length === 0) {
    record('V20', 'doctor provider 检查输出', 'PASS', `${expected.length} 个 provider`);
  } else {
    record('V20', 'doctor provider 检查输出', 'FAIL', `缺失：${missing.join(', ')}`);
  }
}

async function checkV23DoctorOutput() {
  const r = await run(releaseLauncher, ['debug'], { input: '1\n' });
  const expected = ['Node 版本', 'runtime 模式', 'node-pty', 'plist nodePath', 'plist launcher', 'Gateway 状态存储'];
  const missing = expected.filter((e) => !r.stdout.includes(e));
  record('V23', 'doctor 输出完整', missing.length === 0 ? 'PASS' : 'FAIL',
    missing.length === 0 ? '6 项 runtime 检查全部输出' : `缺失：${missing.join(', ')}`);
}

async function checkV24Sourcemap() {
  const exists = existsSync(distMainMap);
  record('V24', 'source map 存在', exists ? 'PASS' : 'FAIL',
    exists ? `${(statSync(distMainMap).size / 1024).toFixed(0)} KB` : '不存在');
}

async function checkV26PackageSize() {
  const r = await run('npm', ['pack', '--dry-run'], { cwd: releaseDir });
  const m = r.stderr.match(/package size:\s*([\d.]+)\s*kB/i) || r.stdout.match(/package size:\s*([\d.]+)\s*kB/i);
  if (!m) {
    record('V26', '包大小合理', 'FAIL', `未解析到大小`);
    return;
  }
  const sizeKb = Number(m[1]);
  const ok = sizeKb < 5000;
  record('V26', '包大小合理', ok ? 'PASS' : 'FAIL', `${sizeKb} kB（阈值 5000）`);
}

async function checkV27BuildSpeed() {
  const start = Date.now();
  const r = await run('pnpm', ['exec', 'tsup', '--config', 'tsup.release.config.ts'], { cwd: repoRoot });
  const ms = Date.now() - start;
  const ok = r.code === 0 && ms < 30000;
  record('V27', 'tsup 构建时间', ok ? 'PASS' : 'FAIL', `${ms}ms（阈值 30000）`);
  // rebuild 后必须重跑 fix-node-prefix
  await run('node', ['scripts/fix-node-prefix.mjs'], { cwd: repoRoot });
}

async function checkV28LauncherFork() {
  const start = Date.now();
  const r = await run(releaseLauncher, ['--version']);
  const ms = Date.now() - start;
  const ok = r.code === 0 && ms < 1000;
  record('V28', 'launcher fork 开销', ok ? 'PASS' : 'FAIL',
    `${ms}ms（阈值 1000）输出="${r.stdout.trim()}"`);
}

async function checkV29DevLauncher() {
  const devLauncher = path.join(repoRoot, 'bin', 'tether');
  if (!existsSync(devLauncher)) {
    record('V29', 'dev launcher 兼容', 'FAIL', 'bin/tether 不存在');
    return;
  }
  const r = await run(devLauncher, ['--version']);
  const ok = r.code === 0;
  record('V29', 'dev launcher 兼容', ok ? 'PASS' : 'FAIL',
    `output="${r.stdout.trim()}" code=${r.code}`);
}

async function main() {
  console.log('\nM5 自动化验证（不修改用户全局环境）\n');

  // 前置：必须有构建产物
  if (!existsSync(distMain)) {
    console.log('  release/dist 不存在，先跑 pnpm build:release\n');
    process.exit(1);
  }

  console.log('--- Build & package ---');
  await checkV2PackContents();
  await checkV3BundleIntegrity();
  await checkV4BinExecutable();
  await checkV24Sourcemap();
  await checkV26PackageSize();
  await checkV27BuildSpeed();

  console.log('\n--- Runtime ---');
  await checkV1NodeHardCheck();
  await checkV16NoExperimentalWarning();
  await checkV28LauncherFork();
  await checkV29DevLauncher();

  console.log('\n--- Functional ---');
  await checkV7NodeSqliteOk();
  await checkV8HistoryDb();
  await checkV20Providers();
  await checkV23DoctorOutput();

  console.log('\n--- LaunchAgent (依赖之前 tether gateway install) ---');
  await checkV19PlistPath();

  // 总结
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\n=== ${passed} PASS · ${failed} FAIL · ${skipped} SKIP ===`);
  console.log('剩余需用户手动验证的项见 docs/working/M5-VERIFY.md\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
