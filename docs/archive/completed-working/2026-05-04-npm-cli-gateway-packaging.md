# npm CLI / Gateway 打包发布方案

状态：Working  
创建时间：2026-05-04  
最近更新：2026-05-04（补完打包发布操作手册、按阶段重组 TODO、按严重度分级验证矩阵）  
范围：根包 `tether`、`apps/cli`、`apps/gateway`、`packages/core`、`packages/config`、`packages/protocol`

## 关键决策摘要

- 单包 `@tether/cli` 起步，Gateway runtime 打进同一包。
- `bin/tether` 改成 JS launcher，自动注入 Node flag，不再依赖 `tsx`。
- `apps/gateway/src/store.ts` 从 `better-sqlite3` 迁移到 `node:sqlite`，彻底消除 ABI 问题。
- `engines.node >=22.13.0`，运行时 flag `--experimental-sqlite` 通过 launcher 单点维护。
- LaunchAgent plist `ProgramArguments` 走 launcher 而非直接 `dist/cli/main.js`，避免 flag 散落。
- 远端 API 不接收任意 command，本机命令通过 `commands` 别名白名单注册。

## 背景

当前仓库适合本地开发：

- 根包 `package.json` 是 `private: true`。
- `bin/tether` 通过 `#!/usr/bin/env -S node --import tsx` 直接加载 `apps/cli/src/main.ts`。
- `apps/cli` 依赖 `@tether/gateway`，Gateway 作为库被 CLI 直接 import。
- Gateway 使用 `node-pty` 和 `better-sqlite3`，这两个都是原生依赖。
- `tether gateway install/start` 会写 macOS LaunchAgent，当前 plist 仍围绕源码路径和 `tsx` loader 设计。

这对开发者没问题，但不适合给别人直接：

```bash
npm install -g tether
tether gateway init
tether gateway login
tether gateway start
tether codex
```

要给其他人用，必须把 CLI、Gateway 和内部 workspace 依赖打成可安装的 npm package，不能要求用户 clone 仓库、装 pnpm、跑源码。

## 目标体验

第一阶段只做 Mac / Node.js 用户可用的 npm 包。

目标命令：

```bash
npm install -g @tether/cli
tether gateway init
tether gateway login --server-url https://www.earntools.me
tether gateway start
tether codex
```

核心要求：安装后必须能在任意目录直接使用全局 `tether` 命令。

```bash
cd /tmp
tether --help
tether gateway status
tether codex
```

或者使用一次性运行：

```bash
npx @tether/cli gateway status
```

安装后用户不需要知道：

- monorepo 结构
- `apps/cli/src/main.ts`
- `tsx`
- `pnpm`
- `@tether/gateway` workspace 依赖

## 全局 `tether` 命令要求

发布包必须通过 `package.json#bin` 暴露命令：

```json
{
  "bin": {
    "tether": "./bin/tether"
  }
}
```

用户安装后：

```bash
npm install -g @tether/cli
which tether
tether --version
```

应满足：

- `tether` 在任意 cwd 可执行。
- `tether` 不依赖当前目录存在 Tether repo。
- `tether` 不依赖 `pnpm`、`tsx` 或 workspace symlink。
- `tether` 能正确找到自己的安装目录、`dist/cli/main.js` 和运行时依赖。
- `tether gateway install/start` 写入的 LaunchAgent 使用绝对路径，不依赖用户 shell 的 PATH。

开发模式可以继续通过 `pnpm tether` 跑源码；发布模式必须走全局 bin。

## 推荐路线：先发布一个 npm CLI 包

短期不要把 CLI 和 Gateway 拆成两个用户可见包。推荐先发布一个包：

```text
@tether/cli
  bin: tether
  内含 CLI + Gateway runtime + core/config/protocol
```

理由：

- 用户只需要装一个东西。
- Gateway 是 Tether CLI 的本机 runtime，不是独立给第三方 import 的 SDK。
- `tether gateway start`、`tether codex`、`tether attach` 都需要同一套本机配置、auth 和 provider 发现逻辑。
- 先做单包可以避免 workspace 包发布顺序、版本锁和 npm dependency 暴露过早复杂化。

后续如果有外部开发者要复用协议，再单独发布：

```text
@tether/protocol
@tether/core
```

`@tether/gateway` 暂时不建议作为公开库承诺 API。

## 包结构建议

发布包内建议长这样：

```text
@tether/cli/
├── package.json
├── dist/
│   ├── cli/
│   │   ├── main.js
│   │   └── launchd.js
│   ├── gateway/
│   │   ├── index.js
│   │   ├── daemon.js
│   │   ├── pty.js
│   │   └── store.js
│   ├── core/
│   ├── config/
│   └── protocol/
└── bin/
    └── tether
```

`bin/tether` 是一个 **JS launcher**（不是 `import` 直加载），负责注入运行时 flag 后 spawn 真正的 CLI 入口。完整代码和理由见后文"Node 运行时 flag 与 bin launcher"章节。

`package.json`：

```json
{
  "name": "@tether/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "tether": "./bin/tether"
  },
  "engines": {
    "node": ">=22.13.0"
  },
  "files": [
    "bin",
    "dist",
    "README.md"
  ]
}
```

`engines` 取 22.13 是因为 `node:sqlite` 在该版本可用且接口稳定（仍 experimental，运行时通过 launcher 注入 `--experimental-sqlite` flag）。详见"better-sqlite3 → node:sqlite"章节。

## 构建方式

### 推荐：用 tsup / tsdown 打包 CLI runtime

目标是把 workspace 内部依赖打进 `dist`，但保留原生依赖 external。

建议 external：

```text
node-pty
ws
```

迁移到 `node:sqlite` 后，`better-sqlite3` 从依赖列表中完全移除。`node:sqlite` 是 Node 内置模块，bundler 默认会自动 external `node:` 协议导入，不需要显式声明。

`ws` 可以打进去也可以 external；`node-pty` 是迁移后**唯一的原生依赖**，必须 external。

构建产物：

```text
dist/cli/main.js
```

session-runner 是独立子进程入口，必须有自己的 entry：

```text
dist/gateway/session-runner-process.js
```

`session-runner-spawn.ts` 在发布模式下 spawn 这个 entry（详见"开发模式与发布模式入口解析"小节）。

CLI import 的 `@tether/gateway`、`@tether/core`、`@tether/config`、`@tether/protocol` 应在构建时被打进产物，或者通过 package manager 作为 npm dependency 安装。短期更推荐打进产物，减少包发布数量。

需要新增脚本：

```json
{
  "scripts": {
    "build:cli": "tsup apps/cli/src/main.ts apps/gateway/src/session-runner-process.ts --format esm --target node22 --platform node --out-dir dist --external node-pty",
    "pack:cli": "pnpm build:cli && npm pack --dry-run"
  }
}
```

实际落地时要根据 sourcemap、多个入口和 `__dirname` 兼容再调整。注意 `target node22` 不是 `node20`，因为 `engines` 是 22.13+。

### 备选：tsc 多包编译

也可以让每个 workspace package 输出自己的 `dist`：

```text
apps/cli/dist
apps/gateway/dist
packages/core/dist
packages/config/dist
packages/protocol/dist
```

然后把它们作为 npm workspace 包一起发布。

这个方式更接近标准 monorepo，但首版成本更高：

- 每个 package 都要 `exports` 指向 `dist`。
- workspace 依赖要改成正式 semver。
- 发布顺序和版本管理要稳定。

短期不推荐作为第一版。

## Gateway / launchd 打包关键点

当前 LaunchAgent 生成逻辑不能继续依赖源码路径：

```text
node --import <repo>/node_modules/tsx/dist/loader.mjs <repo>/apps/cli/src/main.ts gateway
```

发布包里 plist 的 `ProgramArguments` 改成走 launcher：

```text
<nodePath>
<packagePath>/bin/tether
gateway
```

走 launcher（不是 `dist/cli/main.js`）的原因：让 `--experimental-sqlite` flag 由 launcher 注入，plist 不重复维护 flag。详见后文"Node 运行时 flag 与 bin launcher"章节。

但 launchd 不继承 shell PATH，所以两件事都必须是**绝对路径**：

- `<nodePath>`：不能写 `node`，必须写绝对路径（详见下文"plist 中 Node 路径策略"）。
- `<packagePath>/bin/tether`：必须解析到全局 npm 包安装目录的绝对路径。

需要在 CLI 内提供一个"当前 CLI 入口路径解析"函数：

```ts
resolveLauncherPath()  // 返回 bin/tether 的绝对路径（dev 和 prod 不同处理）
```

开发模式下没有 launcher，要走另一条路径（详见"开发模式与发布模式入口解析"小节）。

### plist 中 Node 路径策略

`<nodePath>` 的几种选项各有缺陷：

- **写 `node`**：launchd 无 PATH，找不到。直接淘汰。
- **写 `process.execPath` 当时的快照**：`tether gateway install` 执行时记录当前 Node 的绝对路径写到 plist。问题：用户 nvm 切版本或卸载该 Node 版本后，路径失效，launchd 启动 Gateway 直接失败。
- **写系统稳定路径**（`/usr/local/bin/node` 或 `/opt/homebrew/bin/node`）：用户可能没装系统 Node，只用 nvm。

**决策**：写 `process.execPath` 快照 + 在 `~/.tether/gateway-runtime.json` 同时记录当时的 Node 版本和路径 + `tether doctor` 主动检测是否仍存在。

```json
// ~/.tether/gateway-runtime.json
{
  "nodePath": "/Users/dream/.nvm/versions/node/v22.13.0/bin/node",
  "nodeVersion": "v22.13.0",
  "launcherPath": "/Users/dream/.nvm/versions/node/v22.13.0/lib/node_modules/@tether/cli/bin/tether",
  "installedAt": 1714838400000
}
```

`tether doctor` 必须检查：

- `nodePath` 文件是否仍存在（`fs.existsSync`）。
- 实际版本是否 >= 22.13（执行 `node --version`）。
- `launcherPath` 是否仍存在。

任一项失败时报：

```text
LaunchAgent 引用的 Node 已不存在或版本过低：
  plist 中 Node 路径：/Users/dream/.nvm/versions/node/v22.13.0/bin/node
  当前 nvm 默认 Node：/Users/dream/.nvm/versions/node/v23.5.0/bin/node
请重新运行：tether gateway install  以更新 LaunchAgent
```

这样把"用户切 Node 版本"从静默失败变成可观测、可自助修复。

## Node 运行时 flag 与 bin launcher

因为 `node:sqlite` 在 Node 22.x / 23.x 仍是 experimental，需要 `--experimental-sqlite` flag。
flag 必须出现在三处：用户启动 `tether`、launchd 启动 Gateway、Gateway 启动 session-runner 子进程。
为避免 flag 散落在 shebang、plist、spawn 调用中各写一份，统一用一个 launcher。

### `bin/tether` 改成 JS launcher

不要用：

```text
#!/usr/bin/env -S node --experimental-sqlite ...
```

`-S` 在某些老系统对多参数支持不一致，且 shebang 里的 flag 一旦发布就难以集中修改。

改用 JS launcher：内部 spawn `process.execPath`，启动时注入 `NODE_RUNTIME_FLAGS`，参数透传。完整代码（含 dev/prod 自动切换）见 [开发模式与发布模式入口解析 / launcher 在两种模式下的行为](#launcher-在两种模式下的行为) 章节。

设计要点：

- launcher 自身不需要 `--experimental-sqlite`（它不用 sqlite，只 spawn 子进程）。
- 子进程才是真正的 CLI 入口（dev: tsx + 源码；prod: `dist/cli/main.js`）。
- `child.on('exit')` 透传退出码和信号，确保 launcher 透明。
- 代价：每次启动多一次 fork，~30ms。CLI 完全可接受。

### `node-flags.ts` 单一来源

```ts
// apps/gateway/src/node-flags.ts
export const NODE_RUNTIME_FLAGS = [
  '--experimental-sqlite',
  '--no-warnings=ExperimentalWarning'
];
```

`bin/tether` 和 `session-runner-spawn.ts` 都从这里读，禁止任何文件硬编码 flag 字符串。
未来 Node 24 stable 后只删这一个文件的内容即可（flag 在 stable Node 上是 no-op，不会报错，但仍建议清理）。

### LaunchAgent plist 走 launcher

```text
ProgramArguments:
  /absolute/path/to/node
  /absolute/path/to/@tether/cli/bin/tether
  gateway
```

不要写 `node dist/cli/main.js gateway`——那会让 plist 重新承担 flag 维护责任。
让 plist 只认 launcher 路径一处，flag 由 launcher 注入。

launchd 会多一次 fork，但启动 Gateway 是单次行为，无影响。

### session-runner 子进程

`session-runner-spawn.ts` 不能用 launcher（性能 + 需要传 base64 payload），必须直接 `spawn(process.execPath, [...])`。
此处必须从 `node-flags.ts` 导入 `NODE_RUNTIME_FLAGS` 拼接到 args 前面：

```ts
import { NODE_RUNTIME_FLAGS } from './node-flags.js';

spawn(process.execPath, [...NODE_RUNTIME_FLAGS, runnerEntry, payload], { ... });
```

未来如果再有任何 fork Node 子进程的代码，规则是：**flag 永远从 `node-flags.ts` 读，不允许硬编码**。

### launcher 进程常驻成本

JS launcher 用 spawn 模式意味着每次 `tether` 都有两个 Node 进程：

- launcher 进程：~30-50MB 常驻，等子进程 exit 后退出。
- 实际 CLI 进程：跑业务逻辑。

短命令（`tether --version`、`tether sessions`）影响可忽略。`tether attach` 这种长会话期间，launcher 也会一直挂着。这是 flag 隔离的代价，可接受。

不能改成 `import('../dist/cli/main.js')` 同进程加载，因为那样就没法在加载前注入启动 flag——`--experimental-sqlite` 必须在 Node 进程启动时给。

## 开发模式与发布模式入口解析

`bin/tether` launcher 和 `session-runner-spawn.ts` 都需要知道入口文件路径。开发和发布模式入口完全不同，必须有清晰的分支。

### 三种执行场景

| 场景 | 怎么启动 CLI | 怎么启动 session-runner |
| --- | --- | --- |
| 仓库内开发（`pnpm tether ...`） | `tsx apps/cli/src/main.ts` | `tsx apps/gateway/src/session-runner-process.ts` |
| 仓库内开发（直接跑 `bin/tether`） | launcher → spawn node + tsx + 源码 | spawn node + tsx + 源码 |
| 全局安装（`npm install -g`） | launcher → spawn node + flags + `dist/cli/main.js` | spawn node + flags + `dist/gateway/session-runner-process.js` |

### 入口解析策略

统一用一个 helper（建议放 `apps/cli/src/runtime-paths.ts`）：

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export type RuntimeMode = 'dev' | 'prod';

export function detectRuntimeMode(): RuntimeMode {
  // 发布包：bin/tether 同级有 ../dist/cli/main.js
  // 开发模式：源码在 apps/cli/src/main.ts，没有 dist
  return existsSync(path.join(here, '../dist/cli/main.js')) ? 'prod' : 'dev';
}

export function resolveCliEntry(mode: RuntimeMode): string {
  return mode === 'prod'
    ? path.join(here, '../dist/cli/main.js')
    : path.join(here, '../apps/cli/src/main.ts');
}

export function resolveRunnerEntry(mode: RuntimeMode): string {
  return mode === 'prod'
    ? path.join(here, '../dist/gateway/session-runner-process.js')
    : path.join(here, '../apps/gateway/src/session-runner-process.ts');
}
```

### launcher 在两种模式下的行为

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.join(here, '../dist/cli/main.js');
const isProd = existsSync(distEntry);

const args = isProd
  ? ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', distEntry]
  : ['--import', 'tsx', '--experimental-sqlite', '--no-warnings=ExperimentalWarning',
     path.join(here, '../apps/cli/src/main.ts')];

const child = spawn(process.execPath, [...args, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
```

dev 模式下 `tsx` 必须能在 Node module resolution 范围内找到（仓库根 `node_modules/tsx`）。这要求开发者已经 `pnpm install` 过。

### `pnpm tether` 怎么办

当前 `package.json` 的 `tether` script（如有）应改为：

```json
{
  "scripts": {
    "tether": "node bin/tether"
  }
}
```

让 dev 也走 launcher，统一行为。launcher 自己检测 dev/prod，无需调用方知道。

### session-runner 入口的特殊性

`session-runner-spawn.ts` 必须用 `resolveRunnerEntry(mode)` 拿到入口，且：

```ts
import { NODE_RUNTIME_FLAGS } from './node-flags.js';
import { detectRuntimeMode, resolveRunnerEntry } from '...';

const mode = detectRuntimeMode();
const entry = resolveRunnerEntry(mode);
const args = mode === 'prod'
  ? [...NODE_RUNTIME_FLAGS, entry, payload]
  : ['--import', 'tsx', ...NODE_RUNTIME_FLAGS, entry, payload];

spawn(process.execPath, args, { ... });
```

dev 模式下额外加 `--import tsx` 才能跑 .ts 文件。

**注意**：`runtime-paths.ts` 必须放在不依赖 workspace import 的位置，因为发布产物里它会被 bundle 进 `dist/cli/main.js`，而 launcher（在 `bin/`）和它在不同目录。launcher 自己用 inline 实现 `existsSync` 检测即可，避免循环依赖。

## 后台 PATH 与 provider 命令

当前 `tether gateway doctor/status` 会显示类似：

```text
后台 PATH: 包含 /opt/homebrew/bin，包含 /usr/local/bin
Provider 命令: 未配置，使用 PATH 查找
```

这个逻辑在开发和个人使用里是合理的，但打包给其他人时要明确边界：

- 全局 `tether` 命令本身不能依赖 PATH fallback，必须由 npm global bin 提供。
- LaunchAgent 启动 Gateway 不能只写 `tether`，必须写绝对 CLI 入口。
- provider 命令可以继续默认用 PATH 查找，例如 `codex`、`claude`、`opencode`。
- launchd 的 PATH 必须显式写入常见目录，否则后台 Gateway 可能找不到用户前台 shell 里能找到的 provider。

第一版建议保留 provider PATH fallback，但增强诊断和配置：

1. LaunchAgent `EnvironmentVariables.PATH` 默认包含：

   ```text
   /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
   ```

2. `tether gateway doctor` 明确检查：

   - 全局 `tether` bin 是否可用。
   - LaunchAgent 实际 CLI 入口是否是绝对路径。
   - 后台 PATH 是否包含 `/opt/homebrew/bin` 和 `/usr/local/bin`。
   - `codex` / `claude` / `opencode` 是否能在后台 PATH 中解析到。

3. `tether gateway providers` 显示每个 provider 的 resolved command：

   ```text
   codex: /opt/homebrew/bin/codex
   claude: 未找到
   ```

4. 如果用户机器的 provider 不在默认 PATH，允许写入绝对路径配置：

   ```json
   {
     "providers": {
       "codex": {
         "command": "/Users/<user>/.local/bin/codex"
       }
     }
   }
   ```

5. `Provider 命令: 未配置，使用 PATH 查找` 不算错误；只有后台 PATH 找不到 provider
   时才应该报 actionable error：

   ```text
   未找到 codex。请确认 codex 已安装，或运行 tether gateway providers 配置绝对路径。
   ```

结论：打包发布必须修“全局 tether / launchd 入口不能依赖 PATH”；provider 命令可以继续使用
PATH fallback，但要补强后台 PATH、doctor 和绝对路径配置能力。

## 原生依赖风险

### node-pty

`node-pty` 是核心风险：

- 不同 Node ABI / macOS 架构可能需要编译。
- 用户机器需要 Xcode Command Line Tools。
- npm install 失败会直接导致 CLI 不可用。

建议第一版明确支持：

```text
macOS arm64 / x64
Node.js >=22.13（与 engines 一致）
```

注意 `node-pty` 也按 Node ABI 发布 prebuild，切 Node 版本同样可能 ABI mismatch。但与 `better-sqlite3` 不同，`node-pty` 我们必须保留（没有 Node 内置替代品），所以 `tether doctor` 需要明确检测并提示用户 `npm rebuild node-pty`。

后续优化：

- CI 预构建 macOS arm64 / x64 binary。
- 发布前做 clean install 测试。
- 如果 `node-pty` 安装失败，CLI 要给明确错误：安装 Xcode Command Line Tools 或换 Node 22.13+。

### better-sqlite3 → node:sqlite（已决策）

`better-sqlite3` 的根本问题不是"能否拿到 prebuild"，而是 **ABI 绑定**：

- prebuild 按 Node ABI（`process.versions.modules`）发布。
- 用户用 nvm 切 Node 版本后，binding 不匹配，CLI 直接启动失败。
- doctor 检测 + 文档说明只能"提示用户手动 rebuild"，不能根治。

**决策：迁移到 `node:sqlite`（Node 内置）。**

理由：

- 完全消除 native 编译和 ABI 问题。
- `node:sqlite` 底层就是 SQLite，文件格式与 better-sqlite3 完全兼容，**`~/.tether/tether.db` 现有数据零迁移**。
- API 与 better-sqlite3 高度相似（`db.prepare().run/all/get`、`db.exec`、`db.pragma`）。
- 支持 WAL，daemon 与 session-runner 多进程共享 db 的当前架构不受影响。
- 迁移后整个发布只剩 `node-pty` 一个原生依赖。

**Node 版本决策**

- `node:sqlite` 在 Node 22.5 引入，22.x / 23.x 均为 experimental，需要 `--experimental-sqlite` flag。
- Node 24+ 转 stable，flag 变 no-op。
- 决策：**`engines.node >=22.13.0`**，运行时通过 launcher 注入 `--experimental-sqlite`，不强制 Node 24。
- flag 注入策略详见"Node 运行时 flag 与 bin launcher"章节，本节不重复。

**Node 版本 hard-check**

`engines` 字段只在 npm install 时给 EBADENGINE warning（不阻断）。CLI 启动时必须显式检查：

```ts
// apps/cli/src/main.ts 第一行
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('Tether 需要 Node.js 22.13 或更高版本，当前 ' + process.versions.node);
  console.error('建议：nvm install 22 && nvm use 22');
  process.exit(1);
}
```

### node:sqlite vs better-sqlite3 关键 API 差异

**这一节是迁移工作量的真正来源。** 不是简单替换 import 就能跑。

| 维度 | better-sqlite3 | node:sqlite |
| --- | --- | --- |
| 类名 | `Database`（default export） | `DatabaseSync`（命名导出） |
| import | `import Database from 'better-sqlite3'` | `import { DatabaseSync } from 'node:sqlite'` |
| pragma | `db.pragma('journal_mode = WAL')` | **无此方法**，用 `db.exec('PRAGMA journal_mode = WAL')` |
| 命名参数 | `.run({ id, provider, ... })` 配合 `@id, @provider` | **不支持对象命名参数**，必须改位置参数 |
| Statement 返回 | `Statement` | `StatementSync` |
| `lastInsertRowid` | BigInt 或 number | number（不需要 `Number()` 转换） |
| `prepare` 缓存 | 隐式 cache | 不缓存，需调用方持有 statement 对象 |

**对当前 `store.ts` 的具体影响**：

1. `store.ts:99` `new Database(dbPath)` → `new DatabaseSync(dbPath)`。
2. `store.ts:100-101` `db.pragma(...)` → `db.exec('PRAGMA ...')`。pragma 的返回值当前代码没用，OK。
3. `store.ts:153-167` `insertSession` 用了 `@id, @provider, @title, ...` 命名参数 + `.run(toRow(session))` 传对象——**全部要重写为位置参数数组**。这是最大的工作量：22 个字段、`?, ?, ?, ...` 占位符按顺序排好，调用处 `.run(session.id, session.provider, ...)`。
4. `store.ts:244` `Number(result.lastInsertRowid)` → 直接用 `result.lastInsertRowid`（已经是 number）。
5. 所有方法里的 `this.db.prepare('...').run/all/get(...)` 模式改成 constructor 里预编译：
   ```ts
   private readonly stmtListSessions: StatementSync;
   constructor(...) {
     this.stmtListSessions = this.db.prepare('SELECT * FROM sessions ORDER BY last_active_at DESC');
   }
   listSessions() { return this.stmtListSessions.all() as SessionRow[]; }
   ```
6. schema 自迁移（`store.ts:306-346`）的 `PRAGMA table_info` 调用：从 `prepare('PRAGMA ...').all()` 形式确认仍可用，必要时改 `db.exec` + 不读返回。

**真实工作量预估**：4-6 小时（不是之前说的"几小时"），主要在 #3 和 #5 上。

### Store 重写其他要点

- 所有 SQLite 代码集中在 `apps/gateway/src/store.ts`（415 行），外部接口 15 个方法签名不变，调用方零改动。
- 多进程共享 db（daemon + session-runner）通过 SQLite 文件锁 + WAL，`node:sqlite` 同样支持，行为一致。
- `~/.tether/tether.db` 现有 91MB 数据零迁移，文件格式完全兼容。
- schema 自迁移逻辑保留，确保打开老 db 时新增字段兼容。
- `store.test.ts` 在 Node 22.13 + `--experimental-sqlite` 下全部跑通。

### 实测确认（动手前必做）

```bash
node --experimental-sqlite -e "
import('node:sqlite').then(m => {
  console.log('exports:', Object.keys(m));
  const db = new m.DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
  const ins = db.prepare('INSERT INTO t (name) VALUES (?)');
  console.log('insert result:', ins.run('hello'));
  const sel = db.prepare('SELECT * FROM t').all();
  console.log('select:', sel);
  db.close();
})
"
```

在 Node 22.13 实测，确认：

- `DatabaseSync` 是否真的命名导出。
- `prepare(...).run(positional)` 行为符合预期。
- `lastInsertRowid` 字段名和类型。

如果 API 与上表描述有出入，先更新本节再开干。

## 版本与包名

建议阶段性包名：

```text
@tether/cli
```

如果 npm scope 不可用，备选：

```text
tether-cli
```

不建议马上发布根包名 `tether`，除非确认 npm name 可用并准备长期维护这个名字。

版本策略：

- 首版：`0.1.0-alpha.0`
- 每次可安装验证后递增 alpha。
- 等安装、Gateway 后台、Codex session、Relay 登录链路都稳定，再发 `0.1.0`。

## 配置和数据目录

发布包不应把运行态写到安装目录。继续使用用户目录：

```text
~/.tether/config.json
~/.tether/auth.json
~/.tether/tether.db
~/.tether/logs/
~/Library/LaunchAgents/sh.tether.gateway.plist
```

这点是正确方向。需要补齐的是：

- `tether doctor` 显示 package version、node path、install path、gateway plist path。
- `tether gateway uninstall` 只删除 LaunchAgent，不删除用户数据。
- 如需清空数据，单独提供 `tether reset` 或文档手动说明，不和 uninstall 混在一起。

## 打包与发布操作手册

完整的端到端流程：本地打包 → 本地验证 → npm 发布 → CI 自动化。

### 发布产物目录结构

monorepo 不能直接 `npm publish` 整个仓库。决策：**用独立的 `release/` 目录隔离发布产物**。

```
release/
├── package.json          # 发布专用，独立维护
├── README.md             # 从根目录复制
├── bin/
│   └── tether            # JS launcher（手写，提交进 git）
└── dist/                 # tsup 构建输出
    ├── cli/main.js
    └── gateway/session-runner-process.js
```

构建脚本把 tsup 输出到 `release/dist/`，`bin/tether` 一次写好提交进 git，`npm publish` 在 `release/` 目录里跑。

不用根 `package.json` 直接发布的原因：根包有 monorepo 配置（`pnpm-workspace.yaml`、大量 dev deps），发布时很难干净分离。

### `release/package.json` 模板

```json
{
  "name": "@tether/cli",
  "version": "0.1.0-alpha.0",
  "description": "Tether CLI - manage AI provider sessions across devices",
  "type": "module",
  "bin": {
    "tether": "./bin/tether"
  },
  "engines": {
    "node": ">=22.13.0"
  },
  "os": ["darwin", "linux"],
  "files": ["bin", "dist", "README.md"],
  "dependencies": {
    "node-pty": "^1.0.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<owner>/tether.git"
  },
  "license": "MIT"
}
```

要点：

- **runtime dependencies 只列 `node-pty`**，其他全部 bundle 进 `dist`，不出现在 dependencies。
- 不写 `devDependencies`（发布产物不需要）。
- `os` 字段限制可装平台，避免 Windows 用户装上去崩。
- `engines.node` 必须 22.13 与 hard-check 一致。

### tsup 构建配置

`tsup.release.config.ts`（仓库根）：

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/main': 'apps/cli/src/main.ts',
    'gateway/session-runner-process': 'apps/gateway/src/session-runner-process.ts'
  },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outDir: 'release/dist',
  external: ['node-pty'],          // 唯一原生依赖
  noExternal: [/^@tether\//],      // 强制 bundle workspace 包
  splitting: false,                // CLI 不需要代码分割
  sourcemap: true,
  clean: true,
  shims: false                     // ESM 只跑 Node 22+
});
```

关键：

- `noExternal: [/^@tether\//]` 必须显式声明。tsup 默认 external `node_modules` 里所有包，包括 workspace 软链。不写就会出现"产物里仍然 `import '@tether/gateway'`"的事故。
- `node:sqlite` 是 Node 内置，tsup 自动 external `node:` 协议，不用配。
- 两个 entry 分别打 `dist/cli/main.js` 和 `dist/gateway/session-runner-process.js`。

### 构建命令

仓库根 `package.json` 加：

```json
{
  "scripts": {
    "build:release": "tsup --config tsup.release.config.ts",
    "pack:release": "pnpm build:release && cp README.md release/ && cd release && npm pack --dry-run"
  }
}
```

执行：

```bash
pnpm pack:release
```

`--dry-run` 输出应该只看到：

```
release/package.json
release/README.md
release/bin/tether
release/dist/cli/main.js
release/dist/cli/main.js.map
release/dist/gateway/session-runner-process.js
release/dist/gateway/session-runner-process.js.map
```

出现任何 `apps/`、`packages/`、`node_modules/` 都是 `files` 字段配错。

### 本地 tarball 测试

```bash
cd release
npm pack                    # 生成 tether-cli-0.1.0-alpha.0.tgz
mv tether-cli-*.tgz /tmp/
cd /tmp/

# 用全新 Node 模拟用户环境
nvm install 22.13
nvm use 22.13
mkdir clean-test && cd clean-test
npm install -g /tmp/tether-cli-0.1.0-alpha.0.tgz
```

然后跑下面"验证矩阵"中的 🔴 阻塞级用例。

### npm 发布（首版）

一次性准备：

```bash
npm login
npm whoami

# 探测 scope 是否可用
npm view @tether/cli   # 404 = 可用，有结果 = 被占
```

`@tether` 被占的备选：`@<your-username>/tether-cli`，例如 `@dreamhuang/cli`。备选名一旦确定，文档里所有 `@tether/cli` 引用要同步改。

如果是新建 npm org：

```bash
npm org create tether
```

首次发布：

```bash
cd release
npm publish --access public --tag alpha
```

要点：

- scoped 包默认 private，必须 `--access public`。
- `--tag alpha` 让用户必须显式 `npm install -g @tether/cli@alpha`，不会被 `npm install -g @tether/cli`（等价 `@latest`）拉到。
- 等稳定后再 `npm dist-tag add @tether/cli@0.1.0 latest`。

### 发布后跨机器验证

最好真用另一台机器（或同事的）：

```bash
nvm install 22 && nvm use 22
npm install -g @tether/cli@alpha
tether --version
tether doctor
```

确认从 npm registry 真能拉到、能装、能跑。

### 后续版本递增

```bash
cd release
npm version prerelease --preid=alpha     # 0.1.0-alpha.0 → 0.1.0-alpha.1
cd ..
pnpm pack:release                         # 重新构建
cd release
npm pack
# ... 跑验证矩阵
npm publish --access public --tag alpha
```

### 撤回发布

- 72 小时内：`npm unpublish @tether/cli@0.1.0-alpha.0` 可以真删。
- 超过 72 小时：只能 `npm deprecate @tether/cli@0.1.0-alpha.0 "msg"`，不能真删。
- 含义：alpha.0 必须本地全部验证通过再发，不要边发边修。

### CI 自动化（首版稳定后再做）

`.github/workflows/release.yml`：

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '22.13'
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm pack:release
      - name: Publish
        working-directory: release
        run: npm publish --access public --tag alpha
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

需要：

- GitHub repo settings 加 `NPM_TOKEN` secret（npm.com 生成 automation token）。
- 触发：`git tag v0.1.0-alpha.2 && git push origin v0.1.0-alpha.2`。

测试矩阵建议：

```yaml
test:
  strategy:
    matrix:
      node: ['22.13', '24']
      os: [macos-14, macos-13]
```

## 任务清单（TODO）

按依赖关系分阶段。每阶段内部任务可以并行，阶段之间必须串行。

### 阶段 1：SQLite 迁移（最优先，独立可验证）

- [ ] T1.1 在 Node 22.13 实测 `node:sqlite` API surface（运行文档"实测确认"代码块），确认 `DatabaseSync`、`prepare(...).run(positional)`、`lastInsertRowid` 行为
- [ ] T1.2 重写 `apps/gateway/src/store.ts`：
  - [ ] T1.2.1 `Database` → `DatabaseSync`，import 改命名导出
  - [ ] T1.2.2 `db.pragma(...)` → `db.exec('PRAGMA ...')`
  - [ ] T1.2.3 `insertSession` 命名参数 `@xxx` 改位置参数 `?`，`toRow()` 改返回数组
  - [ ] T1.2.4 所有 `prepare()` 移到 constructor 预编译，方法体只调用 statement
  - [ ] T1.2.5 `Number(result.lastInsertRowid)` 简化
  - [ ] T1.2.6 schema 自迁移逻辑保留，确认 `PRAGMA table_info` 返回结构兼容
- [ ] T1.3 `apps/gateway/src/store.test.ts` 在 Node 22.13 + `--experimental-sqlite` 下全绿
- [ ] T1.4 用既有 `~/.tether/tether.db`（91MB）冒烟一次：备份、打开、读取老 session、append 新 event 验证
- [ ] T1.5 从 `package.json`（根 + `apps/gateway/package.json`）移除 `better-sqlite3` 依赖
- [ ] T1.6 `pnpm install` 一次确认无残留

### 阶段 2：Node flag 与 runtime mode（运行时基础设施）

- [ ] T2.1 新建 `apps/gateway/src/node-flags.ts`，导出 `NODE_RUNTIME_FLAGS`
- [ ] T2.2 新建 `apps/cli/src/runtime-paths.ts`：`detectRuntimeMode()`、`resolveCliEntry()`、`resolveRunnerEntry()`
- [ ] T2.3 改 `apps/gateway/src/session-runner-spawn.ts`：spawn 时拼 `NODE_RUNTIME_FLAGS`，dev 模式额外加 `--import tsx`
- [ ] T2.4 `apps/cli/src/main.ts` 第一行加 Node 22.13 hard-check
- [ ] T2.5 跑通整个 Gateway + session-runner 流程（dev 模式）

### 阶段 3：bin launcher 与 launchd

- [ ] T3.1 把现有 `bin/tether` 改成 JS launcher（dev/prod 自动切换）
- [ ] T3.2 `chmod +x bin/tether`，确认 git 保留 mode
- [ ] T3.3 改 `apps/gateway/src/launchd.ts`：
  - [ ] T3.3.1 `ProgramArguments` 第一项 `process.execPath` 快照（绝对路径）
  - [ ] T3.3.2 第二项 launcher 绝对路径（不写 `dist/cli/main.js`）
  - [ ] T3.3.3 `EnvironmentVariables.PATH` 显式包含 `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`
  - [ ] T3.3.4 `tether gateway install` 同时写 `~/.tether/gateway-runtime.json`（nodePath、nodeVersion、launcherPath、installedAt）
- [ ] T3.4 改 `package.json` 的 `tether` script 为 `node bin/tether`
- [ ] T3.5 本地 `tether gateway install/start` 验证 launchd 可用，`launchctl print` 检查 plist
- [ ] T3.6 `tether gateway doctor` 增强：
  - [ ] T3.6.1 检测 `nodePath` 是否仍存在 + 版本 >= 22.13
  - [ ] T3.6.2 `node:sqlite` 加载检测（in-memory db）
  - [ ] T3.6.3 `node-pty` 加载检测
  - [ ] T3.6.4 输出 db 路径与大小
  - [ ] T3.6.5 输出当前 runtime mode（dev/prod）
  - [ ] T3.6.6 输出 launcher 路径、`process.execPath`、Node 版本、安装目录

### 阶段 4：发布产物（打包结构）

- [ ] T4.1 创建 `release/` 目录，加入 `.gitignore` 排除 `release/dist/`
- [ ] T4.2 写 `release/package.json`（按模板）
- [ ] T4.3 写 `release/bin/tether`（launcher 完整版）+ `chmod +x`
- [ ] T4.4 仓库根新建 `tsup.release.config.ts`
- [ ] T4.5 仓库根 `package.json` 加 `build:release`、`pack:release` script
- [ ] T4.6 决定包名：`npm view @tether/cli` 探测，被占则定备选名并全文档替换
- [ ] T4.7 处理 workspace import：确认 tsup 真把 `@tether/*` 都 bundle 进去（`grep -r "@tether/" release/dist/` 应该零结果）

### 阶段 5：本地验证（不通过不发）

- [ ] T5.1 `pnpm pack:release` 跑通，`--dry-run` 输出文件列表干净（无 apps/packages/node_modules）
- [ ] T5.2 在 `/tmp/clean-test` 用全新 Node 22.13 装 tarball
- [ ] T5.3 跑"验证矩阵"全部 🔴 阻塞级用例
- [ ] T5.4 跑"验证矩阵"全部 🟡 警告级用例（失败可推迟，但要记录 issue）
- [ ] T5.5 卸载测试：`uninstall` 后用户数据保留、plist 删除

### 阶段 6：npm 发布

- [ ] T6.1 `npm login` 登录目标账号
- [ ] T6.2 如需新建 org：`npm org create tether`
- [ ] T6.3 `npm publish --access public --tag alpha` 发 alpha.0
- [ ] T6.4 在另一台机器 `npm install -g @tether/cli@alpha` 验证
- [ ] T6.5 alpha.0 → alpha.5 期间手动迭代发版，每次重跑验证矩阵
- [ ] T6.6 稳定后 `npm dist-tag add @tether/cli@0.1.0 latest`

### 阶段 7：CI 自动化（可选，alpha.5+ 再做）

- [ ] T7.1 GitHub repo settings 加 `NPM_TOKEN` secret
- [ ] T7.2 写 `.github/workflows/release.yml`（tag 触发）
- [ ] T7.3 写 `.github/workflows/test.yml`（PR 触发，矩阵 Node 22.13/24 × macos-14/13）
- [ ] T7.4 用 `git tag v0.1.0-alpha.x` 触发一次端到端验证

### 阶段 8：附带改进（独立排期）

- [ ] T8.1 `commands` alias 白名单（详见"自定义命令"章节）
- [ ] T8.2 `session_events` 表 retention 机制（90MB 已经不小，半年到 GB）
- [ ] T8.3 `tether reset --events-older-than 30d` 数据清理命令
- [ ] T8.4 schema 自迁移改 user_version + migration array 模式（可读性改进）

## 验证矩阵

按严重度分级。**🔴 阻塞级不通过不能发布；🟡 警告级要修但可推迟到下个 alpha；🟢 信息级可选**。

### 🔴 阻塞级（必须全绿才能 npm publish）

| ID | 验证项 | 验证命令 | 预期 |
| --- | --- | --- | --- |
| V1 | Node 版本 hard-check | Node 21 下 `tether --version` | exit 1 + 友好提示，无 stack trace |
| V2 | 包结构干净 | `cd release && npm pack --dry-run` | 仅含 bin/dist/README/package.json，无 apps/packages |
| V3 | bundle 完整 | `grep -r "@tether/" release/dist/` | 零结果（workspace 包全部打进去了） |
| V4 | bin 可执行 | `ls -la release/bin/tether` | mode 含 `+x` |
| V5 | 全新环境装包 | `nvm use 22.13 && npm install -g <tgz>` 无报错 | 安装成功，`which tether` 输出 npm global bin |
| V6 | 任意 cwd 可执行 | `cd /tmp && tether --version` | 输出版本号，无找不到入口报错 |
| V7 | `node:sqlite` 加载 | `tether doctor` | 显示 `node:sqlite: ok` |
| V8 | 历史数据兼容 | 升级前后 `ls ~/.tether/tether.db` | 文件存在，`tether sessions` 列出老 session |
| V9 | session 创建 | `tether codex --no-attach` | session 创建成功，`tether sessions` 可见 |
| V10 | session 子进程 spawn | 上一步成功 | `ps aux \| grep session-runner` 看到子进程，flag 正确 |
| V11 | LaunchAgent 安装 | `tether gateway install` | plist 写入 `~/Library/LaunchAgents/`，`launchctl list \| grep tether` 能找到 |
| V12 | plist 路径绝对 | `launchctl print gui/$(id -u)/sh.tether.gateway \| grep -A 5 ProgramArguments` | 第一项是绝对 node 路径，第二项是绝对 launcher 路径，不含 `tsx` |
| V13 | LaunchAgent 启动 Gateway | `tether gateway start && tether gateway status` | status 显示 running |
| V14 | LaunchAgent 卸载干净 | `tether gateway uninstall && ls ~/Library/LaunchAgents/` | plist 已删除 |
| V15 | 卸载保留用户数据 | `npm uninstall -g @tether/cli && ls ~/.tether/` | `~/.tether/` 仍然完整 |

### 🟡 警告级（应该修，可推到下个 alpha）

| ID | 验证项 | 验证命令 | 预期 |
| --- | --- | --- | --- |
| V16 | 启动无 ExperimentalWarning | `tether --version 2>&1` | 无 `ExperimentalWarning` 输出 |
| V17 | Node 切版本兼容 | `nvm use 24 && tether --version` | 正常运行，无 warning（验证 flag 在 stable Node 上是 no-op） |
| V18 | nvm 切版本后 doctor 报错可读 | `nvm use 24 && tether gateway status` | 提示"LaunchAgent 引用的 Node 已不存在，请重新 install"，不静默失败 |
| V19 | plist PATH 包含 brew | `launchctl print gui/$(id -u)/sh.tether.gateway \| grep PATH` | 包含 `/opt/homebrew/bin` 和 `/usr/local/bin` |
| V20 | provider 在后台 PATH | Gateway 后台启动后 `tether gateway providers` | `codex`/`claude` resolved path 正确 |
| V21 | session attach 长会话 | `tether attach <id>` 持续 5 分钟 | launcher 进程稳定，无内存泄漏 |
| V22 | session 子进程 flag | `ps -ef \| grep session-runner` | args 包含 `--experimental-sqlite` |
| V23 | doctor 输出完整 | `tether doctor` | 含 nodePath、launcher、Node 版本、sqlite ok、node-pty ok、db 大小、runtime mode |
| V24 | source map 可用 | tsup 产物 `release/dist/cli/main.js.map` | 文件存在 |
| V25 | Linux 边界报错友好 | Linux VM `tether gateway install` | 明确提示"Linux 暂不支持"，不写空 plist |

### 🟢 信息级（首版可选）

| ID | 验证项 | 验证命令 | 预期 |
| --- | --- | --- | --- |
| V26 | 包大小合理 | `du -sh release/*.tgz` | < 5MB（不含 node-pty prebuild） |
| V27 | tsup 构建时间 | `time pnpm build:release` | < 30s（持续监控避免回归） |
| V28 | launcher fork 开销 | `time tether --version` | < 100ms |
| V29 | dev 模式 launcher 兼容 | 仓库内 `node bin/tether --version` | 自动用 tsx + 源码运行 |
| V30 | 跨机器拉取 | 另一台 mac `npm install -g @tether/cli@alpha` | 安装成功 |

### 验证执行顺序

每次发版前按这个顺序跑：

1. **构建期**：V2、V3、V4、V24、V26、V27（不需要装包）
2. **本地装包后**：V5、V6、V7、V9、V10、V28、V29（在 /tmp 干净环境）
3. **Gateway 流程**：V11、V12、V13、V19、V20、V22、V23
4. **回归**：V1、V8、V14、V15、V16、V21、V25
5. **跨环境**：V17、V18、V30

跑不通的项一律记录在 `release/RELEASE-NOTES-<version>.md`，已知问题透明发布。

## ~~发布前必须做的代码调整~~（已合并至"任务清单（TODO）"）

> 早期的扁平清单已经按依赖关系重组到上面"任务清单（TODO）"章节，按阶段 1-8 推进。本节仅为参考保留：

<details>
<summary>展开查看旧清单（18 项扁平列表）</summary>

1. 根包或发布包取消 `private: true`。
2. `bin/tether` 改成 JS launcher（不依赖 `tsx`，注入 `NODE_RUNTIME_FLAGS`）。
3. 新增 `apps/gateway/src/node-flags.ts`，导出 `NODE_RUNTIME_FLAGS`。
4. 重写 `apps/gateway/src/store.ts`：`better-sqlite3` → `node:sqlite`，所有 prepared statement 在 constructor 预编译。
5. 从 `package.json` 移除 `better-sqlite3` 依赖（根包和 `apps/gateway/package.json`）。
6. `apps/cli/src/main.ts` 第一行加 Node 22.13 hard-check，不达标直接 exit 1 + 友好提示。
7. `apps/gateway/src/session-runner-spawn.ts` spawn 子进程时拼接 `NODE_RUNTIME_FLAGS`。
8. 新增 CLI 构建脚本，输出 `dist/cli/main.js`。
9. 处理 workspace import，让发布包不依赖本地 `workspace:*`。
10. 修改 `launchd.ts`：
    - `ProgramArguments` 第一项是 `process.execPath` 当时的快照（绝对路径，不能写 `node`）。
    - 第二项是 `bin/tether` launcher 的绝对路径（不写 `dist/cli/main.js`，让 flag 由 launcher 注入）。
    - 第三项起是子命令（`gateway` 等）。
    - 同时把 `nodePath` / `launcherPath` / `nodeVersion` 写到 `~/.tether/gateway-runtime.json` 供 doctor 检测。
    - 发布模式不再寻找 repo 内 `node_modules/tsx/dist/loader.mjs`。
11. `package.json` 设置 `"engines": { "node": ">=22.13.0" }`。
12. 确认 `package.json#bin.tether` 指向发布包内的 launcher。
13. 增加 `tether doctor` 输出：
    - `which tether`、launcher 路径、`process.execPath`、Node 版本、安装目录。
    - `~/.tether/gateway-runtime.json` 中 `nodePath` 是否仍存在 + 版本 >= 22.13。
    - `node:sqlite` 加载检测：
      ```ts
      try {
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.exec('SELECT 1');
        db.close();
        // ok
      } catch (err) {
        // 报告 node:sqlite 不可用 + 提示 Node 版本/flag
      }
      ```
    - `node-pty` 加载检测：`try { require('node-pty') }` 失败时提示 `npm rebuild node-pty` + Xcode CLT。
    - db 文件路径与大小（提醒用户 events 表持续增长）。
    - 当前 runtime mode（dev / prod）。
14. 确认 `node-pty` 在 clean npm install 下可用（这是迁移后唯一的原生依赖）。
15. `node --experimental-sqlite -e "import('node:sqlite')"` 在 Node 22.13 实测确认 module 存在。
16. `store.test.ts` 在 Node 22.13 + flag 下全部通过。
17. `npm pack --dry-run` 检查包内只包含必要文件。
18. 在一台没有 repo 的临时目录里测试 `npm install -g <tgz>`。

</details>

## 自定义命令 / provider 白名单方案

当前 `tether codex`、`tether claude`、`tether opencode` 是固定 provider 命令。
这些命令只解析 Tether 自己的 `--project`、`--title`、`--no-attach`，并把剩余参数作为
`providerArgs` 透传给 provider。它不能直接支持：

```bash
pnpm tether codex-proxy --title "flutter 方案"
```

原因是 `codex-proxy` 不是已注册 provider 命令，commander 会把它当作未知子命令。

这个问题不应通过让 Gateway 接收任意 `command` / `args` / `env` / `shell` 来解决。
Tether 的安全边界必须保持为：Gateway API 只允许启动本机白名单中的命令，远端客户端不能
让用户电脑执行任意 shell 命令。

### 短期可用：复用 provider command 覆盖

如果只是想把 `codex` 的真实可执行文件替换成 `codex-proxy`，可以继续使用现有
`providers.<name>.command` 配置：

```json
{
  "providers": {
    "codex": {
      "command": "/absolute/path/to/codex-proxy"
    }
  }
}
```

之后仍通过 provider 名启动：

```bash
tether codex --title "flutter 方案"
```

优点是改动小，符合当前安全模型。缺点是 UI 和 session metadata 里的 provider 仍然是
`codex`，不是 `codex-proxy`。

### 推荐方案：命令别名 / 自定义 provider 白名单

正式方案是在本机配置中新增一层白名单别名，例如：

```json
{
  "commands": {
    "codex-proxy": {
      "command": "/absolute/path/to/codex-proxy",
      "defaultArgs": [],
      "kind": "agent"
    },
    "flutter": {
      "command": "flutter",
      "defaultArgs": [],
      "kind": "tool"
    }
  }
}
```

CLI 根据 `commands` 动态注册本机命令：

```bash
tether codex-proxy --title "flutter 方案"
tether flutter --title "flutter doctor" -- doctor
```

Gateway API 只接收别名，不接收真实命令：

```json
{
  "commandId": "codex-proxy",
  "title": "flutter 方案",
  "providerArgs": []
}
```

Gateway 在本机读取 `~/.tether/config.json`，把 `commandId` 解析成真实 `command` 和
`defaultArgs`，再通过 PTY 启动。请求体继续禁止出现以下字段：

```text
command
args
argv
env
shell
providerCommand
```

建议命名上不要把它叫“任意命令”，而叫“本机命令白名单”或“command alias”。这能同时满足
开发者便利性和远端安全边界。

### 可选开发者便利：本地-only exec

可以另外提供一个只在本机 CLI 可用的开发者入口：

```bash
tether exec --title "flutter 方案" -- flutter doctor
tether exec --title "proxy" -- codex-proxy --resume <session-id>
```

约束：

- `exec` 只能由本机 CLI 直接触发。
- `exec` 不进入 Gateway HTTP API、Relay API 或手机/Web 远端创建 session 的协议。
- `exec` 不能被远端客户端调用。
- 运行时仍必须使用 `spawn(command, args[])`，不能使用 `shell:true`。

这个入口适合开发者临时包一条本机命令，但不应成为 Tether 多端控制面的默认能力。

### 推荐实施顺序

1. 先支持 `commands` 配置读取和类型定义。
2. CLI 启动时把 `commands` 动态注册成顶层子命令。
3. `POST /api/sessions` 增加 `commandId`，并只允许解析本机配置里的白名单别名。
4. session metadata 增加 `commandId` / `displayName`，真实 `command` 继续只记录本机解析结果。
5. `tether gateway providers` 扩展为同时展示内置 provider 和自定义 command alias。
6. 增加测试：禁止 API 传 `command`，允许 API 传合法 `commandId`，非法 `commandId` 返回 400。

## 验收清单

在干净环境执行：

```bash
node -v   # 必须 >= 22.13
npm install -g ./tether-cli-0.1.0-alpha.0.tgz
which tether
tether --help
tether --version
tether doctor
tether gateway init
tether gateway login --server-url https://www.earntools.me
tether gateway install
tether gateway start
tether gateway status
tether codex --no-attach
tether sessions
tether attach <session-id>
tether gateway stop
tether gateway uninstall
```

需要确认：

- 不需要 clone repo。
- 不需要 pnpm。
- 不需要 `tsx`。
- 不需要 native 编译工具链（除了 `node-pty` prebuild fallback）。
- `which tether` 指向 npm 全局 bin，且是 JS launcher。
- 任意目录都能执行 `tether`。
- 启动时无 `ExperimentalWarning` 输出。
- Node 21 / Node 20 环境下 `tether --version` 给出明确版本不达标提示并 exit 1，不抛 stack trace。
- `tether doctor` 显示 `node:sqlite: ok`、launcher 路径、Node 路径、db 文件路径与大小。
- LaunchAgent 重启后仍能找到正确 CLI 入口（`launchctl print gui/$(id -u)/sh.tether.gateway` 检查 `ProgramArguments` 是绝对路径，第二项是 launcher）。
- Gateway 能写入和读取 `~/.tether`。
- `node-pty` 能正常 spawn provider。
- `node:sqlite` 能正常打开既有 `~/.tether/tether.db`（含 91MB 老数据）并通过 schema 自迁移。
- 切换 Node 版本（22 → 24）后 CLI 仍可启动，无需任何 rebuild。
- Node 24 下启动无 `ExperimentalWarning`（验证 `--experimental-sqlite` 在 stable Node 上是 no-op）。
- nvm 切换 Node 版本后跑 `tether gateway status`，应该提示"LaunchAgent 引用的 Node 已不存在"而不是静默失败。

## 平台边界

第一阶段只在 macOS（arm64 / x64）做完整验证。其他平台行为：

**Linux**

- npm 包可以 `npm install -g`（`node-pty` 有 Linux prebuild）。
- 前台命令可用：`tether codex`、`tether attach`、`tether sessions` 等。
- `tether gateway install/start/stop/status` 在 `os.platform() !== 'darwin'` 时必须明确报错：
  ```text
  Linux 暂不支持 tether gateway install。
  替代方案：tether gateway start --foreground 在前台运行 Gateway，
  或自行用 systemd / supervisord 包装。
  ```
- 不要假装支持然后写一个空 plist 给 launchd——更难调试。

**Windows**

- 完全不支持。`bin/tether` 是 Unix shebang 风格 + spawn 行为依赖 POSIX 信号转发，Windows 上未验证。
- 文档明确说明，且 `engines.os` 可以收紧到 `["darwin", "linux"]`。

## 实施里程碑

| 里程碑 | 涵盖 TODO 阶段 | 完成判定 |
| --- | --- | --- |
| M1：SQLite 迁移完成 | 阶段 1 全部 | `store.test.ts` 全绿，dev 模式跑 `tether codex` 正常，91MB 老 db 兼容 |
| M2：runtime 基础设施完成 | 阶段 2 全部 | dev 模式下 launcher + session-runner 全链路用 `node:sqlite` 跑通 |
| M3：launchd 与 doctor 完成 | 阶段 3 全部 | 本地 `tether gateway install/start/status/stop/uninstall` 全流程通过 |
| M4：发布产物可装 | 阶段 4 + 5 全部 | `release/` tarball 在干净环境 `npm install -g` 通过验证矩阵 🔴 全部 |
| M5：alpha 上线 | 阶段 6 全部 | `npm install -g @tether/cli@alpha` 跨机器可装可用 |
| M6：CI 自动化 | 阶段 7 全部 | tag push 自动构建发布 |
| M7：稳定后 | 阶段 8 + dist-tag latest | retention 机制就位，Node 24 stable 后清理 flag |

依赖关系：M1 → M2 → M3 → M4 → M5 → M6。M1 是阻塞所有后续工作的关键路径，必须最优先且独立验证。

## 暂不做

- 暂不做 Windows Service / Linux systemd。
- 暂不承诺 `@tether/gateway` 作为公开库 API。
- 暂不把 Server / Relay / Web 一起打进这个 npm 包。
- 暂不做 Docker 桌面版或 Electron 包。
