# codex_web

[简体中文](./README.md) | English

`codex_web` is an unofficial local Codex web client. It brings a Codex Desktop-like thread list, chat surface, composer, settings/diagnostics, and mobile browser access to the web, while experimentally connecting to the realtime sync path used by Codex Desktop and the VS Code Codex extension.

The project is designed for local execution and LAN access, not as a hosted cloud service. The backend runs on your machine and bridges the official Codex IPC layer, app-server, local SQLite data, attachment storage, and the browser UI.

## Interface Preview

![codex_web web interface preview](./docs/assets/readme-ui-showcase.png)

### Mobile Example

<img src="./docs/assets/readme-mobile-example.jpg" alt="codex_web mobile example" width="360">

## Project Goals

Codex Desktop is good for working on one computer, but it is not a browser, LAN, or phone-first entry point. `codex_web` extends local Codex workflows to more screens and interaction styles without moving conversations to a hosted cloud service:

- Provide a browser UI with interaction density close to Codex Desktop
- Let phones, tablets, and other LAN devices access Codex sessions on the same computer
- Share thread state with Codex Desktop and the VS Code Codex extension, with best-effort realtime sync
- Keep official protocol handling, Web APIs, frontend domain models, and UI rendering cleanly separated
- Produce redacted diagnostics material for sync, IPC, app-server, and cache troubleshooting

## Core Features

- **Desktop-like thread experience**: projects, regular/archive thread lists, virtualized long lists, thread detail, Markdown messages, code blocks, tables, file changes, approval cards, and layout density close to Codex Desktop across the left rail, header, and right sidebar.
- **Full composer**: text input, Enter/Shift+Enter behavior, model selection, reasoning effort, collaboration mode, Skills, attachments, image previews, attachment association after sending, and per-thread unsent text/attachment drafts.
- **Three-way sync experiment**: official IPC / app-server bridge for thread list/detail, follower start / steer / interrupt, stale-owner local fallback, and realtime WebSocket events.
- **Side conversations**: reads official side conversations and can send to already-synced official side conversations.
- **Mobile and LAN access**: responsive layout, mobile drawer, mobile composer, collapsible running-status panel, PWA manifest, LAN URL display, and login gate.
- **Local files and attachments**: constrained file browsing/preview, right-side file tabs, message image rendering, file change previews, persisted web uploads, and cleanup.
- **Security and diagnostics**: LAN password, HTTP-only session cookie, session revocation, recursive diagnostics redaction, sync readiness, protocol compatibility, and `sync:doctor` CLI.
- **Test coverage**: TypeScript typecheck, Vitest unit tests, Playwright desktop/mobile E2E, and UI fidelity baseline entry points.

## Status

The repository now contains runnable source code and is still in the experimental `0.1.x` stage. Current coverage includes:

- Desktop-like web shell, thread list, collapsed-by-default archive list, search, settings, and diagnostics
- Composer support for model, reasoning effort, collaboration mode, Skills, attachments, per-thread drafts, and active turn steer / interrupt
- Official IPC / app-server bridge for thread list, thread detail, follower start / steer / interrupt, stale active fallback, and realtime events
- Side conversation reading and sending to already-synced official side conversations
- Local file previews, right-side file tree/tabs, image previews, attachment persistence, and constrained file reads
- LAN login gate, session management, and redacted diagnostics export
- Desktop and mobile Playwright regression tests

Three-way sync still depends on Codex Desktop, the VS Code Codex extension, and the current official protocol shape. Protocol changes may require follow-up adapters.

## Quick Start

Prerequisites:

- Node.js 22+
- pnpm 10+
- Codex Desktop
- Optional: VS Code Codex extension for three-way sync validation

Install dependencies:

```powershell
pnpm install
```

Development mode:

```powershell
pnpm dev
```

Default URLs:

```text
Web dev server: http://127.0.0.1:18931
Backend API:    http://127.0.0.1:18930
```

Production mode:

```powershell
pnpm build
pnpm start
```

`pnpm start` runs the Fastify backend on `0.0.0.0:18930` and serves the built web app. LAN devices must pass the LAN password gate; first startup generates local private config and a password hash.

## Common Commands

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm test:e2e -- --list
pnpm sync:doctor -- --json
```

Playwright defaults to `http://127.0.0.1:18930/`. To target the Vite dev server, set `PLAYWRIGHT_BASE_URL=http://127.0.0.1:18931`.

## Repository Layout

```text
apps/
  server/      Fastify backend, IPC bridge, app-server bridge, WebSocket/API
  web/         React + Vite frontend
packages/
  api/         Shared API schemas and types
  config/      Runtime config, paths, and port parsing
  domain/      Web domain model and official data normalizers
  i18n/        zh-CN / en-US locale packs and translation keys
  protocol/    Official IPC / app-server wire protocol
  ui/          UI token exports
docs/          Product, startup, sync, troubleshooting, and pitfall docs
documentation/
  protocol/    Official protocol research notes
data/          Local runtime data, ignored by Git by default
```

See [docs/repository_overview.md](./docs/repository_overview.md) for more detail.

## Local Data And Safety

`data/` is the runtime directory and is not committed by default:

- `data/config.local.json`: ports, theme, diagnostics flags, LAN password hash, session secret
- `data/auth.sessions.json`: LAN session records
- `data/*.sqlite`: local indexes and projection data
- `data/attachments/`: persisted copies of uploaded web attachments
- `data/logs/`, `data/tmp/`: logs and temporary diagnostics material

These paths are excluded in `.gitignore`. Do not use `git add -f data/...` for a public repository.

Diagnostics export is produced by `/api/diagnostics/export`. It is intended to contain redacted status summaries only, excluding conversation text, attachment contents, passwords, tokens, cookies, session secrets, and raw protocol frames.

## Documentation

- [Startup runbook](./docs/startup_runbook.md)
- [Repository overview](./docs/repository_overview.md)
- [Product spec](./docs/product_spec.md)
- [MVP gap tracker](./docs/mvp_gap_tracker.md)
- [Sync acceptance checklist](./docs/sync_acceptance_checklist.md)
- [Sync troubleshooting](./docs/troubleshooting_sync.md)
- [UI fidelity baseline](./docs/ui_fidelity.md)
- [Playwright E2E](./docs/playwright_e2e.md)

## Disclaimer

This is an unofficial experimental project and is not affiliated with OpenAI or the official Codex Desktop team. Codex, OpenAI, VS Code, and related names belong to their respective owners.

## License

MIT © 2026 shopkeeper2020. See [LICENSE](./LICENSE) for details.
