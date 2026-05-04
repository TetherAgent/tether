# npm CLI / Gateway 打包发布方案

状态：Working  
创建时间：2026-05-04  
范围：根包 `tether`、`apps/cli`、`apps/gateway`、`packages/core`、`packages/config`、`packages/protocol`

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

`bin/tether` 不再依赖 `tsx`：

```js
#!/usr/bin/env node
import '../dist/cli/main.js';
```

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
    "node": ">=20"
  },
  "files": [
    "bin",
    "dist",
    "README.md"
  ]
}
```

## 构建方式

### 推荐：用 tsup / tsdown 打包 CLI runtime

目标是把 workspace 内部依赖打进 `dist`，但保留原生依赖 external。

建议 external：

```text
node-pty
better-sqlite3
ws
```

其中 `ws` 可以打进去也可以 external，`node-pty` 和 `better-sqlite3` 不建议 bundle。

构建产物：

```text
dist/cli/main.js
```

CLI import 的 `@tether/gateway`、`@tether/core`、`@tether/config`、`@tether/protocol` 应在构建时被打进产物，或者通过 package manager 作为 npm dependency 安装。短期更推荐打进产物，减少包发布数量。

需要新增脚本：

```json
{
  "scripts": {
    "build:cli": "tsup apps/cli/src/main.ts --format esm --target node20 --platform node --out-dir dist/cli --external node-pty --external better-sqlite3",
    "pack:cli": "pnpm build:cli && npm pack --dry-run"
  }
}
```

实际落地时要根据 sourcemap、多个入口和 `__dirname` 兼容再调整。

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

发布包里应改成：

```text
<nodePath> <packageBinOrDistMain> gateway
```

建议 plist 的 `ProgramArguments` 使用：

```text
process.execPath
<global npm package resolved path>/dist/cli/main.js
gateway
```

或者直接使用 npm 安装后的 bin 真实路径：

```text
<resolved tether bin path>
gateway
```

但 launchd 不一定继承 shell PATH，所以不能只写 `tether`。必须写绝对路径。

需要在 CLI 内提供一个稳定的“当前 CLI 入口路径”解析函数：

```ts
resolveInstalledCliEntry()
```

开发模式返回源码入口；发布模式返回 `dist/cli/main.js` 或全局 bin 的真实路径。

建议优先让 LaunchAgent 直接执行 Node + dist 入口：

```text
ProgramArguments:
  /absolute/path/to/node
  /absolute/path/to/@tether/cli/dist/cli/main.js
  gateway
```

这样即使用户 shell 里能找到 `tether`，launchd 也不依赖 shell 初始化文件。

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
Node.js 20 LTS
```

后续优化：

- CI 预构建 macOS arm64 / x64 binary。
- 发布前做 clean install 测试。
- 如果 `node-pty` 安装失败，CLI 要给明确错误：安装 Xcode Command Line Tools 或换 Node 20。

### better-sqlite3

`better-sqlite3` 也是原生依赖：

- 需要确认 npm install 时是否能稳定拿到 prebuild。
- 如果 fallback 编译，仍依赖本机构建工具。

短期接受这个依赖；不要为了发布首版马上替换 SQLite。

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

## 发布前必须做的代码调整

1. 根包或发布包取消 `private: true`。
2. `bin/tether` 改成不依赖 `tsx` 的 JS 入口。
3. 新增 CLI 构建脚本，输出 `dist/cli/main.js`。
4. 处理 workspace import，让发布包不依赖本地 `workspace:*`。
5. 修改 `launchd.ts`，发布模式下不再寻找 repo 内 `node_modules/tsx/dist/loader.mjs`。
6. 确认 `package.json#bin.tether` 指向发布包内的稳定入口。
7. 增加 `tether doctor` 或现有 doctor 输出 `which tether`、CLI 入口、Node 路径和安装目录。
8. 确认 `node-pty`、`better-sqlite3` 在 clean npm install 下可用。
9. `npm pack --dry-run` 检查包内只包含必要文件。
10. 在一台没有 repo 的临时目录里测试 `npm install -g <tgz>`。

## 验收清单

在干净环境执行：

```bash
node -v
npm install -g ./tether-cli-0.1.0-alpha.0.tgz
which tether
tether --help
tether --version
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
- `which tether` 指向 npm 全局 bin。
- 任意目录都能执行 `tether`。
- LaunchAgent 重启后仍能找到正确 CLI 入口。
- Gateway 能写入和读取 `~/.tether`。
- `node-pty` 能正常 spawn provider。
- `better-sqlite3` 能正常创建和读写 `~/.tether/tether.db`。

## 建议实施顺序

1. 先做 npm 包 dry-run，不发布。
2. 修 `bin/tether` 和 `launchd.ts` 的源码路径依赖。
3. 做 `npm pack` 本地 tgz 安装测试。
4. 再接入 GitHub Actions / release workflow。
5. 最后再考虑拆出 `@tether/protocol`、`@tether/core` 作为公开 SDK 包。

## 暂不做

- 暂不做 Windows Service / Linux systemd。
- 暂不承诺 `@tether/gateway` 作为公开库 API。
- 暂不把 Server / Relay / Web 一起打进这个 npm 包。
- 暂不做 Docker 桌面版或 Electron 包。
