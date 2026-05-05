# M5 验证 checklist

状态：Working
范围：M1-M4 完成后，验证 release 产物可装可用，准备进入 M6（npm publish）。

## 怎么用

1. **先跑自动化脚本**：

   ```bash
   cd /Users/dream/code/tether
   pnpm build:release
   node scripts/verify-release.mjs
   ```

   脚本覆盖 V1-V4、V7-V8、V16、V19、V20、V23、V24、V26-V29，无副作用。

2. **再手动跑下面 checklist 里的剩余项**。每项标了"为什么手动"+"怎么跑"+"通过条件"。

3. 全部 🔴 阻塞级通过 → 可以进 M6（npm publish）。
   🟡 警告级失败 → 记录在本文件 issue 区，不阻塞，下个 alpha 修。

---

## 🔴 阻塞级（必须人工跑）

### V5 + V6：全新 Node 环境装 tarball

**为什么手动**：会污染全局 npm install。

```bash
# 1. 生成真实 tarball
cd /Users/dream/code/tether
pnpm pack:release   # dry-run 输出
cd release && npm pack   # 真实生成 .tgz
mv tether-cli-*.tgz /tmp/
cd /Users/dream/code/tether

# 2. 切到目标 Node 版本
nvm install 22.13
nvm use 22.13

# 3. 全局安装（会覆盖你当前的 dev launcher 软链）
npm install -g /tmp/tether-cli-*.tgz

# 4. 验证
which tether                                # 应该指向 npm global bin
tether --version                            # 应该输出版本号
cd /tmp && tether --help                    # 任意目录可用
```

**通过条件**：
- V5 ✅ `npm install -g` 无报错
- V6 ✅ `which tether` 不再指向 `/Users/dream/code/tether/bin/tether`
- V6 ✅ `cd /tmp && tether --version` 输出版本号

---

### V9 + V10：session 创建 + session-runner spawn

**为什么手动**：会真的启动 codex 子进程占用资源。

```bash
# 假设 V5 已跑（或继续用 dev launcher 也行）
tether codex --no-attach --title "M5-V9-test"
# 输出 session id：tth_...

tether ls | grep "M5-V9-test"
# 应该看到刚创建的 session（status=running）

ps -ef | grep -i session-runner
# 应该看到一个 node 子进程，args 含 --experimental-sqlite + session-runner-process.js

# 收尾
tether stop <session_id>
```

**通过条件**：
- V9 ✅ `tether codex` 输出新 session id 且 ls 能看到
- V10 ✅ ps 看到 session-runner 子进程，args 含 `--experimental-sqlite`

---

### V11 + V12 + V13 + V14：LaunchAgent 全链路

**为什么手动**：会启动后台 Gateway，影响你的工作流。**不要在跑着重要 session 的时候做**。

```bash
# 假设你当前 Gateway 已停（gateway status 显示 not loaded）

# V11: install
tether gateway install
ls ~/Library/LaunchAgents/sh.tether.gateway.plist          # 应存在
cat ~/.tether/gateway-runtime.json                          # nodePath/launcherPath 应存在

# V12: 检查 plist 内容
launchctl print gui/$(id -u)/sh.tether.gateway 2>/dev/null \
  | grep -A 10 ProgramArguments
# 期望（或类似）：
#   ProgramArguments = (
#       "/Users/dream/.../bin/node";   ← 绝对 node 路径
#       "/Users/dream/.../bin/tether"; ← 绝对 launcher 路径
#       "gateway";
#   )

# V13: start + status
tether gateway start
sleep 2
tether gateway status                                       # 应显示 PID + URL
curl -s http://127.0.0.1:4789/api/status | head -c 200      # API 可连接

# 验证完后 V14: 卸载
tether gateway uninstall
ls ~/Library/LaunchAgents/sh.tether.gateway.plist          # 应不存在
launchctl print gui/$(id -u)/sh.tether.gateway 2>&1 | head -3
# 应输出 "Could not find service"
```

**通过条件**：
- V11 ✅ install 后 plist 文件存在 + gateway-runtime.json 写入
- V12 ✅ `ProgramArguments` 第一项是绝对 node 路径，第二项是绝对 launcher 路径，**不含** `tsx` / `--import` / `dist/cli/main.js`
- V13 ✅ status 显示 running + curl 能连
- V14 ✅ uninstall 后 plist 删除 + launchctl 找不到服务

---

### V15：卸载保留用户数据

**为什么手动**：测全局 uninstall 影响。

```bash
# 假设 V5 跑过了 npm install -g
ls ~/.tether/                # 记录现状（auth.json, config.json, tether.db, ...）

npm uninstall -g @tether/cli
which tether                  # 应该 not found，或回到 dev 软链

ls ~/.tether/                # 应该完全不变
ls ~/Library/LaunchAgents/   # 如果之前 install 过，plist 还在（不归 npm 管）
```

**通过条件**：
- V15 ✅ `~/.tether/` 内容与卸载前一致（auth/config/db 都在）

---

## 🟡 警告级（应跑，不阻塞）

### V17：切 Node 版本仍能跑

**为什么手动**：nvm 切版本会改变 shell PATH。

```bash
nvm install 24
nvm use 24
tether --version                         # 应该正常输出
tether ls                                # 应该正常
node --version | grep 'v24'              # 确认在 v24 上
```

**通过条件**：
- V17 ✅ Node 24 上 `tether --version` 正常 + 无 ExperimentalWarning（24 起 sqlite stable）

---

### V18：切 Node 后 doctor 报 plist 失效

**为什么手动**：依赖 V11 跑过 install，然后切 nvm。

```bash
# 假设 V11 时是 Node 22.x，gateway-runtime.json 记录了 node v22 路径
nvm use 24                               # 切到 v24
tether gateway status
# 应该提示 "LaunchAgent 引用的 Node 已不存在"（如果 v22 被卸载）
# 或者 doctor 输出 "plist nodePath: FAIL"
tether doctor | grep "plist nodePath"
```

**通过条件**：
- V18 ✅ 不静默失败；明确提示 plist nodePath 失效

---

### V21：长 attach session 内存稳定

**为什么手动**：要持续观察 5 分钟。

```bash
tether codex --no-attach --title "long-session"
# 输出 sid
tether attach <sid>
# 在 attach 内做点交互（比如让 codex 等待你输入），保持 5 分钟
# 另开一个终端：
ps -o pid,rss,command -p $(pgrep -f "bin/tether attach") | head -5
# 等 5 分钟再跑一次，rss 不应该明显增长
```

**通过条件**：
- V21 ✅ launcher + cli 两个进程内存稳定（< 100 MB），无明显泄漏

---

### V22：session-runner spawn args 含 flag

**为什么手动**：依赖 V9 启动了 session。

```bash
ps -ef | grep -i session-runner | grep -v grep
# 期望输出含：--experimental-sqlite --no-warnings=ExperimentalWarning
```

**通过条件**：
- V22 ✅ args 列出 NODE_RUNTIME_FLAGS 注入项

---

### V25：Linux 边界报错（如有 Linux 测试机）

**为什么手动**：跨平台。

```bash
# 在 Linux 机器上：
npm install -g /tmp/tether-cli-*.tgz
tether gateway install
# 期望：明确提示 "Linux 暂不支持 tether gateway install"
# 不应该写空 plist 也不应该崩
```

**通过条件**：
- V25 ✅ 友好降级，不写空 plist

---

## 🟢 信息级（可选）

### V30：跨机器拉 tarball

**为什么手动**：需要第二台机器。

```bash
# 在第二台 mac：
nvm install 22.13 && nvm use 22.13
# 把 /tmp/tether-cli-0.1.0-alpha.0.tgz scp 过去
npm install -g /tmp/tether-cli-0.1.0-alpha.0.tgz
tether --version
tether doctor
```

**通过条件**：
- V30 ✅ 全新机器装得上 + doctor 全绿（除 LaunchAgent 未 install）

---

## 验证执行顺序建议

```
1. pnpm build:release
2. node scripts/verify-release.mjs        ← 自动跑 V1-V4 V7-V8 V16 V19 V20 V23 V24 V26-V29
3. （手动）V11 V12                          ← LaunchAgent install 验证
4. （手动）V9 V10 V22                       ← session 创建 + spawn flag
5. （手动）V13                              ← gateway start
6. （手动）V14 V15                          ← uninstall + 数据保留
7. （手动可选）V17 V18                      ← nvm 切版本
8. （手动可选）V21                          ← 长 session
9. （手动可选）V25 V30                      ← 跨平台
10. （手动）V5 V6                           ← 真实 npm install -g （最后做，因为会污染全局）
```

V5/V6 放最后是因为它会改变全局 `tether` 命令指向，做完后建议立刻跑一次 `npm uninstall -g @tether/cli` + 重新链回 dev 软链：

```bash
npm uninstall -g @tether/cli
cd /Users/dream/code/tether
pnpm install              # 重建 dev 软链 @tether/cli → bin/tether
```

---

## 卡住时

- 任何 🔴 失败 → 不要 publish，回报具体错误
- 🟡 失败 → 记在文档底部 "Issues"，下 alpha 修
- 🟢 失败 → 记录但不影响发版

## Issues（验证中发现的问题）

（M5 跑完后填）

---

## 完成判定

🔴 全绿 + 🟡 至少 80% 绿 → M5 完成 → 进入 M6（npm publish）。
