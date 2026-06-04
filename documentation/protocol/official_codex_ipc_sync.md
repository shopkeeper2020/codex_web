# Official Codex IPC Sync Blueprint

This document records the verified mechanism used to make a third-party Web client participate in the same live thread stream as official Codex Desktop and the official VS Code Codex extension.

Status: verified locally on Windows on 2026-05-29; patch-without-snapshot reconnect recovery verified on 2026-05-30. This is an internal, unsupported protocol. Treat every official Codex app update as a compatibility risk.

## Goal

Build a Web client that can run in parallel with:

- official Codex Desktop
- official VS Code Codex extension
- a browser/mobile Web UI

The important property is live three-way behavior: a turn started from the Web UI should be handled by the same official owner client when an official client owns the thread, and official stream updates should be visible in the Web UI without waiting for Desktop/VS Code restart.

## Key Finding

The official Desktop and VS Code extension do not rely only on the Codex app-server HTTP/JSON-RPC protocol for live cross-client synchronization.

They also use a local IPC router:

```text
\\.\pipe\codex-ipc
```

The Codex app-server still matters for persistence, model execution, auth, thread list/read APIs, and local fallback. But live official-client sync is carried by the IPC bus.

If a third-party client only starts its own app-server and calls `turn/start`, the message is written to the shared session store and can appear after official clients reload. It does not become a live official stream. To get live sync, the third-party client must join the IPC bus and use the owner/follower protocol.

## Protocol Shape

Transport:

- Windows named pipe: `\\.\pipe\codex-ipc`
- Frame format: 4-byte little-endian payload length, followed by a UTF-8 JSON payload.
- Payloads are plain JSON objects.

Observed frame types:

```text
request
response
broadcast
client-discovery-request
client-discovery-response
```

A client starts by sending `initialize`:

```json
{
  "type": "request",
  "requestId": "uuid",
  "method": "initialize",
  "version": 0,
  "params": {
    "clientType": "codex-web-local"
  }
}
```

The router returns a client id:

```json
{
  "type": "response",
  "requestId": "uuid",
  "resultType": "success",
  "method": "initialize",
  "result": {
    "clientId": "uuid"
  }
}
```

## Method Versions

Observed method versions used by official clients:

```ts
{
  "thread-stream-state-changed": 6,
  "thread-read-state-changed": 1,
  "thread-follower-start-turn": 1,
  "thread-follower-compact-thread": 1,
  "thread-follower-steer-turn": 1,
  "thread-follower-interrupt-turn": 1,
  "thread-follower-set-model-and-reasoning": 1,
  "thread-follower-set-collaboration-mode": 1,
  "thread-follower-edit-last-user-turn": 1,
  "initialize": 0
}
```

When implementing a new project, keep this map explicit and centralized. If official clients bump versions, discovery can fail even when the pipe connection works.

## Follower Method Capability Matrix

As of the local 2026-05-29 investigation, Desktop and the VS Code extension both use the same general internal path:

```text
thread-follower-* IPC request
  -> renderer/webview request handler
  -> thread-follower-*-for-host command
  -> owner-side AppServerManager behavior
```

Do not assume every follower method is a one-hop app-server JSON-RPC call. The current Web adapter exposes a machine-readable version of this matrix at `/api/protocol/compatibility` under `adapter.followerMethodCapabilities`.

| Method                                    | Web handler | Official host command found | Owner behavior                                      | App-server mapping               | Support level | Current policy                                                            |
| ----------------------------------------- | ----------- | --------------------------- | --------------------------------------------------- | -------------------------------- | ------------- | ------------------------------------------------------------------------- |
| `thread-follower-start-turn`              | Yes         | Yes                         | Start a turn on the owner                           | `turn/start`                     | `implemented` | Required for realtime Web sends and Web-owned handoff behavior.           |
| `thread-follower-steer-turn`              | Yes         | Yes                         | Steer the active owner turn with `expectedTurnId`   | `turn/steer`                     | `implemented` | Required for guiding active turns without duplicate turns.                |
| `thread-follower-interrupt-turn`          | Yes         | Yes                         | Interrupt the owner active turn                     | `turn/interrupt`                 | `implemented` | Required for stopping the same active turn across clients.                |
| `thread-follower-compact-thread`          | Yes         | Yes                         | Start compaction on the owner                       | `thread/compact/start`           | `implemented` | Implemented only for Web-owned conversations and guarded by owner checks. |
| `thread-follower-set-model-and-reasoning` | Yes         | Yes                         | Update owner local latest model/reasoning state     | Owner-state, not app-server RPC  | `implemented` | Implemented as Web-owned runtime state consumed by later follower starts. |
| `thread-follower-set-collaboration-mode`  | Yes         | Yes                         | Update owner local latest collaboration mode state  | Owner-state, not app-server RPC  | `implemented` | Implemented as Web-owned runtime state consumed by later follower starts. |
| `thread-follower-edit-last-user-turn`     | Yes         | Yes                         | Roll back the last turn and start a replacement one | `thread/rollback` + `turn/start` | `implemented` | Guarded to the latest completed turn; rollback still does not restore local file changes. |

Important consequences:

- Missing optional follower handlers should be diagnosed as capability gaps, not as proof that base realtime sync is broken.
- `start` / `steer` / `interrupt` are the required first-version realtime set.
- `compact` is implemented for Web-owned conversations because the official owner mapping is direct. It is still a thread-mutating operation, so public UI should keep an explicit confirmation path if exposed later.
- `set-model-and-reasoning` and `set-collaboration-mode` are owner-state updates in official clients. The Web implementation stores equivalent Web-owned runtime state and applies it to later follower `turn/start` requests when those params are omitted.
- `edit-last-user-turn` is implemented through the official owner-aware path. External-owned threads receive `conversationId + turnId + message` via `thread-follower-edit-last-user-turn`; Web-owned threads reconstruct replacement params from the original turn, then call `thread/rollback` and `turn/start`.

## Owner/Follower Model

Each live thread has an owner. The owner is the client that can actually handle turn operations for that thread.

Owner responsibilities:

- execute `turn/start`, interrupt, steer, compact, etc.
- broadcast live `thread-stream-state-changed` updates
- respond to follower requests for owned conversations

Follower responsibilities:

- listen to owner broadcasts
- render the owner's stream state
- forward user actions to the owner via `thread-follower-*`

This is the central rule:

> If an official client owns a thread, the Web client must not call its own app-server `turn/start` for that thread. It must send `thread-follower-start-turn` over official IPC.

Owner handoff guard:

- A Web client can temporarily become owner when it starts/continues a thread through its own local app-server fallback.
- While Web owns that thread, it broadcasts `thread-stream-state-changed` snapshots so Desktop/VS Code can follow.
- If Desktop or VS Code later broadcasts a snapshot or patch for the same `conversationId`, the Web client must release its local owned marker immediately.
- Current implementation deletes the conversation from `ownedConversationIds` when an external `sourceClientId` or owner appears, and records the event in `/api/official-ipc/status.recentOwnershipHandoffs`.
- This prevents Web from later rejecting follower requests as `no-official-owner` or silently falling back to its own app-server after the official side has resumed ownership.

## Stream State Broadcast

Owners broadcast stream state with:

```json
{
  "type": "broadcast",
  "method": "thread-stream-state-changed",
  "version": 6,
  "sourceClientId": "owner-client-id",
  "params": {
    "hostId": "local",
    "conversationId": "thread-id",
    "change": {
      "type": "snapshot",
      "conversationState": {}
    }
  }
}
```

Live updates can also arrive as patches:

```json
{
  "type": "broadcast",
  "method": "thread-stream-state-changed",
  "version": 6,
  "sourceClientId": "owner-client-id",
  "params": {
    "hostId": "local",
    "conversationId": "thread-id",
    "change": {
      "type": "patches",
      "patches": []
    }
  }
}
```

The implementation should cache the latest full `conversationState` per `conversationId`. For a snapshot, replace the cache. For patches, apply them to the cached state and emit a lightweight app notification so the browser refreshes the affected thread.

The patch format observed here is Immer-style enough for the current implementation: each patch has `op`, `path`, and optional `value`. Support at least `add`, `replace`, and `remove` on object and array paths.

If patches arrive before any snapshot for that `conversationId`, do not fail silently. Current implementation records `official-ipc-patches-without-snapshot:<conversationId>` as the last IPC error and emits a lightweight `patches-without-snapshot` notification. The server reacts to that notification by reading the current thread through app-server `thread/read` and hydrating the official stream cache with that snapshot as a read-only baseline. This hydration must not broadcast back to official clients and must not mark the Web client as owner. Once the baseline exists, later owner patches can be applied normally; after successful hydration or a later successful snapshot/patch, the stale `patches-without-snapshot` error is cleared.

## Follower Start Turn

When the Web client sends a message into an official-owned thread:

```json
{
  "type": "request",
  "requestId": "uuid",
  "sourceClientId": "web-client-id",
  "targetClientId": "owner-client-id",
  "method": "thread-follower-start-turn",
  "version": 1,
  "params": {
    "conversationId": "thread-id",
    "turnStartParams": {
      "threadId": "thread-id",
      "input": [{ "type": "text", "text": "hello" }],
      "attachments": [],
      "model": "gpt-5.5",
      "effort": "medium"
    }
  }
}
```

Default mode should omit `collaborationMode` entirely. Plan mode should send:

```json
{
  "collaborationMode": {
    "mode": "plan",
    "settings": {
      "model": "gpt-5.5",
      "reasoning_effort": "medium",
      "developer_instructions": null
    }
  }
}
```

The model, reasoning effort, and collaboration mode list should come from the app-server methods `model/list` and `collaborationMode/list`. The app-server `initialize` request must include `capabilities.experimentalApi: true` before using these runtime option APIs and `turn/start.collaborationMode`.

If `targetClientId` is known from a previous `thread-stream-state-changed` snapshot, send directly to it.

If it is not known, omit `targetClientId`. The official IPC router sends `client-discovery-request` to connected clients and forwards the request to the first client that says it can handle that method and conversation.

Cached owner ids can become stale when Desktop or the VS Code extension restarts. The current bridge therefore does one guarded retry for `start` / `steer` / `interrupt`: first send to the cached `targetClientId`; if that directed request fails with a routing-shaped error such as generic `official-ipc-request-failed:<method>`, `no-client*`, target-client errors, timeout, or disconnect, retry once without `targetClientId` so router discovery can choose the current owner. Do not retry on a clear owner-side business error, because that means the owner handled the request and rejected it.

Treat `no-client-found`, `no-official-owner`, IPC-not-connected errors, and generic `official-ipc-request-failed:thread-follower-*` errors as recoverable owner/routing classes, but do not blindly fallback to the Web app-server:

- If the conversation is currently Web-owned, local fallback is allowed.
- If the conversation already has official stream state and the official owner cannot be reached, return `official-owner-unavailable` with 409/503 and surface diagnostics instead of starting a local turn.
- If there is no official stream state and the action is a new `start`, cold local fallback is allowed.
- `steer` and `interrupt` should not fallback for an unknown official owner because they require a specific active turn.

Do not silently fallback after an owner accepted the request and returned a real execution error; that can create duplicate turns.

## Follower Steer Turn

When a turn is already active, Web can send guidance to the current owner instead of starting a new queued turn.

The app-server method is:

```text
turn/steer
```

Its stable params are:

```json
{
  "threadId": "thread-id",
  "expectedTurnId": "active-turn-id",
  "input": [
    {
      "type": "text",
      "text": "please focus on the failing test",
      "text_elements": []
    }
  ]
}
```

The official IPC follower method is:

```text
thread-follower-steer-turn
```

Current Web bridge sends:

```json
{
  "type": "request",
  "method": "thread-follower-steer-turn",
  "version": 1,
  "params": {
    "conversationId": "thread-id",
    "turnSteerParams": {
      "threadId": "thread-id",
      "expectedTurnId": "active-turn-id",
      "input": [
        {
          "type": "text",
          "text": "please focus on the failing test",
          "text_elements": []
        }
      ]
    }
  }
}
```

The `expectedTurnId` precondition matters. It prevents a stale Web UI from steering a different active turn after the owner has already completed or moved on. Active turn id extraction should accept at least `turnId`, `turn_id`, and `id`, and should treat both `active` and `inProgress` status shapes as active.

## Recommended New-Project Architecture

Use a backend bridge. Do not try to connect the browser directly to the named pipe.

```text
Browser UI
  |
  | HTTP / WebSocket / SSE
  v
Web backend
  |                         |
  | JSON-RPC                | framed JSON IPC
  v                         v
own Codex app-server        \\.\pipe\codex-ipc
                            |
                            v
                 Desktop / VS Code official clients
```

Minimum backend modules:

- `OfficialIpcBridge`
  - connect/reconnect to `\\.\pipe\codex-ipc`
  - frame encode/decode
  - initialize and store `clientId`
  - send request/response/broadcast frames
  - maintain pending request promises and timeouts
  - cache `conversationState` by thread id
  - expose status and recent follower request diagnostics

- `AppServerBridge`
  - own app-server JSON-RPC fallback
  - thread list/read fallback
  - local turn execution for Web-owned threads
  - notification stream to browser

- `SyncCoordinator`
  - listens to official IPC stream-state changes
  - merges official IPC notifications into browser notification stream
  - decides when to use follower requests vs local app-server
  - broadcasts Web-owned thread snapshots when needed

Minimum frontend modules:

- API gateway
  - `getThreadDetail(threadId)` should first check official IPC stream cache, then fallback to app-server `thread/read`.
  - `startThreadTurn(threadId, params)` should first try `thread-follower-start-turn`, then fallback only on owner-not-found/IPC-unavailable.
  - `interruptThreadTurn(threadId, turnId)` should first try `thread-follower-interrupt-turn`.

- State store
  - subscribe to backend WebSocket/SSE notifications.
  - handle synthetic `official/thread-stream-state-changed`.
  - force-refresh the affected active thread; do not reuse a short-lived local message cache after an official stream event.

## Implemented Files In This Project

Use these as concrete references:

- `src/server/officialIpcBridge.ts`
  - official IPC transport, frame parser, request routing, stream cache, follower requests.
- `src/server/codexAppServerBridge.ts`
  - HTTP routes for status/cache/follower endpoints; merges official IPC notifications into the existing notification stream; syncs publishable Web-owned snapshots.
- `src/api/codexGateway.ts`
  - frontend API gateway: official cache read, follower start/interrupt, fallback behavior.
- `src/composables/useDesktopState.ts`
  - Vue state refresh wiring for official stream notifications.
- `src/server/officialIpcBridge.test.ts`
  - regression tests for patch application and id extraction.
- `tests/chat-composer-rendering/official-codex-ipc-desktop-extension-web-sync.md`
  - manual test checklist.

## API Surface Used By The Browser

Expose backend routes like these:

```text
GET  /codex-api/official-ipc/status
GET  /codex-api/official-thread-stream-state?threadId=<id>
POST /codex-api/official-ipc/thread-follower-start-turn
POST /codex-api/official-ipc/thread-follower-interrupt-turn
```

`/official-ipc/status` should include:

```json
{
  "supported": true,
  "connected": true,
  "clientId": "web-ipc-client-id",
  "pipePath": "\\\\.\\pipe\\codex-ipc",
  "cachedConversationCount": 2,
  "ownedConversationCount": 0,
  "recentFollowerRequests": [
    {
      "atIso": "2026-05-29T00:00:00.000Z",
      "method": "thread-follower-start-turn",
      "threadId": "thread-id",
      "targetClientId": "owner-client-id",
      "usedDiscovery": false,
      "result": "success",
      "handledByClientId": "owner-client-id"
    }
  ],
  "lastError": null
}
```

The `recentFollowerRequests` field is important. It turns UI-level sync failures into concrete routing facts:

- no record: frontend did not call the follower endpoint, or it used stale bundled JS.
- pending then timeout: IPC request was sent but no owner handled it.
- error `no-client-found`: router discovery could not find an owner.
- success with `handledByClientId`: official owner accepted the follower request.

## Web-Owned Threads

Official-owned threads are the high-confidence path. Web-owned threads need extra work because the Web bridge becomes the owner.

For Web-owned threads:

1. Run the turn through the Web project's own app-server.
2. Read/merge the thread state from app-server.
3. Broadcast a `thread-stream-state-changed` snapshot with `sourceClientId` set to the Web bridge's IPC client id.
4. Register handlers for official clients that send follower requests back to the Web owner:
   - `thread-follower-start-turn`
   - `thread-follower-interrupt-turn`
   - optionally steer/compact/model/collaboration/edit-last-user-turn

This project currently broadcasts debounced snapshots and handles start/interrupt. Official clients accepting third-party owners should be treated as a separate compatibility surface from Web-following-official-owner.

## Cache And Refresh Rules

Do not treat app-server `thread/read` as the only source of truth during active official streams.

Recommended rules:

- Official snapshot present for `threadId`: normalize it and render it.
- Official patch received: apply patch to cached snapshot, then notify browser.
- Browser receives `official/thread-stream-state-changed`: force-refresh active thread even if the previous message load was recent.
- No official cache: fallback to app-server `thread/read`.
- No official owner on send: use router discovery once; only fallback to local app-server when the thread is confirmed Web-owned or in an explicitly allowed cold-start path. Do not silently start a local turn for an official-known thread whose owner is unavailable.

This prevents the common failure where the Web UI has the right backend data but the frontend reuses a two-second-old message cache.

## Debugging Checklist

1. Verify the right process is running.

```powershell
Get-NetTCPConnection -LocalPort 18923 -State Listen
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*dist-cli/index.js*' }
```

2. Verify official IPC connection.

```text
GET http://127.0.0.1:18923/codex-api/official-ipc/status
```

Expected:

```json
{
  "connected": true,
  "pipePath": "\\\\.\\pipe\\codex-ipc"
}
```

3. Verify the target thread has official stream cache.

```text
GET /codex-api/official-thread-stream-state?threadId=<thread-id>
```

Expected:

- `ownerClientId` is non-null for official-owned thread.
- `conversationState.turns` contains the current turn.
- `source` often identifies the owner family, for example `vscode`.

4. Verify send path after Web submit.

Check `recentFollowerRequests` in `/official-ipc/status`.

If this list does not change after a Web send, the browser is likely using stale frontend assets or the frontend did not call the follower route.

5. Force-refresh the browser after rebuild.

Use `Ctrl + F5`. The backend can be correct while the browser still runs an old JS bundle.

## Common Failure Modes

### Web message appears after Desktop restart but not live

The Web client probably used its own app-server `turn/start`. The message was persisted to disk but did not join the official live stream.

Fix: route official-owned thread sends through `thread-follower-start-turn`.

### `/official-ipc/status` returns HTML

The request is hitting an old server that does not expose the new API, and the SPA fallback is returning `index.html`.

Fix: restart the correct port from the latest build.

### Official snapshot exists but Web UI does not update

The backend cache is right, but frontend caching or notification wiring is stale.

Fix:

- handle `official/thread-stream-state-changed`
- force-refresh active thread
- disable recent-message-cache reuse for official dirty events
- `Ctrl + F5` after rebuilding frontend

### Follower request returns no owner

The official owner may not have the thread open/resumed, or the method version/predicate does not match.

Fix:

- open the target thread in Desktop or VS Code
- retry with no `targetClientId` to let router discovery choose
- log discovery/follower result

## Security And Exposure

This bridge should be local-user facing. Do not expose it as a public internet service.

Risks:

- It can forward turn operations into official Codex clients.
- It can read local thread state snapshots.
- It can indirectly trigger tools through the official owner.

If remote/mobile access is needed, put it behind a trusted private network, authenticated reverse proxy, or device-level tunnel. Do not publish the raw bridge unauthenticated.

## Performance Notes

The bridge should avoid polling the official IPC bus. Use event-driven broadcasts.

Recommended limits:

- Keep only latest `conversationState` per conversation.
- Apply patches in memory.
- Persist the latest official stream state locally before serving a LAN/mobile UI. A Web server restart during an active Desktop turn may otherwise lose the only full snapshot and receive only later patches or stale `notLoaded` snapshots.
- Do not allow a stale non-active snapshot to overwrite a known active state unless it clearly comes from the current owner completing the turn.
- Emit lightweight browser notifications; fetch full cached state only when needed.
- Debounce publishable Web-owned snapshot broadcasts. This project uses a 650 ms debounce for local owner snapshots, while local-only Web owners skip official stream broadcasts.
- Keep one in-flight snapshot read per thread to avoid fanout during streaming deltas.
- Keep bounded diagnostics such as the last 10-20 follower requests.

## Minimal Implementation Order For A New Project

1. Implement framed JSON pipe transport.
2. Send `initialize` and store `clientId`.
3. Listen for `thread-stream-state-changed` snapshots.
4. Expose a status route and a thread stream cache route.
5. Normalize official `conversationState` into the UI message model.
6. Handle patch updates and emit browser notifications.
7. Implement `thread-follower-start-turn` for official-owned threads.
8. Add diagnostics for recent follower requests.
9. Implement interrupt forwarding.
10. Add Web-owned snapshot broadcasting only after official-owned following works, and keep newly created Web-only threads local-only until their official stream shape is known safe for Desktop/VS Code.

Do not start with Web-owned three-way behavior. First prove that Web can follow and send into an official-owned Desktop/VS Code thread. That path has the clearest owner semantics and was the first verified success in this project.

## Verification Commands Used Here

```powershell
pnpm exec vitest run src/server/officialIpcBridge.test.ts src/commandResolution.test.ts src/composables/useDesktopState.test.ts
pnpm run build
```

Runtime sanity check:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18923/codex-api/official-ipc/status | ConvertTo-Json -Depth 8
```

Successful Web send should add a `recentFollowerRequests` entry with:

```json
{
  "method": "thread-follower-start-turn",
  "result": "success",
  "handledByClientId": "owner-client-id"
}
```
