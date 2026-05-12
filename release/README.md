# @tether-labs/cli

Tether Gateway 是本机后台服务。安装后先登录账号，再启动 Gateway；之后远程 Web / App 才能连接到这台电脑。

## 环境要求

- Node.js >= 22.13
- macOS（Linux 仍是实验性支持）

## 安装

```bash
npm install -g @tether-labs/cli@latest
```

## 最短使用路径

### 1. 登录

```bash
tether login
```

默认登录生产环境。命令会打开浏览器授权，并把本机 Gateway 绑定到你的账号。



### 2. 启动 Gateway

```bash
tether start
```

Gateway 会作为后台服务运行。电脑重启后也会由系统服务拉起。

### 3. 停止 Gateway

```bash
tether stop
```

### 4. 重启 Gateway

```bash
tether restart
```

改了配置、重新登录后，通常执行一次重启即可：

```bash
tether restart
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `tether login` | 登录并绑定本机 Gateway |
| `tether login --env local` | 登录本地开发环境 |
| `tether start` | 启动后台 Gateway |
| `tether stop` | 停止后台 Gateway |
| `tether restart` | 重启后台 Gateway |
| `tether status` | 查看 Gateway 状态 |

## 卸载

```bash
npm uninstall -g @tether-labs/cli
```

卸载 CLI 不会自动删除 `~/.tether/` 下的登录信息和本机数据。

## License

MIT
