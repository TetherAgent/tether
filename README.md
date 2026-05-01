# Tether

> Agent 控制台。把 codex / claude / 其他 agent CLI 包装成由 daemon 托管的会话，
> 让电脑命令行、手机、Web 多端连到同一个会话。

**当前状态**：Phase 1 demo 骨架已实现。

## 一句话说明

```
直接：codex 或 claude
变成：tether codex 或 tether claude
```

电脑跑 `tether codex` / `tether claude` → 进入对应 agent；终端打印一行手机访问 URL；手机打开 URL
看到同一会话；手机敲字电脑能收到，反向亦然。

## 运行

```bash
brew install tmux
pnpm install
pnpm tether --help
pnpm tether codex
pnpm tether claude
```

默认 daemon 只监听 `127.0.0.1:4789`。如果要让手机通过局域网访问，必须显式开放：

```bash
pnpm tether codex --host 0.0.0.0
pnpm tether claude --host 0.0.0.0
```

Phase 1 demo 的局域网模式未启用认证，只适合可信网络。

## 目录

当前仓库已迁移为 pnpm workspace 雏形：

- `apps/gateway`：当前 demo daemon，未来演进为本机常驻 Gateway。
- `apps/cli`：`tether` 命令行入口。
- `apps/web`：React/Vite Web 客户端，当前承载 `/remote/session/:id`。
- `packages/core`：核心类型与业务模型。
- `packages/protocol`：Gateway / Client / Relay 协议契约。
- `packages/config`：默认配置。
- `packages/ui`：共享 UI 预留。
- `native`：Flutter / HarmonyOS 原生客户端预留区，不参与当前 pnpm pipeline。

Web 开发：

```bash
pnpm web:dev
pnpm web:build
```

Gateway 运行时托管 `apps/web/dist`；如果没有构建，`/remote/session/:id` 会提示先运行 `pnpm web:build`。

## 外网访问方向

短期推荐 Tailscale；Cloudflare Tunnel 需要先加 device token 认证。长期会支持三种访问模式：

- LAN：手机直连电脑 Gateway 的局域网地址。
- Tunnel：通过 Tailscale / Cloudflare Tunnel 暴露本机 Gateway，Tether 用 `--public-url` 生成外部 URL。
- Relay：Gateway 主动连接 Tether 中转服务，手机/Web 通过 HTTPS/WSS 接入；relay 只转发，不执行命令。

账户体系优先做本地配对和设备 token：`tether pair`、`tether devices`、`tether revoke <device-id>`。云账户延后到 relay / 多机 / push 阶段。

长期本地进程会从当前 demo daemon 演进为 **Tether Gateway**：它常驻本机，管理 agent session 和多个 UI surface。手机可以请求 Gateway 在电脑上打开桌面 Web、terminal attach 或浮窗，但只能触发白名单动作，不能让电脑执行任意命令。

## 不是什么

- 不是 IDE，不替代 VS Code / Cursor
- 不是 codex_manager（那个是事后扫 jsonl 的观察器；Tether 是实时多端控制台）
- 不是 paseo 的克隆（详见设计文档「与 paseo 的差异化主张」）

## 下一步

- 设计文档：[docs/working/2026-05-01-tether-agent-console.md](docs/working/2026-05-01-tether-agent-console.md)
- 文档治理：[docs/README.md](docs/README.md)
- AI 协作入口：[AGENTS.md](AGENTS.md)

立项后走 OpenSpec 流程进入 `openspec/changes/`。

## License

Apache-2.0，见 [LICENSE](./LICENSE)。

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=dream2672/tether&type=Date)](https://www.star-history.com/#dream2672/tether&Date)
