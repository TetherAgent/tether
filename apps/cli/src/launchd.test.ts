import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayPlist, launchdServiceTarget } from './launchd.js';

test('plist uses absolute node and launcher paths', () => {
  const plist = buildGatewayPlist({
    nodePath: '/usr/local/bin/node',
    launcherPath: '/Users/test/tether/bin/tether',
    stdoutPath: '/Users/test/.tether/logs/gateway.out.log',
    stderrPath: '/Users/test/.tether/logs/gateway.err.log'
  });

  assert.match(plist, /<key>ProgramArguments<\/key>/);
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(plist, /<string>\/Users\/test\/tether\/bin\/tether<\/string>/);
  assert.match(plist, /<string>gateway<\/string>/);
});

test('plist does not depend on pnpm, tsx, dist or HOME expansion', () => {
  const plist = buildGatewayPlist({
    nodePath: '/usr/local/bin/node',
    launcherPath: '/Users/test/tether/bin/tether',
    stdoutPath: '/Users/test/.tether/logs/gateway.out.log',
    stderrPath: '/Users/test/.tether/logs/gateway.err.log'
  });

  assert.equal(plist.includes('pnpm tether'), false);
  assert.equal(plist.includes('tsx/dist/loader'), false);
  assert.equal(plist.includes('dist/cli/main.js'), false);
  assert.equal(plist.includes('--import'), false);
  assert.equal(plist.includes('$HOME'), false);
  assert.equal(plist.includes('~/'), false);
});

test('plist includes launchd environment variables for provider lookup', () => {
  const plist = buildGatewayPlist({
    nodePath: '/usr/local/bin/node',
    launcherPath: '/Users/test/tether/bin/tether',
    stdoutPath: '/Users/test/.tether/logs/gateway.out.log',
    stderrPath: '/Users/test/.tether/logs/gateway.err.log',
    env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' }
  });

  assert.match(plist, /<key>EnvironmentVariables<\/key>/);
  assert.match(plist, /<key>HOME<\/key>/);
  assert.match(plist, /<key>PATH<\/key>/);
  assert.match(plist, /<string>\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin<\/string>/);
});

test('launchd service target uses gui uid', () => {
  assert.equal(launchdServiceTarget(501), 'gui/501');
});
