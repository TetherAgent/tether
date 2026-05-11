#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const releasePkg = resolve(root, 'release/package.json');
const cliPkg = resolve(root, 'apps/cli/package.json');

const version = JSON.parse(readFileSync(releasePkg, 'utf8')).version;
const cli = JSON.parse(readFileSync(cliPkg, 'utf8'));

if (cli.version === version) {
  console.log(`apps/cli already at ${version}`);
} else {
  cli.version = version;
  writeFileSync(cliPkg, JSON.stringify(cli, null, 2) + '\n', 'utf8');
  console.log(`apps/cli synced to ${version}`);
}
