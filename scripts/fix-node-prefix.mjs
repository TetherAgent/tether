#!/usr/bin/env node
// 修补 tsup 输出，恢复 node: 协议前缀。
// 这能避免内置模块名被误解析成同名第三方包。
// 此脚本扫描指定文件，把所有内置模块的 import/require 前缀加回去。

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const NODE_BUILTINS = [
  'assert', 'assert/strict',
  'buffer', 'child_process', 'crypto',
  'events', 'fs', 'fs/promises', 'http', 'https',
  'module', 'net', 'os', 'path', 'process',
  'querystring', 'readline', 'readline/promises',
  'sqlite', 'stream', 'string_decoder',
  'tls', 'url', 'util', 'zlib'
];

const files = [
  'release/dist/cli/main.js',
  'release/dist/gateway/session-runner-process.js'
];

let totalReplacements = 0;

for (const rel of files) {
  const filePath = path.join(repoRoot, rel);
  let content = await readFile(filePath, 'utf8');
  let fileReplacements = 0;
  for (const builtin of NODE_BUILTINS) {
    const escaped = builtin.replace(/\//g, '\\/');
    const importRe = new RegExp(`from\\s*"${escaped}"`, 'g');
    const requireRe = new RegExp(`require\\(\\s*"${escaped}"\\s*\\)`, 'g');
    const dynImportRe = new RegExp(`import\\(\\s*"${escaped}"\\s*\\)`, 'g');
    const before = content;
    content = content.replace(importRe, `from "node:${builtin}"`);
    content = content.replace(requireRe, `require("node:${builtin}")`);
    content = content.replace(dynImportRe, `import("node:${builtin}")`);
    if (content !== before) {
      fileReplacements += (before.match(importRe)?.length ?? 0)
        + (before.match(requireRe)?.length ?? 0)
        + (before.match(dynImportRe)?.length ?? 0);
    }
  }
  if (fileReplacements > 0) {
    await writeFile(filePath, content);
  }
  totalReplacements += fileReplacements;
  console.log(`  ${rel}: ${fileReplacements} replacements`);
}

console.log(`fix-node-prefix: ${totalReplacements} total replacements across ${files.length} files`);
