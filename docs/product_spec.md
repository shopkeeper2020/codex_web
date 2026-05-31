# codex_web Product Spec

Status: draft

Last updated: 2026-05-29

## 1. Product Name

Temporary product name:

```text
codex_web
```

The name may change later, but all architecture and product discussions use `codex_web` as the working name for now.

## 2. Product Positioning

`codex_web` is a clean new Web implementation of the official Codex Desktop experience.

The target is not just a generic Codex chat UI. The product should closely reproduce the official Codex Desktop interface, workflows, and core behavior while adding browser/mobile access to the same local Windows machine.

The product must support live three-end synchronization across:

- official Codex Desktop
- official VS Code Codex extension
- `codex_web`

Any conversation or streaming response started from one end should be visible on the other two ends in real time, as long as the official clients and the local IPC bridge are available.

## 3. Non-Negotiable Goals

Primary goals:

1. Three-end real-time synchronization.
2. A long-term maintainable architecture.

Secondary but still important goals:

1. High-fidelity reproduction of the official Codex Desktop UI.
2. Good mobile experience.

The product should not sacrifice architecture quality for a short-term prototype. It should be designed as a clean replacement/new project rather than a direct continuation of the current `codex-mobile` codebase.

## 4. Target User

Initial target user:

- single personal user
- trusted personal devices only
- access to one Windows machine's files, resources, and local Codex capabilities from different devices

This is not initially a public multi-user service.

## 5. Runtime Environment

Initial runtime target:

- runs on the Windows host machine
- mobile/other devices access it through LAN or private network

Current requirement:

- official Codex Desktop and/or official VS Code Codex extension must be installed and available
- `codex_web` is allowed to depend on official local Codex components

Out of initial scope:

- public internet deployment
- Linux/macOS first-class support
- server-only deployment without official Desktop/VS Code

## 6. Relationship To Official Codex Clients

`codex_web` is not intended to be a fully independent Codex runtime in the first product version.

Required relationship:

- official Desktop or VS Code extension must be installed
- `codex_web` should connect to the official local IPC mechanism
- official clients remain part of the supported runtime model

The expected live-sync path is:

```text
official Codex Desktop
        |
        | official local IPC
        |
official VS Code Codex extension
        |
        | official local IPC
        |
codex_web backend
        |
        | HTTP/WebSocket/SSE
        |
codex_web browser UI
```

## 7. MVP Scope

The MVP should focus on the official Desktop-equivalent core loop:

- conversation list
- project list
- thread detail view
- streaming conversation rendering
- sending user messages
- receiving live assistant output
- maintaining real-time synchronization with Desktop and VS Code extension
- desktop Web layout
- mobile Web layout

The MVP should be designed with separate desktop and mobile UI layers while sharing domain logic, protocol adapters, state models, and API clients where reasonable.

## 8. Explicit Non-Goals For MVP

These can be deferred:

- remote-control enrollment flow
- remote-control device authorization UI
- account login
- account logout
- account upgrade / billing flows

Account and subscription information may be displayed if official/local data is available, but the first version does not need to implement account lifecycle operations.

## 9. UI Fidelity Target

UI goal:

- pixel-level reproduction as much as practical
- first version focuses on high-fidelity light theme only
- first i18n target covers Simplified Chinese and English

The product should closely match the official Codex Desktop visual language, layout hierarchy, interaction structure, and core component behavior.

Desktop Web should be fully isomorphic with official Codex Desktop as much as possible. The left navigation, project/thread surfaces, main chat layout, composer placement, and core interaction hierarchy should match official Desktop rather than merely borrowing its visual style.

Mobile should not be a compressed afterthought. The mobile experience should be closer to the ChatGPT mobile app interaction model: single-column, conversation-first, optimized for selecting a thread, sending a message, and reading streaming output. Mobile should use drawer-style navigation for project/conversation selection, while preserving a clear project concept instead of hiding projects as an advanced-only feature.

The preferred visual reference order is:

1. analyze official Desktop/front-end package resources where practical
2. use official Desktop screenshots and manual inspection as fallback

The final UI should be validated against official Desktop screenshots and behavior, not only by subjective similarity.

## 10. Project Strategy

Project strategy:

- create a clean new project
- do not gradually reshape `codex-mobile` into the final product
- use the current `codex-mobile` work as research, proof of concept, and implementation reference

The new project should start with a deliberate architecture, clear module boundaries, and a maintainable frontend/backend split.

## 11. Confirmed Technical Foundation

The current proof of concept verified that a third-party Web client can participate in official live synchronization by joining the official local IPC bus.

Reference document:

- [Official Codex IPC Sync Blueprint](./OFFICIAL_CODEX_IPC_SYNC.md)

Important implication:

The new project should treat official local IPC as a first-class integration layer, not as an incidental hack hidden inside UI code.

## 12. Product Information Architecture

The five core first-version regions are:

1. Sidebar
2. Project list
3. Conversation list
4. Main chat area
5. Composer

The desktop layout should match official Desktop as closely as possible. Current understanding is that official Desktop is project-oriented: projects are a major grouping layer, with project conversations beneath or within that context, while also exposing a top-level conversation area for non-project/global threads. `codex_web` should follow the official hierarchy rather than inventing a simplified generic chat list.

The product should also support projectless/global conversations. These are conversations not bound to a specific working directory and should remain visible and usable in the same information architecture.

The left navigation should fully reproduce the official Desktop order, icon choices, selected states, collapse behavior, and section boundaries where possible.

## 13. Desktop And Mobile UI Strategy

Desktop:

- target fully Desktop-isomorphic layout
- preserve left navigation, project/thread list surfaces, main chat region, and composer structure
- prioritize pixel-level and interaction-level fidelity
- reproduce the official sidebar, project list, conversation list, chat view, and composer as first-class product surfaces

Mobile:

- use a ChatGPT-like mobile interaction model
- optimize for selecting conversations, sending messages, and watching live streaming output
- use drawer-style navigation for project/conversation selection
- preserve project identity and project switching in the mobile experience
- hide or collapse detailed command execution and other secondary surfaces by default if needed for small screens
- keep future access paths open for advanced actions such as file browsing, model switching, image upload, skills, and command/tool details

Responsive strategy:

- design desktop and mobile in parallel
- use component-level responsive design where feasible
- share most components across desktop and mobile
- share domain logic, state, IPC/app-server adapters, message normalizers, and API clients
- avoid separate desktop/mobile codebases unless a component's interaction model is genuinely different

## 14. Message Rendering Scope

The first version should aim to support all important official Desktop message/item types, including:

- user messages
- assistant messages
- reasoning/thinking
- command execution
- file changes
- plans
- approval requests
- images
- errors
- tool output and other structured items exposed by official/local state

Reasoning display should match official Desktop as closely as practical. It should not be arbitrarily hidden or simplified unless official Desktop does so in the same state.

Command execution blocks should also follow official Desktop behavior. The first version should reproduce Desktop's expand/collapse rules for reasoning, commands, plans, approval requests, file changes, and errors as closely as possible.

At minimum command execution blocks should show:

- command
- status
- duration
- working directory
- exit code
- output

Future enhancements such as copy controls, folding, and terminal deep links should follow the official Desktop interaction pattern.

## 15. Composer Scope

The first version composer should aim for near-complete official Desktop parity. It should include:

- text input
- image paste/upload
- file attachments
- Skills selection
- model selection
- reasoning effort selection
- Default/Plan mode selection
- stop/interrupt button
- paste image
- drag/drop file support if official Desktop supports it in the equivalent state
- clear disabled/loading/running states

Voice input is explicitly not required for the first version.

The composer should be treated as a core product surface, not a small chat input. It owns important execution parameters and must remain synchronized with official thread/model/collaboration state where possible.

## 16. Design System Direction

`codex_web` should extract and maintain a design-token layer inspired by official Codex Desktop:

- colors
- typography
- spacing
- border radius
- shadows
- list row heights
- button/icon states
- input/composer states
- panel sizes and responsive breakpoints

This design system should be explicit enough to support pixel-level Desktop reproduction and consistent mobile adaptation.

Version 1 should prioritize light theme. Dark theme can be added later after the light theme reaches high fidelity.

Reference policy:

- inspect official Desktop/front-end package resources when practical
- use screenshot-based measurement and manual visual QA when direct resources are not available or are insufficient
- keep project-owned tokens/components rather than directly coupling the UI to private official package internals

## 17. UI Fidelity Decisions

### 17.1 Theme

Decision:

- first version implements light theme only
- dark theme is deferred

Reason:

Light theme is enough to validate product shape, synchronization, and high-fidelity Desktop reproduction without doubling visual QA work too early.

### 17.2 Visual Reference Source

Decision:

- official Desktop/front-end package resources may be analyzed as reference
- if direct resource analysis is not practical, use screenshots and manual inspection

The project should not blindly copy private official internals into product code. It should use official resources as reference material, then implement project-owned tokens and components.

### 17.3 Sidebar And Navigation

Decision:

- fully reproduce official Desktop sidebar/navigation
- preserve icon order, selected states, collapse/expand behavior, and section grouping where possible

This includes the official treatment of new conversation, search, plugins/automation surfaces, project area, and Settings if present in the current official UI.

### 17.4 Project And Conversation Hierarchy

Decision:

- follow official Desktop hierarchy
- preserve project-first grouping where official Desktop uses it
- preserve top-level/global conversation surfaces where official Desktop exposes them

The product should not flatten projects and conversations into one generic list unless official Desktop itself does so for a given state.

### 17.5 Desktop Message Blocks

Decision:

- reproduce official Desktop expand/collapse behavior for message blocks
- reasoning, commands, file changes, plans, approvals, errors, and structured tool output should follow Desktop behavior

Completeness matters more than hiding complexity. Mobile may collapse secondary details by default, but the underlying content should remain reachable.

### 17.6 Composer Parity

Decision:

- aim for near-complete official Desktop composer parity
- voice input is excluded from first version

The composer should include text, images, file attachments, Skills, model selection, reasoning effort, Default/Plan mode, stop/interrupt, and official disabled/running/loading states where available.

### 17.7 Mobile Navigation

Decision:

- use drawer-style navigation on mobile
- keep the project concept visible and useful
- design desktop and mobile in parallel

Mobile should feel like a natural browser/mobile version of Codex Desktop, not a separate simplified product.

### 17.8 Settings

Decision:

- Settings should visually follow official Desktop where possible
- Web-specific settings are allowed

First-version Web-specific settings may include:

- LAN access password
- debug/protocol log controls
- theme selection/status
- server port
- app-server/IPC diagnostics entry point

Account login/logout/upgrade operations remain out of MVP scope, but read-only account/subscription status may be shown if official data is available.

### 17.9 Debug Page

Decision:

- hidden debug page should use an engineering-oriented view

It may expose IPC frames, owner status, method/version maps, app-server status, cached snapshots, recent protocol errors, and follower events. It should not be part of the normal Desktop-like product navigation.

### 17.10 UI Acceptance Criteria

The product spec should include UI acceptance criteria.

Recommended criteria:

- desktop layout compared against official Desktop screenshots for major views
- core spacing, typography, row heights, icon sizes, and composer geometry measured with tolerance
- message block expand/collapse behavior tested against official Desktop behavior
- mobile drawer/navigation tested on common phone widths
- no text overlap or layout shift during streaming
- no feature-critical control hidden only because the viewport is small

## 18. Technical Product Decisions

### 18.1 Frontend Stack Direction

Provisional decision:

- React
- TypeScript
- Vite

Rationale:

- the official Codex Desktop/Electron UI appears likely to be closer to the React ecosystem than to Vue
- React has the largest ecosystem for complex app UIs, virtualized lists, command palettes, keyboard interaction, and design-system work
- React makes it easier to use established state/query libraries such as TanStack Query and Zustand
- if future reverse-engineering or UI behavior references official Desktop internals, React component patterns may map more naturally

Vue remains viable in general, but for this project React is the current product-led default.

Component library strategy:

- do not adopt a heavy component library that imposes its own visual language
- prefer low-level/headless primitives where useful
- possible candidates: Radix UI, Ariakit, Floating UI, TanStack Virtual
- build the final visual system in project-owned components and tokens

Styling strategy remains a detailed implementation decision, but the current direction is to avoid a large visual component library and avoid coupling the product to another application's visual language.

### 18.2 App Shape

Decision:

- pure Web service
- no Electron shell
- no Tauri shell

Rationale:

Official Codex Desktop already covers the desktop-app use case. `codex_web` exists to provide the missing browser/mobile surface on top of the same local machine and official synchronization model.

### 18.3 Backend Runtime Options

Backend runtime is not finalized. Options:

#### Node.js

Pros:

- best fit for a Web backend with WebSocket/SSE, HTTP APIs, and frontend build tooling
- native named-pipe support through `node:net`
- easy to reuse protocol/types/shared code with frontend TypeScript
- strongest ecosystem and easiest debugging on Windows
- simplest path from the current proof of concept

Cons:

- less strict than Rust for long-running systems
- process supervision and native edge cases require discipline
- packaging can be messier than a single native binary

#### Bun

Pros:

- fast startup and modern TypeScript ergonomics
- attractive DX for some Web projects

Cons:

- Windows/named-pipe/process-management edge cases are higher risk
- smaller ecosystem and fewer proven production patterns for this specific local-agent use case
- not worth the compatibility risk for the first serious implementation

#### Deno

Pros:

- good TypeScript story
- secure-by-default permissions model
- clean standard library

Cons:

- less aligned with mainstream React/Vite/Node ecosystem
- Node compatibility exists but can still add friction
- Windows local-process integration is not the path of least resistance

#### Rust backend

Pros:

- excellent long-term correctness and performance
- single binary packaging potential
- strong process/IPC control
- good for a hardened local daemon

Cons:

- more implementation cost
- harder to share types and code with a TypeScript frontend
- slower iteration while the protocol and product are still being discovered
- WebSocket/SSE/API development is straightforward but less flexible for rapid UI/backend co-evolution

Current recommendation:

- start with Node.js + TypeScript
- isolate protocol/backend modules cleanly so a future Rust service can replace selected parts if needed

### 18.4 Official app-server Strategy

The app-server strategy should mirror official clients as closely as possible. If official Desktop and VS Code each run their own app-server processes, `codex_web` may also run its own app-server for fallback and Web-owned threads.

Requirement:

- running a separate app-server must not break three-end synchronization

Proposed rule:

- official-owned thread: use official IPC follower requests; do not start local independent turns
- Web-owned thread or no official owner: use `codex_web`'s app-server, then broadcast snapshots over official IPC where supported
- thread list/read: combine app-server persisted state with official IPC live-state cache

This keeps app-server useful without letting it split the live stream.

### 18.5 Owner Selection

Question raised: what does owner selection mean?

In the official IPC model, the owner of a thread is the client responsible for executing actions on that thread. A follower should not independently execute a turn. It should ask the owner to execute it.

Owner choice affects:

- which app-server/process runs the turn
- which client broadcasts live `thread-stream-state-changed`
- whether Desktop/VS Code/Web stay on one stream or split into duplicated turns
- which working directory, model state, collaboration mode, and tool context are authoritative

Current recommendation:

- use the owner from the latest official IPC snapshot when known
- if owner is unknown, omit `targetClientId` and let official router discovery choose
- record the selected/handled owner in diagnostics

Open decision:

- whether to add a user-facing or config-level preference for Desktop vs VS Code owner selection

### 18.6 Protocol Upgrade Behavior

Decision:

- provide a clear diagnostic page/state if official IPC compatibility breaks

Even if the main app should not expose a full technical dashboard, protocol-breakage should be surfaced in a controlled way. The user should not be left with silent partial sync.

Product behavior:

- normal UI should stay clean and Desktop-like
- a hidden or settings-linked diagnostics surface can show IPC status, method versions, recent follower requests, and compatibility errors
- if IPC is incompatible, explain that the official protocol likely changed and an adapter update is needed

### 18.7 Security

Decision:

- the backend listens on LAN by default for the first product version
- LAN access must require authentication
- trusted sessions should expire

Initial access model:

- server listens on `0.0.0.0:<port>` by default so phones and other LAN devices can connect directly
- first startup generates a random password
- Settings allows the user to change the password
- browser sessions use a token/cookie so trusted devices can stay signed in
- trusted-device sessions must have an expiration time
- future FRP/private-network access can build on the same auth layer

### 18.8 Mobile Access

Initial target:

- direct LAN IP + port
- no public-internet deployment requirement in the first version

Future possible access:

- FRP
- Tailscale
- Cloudflare Tunnel
- PWA install

These should not drive MVP architecture, but the auth/session layer should not block them later.

### 18.9 File And Git Scope

File system capability:

- first version should reproduce official Desktop's current capability level
- avoid inventing a separate IDE-style file manager unless official Desktop behavior requires it

Git:

- branch/status controls can be deferred from first version
- long-term goal is to bring official Desktop's Git-related UI into the browser

### 18.10 State Management Direction

State management is not finalized.

Current recommendation for React:

- TanStack Query for server/cache/query lifecycle
- Zustand or a small custom domain store for UI/session state that is not naturally query-shaped
- event reducer for WebSocket/SSE/IPC-derived notifications

Rationale:

- thread lists, thread details, project lists, model lists, and account reads are query-shaped
- active streaming state, composer state, selected panels, mobile navigation, and transient owner/follower state are store-shaped
- separating query cache from UI state keeps long-term maintenance easier

### 18.11 URL Routing

Use mainstream clean browser routes rather than hash routes, unless deployment constraints require hashes.

Preferred route shape:

```text
/thread/:threadId
/project/:projectId
/project/:projectId/thread/:threadId
/settings
```

Desktop and mobile should use the same URLs and switch layout responsively. The URL should identify product state, not device layout.

### 18.12 Repository Structure

Monorepo is a strong fit for this project, but it should be kept small and purposeful.

Option A: simple single app

```text
src/
  web/
  server/
  shared/
```

Pros:

- fastest to start
- fewer build/workspace decisions
- easy for a single developer

Cons:

- module boundaries can degrade over time
- protocol, UI, and backend code can become tangled

Option B: workspace monorepo

```text
apps/
  web/
  server/
packages/
  protocol/
  domain/
  ui/
  config/
```

Pros:

- clear boundaries
- shared protocol/domain types are first-class
- easier long-term testing and documentation per package
- better fit for a project intended to last

Cons:

- more setup
- more package/build configuration
- can become ceremony if over-split too early

Current recommendation:

- use a small pnpm workspace monorepo
- start with only packages that enforce real boundaries

Recommended initial structure:

```text
apps/
  web/          # React/Vite browser app
  server/       # Node.js local backend
packages/
  protocol/     # official IPC, app-server DTOs, wire types
  domain/       # thread/project/message normalized models
  ui/           # shared design system and reusable components
  config/       # shared config, feature flags, constants
documentation/
  product/
  architecture/
  protocol/
tests/
```

Avoid splitting into more packages until a boundary is proven.

### 18.13 Maintainability Priorities

Top maintainability priorities:

1. Clear module boundaries.
2. Complete, practical documentation.
3. Meaningful test coverage.

Implications:

- protocol adapters must be isolated from UI code
- official IPC compatibility should have focused tests and diagnostics
- domain models should be normalized and documented
- design system should be explicit rather than copied ad hoc from screenshots
- feature docs should be updated as architecture decisions are made

## 19. Synchronization Semantics And Data Model

### 19.1 User-Level Sync Principle

The product should hide owner/follower complexity from the user.

User expectation:

- it should not matter where a conversation was created
- it should not matter which official client currently owns the thread
- a message sent from any end should work normally
- the other two ends should update in real time
- failures should be explicit and actionable, not silent

Technical implication:

`codex_web` should implement automatic owner resolution, recovery, follower forwarding, local fallback, and queueing internally. The UI should present this as one coherent conversation system.

### 19.2 Default Web Role

Decision:

- choose automatically based on the currently open thread and available official clients

Practical meaning:

- if the thread has an official owner, `codex_web` acts as a follower and sends actions to that owner
- if no official owner is currently known, `codex_web` should attempt to discover or restore one
- if restoration is unavailable or fails, `codex_web` may become a temporary owner through its own app-server, then broadcast state back to official IPC

Examples:

- Thread is open in VS Code and Web sends a message: Web forwards `thread-follower-start-turn` to VS Code.
- Thread is open in Desktop and Web sends a message: Web forwards to Desktop.
- Thread is not open in either official UI, but the session exists on disk: Web should try to resume/restore an official owner before falling back to its own app-server.
- Web creates or owns a turn because no official owner is available: Web should broadcast snapshots so official clients can follow when they open the thread.

### 19.3 Owner Restoration

Target behavior:

- `codex_web` should attempt to wake, resume, or restore an official thread owner when the user sends from Web into a thread that is not currently owned by an official client.

This is a product requirement, but the exact mechanism is still a technical discovery item.

Possible strategies:

1. Router discovery: send follower request without `targetClientId` and let official IPC discover a capable client.
2. Official thread resume path: investigate whether official Desktop/VS Code expose IPC methods that can resume a thread into an owner role.
3. Local fallback: if no official owner can be restored, run through the Web app-server and broadcast Web-owned snapshots.

The first version should implement router discovery and robust fallback. Explicit owner wake/resume can be a dedicated protocol investigation if official clients do not already support it.

### 19.4 Owner Preference

The user does not need to choose Desktop vs VS Code manually in normal use.

Recommended default:

- use the latest official snapshot owner when present
- if no known owner exists, let official router discovery choose
- if multiple clients can handle a thread, prefer official behavior unless evidence shows it causes instability

Why owner preference matters:

- the owner decides which process executes the turn
- the owner broadcasts the stream updates
- the owner controls active model/collaboration/tool context for that thread

Possible future preference:

- expose an advanced setting to prefer Desktop or VS Code only if real-world conflicts appear

### 19.5 Web New Thread Behavior

Open decision:

- exact Web new-thread behavior is not finalized

Current recommended direction:

1. If an official active project/client context exists, prefer creating through or aligning with the official client.
2. If no official owner/context is available, create through Web's app-server.
3. After Web creates a thread, broadcast official IPC snapshots so Desktop and VS Code can discover/follow it.

The implementation should preserve the user-facing expectation: creating a thread from Web should make that thread available to official clients without requiring restart.

### 19.6 Thread Read Priority

Recommended data source priority:

```text
official IPC live cache
  -> app-server thread/read
  -> rollout/session file recovery
```

Reasoning:

- official IPC live cache is the best source for active synchronized stream state
- app-server `thread/read` is the stable structured read path for persisted sessions
- rollout/session files are a recovery/backfill layer, not the primary app API

The frontend should not read raw protocol state directly. The backend should convert sources into a unified domain model.

### 19.7 Thread List Ordering

Decision:

- thread list sorting does not have to be perfectly real-time in MVP

The current thread detail and active stream must be real-time. The list can refresh opportunistically or on a small debounce. This avoids over-optimizing list ordering before the core three-end conversation loop is stable.

### 19.8 Title And Rename Sync

Decision:

- thread titles/renames should sync in real time

If Desktop or VS Code renames a thread, Web should update without a manual reload when official/local notifications are available.

### 19.9 UI State Persistence

Decision:

- Web should persist its own UI state
- store UI state in server-side local files

Examples:

- sidebar width
- selected project
- last selected thread
- mobile last-opened conversation
- collapsed/expanded UI sections
- composer local draft state if needed

Rationale:

- browser localStorage does not naturally sync across devices
- server-side local files let multiple trusted devices share the same Web UI state
- official Desktop state should not be overloaded with Web-specific layout preferences

### 19.10 Domain Data Model

Decision:

- backend converts protocol/app-server state into a unified domain model
- frontend consumes the unified domain model rather than raw official `conversationState`

Recommended internal layering:

```text
raw official IPC frame
raw app-server response
raw rollout/session recovery
        |
        v
backend normalizers
        |
        v
domain model
        |
        v
frontend query/store
        |
        v
UI components
```

The backend may keep raw state for debugging/compatibility, but product UI should not depend directly on raw official protocol shapes.

### 19.11 Protocol Logging

Decision:

- retain protocol logging capability

Recommended policy:

- disabled or metadata-only by default
- enable full raw frame logging only manually for debugging
- redact or warn about sensitive content
- bound log size by count and/or file size

Protocol logs are valuable because the official IPC protocol is internal and can change. They should be treated as debugging artifacts, not normal product data.

### 19.12 Concurrent Sends, Queueing, And Steering

Desired behavior:

- support queued messages
- support steering/guidance during an active turn
- use first-come-first-served ordering where queueing is needed

This should align with official Codex behavior:

- if the official owner supports steering, send steering/guidance to the owner
- if the official owner supports queueing, delegate to official behavior
- if Web owns the thread, Web should apply equivalent queue/steer semantics through its own app-server

User-level rule:

- the user should be able to keep typing while a turn runs
- the UI should clearly distinguish "steer current turn" from "queue next turn" if official Desktop exposes those as distinct modes

### 19.13 Stop / Interrupt

Decision:

- interrupt should route according to the current thread owner

Practical behavior:

- official-owned thread: send `thread-follower-interrupt-turn` to the official owner
- Web-owned thread: call Web app-server `turn/interrupt`
- unknown owner: attempt official discovery first, then local fallback if applicable

Do not broadcast blind interrupts to every possible client by default. That can interrupt the wrong execution context.

### 19.14 Hidden Developer Debugging

Decision:

- a hidden developer/debug page is acceptable
- it should not appear as a normal Desktop-like product surface

Example route:

```text
/debug/ipc
```

Possible contents:

- IPC connected status
- client id
- cached conversation count
- current thread owner
- recent follower requests
- protocol version map
- app-server status
- last protocol errors

This is for development and maintenance, not normal user workflow.

### 19.15 Protocol Change Maintenance

Desired behavior:

- detect and clearly report protocol incompatibility
- let the user ask an agent/developer to update the adapter for the new protocol

Recommended implementation:

- version/method map isolated in `packages/protocol`
- compatibility checks at startup
- visible error if official protocol changes
- optional helper script to inspect official package bundles and regenerate/update method version maps

The project does not need fully automatic self-healing protocol upgrades, but it should make breakage easy to diagnose and update.

## 20. Runtime, Service, And Operations Decisions

### 20.1 Startup Mode

Decision:

- first version starts from the command line
- Windows service and tray app are deferred

Recommended first-version commands:

```text
pnpm dev
pnpm start
codex-web start
```

Long-term options:

- Windows startup service
- tray controller
- background daemon
- installer-managed service

The product should not require those from day one. The first milestone should optimize for fast protocol iteration and easy debugging.

### 20.2 Listen Address

Decision:

- backend listens on `0.0.0.0` by default
- LAN access is part of the default product experience

Reason:

The product exists partly so phones and other local devices can access the Windows host. Binding only to `127.0.0.1` would block the core mobile/LAN workflow.

Security consequence:

- authentication is required for LAN access
- the startup log and Settings page should clearly show the LAN URL and auth status

### 20.3 Authentication And Trusted Devices

Decision:

- first startup generates a random password
- user may change the password in Settings
- browser devices may be remembered
- remembered-device sessions must expire

Recommended model:

- password protects login
- successful login receives a signed session token
- token is stored in an HTTP-only cookie where possible
- token has an expiration time
- Settings should allow revoking sessions later

Open implementation detail:

- exact default expiry duration

Initial recommendation:

- 7 to 30 days for trusted LAN devices
- shorter duration if future public tunnel access is enabled

### 20.4 Data Directory

Decision:

- default data directory is project-local `data/`
- data directory can be configured
- structured Web metadata uses SQLite

This keeps early development transparent and easy to inspect. A later packaged/installed build may default to a Windows user data directory such as `%APPDATA%/codex_web`, while preserving a config override.

Likely contents:

- config
- session tokens
- UI state
- logs
- attachment cache/store
- protocol compatibility metadata
- Web-side project favorites
- SQLite database for indexes, settings, session metadata, and local projections

### 20.5 Logging

Decision:

- normal logs are written to local log files
- protocol raw-frame logging is disabled by default
- protocol raw-frame logging can be manually enabled for debugging

Log policy:

- normal logs should be safe enough for routine diagnosis
- raw protocol logs may contain sensitive conversation or file data
- raw protocol logs should be clearly labeled and size-limited
- debug page should expose current logging status

### 20.6 Browser To Backend Communication

Decision:

- use HTTP + WebSocket

Recommended split:

- HTTP for normal request/response APIs
- WebSocket for live events, streaming updates, thread state changes, owner changes, queue state, and diagnostics

Rationale:

HTTP keeps ordinary APIs simple and cacheable. WebSocket fits bidirectional realtime behavior better than pure SSE because the browser needs to both receive stream events and send interactive control actions such as queue, steer, stop, and approval decisions.

### 20.7 Backend Event Bus

Decision:

- backend should have an internal event bus

Event sources:

- official IPC snapshots and follower events
- app-server turn/stream events
- restored persisted thread/session state
- browser client actions
- file/project metadata updates
- protocol diagnostics

Event sinks:

- domain store
- WebSocket clients
- logs
- diagnostics/debug page
- persistence layer

This prevents protocol adapters, app-server calls, and browser transport code from becoming tightly coupled.

### 20.8 Web New Thread Creation

Decision:

- use automatic creation strategy
- prefer official/router discovery where possible
- if official creation/owner routing is unavailable, use Web app-server fallback

Priority:

1. let official router/discovery select the appropriate owner
2. if a suitable official owner is known, ask that owner to create/run the thread
3. otherwise create through Web-owned app-server and broadcast/synchronize state where supported

This mirrors the overall principle that the user should not need to care which end owns a thread.

### 20.9 Attachments And Uploaded Files

Requirement:

- uploaded files and images should remain reviewable later from Desktop, VS Code extension, and Web whenever official protocol/state makes that possible

Decision:

- do not use memory-only forwarding as the product storage model
- persist uploaded attachments before sending or referencing them in a turn
- use transport-level memory forwarding only as an implementation optimization for small transient chunks

Recommended model:

```text
browser upload
        |
        v
server attachment store
        |
        v
domain attachment record
        |
        v
official/app-server send request
        |
        v
thread item / durable reference
```

The backend should store attachment metadata such as:

- attachment id
- original filename
- MIME type
- size
- hash
- created time
- local stored path
- associated thread id / turn id if known
- official/app-server reference id if one is returned

If the official app-server copies attachments into its own durable session storage and returns stable references, `codex_web` may mark its local copy as cacheable rather than authoritative. Until that is confirmed, Web should keep its own durable attachment copy.

Reason:

Memory-only forwarding can work for immediate execution, but it is a bad product model when the same attachment must remain inspectable later across Desktop, VS Code extension, and Web.

### 20.10 Project List Sources

Decision:

- official project list is primary
- Web may add local favorite projects

First version:

- use official Desktop/extension project state as the main source when available
- allow a small Web-side favorites/supplements layer if needed

The UI should make official projects and Web-added favorites feel coherent, but diagnostics should be able to distinguish their sources.

### 20.11 File And Directory Viewing

Decision:

- first version only displays file/directory-related information exposed through thread messages, diffs, attachments, or official state
- full file browser/editor can come later

This keeps v1 focused on reproducing Desktop's conversation workflow instead of becoming a browser IDE too early.

### 20.12 Approvals And Permission Decisions

Decision:

- Web should fully reproduce Desktop approval cards
- Web should allow approve/reject actions

Owner-aware routing:

- official-owned thread: send approval decision through official follower/owner protocol
- Web-owned thread: send approval decision to Web app-server
- unknown owner: perform discovery before deciding where to route the approval

Approval UI must be treated as a core safety surface. It should show enough context for the user to make the same decision they would make in Desktop.

### 20.13 Official Version And Protocol Detection

Decision:

- startup should detect official Desktop/extension/app-server compatibility where possible

Recommended checks:

- installed official Desktop version
- installed VS Code extension version if discoverable
- IPC socket/pipe availability
- known IPC method versions
- app-server command availability
- known compatible protocol map

If compatibility is unknown or broken, the app should enter a clear diagnostics state rather than silently failing synchronization.

### 20.14 Test Priority

Decision:

- test all three important areas
- prioritize protocol synchronization first

Priority order:

1. protocol and three-end synchronization tests
2. core UI and visual behavior tests
3. backend process/service stability tests

Reason:

If synchronization is wrong, the product loses its main purpose. UI fidelity and process stability remain essential, but they should be validated on top of a correct sync model.

## 21. Data, API, And Module Boundary Decisions

### 21.1 Structured Storage

Decision:

- use SQLite for structured local Web data
- continue storing attachment binary files on disk
- keep logs as files

SQLite should store data that benefits from indexing, querying, migration, and consistency:

- device/session tokens
- Web settings
- UI state
- project favorites
- thread list projection indexes
- attachment metadata
- protocol compatibility metadata
- diagnostic event metadata

SQLite should not be treated as the only source of truth for official Codex conversations. It should primarily hold Web-owned settings and local projection/index data derived from official IPC/app-server/session sources.

Attachment files should live in the configured data directory and be referenced by SQLite metadata.

### 21.2 Backend Web Framework

Decision:

- use Fastify for the Node.js backend

Clarification:

- Node.js is the runtime
- TypeScript is the language/type layer
- Fastify is the HTTP/WebSocket server framework running on Node.js
- FastAPI is a Python web framework, not a Node.js framework

Framework comparison:

#### Fastify

Pros:

- strong TypeScript ergonomics compared with older Node frameworks
- good performance
- plugin system is mature
- JSON schema validation fits typed API contracts
- works well for HTTP APIs plus WebSocket plugins
- less ceremony than NestJS

Cons:

- less universally known than Express
- schema-first style can feel stricter at first

#### Express

Pros:

- most familiar Node web framework
- enormous ecosystem
- easy to start

Cons:

- weaker modern TypeScript experience
- less structured by default
- easier for a long-lived project to become loosely organized

#### Hono

Pros:

- lightweight
- modern API
- good developer experience
- attractive for edge/serverless-style apps

Cons:

- less proven for this Windows local daemon + IPC + WebSocket + long-running service shape
- smaller ecosystem for this exact use case

#### NestJS

Pros:

- very structured
- good for large enterprise backends
- dependency injection and module patterns are built in

Cons:

- heavier than this project needs
- more framework ceremony
- can slow down protocol exploration

#### FastAPI

Pros:

- excellent Python API framework
- strong OpenAPI story
- easy to write typed-ish APIs in Python

Cons:

- different language/runtime from the frontend
- harder to share TypeScript types between frontend/backend/protocol packages
- less direct fit for Node-based Windows IPC/app-server integration

Current rationale:

Fastify is the best first-version balance: structured enough for maintainability, light enough for rapid protocol work, and aligned with the TypeScript monorepo.

### 21.3 Frontend Stack

Decision:

- React
- TypeScript
- Vite

This remains a product-led choice rather than a preference choice. The main reasons are ecosystem strength, fit for complex app UI, and easier alignment with Desktop-like component structures.

### 21.4 Styling Strategy

Decision:

- project-owned design tokens using CSS variables
- component-scoped styles with CSS Modules
- headless/low-level primitives for interaction-heavy controls, especially Radix, Ariakit, Floating UI, and TanStack Virtual where appropriate
- avoid a heavy visual component library

Tailwind can reduce some CSS writing, but for a Desktop clone it can also create large class strings and make exact token governance harder. Vanilla Extract or Panda can provide strong type safety, but they add extra tooling and can increase ceremony.

Chosen practical default:

```text
CSS variables for tokens
CSS Modules for component styles
Radix/Ariakit/Floating UI/TanStack Virtual where useful
project-owned visual components
```

This should keep code volume reasonable while still supporting high-fidelity UI reproduction.

### 21.4.1 Internationalization Layer

Decision:

- add i18n as a formal frontend architecture layer
- use `i18next + react-i18next`
- default locale: `zh-CN`
- supported MVP locales: `zh-CN` and `en-US`
- Settings should eventually expose: follow system, Simplified Chinese, English

Planned boundaries:

```text
packages/i18n       shared locale resources, key types, formatter conventions
apps/web/src/i18n   React provider, language switching, persistence
```

Frontend components should not keep long-term user-visible strings inline. New UI work should prefer:

```tsx
t("sidebar.newChat")
```

rather than hard-coded labels.

Backend APIs should move user-visible failures toward structured `code + params`. The Web frontend owns translation of those codes into localized text. `packages/domain` should stay language-neutral and expose structured states such as `completed`, `running`, `editing`, or `failed`, not display strings.

Dates, relative times, numbers, file sizes, and durations should use `Intl` formatters. Desktop and mobile visual regressions should eventually run in both `zh-CN` and `en-US`, because English labels are often longer and can expose layout bugs in Composer, Settings, right side panels, and mobile drawers.

Reference: `docs/i18n.md`.

### 21.5 Core Domain Entities

Accepted core entities:

- `Client`
- `Project`
- `Thread`
- `Turn`
- `MessageItem`
- `Attachment`
- `Approval`
- `Owner`
- `StreamState`
- `DiagnosticEvent`

These entities belong in the domain layer. They should not be one-to-one copies of official raw protocol objects.

### 21.6 Typed Realtime Protocol

Decision:

- WebSocket events should use a strong typed protocol
- every event type should have a schema
- events should include ordering metadata such as a sequence number where useful

Example event names:

```text
thread.updated
thread.stream.delta
thread.stream.state
owner.changed
approval.requested
approval.resolved
project.updated
diagnostic.event
client.status
```

This makes the browser/backend contract testable and prevents realtime sync code from becoming an untyped event soup.

### 21.7 Multiple Web Clients

Decision:

- multiple Web browser clients should synchronize with each other in real time

Examples:

- desktop browser and phone browser watching the same thread should both see streaming output
- a message sent from phone Web should appear in desktop Web, Desktop, and VS Code extension
- owner/status/approval changes should fan out to all active Web clients

The Web backend should treat browsers as multiple connected views of the same local domain state.

### 21.8 Behavior When Official Clients Are Closed

Decision:

- Web should continue to be usable through its own app-server when Desktop and VS Code extension are closed

Required behavior:

- Web can read available persisted history
- Web can start or continue turns through Web-owned app-server when possible
- when official clients reopen, Web should synchronize/broadcast state using the official mechanism where supported

This is important because `codex_web` should be a peer-capable surface, not only a passive viewer.

### 21.9 Search Scope

Decision:

- first version searches thread titles and projects
- full message-text search is deferred

This keeps the MVP useful without requiring a complete local message indexing/search engine on day one.

Future search may include:

- full thread message content
- file names
- command output
- attachment names
- project paths

### 21.10 Projection Cache And Thread Loading

Decision:

- backend maintains an in-memory/domain projection cache updated by realtime events
- SQLite stores projection indexes
- full thread detail is loaded on demand when opening a thread

Recommended model:

```text
official IPC/app-server/session sources
        |
        v
backend event bus
        |
        v
projection cache
        |
        +--> SQLite indexes
        |
        +--> WebSocket clients
```

The thread list should be fast because it reads from projection/index data. Thread detail can be lazily resolved from official/app-server/session sources and then normalized into the domain model.

### 21.11 API Layering

Decision:

- keep protocol raw API, domain API, and frontend API separate

Layers:

```text
official raw protocol adapters
        |
        v
domain services and normalizers
        |
        v
frontend-facing HTTP/WebSocket API
        |
        v
React UI
```

The frontend must not depend directly on raw official protocol shapes.

### 21.12 Error Presentation

Decision:

- normal user mode shows lightweight Desktop-like errors
- developer/debug mode shows detailed protocol and diagnostic information

Examples:

- normal UI: "Sync temporarily unavailable"
- debug UI: IPC method, owner id, target client id, protocol version, raw error class, recent event sequence

This preserves a clean Desktop-like product surface while still supporting fast maintenance when official internals change.

### 21.13 Version And Compatibility Status

Decision:

- startup should show current product version and official compatibility status
- automatic product updater is deferred

The app should make it clear whether the installed Desktop/extension/app-server combination is known-compatible, unknown, or incompatible.

## 22. Development, Testing, And Delivery Decisions

### 22.1 First Implementation Tracks

Decision:

- build two tracks in parallel
- track one: official protocol skeleton and synchronization core
- track two: static high-fidelity Desktop UI shell

Rationale:

The product has two hard problems: official synchronization and Desktop UI fidelity. Waiting for one to be perfect before starting the other would delay integration feedback. The first milestone should make both surfaces visible early, then connect them through the domain model.

### 22.2 Use Of Current `codex-mobile` Work

Decision:

- reuse the current `codex-mobile` project as research/reference
- do not copy its overall architecture as the final architecture

Reusable reference areas:

- official IPC connection findings
- follower/owner synchronization behavior
- app-server interaction notes
- protocol logs and tests
- working proof of Desktop/extension/Web live sync

The new project should start clean, with better module boundaries and product architecture.

### 22.3 Protocol Research Records

Decision:

- maintain an official protocol research record directory

Recommended locations in the new project:

```text
documentation/protocol/
documentation/protocol/official-ipc/
documentation/protocol/app-server/
packages/protocol/fixtures/
```

Research records should capture:

- IPC method names and versions
- request/response payload shapes
- observed owner selection behavior
- stream/snapshot event examples
- interrupt/approval/queue/steer behavior
- compatibility notes by official Desktop/extension version

Protocol fixtures should avoid unnecessary sensitive content.

### 22.4 Visual Regression Testing

Decision:

- use Playwright screenshot regression for UI validation

Focus areas:

- Desktop shell layout
- sidebar/project/thread list
- main chat area
- composer states
- message block expand/collapse
- mobile drawer navigation
- streaming layout stability

Visual regression should not replace manual comparison with official Desktop, but it should prevent regressions once a view is matched.

### 22.5 Visual Baseline Source

Decision:

- start with manually captured official Desktop screenshots
- later automate screenshot capture where practical

This gives the project useful visual baselines immediately without blocking on official Desktop automation.

### 22.6 Browser Support

Decision:

- first version targets Chromium/Edge
- mobile priority is mobile Edge/Chrome

Safari and Firefox can be considered later, but the first version should optimize for the user's actual Windows/LAN workflow.

### 22.7 PWA Scope

Decision:

- first version may include Web App Manifest and icons
- offline capability is out of scope

The purpose of early PWA support is installability and a better mobile home-screen experience, not offline operation.

### 22.8 SQLite Stack

Decision:

- use Drizzle + SQLite

Reasons:

- typed schema and query ergonomics
- migration support
- readable schema definitions
- good fit for a TypeScript monorepo

Open implementation detail:

- exact SQLite driver/binding

The driver should be chosen based on Windows reliability, local development simplicity, migration support, and packaging impact.

### 22.9 Attachment Retention

Decision:

- attachments are retained by default
- Settings should offer cache/attachment cleanup controls

Reason:

Automatic deletion can break later review across Web/Desktop/extension. The safer first-version behavior is durable retention with explicit user cleanup.

Future options:

- per-project cleanup
- cleanup unattached cache files
- storage usage view
- retention policy by size or age

### 22.10 Log Retention

Decision:

- combine time-based and size-based log retention

Recommended policy:

- keep recent logs by day count
- cap total log storage size
- rotate raw protocol logs separately from normal logs

Protocol raw logs should remain opt-in and easy to delete.

### 22.11 app-server Crash Recovery

Decision:

- if Web-owned app-server crashes, backend should attempt restart and record diagnostics

Behavior:

- detect app-server exit/error
- mark affected owner/threads as degraded
- attempt controlled restart
- emit diagnostic event
- notify Web clients if the current thread is affected

The restart policy should avoid an infinite crash loop.

### 22.12 Official Version Change Notification

Decision:

- show a lightweight prompt when official Desktop/extension version changes

Example:

```text
Official Codex version changed. Open diagnostics to confirm compatibility.
```

Normal UI should remain calm, but protocol changes should not be silent.

### 22.13 Diagnostic Export

Decision:

- support exporting a diagnostic package

The diagnostic package may include:

- `codex_web` version
- official Desktop/extension/app-server versions
- compatibility status
- recent non-sensitive logs
- protocol method/version map
- recent error summaries
- owner/client status
- event sequence summaries

It should avoid including conversation text, file contents, attachment binaries, secrets, passwords, tokens, or raw protocol frames unless the user explicitly enables an advanced export mode.

### 22.14 Developer Mode

Decision:

- provide a developer mode switch

When disabled:

- product behaves like a clean Desktop-like app
- technical details are hidden

When enabled:

- show owner/client ids where useful
- show event sequence numbers
- expose protocol diagnostics entry points
- allow raw protocol logging controls
- reveal app-server and IPC state

Developer mode should be useful for maintenance without polluting the normal product experience.

## 23. Milestones, Acceptance, And Test Plan

### 23.1 Documentation Language

Decision:

- new project documentation should be Chinese-first
- bilingual documentation can be added later

The current research/spec draft may contain English sections because it was built incrementally during exploration. For the clean `codex_web` project, product documents, implementation plans, and decision records should be written in Chinese first, then translated or summarized bilingually when the project matures.

### 23.2 Milestone Count

Decision:

- split MVP into 5 medium-sized milestones

Reason:

Five milestones are large enough to avoid excessive process overhead, but small enough to create real checkpoints and usable acceptance boundaries.

### 23.3 Proposed MVP Milestones

#### Milestone 1: Foundation And Real Sync Slice

Goal:

- create the clean monorepo foundation
- connect to official IPC/app-server path
- show real projects/threads
- send a message from Web
- receive streaming output
- verify Desktop, VS Code extension, and Web synchronize for the same thread

Acceptance:

- Web can open a real thread
- Web can send a real message
- streaming output appears in Web
- the same conversation updates in official Desktop and VS Code extension
- no duplicate turn or thread fork is produced

This is the first runnable target. It should go beyond a static UI shell.

#### Milestone 2: Desktop Core UI Fidelity

Goal:

- implement high-fidelity Desktop-like shell
- reproduce sidebar, project list, conversation list, chat area, and composer
- connect the core UI to the domain model

Acceptance:

- major Desktop layout regions visually match the official Desktop reference by human inspection
- core composer controls are present
- project/thread navigation works with real data
- selected/running/loading states are represented clearly

#### Milestone 3: Message Blocks, Approvals, And Composer Parity

Goal:

- reproduce official message block behavior
- support approvals from Web
- improve composer parity

Acceptance:

- reasoning, command, file-change, plan, error, and approval blocks render with Desktop-like expand/collapse behavior
- Web can approve/reject permission requests
- stop/interrupt routes to the current owner
- queue/steer behavior is implemented or clearly gated by protocol capability

#### Milestone 4: Mobile, Multi-Web, Persistence, And Attachments

Goal:

- implement mobile drawer experience
- support multiple Web clients watching the same state
- add SQLite projections and persistent attachments
- add login/session behavior

Acceptance:

- mobile layout works at the chosen reference size
- phone Web and desktop Web synchronize in real time
- uploaded attachments are durably stored and associated with threads/turns
- trusted device sessions expire
- project/thread indexes survive restart

#### Milestone 5: Diagnostics, Stability, And Release Readiness

Goal:

- harden app-server lifecycle
- complete diagnostics
- add visual and E2E test coverage
- prepare the product for daily personal use

Acceptance:

- app-server crash is detected, restarted where appropriate, and logged
- official version/protocol changes produce a clear prompt
- diagnostic export is available
- Playwright regression tests cover core UI paths
- performance and official-client-safety acceptance checks pass

### 23.4 First Usable Version Standard

The first genuinely usable version must support:

- viewing projects and conversations
- opening a thread
- sending a message
- seeing streaming output
- Desktop, VS Code extension, and Web real-time synchronization

If any of these are missing, the product is still a prototype rather than a usable first version.

### 23.5 Implementation Plan In PRD

Decision:

- the product document should include an implementation plan
- each milestone should include tasks and acceptance criteria

Recommended task categories per milestone:

- product behavior
- protocol/backend
- frontend/UI
- persistence
- tests
- documentation

### 23.6 Unit Test Scope

Decision:

- cover all important units over time
- first focus on protocol adapter, domain normalizer, and event bus/reducer

Priority:

1. protocol parser/adapter
2. domain normalizer
3. event bus/reducer
4. API schema
5. persistence/repository layer
6. auth/session logic
7. attachment metadata logic

### 23.7 E2E Test Scope

First E2E paths:

- startup
- login
- open thread
- receive stream
- send message
- approval card
- mobile drawer

These should be tested against the real product path whenever practical.

### 23.8 Protocol Fixtures

Decision:

- recorded protocol fixtures are allowed

Allowed use:

- adapter tests
- domain normalizer tests
- regression tests when official protocol payload shapes change

Rules:

- fixtures must be redacted
- avoid conversation body, file content, secrets, tokens, and private paths where possible
- raw fixtures are test data, not normal product state

### 23.9 Mock Mode

Decision:

- no built-in product mock mode

Rationale:

The product's main value is official Desktop/extension/Web synchronization. A mock product mode could hide broken official integration and encourage development against unrealistic behavior.

Testing fixtures and isolated component examples are still allowed, but normal app startup should detect and report official dependency status instead of pretending everything works.

### 23.10 Visual Acceptance

Decision:

- high-fidelity UI acceptance is primarily by human visual comparison
- Playwright screenshots are used for regression after a view is accepted

Reason:

Official Desktop is the source of truth, but exact pixel diff can be misleading because browser chrome, OS scaling, fonts, and runtime content vary. The first standard is whether the UI looks and behaves close enough by careful inspection.

### 23.11 Mobile Reference Size

Decision:

- use one mobile reference size for first-version acceptance

Reference viewport:

```text
390 x 844
```

This is a common modern phone-class viewport and keeps the first visual QA workflow simple. More sizes can be added later after the mobile interaction model stabilizes.

### 23.12 Desktop Reference Size

Decision:

- use a 1920 x 1080 desktop display as the primary manual reference environment
- do not require overly strict pixel equality because browser chrome affects available viewport size

Automated Playwright tests may use a stable content viewport, but final visual review should account for the browser frame and actual in-app layout.

### 23.13 Conservative Performance Targets

Initial conservative targets:

- app startup should reach a usable local Web page within a few seconds on the target Windows machine
- cached project/thread list should feel immediate for normal personal usage
- a list with roughly 1000 threads should remain scrollable without obvious jank
- opening a cached thread should usually show the first content within about 1 second
- opening an uncached/restored thread should show loading/progress rather than appearing frozen
- streaming updates should appear in Web quickly enough to feel live on LAN
- multiple Web clients should not noticeably degrade one active streaming thread

These targets are intentionally conservative. Exact numeric thresholds should be tightened after real measurements exist.

### 23.14 Official Client Safety Acceptance

This is a highest-priority acceptance category.

Any Web operation must avoid:

- duplicate turns
- wrong owner routing
- duplicated stream broadcasts
- thread forks
- stale follower state causing messages to disappear
- breaking official Desktop or VS Code extension state
- corrupting official persisted sessions

Required checks:

- send from Web while Desktop is open
- send from Web while VS Code extension is open
- send from Desktop while Web is open
- send from VS Code extension while Web is open
- stop/interrupt from Web on official-owned thread
- approval from Web on official-owned thread
- reopen Desktop after Web-owned activity

If official-client safety fails, visual completeness does not matter yet.

## 24. 功能范围决策

### 24.1 会话列表分组

决策：

- 第一版会话列表分组跟随官方 Desktop
- 不自定义新的分组模型

实现要求：

- 官方如何展示项目、会话、无项目会话，Web 就尽量如何展示
- 如果官方数据源只提供已排序/已分组结果，Web 优先尊重官方结果
- 如果 Web 必须自己投影列表，也要以官方行为为基准

### 24.2 会话标题重命名

决策：

- 第一版允许在 Web 中重命名会话

约束：

- 优先使用官方协议/官方 owner 处理 rename
- rename 后必须同步到 Desktop、VS Code 扩展和其他 Web 客户端
- 如果官方 rename 能力不可用，Web 不应创建只在 Web 可见的假标题，除非明确标记为本地覆盖

### 24.3 删除与归档会话

决策：

- 第一版支持删除/归档会话

安全要求：

- 必须走官方可验证路径或确认过的 app-server 路径
- 必须有确认交互
- 必须避免误删官方持久化数据
- 必须记录诊断事件
- 如果官方协议不明确，功能应进入受限/不可用状态，而不是通过猜测文件操作实现

删除和归档属于破坏性操作，验收优先级高于视觉一致性。

### 24.4 新建项目与添加项目

决策：

- 第一版支持新建/添加项目
- 尽量复刻官方 Desktop 行为
- 官方项目来源优先，Web 收藏项目作为补充

实现方向：

- 如果官方提供项目创建/添加协议，优先使用官方路径
- Web 收藏项目可通过设置页维护
- 对于手机访问场景，不能依赖浏览器本地目录选择器选择 Windows 主机路径；应支持手动输入路径或从服务端已知路径/最近路径中选择
- 对于桌面浏览器，可以在浏览器能力允许时提供更方便的选择体验

### 24.5 Web 收藏项目添加方式

决策：

- 按 Desktop 行为优先
- Web 侧补充手动路径和设置页维护能力

第一版推荐：

- Settings 中维护收藏项目路径
- 支持手动输入 Windows 路径
- 支持最近项目/官方项目转收藏
- 不强依赖复杂文件浏览器

### 24.6 Skills

决策：

- 第一版支持选择/切换 Skills
- Skills 安装/管理暂不作为第一版核心目标

要求：

- Skill 列表来源应跟随官方/本地可用状态
- 选择变化应参与发送请求
- 如果当前 thread/owner 不支持某个 Skill 状态，UI 应明确禁用或提示

### 24.7 模型选择

决策：

- 第一版允许 Web 切换模型并同步

要求：

- 模型列表跟随官方可用模型
- 模型选择应进入真实 turn 请求
- 切换后状态应同步到其他 Web 客户端，并尽量同步到 Desktop/扩展端
- 如果官方 owner 拒绝或覆盖模型选择，Web 必须显示最终实际状态

### 24.8 Reasoning Effort

决策：

- 第一版完全复刻 Reasoning Effort，可切换

要求：

- 展示方式跟随官方 Desktop
- 选项来源优先跟随官方
- 切换值应参与后续请求

### 24.9 Plan / Default 模式

决策：

- 第一版完全复刻 Plan / Default 模式，可切换

要求：

- UI 形态跟随官方 Desktop
- 模式值参与后续 turn
- 切换状态应在多 Web 客户端间同步

### 24.10 图片与附件上传

决策：

- 第一版支持按钮选择、粘贴和拖拽上传

要求：

- 上传后进入服务端持久附件仓库
- 附件与 thread/turn 关联
- 支持基本预览、移除和上传错误提示
- 尽量保证后续可在 Desktop/扩展/Web 复看

### 24.11 代码块与命令输出交互

决策：

- 第一版需要完整交互

最低要求：

- 复制按钮
- 折叠/展开
- 横向滚动
- 状态展示
- 长输出处理
- 与官方 Desktop 近似的命令块布局

这些交互是核心阅读体验，不应作为纯视觉细节延期。

### 24.12 文件变更与 Diff 展示

决策：

- 第一版优先实现简化 diff
- 后续推进到尽量复刻 Desktop diff/patch 展示

第一版最低要求：

- 文件名
- 文件状态
- 简化 diff
- 折叠/展开
- 复制相关内容

后续目标：

- 更接近官方 Desktop 的 diff/patch 视觉和交互
- 支持更复杂的变更块和多文件展示

### 24.13 Git 分支与状态

决策：

- 第一版显示 Git 分支/状态的只读信息
- 第一版不做分支切换等操作

原因：

Desktop 顶栏有项目/Git 状态感知。Web 第一版应展示这些上下文，避免用户缺少当前工作区状态判断。但主动 Git 操作可以后续再做。

### 24.14 搜索结果行为

决策：

- 搜索结果点击后直接打开 thread

第一版不做复杂结果页。搜索应保持轻量，服务于快速定位会话。

### 24.15 Settings 页签

决策：

- 第一版 Settings 不包含 About 页签

第一版页签：

- General
- Security
- Network
- Diagnostics
- Appearance

版本、兼容状态和诊断信息可以放在 Diagnostics 中，不单独设置 About。

## 25. 安全、清理与破坏性操作决策

### 25.1 会话归档优先

决策：

- 第一版做 Archive，不做 hard delete

要求：

- 如果官方存在 Archive/Trash/Restore 机制，Web 优先接入官方机制
- 不直接删除官方持久化文件
- 不通过猜测本地 session 文件结构实现删除

### 25.2 归档确认

决策：

- 使用二次确认，并显示会话标题

要求：

- 确认文案明确说明操作对象
- 如果操作不可恢复，必须明确提示
- 如果官方支持恢复，UI 可以说明可从官方恢复路径恢复

### 25.3 恢复能力

决策：

- 按官方来源支持恢复

要求：

- 如果官方协议/状态提供 restore 能力，Web 应支持恢复
- 如果官方仅提供归档但未暴露恢复，Web 不应伪造恢复能力
- 恢复后必须同步到 Desktop、VS Code 扩展和其他 Web 客户端

### 25.4 重命名冲突

决策：

- 官方最新状态优先

场景：

- Web 手动改标题
- Desktop/官方自动标题生成同时发生

处理：

- Web 提交 rename 后等待官方确认或后续 snapshot
- 如果官方返回/广播不同标题，Web 展示官方最终标题
- 诊断层记录冲突事件

### 25.5 项目路径校验

决策：

- 添加项目时必须校验路径

错误类型至少包括：

- 路径不存在
- 路径不是目录
- 权限不足
- 路径不可访问
- 路径格式错误

手机端允许手动输入 Windows 绝对路径，例如：

```text
C:\workspace\project-name
```

### 25.6 Trusted Device Expiry

决策：

- 记住设备默认有效期为 7 天

说明：

- 7 天适合局域网个人设备场景
- 如果后续启用公网/FRP 访问，应重新评估过期时间和二次认证策略

### 25.7 设备管理

决策：

- Security 页提供设备管理

至少展示：

- 设备/session 标识
- 最近访问时间
- 最近 IP
- 创建时间
- 过期时间

至少支持：

- 撤销单个设备/session
- 撤销全部其他设备/session

### 25.8 密码存储与重置

决策：

- 密码哈希后存储
- 不明文存储密码
- 提供命令行重置能力

推荐命令：

```text
codex-web auth reset
```

行为：

- 生成新随机密码
- 写入哈希
- 终端输出新密码
- 记录普通诊断事件
- 使旧 session 失效或提示用户是否失效

### 25.9 LAN HTTP

决策：

- 第一版使用 HTTP

约束：

- 明确提示仅适用于可信局域网
- 不把第一版复杂度投入到自签 HTTPS 证书和手机证书信任流程
- 后续公网/FRP 场景必须重新设计传输安全

### 25.10 CORS

决策：

- 默认只允许同源
- 不开放跨域 API

原因：

`codex_web` 控制本机资源和 Codex 执行能力。默认开放跨域会让局域网页面更容易滥用本机服务。

### 25.11 诊断包导出

决策：

- 第一版只提供普通诊断导出
- 普通诊断导出不包含敏感内容

不得包含：

- 会话正文
- 文件内容
- 附件二进制
- 密码
- token
- secret
- raw protocol frame

raw protocol logging 仍可作为开发者模式下的本地调试能力，但不进入第一版普通诊断包导出。

### 25.12 附件清理

决策：

- 第一版只清理未关联附件和临时失败上传
- 不清理已关联 thread/turn 的附件

原因：

已关联附件可能影响 Desktop、VS Code 扩展和 Web 的后续复看。默认清理它们风险过高。

### 25.13 Appearance

决策：

- Appearance 第一版只展示当前浅色主题状态
- 不放不可用的暗色主题开关

原因：

不可用开关会制造错误预期。第一版目标是浅色主题高保真。

## 26. 本机落地配置决策

### 26.1 项目存放位置

决策：

- 新项目目录：`C:\workspace\codex_web`
- 包名建议：`codex-web`
- 当前 `codex-mobile` 保留为研究、验证和参考项目，不继续改造成正式项目

说明：

- `codex_web` 应作为干净新项目独立创建
- 当前产品文档位于 `C:\workspace\codex-mobile\documentation\CODEX_WEB_REBUILD_PRODUCT_SPEC.md`
- 正式建项时，应把产品文档整理/迁移到 `C:\workspace\codex_web\docs\` 下

### 26.2 默认数据目录

决策：

- 默认数据目录：`C:\workspace\codex_web\data`
- 数据目录必须可配置

用途：

- SQLite 数据库
- 配置
- session/token metadata
- UI state
- 附件仓库
- 日志
- 协议兼容 metadata

### 26.3 默认端口

决策：

- 后端/生产访问端口：`18930`
- 前端 Vite 开发端口：`18931`
- 默认监听地址：`0.0.0.0`

访问形式：

```text
http://<电脑局域网IP>:18930
```

开发模式：

```text
backend: 0.0.0.0:18930
frontend dev: 0.0.0.0:18931
```

正式构建后：

- Fastify 在 `18930` 提供前端静态文件、HTTP API 和 WebSocket

端口检查结论：

- `18930` 当前空闲
- `18931` 当前空闲
- `18923` 曾被 `codex-mobile` 使用，不建议作为新项目默认端口
- `8081` 空闲，但不作为默认端口

### 26.4 配置文件建议

第一版可使用项目数据目录下的本地配置文件：

```text
data/config.local.json
```

示例：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 18930
  },
  "dev": {
    "frontendPort": 18931
  }
}
```

### 26.5 当前本机运行环境

已确认可用：

```text
Node.js v22.17.0
npm 11.4.2
pnpm 10.14.0
Git 2.53.0
Python 3.13.12
sqlite3 3.51.1
VS Code
Codex Desktop
VS Code Codex extension codex.exe
```

结论：

- 第一阶段不需要额外安装系统级运行环境
- 可以直接创建 `React + Vite + Fastify + Drizzle + SQLite + Playwright` 项目

后续可能需要：

- Playwright Chromium：项目安装后运行 `pnpm exec playwright install chromium`
- SQLite Node driver 相关编译工具：仅在 Windows 预编译包不可用或安装失败时再处理
- Windows 服务/托盘/安装器相关工具：仅在后续打包阶段需要

## 27. Owner / Follower 概念澄清

### 27.1 为什么产品里引入 Owner

说明：

- Desktop 和 VS Code 扩展 UI 不会把 owner 暴露给用户
- owner 是我们对官方内部 IPC 行为的工程抽象
- 这个抽象来自已验证的本地 IPC 帧、方法名、`sourceClientId` / `targetClientId`、`thread-follower-*` 请求和 discovery 行为

因此：

- owner 不是一个要展示给普通用户的产品概念
- owner 是后端同步层必须理解和处理的路由概念

### 27.2 官方实际表现

已观察到的官方同步机制：

- Desktop 和 VS Code 扩展连接同一个本地 IPC router：`\\.\pipe\codex-ipc`
- 客户端通过 `initialize` 注册并获得 `clientId`
- 正在负责某个 thread 的客户端会广播 `thread-stream-state-changed`
- 广播帧里有 `sourceClientId`
- 其他客户端通过 `thread-follower-*` 方法把 start、interrupt、steer、model/reasoning、collaboration mode 等操作转发给能处理该 thread 的客户端
- 如果请求没有指定 `targetClientId`，router 会走 `client-discovery-request` / `client-discovery-response`，让可处理该请求的客户端接手

我们把“广播该 thread 状态、能处理 follower 请求的客户端”称为 owner。

这不是官方公开 API 文档中的稳定概念，而是基于本机验证结果建立的内部协议模型。

### 27.3 为什么不能只用 app-server

已验证现象：

- Web 只调用自己的 app-server `turn/start` 时，消息会写入共享 session/持久化数据
- Desktop 关闭后重新打开可以看到这些消息
- 但 Desktop/扩展不会实时显示 Web 发出的流式过程

原因：

- app-server 负责执行、持久化、thread read/list 等能力
- 官方客户端之间的实时同步依赖本地 IPC stream，而不是只依赖 app-server 持久化文件

结论：

- 要做实时三端同步，Web 必须接入官方 IPC
- 对官方已拥有的 thread，Web 不能直接本地 `turn/start`
- Web 必须通过 `thread-follower-start-turn` 把请求交给 owner

### 27.4 当前 `codex-mobile` 实现的同步方式

当前验证项目实现了以下机制：

1. `OfficialIpcBridge` 连接 `\\.\pipe\codex-ipc`
2. 发送 `initialize`，拿到 Web 自己的 `clientId`
3. 监听官方 `thread-stream-state-changed` broadcast
4. 按 thread 缓存最新 `conversationState`
5. 处理 snapshot 和 patches
6. 前端读取 thread 详情时，优先读官方 IPC cache，再 fallback 到 app-server `thread/read`
7. Web 发送消息时，优先调用后端 follower endpoint
8. 后端通过 `thread-follower-start-turn` 发给已知 owner；未知 owner 时让 router discovery 选择
9. follower 成功后，Desktop/扩展/Web 都接收同一条官方 stream
10. 如果 IPC 不可用或没有 owner，才 fallback 到本地 app-server

Web-owned thread 的补充机制：

- Web 自己 app-server 执行 turn
- 后端读取 `thread/read`
- 通过 IPC 广播 `thread-stream-state-changed` snapshot
- 同时注册 `thread-follower-start-turn` 和 `thread-follower-interrupt-turn` handler，让官方客户端在接受 Web owner 时能反向请求 Web

### 27.5 新项目中的原则

产品层原则：

- 用户不需要知道 owner/follower
- 三端看起来应当是平等并行的

工程层原则：

- 必须保留 owner/follower 路由模型
- owner 决定谁真正执行 turn
- follower 决定谁转发动作并渲染 stream
- 不允许在 owner 已存在时另起本地 turn，避免分叉和重复 turn

## 28. Open Decisions

The following areas still need detailed decisions:

- exact official owner restore/wake mechanism
- Web new-thread behavior
- exact queue vs steer UI model
- final app-server process model
- exact state management libraries
- release and update model
- exact SQLite driver/binding
- exact Playwright screenshot baseline workflow
- diagnostic export format and redaction rules
- exact performance thresholds after measurement
