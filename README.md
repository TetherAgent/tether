# Tether

[中文 README](./README.zh-CN.md)

> **The OS layer for AI agents.**
>
> Run Codex, Claude, OpenCode, and the next wave of agent CLIs on your own
> machine — and take over from any device.
> Persistent. Observable. Approvable. Orchestratable.

**Current status**: Phase 1 demo skeleton runs the full end-to-end loop.

The chat window is the wrong abstraction.

AI agents are no longer one-shot Q&A. They run for hours, edit code, run tests,
hit external services, and wait. Managing that with a chat box that loses
context the moment you switch IDEs is like managing a production cluster
through PuTTY.

Tether is not a better IDE, and not a prettier chat UI.
Tether builds the layer underneath: **agent operations** — process model,
session protocol, device trust, cross-surface takeover, and orchestration for
agents.

```text
Before: codex
After:  tether codex

Before: claude
After:  tether claude
```

Run `tether codex` or `tether claude` on your computer. Tether wraps the agent
into a managed session and prints a URL. Open it on your phone and you are
looking at the same live work — every keystroke from the desktop appears, every
character you type on the phone reaches the agent. Code keeps executing on your
machine. Credentials never leave it.

## The Bet

The next developer workflow is not "one human at one editor."

It is one human supervising ten agents across laptops, workstations, CI,
phones, and scheduled jobs — running them the way an SRE runs a fleet of
services.

Whoever owns that control plane owns the entry point of the next generation of
developer tools.

Tether has been built around that bet from day one:

- agents are background processes, not chat sessions
- the Gateway owns sessions; arbitrary shell access is never on the table
- any screen can become an attach point for the same work
- execution stays local; supervision goes anywhere
- event streams, approvals, handoffs, and verification loops are first-class —
  not patched on later

## Built For

- **Any screen is a workstation**: desktop app, mobile app, web, and CLI are
  all first-class — none of them is a second seat.
- **Local execution is non-negotiable**: agents run on your machine, your repo,
  your credentials, your toolchain. The cloud cannot reproduce them and does
  not need to.
- **One Gateway for every agent**: Codex, Claude, OpenCode, and whichever CLI
  ships next — same session protocol behind them all.
- **Heavy lifting on the workstation, supervision in your pocket**: build
  machines do the work; laptops and phones watch, intervene, and approve.
- **Hand it off and walk away**: dispatch the task, close the lid, get a push
  when something needs you, glance at the diff, decide, continue.
- **Critical actions go through you**: writes, commands, external calls — diff
  and intent surface for review before they execute.
- **Multi-agent collaboration is real, not a slide**: handoff, verification
  loops, and agent teams are first-class in the protocol — not a prompt
  wrapper.
- **Privacy by architecture, not by promise**: the relay forwards frames;
  execution authority and session plaintext never leave the local Gateway.

## What Already Runs

Phase 1 is intentionally thin. The point is to prove that one agent session
can be taken over seamlessly between desktop and phone — before pouring
concrete on event streams or heavy architecture. No paper promises.

Working today:

- `tether codex` / `tether claude` — wrap an agent into a managed session in
  one command
- Local Gateway / daemon on `127.0.0.1:4789`
- tmux-backed session adapter (demo-stage; will be replaced)
- Terminal attach on the desktop, session view on phone / web
- Phone input forwarded live into the existing agent process
- Polling snapshot API (becomes an event stream in Phase 2)
- SQLite session registry
- pnpm workspace skeleton: CLI, Gateway, protocol, config, UI, web, and native
  client packages all in place

What stays: the Gateway, CLI shape, API boundaries, package layout.
What gets swapped out: the tmux capture/send layer.
Phase 1 is a demo, but the foundation is built to last.

## Quick Start

Requirements:

- Node.js 20+
- pnpm
- tmux
- Codex CLI or Claude CLI installed locally

```bash
brew install tmux
pnpm install
pnpm tether --help
pnpm tether codex
pnpm tether claude
```

By default, the Gateway only listens on localhost:

```text
127.0.0.1:4789
```

For a trusted LAN demo, explicitly expose it:

```bash
pnpm tether codex --host 0.0.0.0
pnpm tether claude --host 0.0.0.0
```

Phase 1 LAN mode does not enable device authentication yet. Use it only on a
trusted network.

## Surfaces

Tether is not a web dashboard. **The Gateway is the product** — every UI is
just an attach point. New surfaces can be added or replaced; sessions and
execution authority always live in the Gateway.

Current and planned surfaces:

- CLI (native terminal attach)
- Desktop web / mobile web PWA
- Desktop app (macOS / Windows / Linux)
- iOS / Android / HarmonyOS native apps
- Flutter cross-platform clients
- Floating desktop console (watch without blocking your screen)
- Automation entry point / agent-to-agent control API

```text
terminal attach        mobile PWA        desktop app        native clients
      \                    |                 |                    /
                         Tether Gateway
                               |
                    agent sessions on this machine
                      codex / claude / opencode / ...
```

## Product Direction

Three access paths — same Gateway, from your home Wi-Fi to a flight halfway
around the world:

- **LAN**: phone and computer on the same network, direct to the Gateway.
  Zero middlemen.
- **Tunnel**: expose the Gateway through the Tailscale or Cloudflare Tunnel
  you already trust, with device-token auth on top.
- **Relay**: Gateway opens an outbound WSS to a relay; the relay forwards
  bytes — it never executes commands and never holds plaintext.

Control plane principles — local first, cloud later:

- Pairing starts locally: `tether pair`, `tether devices`, `tether revoke`.
  Works without any account system.
- The cloud handles routing, push, device directory, and remote revoke — never
  control.
- Session plaintext does not leave your machine by default.
- The phone can request a whitelist of local actions: open a desktop web UI,
  attach an existing session, send input to the agent. That is the entire menu.
- The phone **cannot** ask the Gateway to execute arbitrary shell commands.
  This is a hard architectural boundary, not a feature toggle.

## Roadmap

| Phase | Theme | Key shift |
| --- | --- | --- |
| Phase 1 | Demo | tmux proves the desktop / phone shared-session loop |
| Phase 1.5 | Access | pairing, device tokens, three-tier LAN / tunnel / relay entry |
| Phase 2 | Event stream | drop snapshot polling, go fully native session events |
| Phase 3 | Scale out | multi-machine, parallel agents, background tasks, push |
| Phase 4 | Review UI | diffs, file tree, approval surfaces, permission review |
| Future | Apps | desktop app, mobile native apps, Flutter clients, floating console |
| Future | Orchestration | agent handoff, verification loops, agent teams, scheduled work |

**Phase 2 is the watershed.** Before it, Tether is "shared sessions." After
it, Tether becomes a real agent operations platform — event streams turn
approvals, multi-agent coordination, app clients, and relay sync from
duct-taped extensions into natural extensions.

## Why Another Agent Console?

Most agent consoles solve a shallow problem: how to poke the same agent from
more clients.

Tether solves the deeper one underneath: who owns this session, which machine
is it running on, who has the right to interrupt it, how does it cooperate
with other agents, and where does the audit trail live when things break.

That is not a remote-control problem. It is an **agent operations** problem —
the next generation of DevOps, where the things you operate are no longer
services, but agents.

## What Tether Is Not

Drawing the boundaries clearly so nobody shows up with the wrong map.

- **Not an IDE**, and never trying to replace VS Code or Cursor. How you write
  code is not Tether's business.
- **Not a code editor.** No syntax tree, no completions.
- **Not a generic remote shell.** The Gateway will not accept arbitrary
  command execution. This is a design hard line.
- **Not `codex_manager`**: that project reads existing Codex JSONL files for
  post-hoc observability. Tether wraps live agent processes so they can be
  controlled from anywhere.
- **Not a paseo clone**: there is overlap on the event-stream direction, but
  Tether's center of gravity is local Gateway ownership, multi-machine
  supervision, app-grade clients, and treating agents as background tasks.
  This is infrastructure, not a UI.

## Safety Model

Tether holds the keys to terminal processes on your machine. The security
boundary is part of the product, not a compliance checklist tacked on before
release.

- **Strict by default**: the Gateway binds only to `127.0.0.1`. It does not
  listen on any external interface unless you say so.
- **Exposure must be explicit**: sharing on the LAN requires `--host 0.0.0.0`
  by hand. Nothing leaks because of a stray default.
- **Writes require credentials**: from Phase 1.5 onward, every client write
  action requires a device token.
- **Clients can send input, never get a shell**: phone and web clients can
  message an existing agent session — they cannot gain arbitrary command
  execution.
- **Secrets do not belong on screen**: terminal output forwarded to clients
  is masked for common tokens and credentials.
- **Relay only moves bytes**: command execution always happens on the local
  Gateway. The relay does not — and structurally cannot — execute anything.

## Repository Layout

```text
apps/cli        tether command entry
apps/gateway    local Gateway / daemon and Phase 1 tmux adapter
apps/web        React/Vite web client for session viewing
packages/core   core types and business model
packages/protocol
                Gateway / client / relay protocol contracts
packages/config default config
packages/ui     shared UI package placeholder
native/         Flutter / HarmonyOS client placeholders
```

Web development:

```bash
pnpm web:dev
pnpm web:build
```

Gateway serves `apps/web/dist` at runtime. If the web app has not been built,
`/remote/session/:id` will ask you to run `pnpm web:build`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm tether --help
```

Package manager: pnpm.

Runtime: Node.js 20+.

TypeScript is run directly through `tsx`; Phase 1 does not require a bundled
server build.

## License

Apache-2.0, see [LICENSE](./LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=dream2672/tether&type=Date)](https://www.star-history.com/#dream2672/tether&Date)
