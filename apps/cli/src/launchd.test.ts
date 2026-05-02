import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayPlist, launchdServiceTarget } from './launchd.js';

test('plist uses absolute gateway entry', () => {
  const plist = buildGatewayPlist({
    nodePath: '/usr/local/bin/node',
    tsxLoaderPath: '/Users/test/tether/node_modules/tsx/dist/loader.mjs',
    cliMainPath: '/Users/test/tether/apps/cli/src/main.ts',
    stdoutPath: '/Users/test/.tether/logs/gateway.out.log',
    stderrPath: '/Users/test/.tether/logs/gateway.err.log'
  });

  assert.match(plist, /<key>ProgramArguments<\/key>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/Users\/test\/tether\/node_modules\/tsx\/dist\/loader\.mjs<\/string>/);
  assert.match(plist, /<string>\/Users\/test\/tether\/apps\/cli\/src\/main\.ts<\/string>/);
  assert.match(plist, /<string>gateway<\/string>/);
});

test('plist does not depend on pnpm or HOME expansion', () => {
  const plist = buildGatewayPlist({
    nodePath: '/usr/local/bin/node',
    tsxLoaderPath: '/Users/test/tether/node_modules/tsx/dist/loader.mjs',
    cliMainPath: '/Users/test/tether/apps/cli/src/main.ts',
    stdoutPath: '/Users/test/.tether/logs/gateway.out.log',
    stderrPath: '/Users/test/.tether/logs/gateway.err.log'
  });

  assert.equal(plist.includes('pnpm tether'), false);
  assert.equal(plist.includes('$HOME'), false);
  assert.equal(plist.includes('~/'), false);
});

test('launchd service target uses gui uid', () => {
  assert.equal(launchdServiceTarget(501), 'gui/501');
});
