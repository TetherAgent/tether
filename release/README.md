# @tether-labs/cli

> 在你自己的机器上运行 Codex、Claude 等 AI agent CLI，并从任意设备接管会话。

## 环境要求

- Node.js >= 22.13
- macOS（Linux 实验性支持）

## 安装

```bash
npm install -g @tether-labs/cli
```

## 快速开始

```bash
# 1. 初始化配置（一次性）
#    local  — 仅本机，无需账号
#    direct — 局域网访问，需要 tether 账号
#    relay  — 任意网络远程访问，需要 tether 账号
tether gateway init

# 2. 启动后台 Gateway
#    （首次运行自动安装为系统服务）
tether gateway start

# 3. 启动 agent 会话
tether codex
tether claude

# 4. 管理会话
tether ls
tether attach <session-id>
tether stop <session-id>
```

## tether codex / tether claude 参数

| 参数 | 说明 |
|------|------|
| `--project <path>` | 工作目录（默认：当前目录） |
| `--title <title>` | 会话标题，显示在 Web UI 中 |
| `--no-attach` | 只启动会话，不接入当前终端 |
| `--no-reconnect` | 本地 attach 断开后不自动重连 |
| `[providerArgs...]` | 透传给底层 CLI 的额外参数 |

```bash
tether codex --title "修复 auth bug" --project ~/myrepo
tether codex --no-attach          # 后台运行，稍后 attach
tether codex -- --model o3        # 透传参数给 codex 本身
```

## Gateway 命令

| 命令 | 说明 |
|------|------|
| `tether gateway init` | 选择默认模式，写入 `~/.tether/config.json` |
| `tether gateway` | 前台运行 Gateway（适合调试） |
| `tether gateway start` | 以系统服务方式启动后台 Gateway |
| `tether gateway stop` | 停止后台 Gateway |
| `tether gateway status` | 查看 Gateway 状态和访问地址 |
| `tether gateway restart` | 重启后台 Gateway |
| `tether gateway uninstall` | 卸载系统服务 |

## 诊断

```bash
tether doctor          # 检查运行环境
tether gateway status  # 查看 Gateway 状态和地址
```

`tether gateway status` 输出示例：

```
Gateway 状态
默认模式: relay          ← 当前运行模式（local / direct / relay）
运行状态: 运行中          ← 是否正在运行
PID: 25887               ← 进程 ID
URL: http://127.0.0.1:4789  ← 本机访问地址
配置文件: ~/.tether/config.json
Server: https://...      ← relay 模式下的远程服务地址
Relay 连接: connected    ← relay 通道是否正常（local 模式不显示）
LaunchAgent: 已安装，未加载  ← 系统服务状态
```

**Relay 连接**说明：
- `connected` — 远程可正常访问
- `disconnected` — 网络中断，agent 仍在本机运行，重连后自动恢复
- 不显示 — 当前为 local 模式，无需 relay

## 卸载

卸载不会删除 `~/.tether/` 下的用户数据（会话记录、配置、auth）。

```bash
npm uninstall -g @tether-labs/cli
```

## License

Apache-2.0
