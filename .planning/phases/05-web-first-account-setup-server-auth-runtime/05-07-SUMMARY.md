---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 07
subsystem: cross-package-verification-and-phase-fact-sync
tags: [verification, audit, revoke, isolation, planning-sync]
requires:
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 03
    provides: Server auth, notification, and audit runtime
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 04
    provides: Gateway bearer auth and ws ticket scope enforcement
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 05
    provides: Relay token auth and boundary enforcement
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 06
    provides: Web auth pages and authenticated session shell gating
provides:
  - Full Phase 5 automated suite results across Server, Gateway, Relay, CLI, and Web typecheck/build
  - Gateway-side owner isolation verification for ws-ticket issuance
  - Planning state synced to `/register`-first Phase 5 facts
affects: [SERVER-02, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-07, RELAY-AUTH-01, RELAY-AUTH-02, AUDIT-01, AUDIT-02]
tech-stack:
  added: [gateway owner-isolation test, phase validation fact sync]
  patterns: [same-account wrong-owner ws-ticket denial, automated-green plus manual-pending planning status]
key-files:
  created:
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-07-SUMMARY.md
  modified:
    - apps/gateway/src/daemon.test.ts
    - .planning/ROADMAP.md
    - .planning/STATE.md
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-VALIDATION.md
key-decisions:
  - "Phase 5 automated closure requires full-suite evidence, but visual auth-route checks remain explicitly manual-only."
  - "Gateway must reject same-account but wrong-owner ws-ticket requests, not just cross-account mismatches."
  - "Phase tracking now states Phase 5 as in verification rather than not started or fully complete."
patterns-established:
  - "Planning artifacts distinguish automated green from manual pending instead of collapsing both into a single done state."
requirements-completed: [SERVER-02, AUTH-02, AUTH-03, AUTH-04, AUTH-05, RELAY-AUTH-01, RELAY-AUTH-02, AUDIT-01, AUDIT-02]
duration: ~45min
completed: 2026-05-02
---

# Phase 5 Plan 07: Cross-Package Verification, E2E Auth Checks, and Phase Fact Sync Summary

**Phase 5 的自动化验证已经收口。Server、Gateway、Relay、CLI 和 Web build/typecheck 都跑通了；四个 Web auth 页面、未登录重定向、内存态 submit 验证，以及 MySQL 真库 submit 验证都已经确认，剩下主要是多端 metadata refresh。**

## Accomplishments

- 在 `apps/gateway/src/daemon.test.ts` 新增 same-account wrong-owner 覆盖：
  - 同账号但非本人 token 不能为别人的 session 申请 WS ticket
- 修复 `apps/server/app/service/auth.ts`：
  - `/api/auth/me` 现在接受 `Authorization: Bearer <token>`，不再把整个 header 当作 JWT 去验签
- 跑完整个 Phase 5 自动化闭环：
  - `pnpm -r test`
  - `pnpm typecheck`
  - `pnpm --filter @tether/web build`
- 把 `.planning` 回写到当前事实：
  - `ROADMAP.md` 把 Phase 5 进度更新为 `7/7 | In verification`
  - `STATE.md` 不再停留在 `Plan 1 of 7`
  - `05-VALIDATION.md` 区分 automated green 和 manual pending

## Verification

- `pnpm -r test` - passed
- `pnpm typecheck` - passed
- `pnpm --filter @tether/web build` - passed

## Manual Browser Verification

- 已人工打开 `/register`、`/login`、`/admin/register`、`/admin/login`，页面标题和基础卡片布局与 Phase 5 文案契约一致
- 已人工确认未登录访问 `/` 会跳到 `/login`
- 已人工确认未登录访问 `/admin` 会跳到 `/admin/login`

## Live Submit Verification

- 本地将 `egg-redis` 和 `egg-mysql` 调整为显式环境变量开启后，`apps/server` 可以在内存态下启动
- 已验证 normal `/api/auth/register`、`/api/auth/login` 和 `GET /api/auth/me`
- 已验证顺序执行的 `/api/admin/auth/register`、`/api/admin/auth/login`
- 已修复 `/Users/dream/code/tether/apps/server/app/service/storage.ts` 的 `001_init.sql` 路径解析，避免 Egg 以 `apps/server` 为 cwd 时误拼成重复路径
- 已验证带 MySQL 持久化的真实 submit 链路：
  - `POST /api/auth/register` -> `201`
  - `GET /api/auth/me` -> `200`
  - `POST /api/auth/refresh` -> `200`
  - `POST /api/admin/auth/register` -> `201`
  - `POST /api/admin/auth/login` -> `200`
  - `POST /api/gateway/bind` -> `200`
  - `POST /api/gateway/refresh` -> `200`

## Residual Manual Verification

- same-user multi-device metadata refresh 仍需要真实环境人工验收

## Uncommitted Change Policy

本轮没有创建 git commit，所有 Phase 5 代码和 planning 回写仍保留在工作区。

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
