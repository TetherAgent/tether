# Claude HUD 状态栏指标计算说明

状态栏格式示例：

```
Context ████████░░ 79% │ Usage █░░░░░░░░░ 5% (resets in 4h 17m) | Weekly ░░░░░░░░░░ 1% (resets in 6d 21h)
```

---

## Context %

**含义：** 当前会话已用上下文窗口的百分比。

**数据来源：** Claude Code hook 的 stdin JSON，字段 `context_window.used_percentage`（Claude Code ≥ v2.1.6 原生提供）。

**计算公式（Claude Code 内部）：**

```
used% = round((input_tokens + cache_creation_input_tokens + cache_read_input_tokens) / contextWindowSize * 100)
```

注意：**output_tokens 不计入**，只算输入侧 token（含缓存写入和缓存读取）。

**上下文窗口大小（contextWindowSize）取值优先级：**

1. 环境变量 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`（手动覆盖）
2. 启用了 `context-1m-2025-08-07` beta 且模型支持 → 1,000,000
3. 模型为 `claude-opus-4-7` → 模型内置值
4. 服务端下发的 `clientDataCache.kelp_forest_sonnet`（针对 sonnet-4-6 的动态值，实测约 676k）
5. 默认值 → 200,000

**claude-hud 读取逻辑（两级 fallback）：**

```javascript
// stdin.js: getContextPercent()
const nativePercent = stdin.context_window?.used_percentage;
if (typeof nativePercent === 'number' && nativePercent > 0) {
  return Math.min(100, Math.round(nativePercent));  // 优先使用原生值
}
// fallback：手动计算
const totalTokens = input + cache_creation + cache_read;
return Math.round(totalTokens / context_window_size * 100);
```

**Claude Code 状态栏（`ctx XX%`）vs claude-hud 显示不一致的原因：**

Claude Code 状态栏在计算时 `exceeds200kTokens` 硬编码为 `false`，可能使用 200k 作为分母；而 hook stdin 在响应时用实际窗口大小（如 676k）计算后注入 `used_percentage`。claude-hud 读取的是 hook 值（较小百分比），状态栏独立计算可能得到更大甚至 100% 的值。

---

## Usage % （5-小时用量）

**含义：** 过去 5 小时内 API 调用量占该时段配额的百分比，附带重置倒计时。

**数据来源（优先级）：**

1. **Hook stdin `rate_limits`**（主要来源）：
   - `rate_limits.five_hour.used_percentage` → 0–100
   - `rate_limits.five_hour.resets_at` → Unix 秒级时间戳

2. **外部 snapshot 文件**（备用，`config.display.externalUsagePath`）：JSON 文件需含 `updated_at` 字段，超过配置的 freshnessMs 视为过期

3. **Anthropic OAuth API**（`usage-api.js` 独立工具，不在主流程内）：`five_hour.utilization` 和 `five_hour.resets_at`，仅 OAuth 用户可用

---

## Weekly % （7-天用量）

**含义：** 过去 7 天内 API 调用量占该时段配额的百分比，附带重置倒计时。

**数据来源（优先级同上）：**

1. **Hook stdin `rate_limits`**：
   - `rate_limits.seven_day.used_percentage` → 0–100
   - `rate_limits.seven_day.resets_at` → Unix 秒级时间戳

Usage % 和 Weekly % 从同一次 hook stdin 读取，`resets_at` 转换：`new Date(resets_at * 1000)`。

---

## 数据流汇总

```
Claude Code 进程（每次响应结束）
  │
  ├─ 触发 hook → stdin JSON
  │    ├─ context_window.used_percentage        ──→  Context %
  │    ├─ rate_limits.five_hour.used_percentage ──→  Usage %
  │    ├─ rate_limits.five_hour.resets_at       ──→  "resets in Xh Ym"
  │    ├─ rate_limits.seven_day.used_percentage ──→  Weekly %
  │    └─ rate_limits.seven_day.resets_at       ──→  "resets in Xd Yh"
  │
  └─ 状态栏独立计算（可能与 hook 值不一致，原因见 Context % 章节）
```

---

## 在 Tether 中接入 Hook 数据

### 架构链路

```
Claude Code hook (Stop 事件)
  → POST http://localhost:4789/api/hook/context
  → Gateway 存入内存
  → 下次 agent.result 帧一起发出
  → Relay WS
  → Web
```

### 实现要点

**1. Gateway 新增 HTTP 端点**

```
POST /api/hook/context
Body: 完整 hook stdin JSON（无需鉴权，localhost 调用）
```

Gateway 提取并缓存：
- `context_window.used_percentage`
- `rate_limits.five_hour.used_percentage` + `resets_at`
- `rate_limits.seven_day.used_percentage` + `resets_at`

**2. Claude Code hook 脚本**

```bash
#!/bin/bash
cat | curl -s -X POST http://localhost:4789/api/hook/context \
  -H "Content-Type: application/json" \
  --data-binary @-
```

在 `~/.claude/settings.json` 注册为 `Stop` 事件 hook。

**3. Protocol 扩展（最小改动）**

`agent.result` 帧的 `rateLimitInfo` 字段当前只有 `resetsAt / rateLimitType / status`，需扩展：

```typescript
rateLimitInfo?: {
  resetsAt: number;
  rateLimitType: string;
  status: string;
  // 新增
  fiveHourUsedPercentage?: number;
  fiveHourResetsAt?: number;
  sevenDayUsedPercentage?: number;
  sevenDayResetsAt?: number;
}
```

这样不需要新 frame 类型，Web 端不需要额外订阅逻辑。

**4. 为什么选 `Stop` 而不是 `PostToolUse`**

`Stop` 在每次完整响应结束时触发，与 `agent.result` 帧频率一致；`PostToolUse` 每个工具调用都触发，频率过高。
