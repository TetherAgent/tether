import { defineConfig } from 'tsup';

// 强制保留 `node:` 协议前缀，避免内置模块被误解析成同名第三方包。
const preserveNodePrefix = {
  name: 'preserve-node-prefix',
  setup(build: { onResolve: (opts: { filter: RegExp }, cb: (args: { path: string }) => { path: string; external: true }) => void }) {
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      external: true
    }));
  }
};

export default defineConfig({
  entry: {
    'cli/main': 'apps/cli/src/main.ts',
    'gateway/session-runner-process': 'apps/gateway/src/pty/session-runner-process.ts'
  },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outDir: 'release/dist',
  external: ['node-pty'],
  noExternal: [/^@tether\//],
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true,
  banner: {
    js: `import { createRequire as __tetherCreateRequire } from 'node:module';\nconst require = __tetherCreateRequire(import.meta.url);`
  },
  esbuildPlugins: [preserveNodePrefix as never]
});
