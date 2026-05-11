# Chat / Web 代码审查 TODO

> 分支：gsd-h5，Phases A–C 完成后  
> 整理：2026-05-08  
> 定性：当前分支审查 TODO，不是长期事实文档

---

## 优先修（影响主流程）

### 1. 硬编码中文文案违反 i18n
- **文件**：`apps/web/src/components/session/chat-session-surface.tsx:253`
- **问题**：`<span className="chat-tool-meta">完成</span>` 硬编码，未走 `useI18n()`
- **修复**：在 `messages.ts` 两语言各加 `chatToolCompleted`，改为 `{t.chatToolCompleted}`

### 2. clipboard.writeText 无错误处理（3 处）
- **文件**：
  - `chat-session-surface.tsx:1021` — `void navigator.clipboard?.writeText(sessionId)` Promise 完全丢弃
  - `session-detail-chrome.tsx:41` — `.then(...)` 无 `.catch()`
  - `main.tsx:854` — 同上
- **问题**：复制失败时用户无任何反馈
- **修复**：加 `.catch(() => { /* 可选 toast */ })`

### 3. userHistory 未过滤失败消息
- **文件**：`apps/web/src/components/session/chat-session-surface.tsx:279–285`
- **问题**：只过滤 `id.startsWith('pending:')` 消息，`status === 'failed'` 的消息仍进入历史，用户按 ArrowUp 会重新发出失败内容
- **修复**：过滤条件加 `&& m.status !== 'failed'`

### 4. 发送后 historyIndexRef 未重置
- **文件**：`apps/web/src/components/session/chat-session-surface.tsx:536`
- **问题**：`sendChatText` 调用 `setInputText('')` 但没有 `historyIndexRef.current = null`。从历史调出一条消息发送后，再按 ArrowUp，索引从旧位置继续而不是从末尾重新开始
- **修复**：`setInputText('')` 之后加 `historyIndexRef.current = null`

### 5. sendInputFrame 返回值被忽略
- **文件**：`apps/web/src/components/session/chat-session-surface.tsx:539–542`
- **问题**：`sendInputFrame` 在 WS 不可用时返回 `false` 而不抛异常，调用方完全忽略返回值，消息仍标为 `'sent'`，5 秒后超时才变 `'failed'`，用户没有即时反馈
- **修复**：检查返回值，`false` 时立刻调用 `updateMessageStatus(localId, 'failed', ...)`

### 6. gateway/store.ts JSON.parse 无保护
- **文件**：`apps/gateway/src/store.ts:500`
- **问题**：`eventFromRow` 直接 `JSON.parse(row.payload_json)`，数据库记录损坏时整个查询抛异常
- **修复**：加 try-catch，损坏行返回 null 后在上层过滤

### 7. 无语言标注的代码块没有复制按钮
- **文件**：`apps/web/src/components/session/chat-markdown.tsx:75`
- **问题**：`ChatCodeBlock` 只在 `language` 非空时渲染 header（含复制按钮），Agent 回复中未标注语言的代码块用户无法一键复制
- **修复**：`language === null` 时也显示复制按钮，只是不显示语言标签行

---

## 质量 polish（不挡主流程）

### 8. agentToolChip 已定义但未使用
- **文件**：`messages.ts:115 / 403`
- **问题**：`'工具调用' / 'Tool call'` 有翻译但源码无引用，是死文案
- **修复**：接上 UI，或删除

### 9. resumeCommand 函数重复定义
- **文件**：`main.tsx:844` 和 `session-detail-chrome.tsx:10`
- **问题**：完全相同的函数写了两份
- **修复**：提取到 `src/lib/resume-command.ts`，两处 import

### 10. copy timeout 未清理
- **文件**：`chat-session-surface.tsx` header 复制按钮附近
- **问题**：快速多次点击复制时，旧 timeout 不取消，`sessionIdCopied` 状态可能错误翻转
- **修复**：用 `useRef` 存 timer id，点击时先 `clearTimeout`

### 11. isThinkingStatus 多余
- **文件**：`chat-session-surface.tsx:240` 定义，`:993` 使用
- **问题**：函数只判断 `responding`，但 `isAgentThinking` 还额外包含 `thinking`，函数实际多余
- **修复**：删掉 `isThinkingStatus`，统一用 `activityState` 判断

### 12. 待发超时 timer 未清理
- **文件**：`chat-session-surface.tsx:548–552`
- **问题**：每次发送创建一个 5s timeout，组件卸载时不清理，快速发送会累积泄漏 timer（predicate 保护了状态正确性，但 timer 本身仍泄漏）
- **修复**：收集 timer id 到 ref，cleanup 时统一 clear

### 13. language 正则过窄
- **文件**：`chat-markdown.tsx:113, 129`
- **问题**：`/language-([\w-]+)/` 不匹配 `c++`、`objective-c` 等，无法高亮
- **修复**：改为 `/language-([^\s]+)/`

### 14. getCodeText 类型守卫可读性
- **文件**：`chat-markdown.tsx:52`
- **问题**：已有 `node && typeof node === 'object'` 守卫，实际安全，但不直观
- **修复**：无需改动，或加注释说明

### 15. Form onSubmit 是死代码
- **文件**：`chat-session-surface.tsx:1217, 1277`
- **问题**：发送按钮是 `type="button"`，Enter 键被 `onKeyDown` 拦截，`<form onSubmit={sendChat}>` 正常情况下永远不触发
- **修复**：将 `<form>` 改为 `<div>`，或将按钮改成 `type="submit"` 统一走表单路径

### 16. 复制代码块乐观更新
- **文件**：`chat-markdown.tsx:69–70`
- **问题**：`setCopied(true)` 在 `clipboard.writeText` resolve 之前调用，剪贴板写失败用户仍看到"已复制"
- **修复**：改为 `.then(() => setCopied(true)).catch(...)`
