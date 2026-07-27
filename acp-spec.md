# ACP Integration Spec — fft_nano

> Status: FINAL
> Branch: `feat/telegram-hermes-streaming` (to be moved to `feat/acp-gateway`)
> Restore point: `3e79d0e`
> Review pass: 2 (cross-referenced against codebase)

---

## 1. Background

"ACP" refers to two distinct protocols in the AI agent ecosystem. This spec
covers both and recommends a phased integration path for fft_nano.

### 1.1 Agent Client Protocol (primary target)

- **URL:** https://agentclientprotocol.com
- **Purpose:** Standardizes communication between code editors/IDEs and coding
  agents — analogous to what LSP did for language servers.
- **Transport:** JSON-RPC 2.0 over stdio (local subprocess) or HTTP/WebSocket
  (remote). v1 stable; v2 in draft.
- **SDK:** `@agentclientprotocol/sdk` v1.3.0 (TypeScript), Rust SDK at 1.0.
- **Ecosystem:** 35+ agents (Claude Code, Gemini CLI, Copilot, Cline, Cursor,
  OpenHands, **Pi via `pi-acp`**), 50+ clients (Zed, JetBrains, VS Code,
  neovim ×4, Emacs, Obsidian, Unity, mobile apps, Telegram/Discord/Slack
  bridges, CLI tools, orchestrators).
- **Governance:** Open, RFD process, working groups. Lead maintainers from
  Zed and the broader community.

### 1.2 Agent Communication Protocol (secondary / monitor only)

- **URL:** https://agentcommunicationprotocol.dev
- **Purpose:** REST-based agent-to-agent communication (IBM Research / BeeAI).
- **Status:** **Archived** Aug 2025. Merged into Google's A2A under the Linux
  Foundation. GitHub repo `i-am-bee/acp` is read-only.
- **Transport:** RESTful HTTP; sync, async (202), and SSE streaming.
- **Key endpoints:** `GET /agents`, `POST /runs`, `GET /runs/{id}`,
  `POST /runs/{id}/cancel`, `GET /runs/{id}/events`, sessions.
- **Recommendation:** Do not implement. If agent-to-agent interop is needed
  later, implement A2A (its successor) directly.

### 1.3 Existing pi-acp adapter

The npm package `pi-acp` (v0.0.32, MIT, by Sergii Kozak) adapts the `pi`
coding agent to the Agent Client Protocol. It is listed on the official ACP
agents page. Since fft_nano runs `pi` as its agent subprocess, this is a
direct dependency path.

---

## 2. Goals

| # | Goal | Priority |
|---|------|----------|
| G1 | Any ACP-compatible editor/client can drive fft_nano's agent | P0 |
| G2 | Full fft_nano pipeline: memory injection, skills, evaluator, permission gate | P0 |
| G3 | Streaming: real-time deltas, tool progress, plans via ACP notifications | P0 |
| G4 | Permission prompts surface in the editor's native approval UI | P1 |
| G5 | Session management: list, resume, delete sessions | P1 |
| G6 | Remote access via WebSocket transport | P2 |
| G7 | ACP Agent Registry listing | P2 |
| G8 | Agent Communication Protocol (IBM/A2A) support | P3 (monitor) |

### Non-goals

- Replacing Telegram/WhatsApp channels (ACP is additive)
- New kernel primitives (prompt layers, run origins, IPC envelope kinds)
- Breaking the frozen kernel surface (`src/kernel-surface.ts`)

---

## 3. Architecture

### 3.1 Current fft_nano communication topology

```
Telegram / WhatsApp
        │
        ▼
  message-dispatch-pipeline.ts  ──►  runAgent()  ──►  runContainerAgent()
        │                                │                    │
        │                                │              pi subprocess
        │                                │              (stdio NDJSON)
        ▼                                ▼
   HostEventBus  ◄────────────  host events (run_state,
        │                       tool_progress, run_progress)
        ├──► telegram-streaming.ts
        ├──► file-delivery.ts
        ├──► TUI gateway (WebSocket, port 28989)
        └──► Web control center (HTTP, port 28990)
```

### 3.2 Proposed addition

```
ACP Client (Zed / VS Code / neovim / Telegram ACP bot / mobile)
        │
        │  JSON-RPC 2.0 (stdio or WebSocket)
        ▼
┌─────────────────────────┐
│   src/acp/              │  NEW module
│   acp-gateway.ts        │  ACP server: initialize, session/*, prompt
│   acp-adapters.ts       │  AcpGatewayAdapters interface (injected)
│   acp-event-projector.ts│  HostEvent → ACP session/update notifications
│   acp-transport-stdio.ts│  stdio transport (phase 2)
│   acp-transport-ws.ts   │  WebSocket transport (phase 3)
└───────────┬─────────────┘
            │  AcpGatewayAdapters (injected from wiring.ts)
            ▼
   HostEventBus (subscribe)          processMessage / runDirectSessionTurn
   (run_state, tool_progress,   ◄──  (inbound: session/prompt → chat.send)
    run_progress)
```

### 3.3 Kernel compliance

The frozen kernel surface (`src/kernel-surface.ts:145`) forbids new prompt
layers, run origins, IPC envelope kinds, or payload types without explicit
review. This design complies:

- **No new run origins.** ACP sessions map to existing origins via
  `deriveRunOrigin()` — `interactive-main` for direct sessions, `headless`
  for programmatic/API access.
- **No new IPC kinds.** ACP is a transport adapter over existing `HostEvent`
  types (`run_state`, `tool_progress`, `run_progress`).
- **No new prompt layers.** System prompt assembly is unchanged.
- **Growth policy:** ACP is product surface (a gateway), not a kernel change.
  Same category as the TUI gateway and Web control center.

### 3.4 Session model — how ACP sessions map to fft_nano

**Critical:** fft_nano does not have a standalone "session" concept. Sessions
are identified by `chatJid` (Telegram JID, WhatsApp JID, or TUI session key).
The function `getSessionKeyForChat(chatJid)` (tui-coordination.ts:60) returns:

- `'main'` — for the main/admin chat (identified by `isMainChat()`)
- `chatJid` — for all other registered groups

**ACP session mapping:**

| ACP concept | fft_nano equivalent |
|---|---|
| `session/new` | Map to main chat (`chatJid = findMainChatJid()`), session key = `'main'` |
| `session/prompt` | Construct `NewMessage` with `chat_jid = mainChatJid`, route via `processMessage()` |
| `session/cancel` | Call `abortChat(mainChatJid)` (same as TUI `chat.abort`) |
| `session/list` | Return all registered groups as sessions (same as TUI `sessions.list`) |
| `session/load` | Resume main chat session (fft_nano does not persist per-ACP-session state) |
| `session/delete` | Reset main chat session (same as TUI `sessions.reset`) |

**Why not `acp:<uuid>` session keys?** fft_nano's run pipeline, permission
gate, memory injection, and evaluator all key off `chatJid`. Introducing a
parallel session namespace would require changes to `run-authority.ts`,
`agent-runner.ts`, `pi-runner.ts`, and the kernel surface. Mapping to the
existing main chat avoids all of this.

**Multi-user ACP:** If multiple ACP clients connect simultaneously, they all
share the main chat session. This is intentional — fft_nano is designed as a
single-user assistant. For true multi-user, each user needs their own fft_nano
instance (or a future multi-tenant mode).

### 3.5 Process model

fft_nano runs `pi` as a **native subprocess** (not Docker) via
`platformAdapter.spawnDetached()` (pi-runner.ts:1645). The ACP gateway runs
**inside the same Node.js process** as the host (same as TUI gateway and Web
control center). There is no separate ACP process.

```
┌─────────────────────────────────────┐
│  fft_nano host process (Node.js)    │
│  ┌─────────────────────────────┐    │
│  │  ACP gateway (stdio or WS)  │    │
│  │  TUI gateway (WS)           │    │
│  │  Web control center (HTTP)  │    │
│  │  Telegram bot               │    │
│  │  WhatsApp (baileys)         │    │
│  └─────────────────────────────┘    │
│              │                      │
│  ┌───────────▼───────────┐          │
│  │  HostEventBus         │          │
│  └───────────┬───────────┘          │
│              │                      │
│  ┌───────────▼───────────┐          │
│  │  pi subprocess        │          │
│  │  (native, spawnDetached)         │
│  └───────────────────────┘          │
└─────────────────────────────────────┘
```

### 3.6 Inbound message flow (ACP → agent)

1. ACP client sends `session/prompt` with user text
2. ACP gateway constructs `NewMessage`:
   ```typescript
   const msg: NewMessage = {
     id: requestId,
     chat_jid: mainChatJid,  // from findMainChatJid()
     sender: 'acp-client',
     sender_name: 'ACP Client',
     content: userText,
     timestamp: new Date().toISOString(),
   };
   ```
3. Route via `processMessage(msg)` (message-dispatch-pipeline.ts:1986)
4. Pipeline queues, dispatches to `runAgent()`, spawns `pi` subprocess
5. `pi` streams NDJSON events → host translates to `HostEvent`s
6. ACP gateway subscribes to `HostEventBus`, projects events to ACP notifications
7. ACP client receives `session/update` notifications in real-time

### 3.7 Outbound event flow (agent → ACP)

**Events that MUST be projected to ACP:**

| HostEvent | ACP notification | Priority |
|---|---|---|
| `run_state` (state=`delta`) | `session/update` message chunk | P0 |
| `run_state` (state=`message`) | `session/update` complete message | P0 |
| `run_state` (state=`final`) | End `session/prompt` with stop reason | P0 |
| `run_state` (state=`error`) | `session/update` error content | P0 |
| `run_state` (phase=`start`) | `session/update` status (run started) | P1 |
| `run_state` (phase=`end`) | `session/update` status (run completed) | P1 |
| `run_state` (phase=`error`) | `session/update` status (run failed) | P1 |
| `tool_progress` (status=`start`) | `session/update` tool call block | P0 |
| `tool_progress` (status=`ok`) | `session/update` tool call result | P0 |
| `tool_progress` (status=`error`) | `session/update` tool call error | P0 |
| `run_progress` (phase=`thinking`) | `session/update` thought indicator | P1 |
| `run_progress` (phase=`spawn`) | `session/update` status notification | P1 |
| `run_progress` (phase=`completed`) | `session/update` final status | P1 |
| `run_progress` (phase=`failed`) | `session/update` error status | P1 |

**Events that MUST NOT be projected to ACP:**

| HostEvent | Reason |
|---|---|
| `chat_delivery_requested` | ACP uses its own delivery mechanism; Telegram/WhatsApp only |
| `file_transfer` | ACP file operations use `fs/*` methods, not file transfer |
| `ipc_request` / `ipc_result` | Internal IPC; not user-facing |
| `host_error` (scope=ipc) | Internal errors; only scope=runtime errors are user-facing |

### 3.8 Evaluator loop interaction

The evaluator (`evaluator.ts`) runs a second `pi` pass after agent completion
to score output quality. This MUST NOT interfere with ACP streaming:

- Evaluator runs are tagged with `run_origin: 'evaluator'` (kernel-surface.ts:38)
- ACP event projector MUST filter out events where `runId` belongs to an
  evaluator run (check `run_origin` in `RunAuthority`)
- Evaluator verdicts are persisted to `evaluator_verdicts` table but never
  sent to users (boundary-ipc.ts:isInternalEvaluatorVerdictText)

### 3.9 Heartbeat and curator interaction

- Heartbeat service runs periodically regardless of ACP sessions; ACP clients
  do not see heartbeat events (they are `run_origin: 'maintenance'`)
- Idle curator runs only after `minIdleHours` of inactivity; ACP activity
  updates `state.lastInboundAt` (same as Telegram/WhatsApp), so ACP sessions
  correctly prevent idle curation

### 3.10 Permission gate interaction

The permission gate (`permission-gate-policy.ts`) blocks destructive bash
commands via `ExtensionUIRequest` prompts. For ACP sessions:

1. `pi` subprocess writes `extension_ui_request` to stdout
2. Host `onExtensionUIRequest` callback receives the request
3. If session is ACP (check `chatJid` or `runId` prefix), send
   `session/request_permission` to ACP client
4. ACP client (editor) shows native approval UI
5. User approves/denies → ACP response → host writes `extension_ui_response`
   to `pi` stdin
6. `pi` continues or aborts

**Timeout:** If no response within 60s, default to deny (same as Telegram).

---

## 4. Protocol Mapping

### 4.1 ACP methods → fft_nano operations

| ACP Method | Direction | fft_nano mapping |
|---|---|---|
| `initialize` | Client→Agent | Return capabilities, protocol version, agent info |
| `session/new` | Client→Agent | Resolve main chat via `findMainChatJid()`, return session key `'main'` |
| `session/prompt` | Client→Agent | Construct `NewMessage` with `chat_jid = mainChatJid`, call `processMessage()` |
| `session/update` | Agent→Client | Project from `HostEventBus` (see §4.2) |
| `session/cancel` | Client→Agent | Call `abortChat(mainChatJid)` (same as TUI `chat.abort`) |
| `session/list` | Client→Agent | Return all registered groups as sessions (via `buildTuiSessionList`) |
| `session/load` | Client→Agent | Resume main chat session (fft_nano sessions are persistent) |
| `session/delete` | Client→Agent | Reset main chat session (same as TUI `sessions.reset`) |
| `session/request_permission` | Agent→Client | Map from `ExtensionUIRequest` permission gate |
| `fs/read_text_file` | Agent→Client | Optional: delegate to client FS (P2) |
| `terminal/create` | Agent→Client | Optional: delegate to client terminal (P2) |

### 4.2 HostEvent → ACP notification projection

New function `projectEventToAcpNotification()` in `acp-event-projector.ts`,
modeled on `projectEventToGatewayFrame()` (host-events.ts:217):

| HostEvent | ACP session/update content |
|---|---|
| `run_state` (state=`delta`) | Message chunk (role: `assistant`, streaming text) |
| `run_state` (state=`message`) | Complete message block |
| `run_state` (state=`final`) | End-turn with stop reason |
| `run_state` (state=`error`) | Error content block |
| `run_state` (phase=`start`) | Status: "Run started" |
| `run_state` (phase=`end`) | Status: "Run completed" |
| `run_state` (phase=`error`) | Status: "Run failed" |
| `tool_progress` (status=`start`) | Tool call block (status: `running`) |
| `tool_progress` (status=`ok`) | Tool call update (status: `completed`, output) |
| `tool_progress` (status=`error`) | Tool call update (status: `error`) |
| `run_progress` (phase=`thinking`) | Thought/reasoning indicator |
| `run_progress` (phase=`spawn`) | Status notification |
| `run_progress` (phase=`completed`) | Final status |
| `run_progress` (phase=`failed`) | Error status |

**Filtering rules:**

- Only project events where `runId` matches an active ACP run (not evaluator,
  heartbeat, or maintenance runs — check `run_origin` in `RunAuthority`)
- Do NOT project `chat_delivery_requested`, `file_transfer`, `ipc_request`,
  or `ipc_result` events (internal or channel-specific)
- Do NOT project `host_error` events with `scope=ipc` (internal errors)

### 4.3 Capability negotiation (`initialize` response)

```json
{
  "protocolVersion": "1",
  "agentInfo": {
    "name": "fft_nano",
    "version": "<package.json version>"
  },
  "capabilities": {
    "loadSession": true,
    "sessionModes": ["chat"],
    "auth": { "logout": false }
  },
  "instructions": "FFT_nano agent — multi-channel AI assistant with memory, skills, and scheduled tasks."
}
```

---

## 5. Module Design

### 5.1 `src/acp/acp-gateway.ts`

The ACP server. Follows the TUI gateway pattern (gateway-server.ts):

```typescript
export interface AcpGatewayServer {
  port?: number;          // WebSocket mode
  stdio?: boolean;        // stdio mode (mutually exclusive)
  close: () => Promise<void>;
}

export interface AcpGatewayAdapters {
  // Mirrors TuiGatewayAdapters (gateway-server.ts:60)
  getStatus: () => { runtime: string; sessions: number; activeRuns: number };
  listSessions: () => AcpSessionSummary[];
  sendChat: (params: {
    chatJid: string;        // NOT sessionKey — use chatJid directly
    text: string;
    requestId: string;
  }) => Promise<void>;
  abortChat: (chatJid: string) => { ok: boolean };
  getHistory: (chatJid: string, limit: number) => Promise<AcpHistoryMessage[]>;
  resetSession: (chatJid: string) => { ok: boolean };
  // Additional adapters needed for ACP
  findMainChatJid: () => string | null;
  resolveChatJidForSessionKey: (sessionKey: string) => string | null;
  getSessionKeyForChat: (chatJid: string) => string;
  getGroupForChat: (chatJid: string) => RegisteredGroup | undefined;
}
```

JSON-RPC dispatch:

```typescript
function handleRequest(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case 'initialize':        return handleInitialize(params);
    case 'session/new':       return handleSessionNew(params);
    case 'session/prompt':    return handleSessionPrompt(params);
    case 'session/cancel':    return handleSessionCancel(params);
    case 'session/list':      return handleSessionList(params);
    case 'session/load':      return handleSessionLoad(params);
    case 'session/delete':    return handleSessionDelete(params);
    default:                  throw jsonRpcError(-32601, `Method not found: ${method}`);
  }
}
```

### 5.2 `src/acp/acp-event-projector.ts`

```typescript
export function projectEventToAcpNotification(
  event: HostEvent,
  sessionKey: string,
): AcpSessionUpdateNotification | null {
  // Filter: only project events matching this session
  // Map run_state/tool_progress/run_progress → ACP content blocks
  // Return null for irrelevant events
}
```

### 5.3 `src/acp/acp-transport-stdio.ts`

Stdio transport for local agent mode (most common ACP usage):

- Read newline-delimited JSON-RPC from stdin
- Write JSON-RPC responses/notifications to stdout
- Stderr for logging only (ACP convention)
- Entry point: `node dist/acp-stdio.js` (separate bin)

### 5.4 `src/acp/acp-transport-ws.ts`

WebSocket transport for remote access (phase 3):

- Listen on configurable port (default 28991)
- Token auth (same pattern as TUI gateway, gateway-server.ts:104)
- Each WS connection can multiplex sessions

### 5.5 Wiring (`src/wiring.ts`)

```typescript
// Alongside TUI gateway startup (~line 2073):
if (config.acpEnabled) {
  const acpAdapters = buildAcpGatewayAdapters({
    hostEventBus,
    findMainChatJid,
    resolveChatJidForSessionKey,
    getSessionKeyForChat,
    getGroupForChat: (chatJid) => state.registeredGroups[chatJid],
    // ... other deps
  });
  acpGateway = startAcpGateway(acpAdapters, {
    stdio: config.acpStdio,
    port: config.acpPort,
    host: config.acpHost,
    eventBus: hostEventBus,
  });
}
```

**Dependencies injected into `buildAcpGatewayAdapters`:**

- `hostEventBus` — for event subscription
- `findMainChatJid` — to resolve main chat identity
- `resolveChatJidForSessionKey` — to map session keys to chat JIDs
- `getSessionKeyForChat` — to map chat JIDs to session keys
- `getGroupForChat` — to check if a chat is registered
- `sendChat` — to route `session/prompt` to `processMessage()`
- `abortChat` — to handle `session/cancel`
- `getHistory` — to provide session history
- `resetSession` — to handle `session/delete`
- `activeChatRuns` — to check run status and abort runs

### 5.6 Configuration

New env vars (added to `src/app-config.ts`):

| Env var | Default | Description |
|---|---|---|
| `FFT_NANO_ACP_ENABLED` | `0` | Enable ACP gateway |
| `FFT_NANO_ACP_STDIO` | `1` | Use stdio transport (vs WebSocket) |
| `FFT_NANO_ACP_PORT` | `28991` | WebSocket port (when stdio=0) |
| `FFT_NANO_ACP_HOST` | `127.0.0.1` | Bind address |
| `FFT_NANO_ACP_TOKEN` | (generated) | Auth token for WS transport |

---

## 6. Permission Gate Integration

fft_nano's permission gate (`src/permission-gate-policy.ts`) blocks destructive
bash commands via `ExtensionUIRequest` prompts. In ACP, these map to
`session/request_permission` client calls:

```
pi subprocess → extension_ui_request → host permission gate
    → ACP session/request_permission → editor approval UI
    → user approves/denies → ACP response → host → pi continues
```

The `onExtensionUIRequest` callback (agent-runner.ts:89) gains an ACP-aware
branch: if the run's `chatJid` matches the main chat (ACP sessions always map
to main), route the permission prompt through the ACP connection instead of
the Telegram inline keyboard.

**Timeout:** If no response within 60s, default to deny (same as Telegram).

---

## 7. Phased Implementation Plan

### Phase 1: Spike — pi-acp verification

**Scope:** Verify `pi-acp` works with fft_nano's pi configuration.

- [ ] `npm install pi-acp` (dev dependency)
- [ ] Create a test script that spawns `pi-acp` with fft_nano's env
      (PI_API, PI_MODEL, ZAI_API_KEY, workspace path)
- [ ] Connect with an ACP client (Zed, or `npx @agentclientprotocol/inspector`)
- [ ] Verify: initialize, session/new, session/prompt, streaming, tool calls
- [ ] Document findings and any gaps

**Deliverable:** Working spike, decision on Phase 2 approach.

### Phase 2: ACP gateway (stdio transport)

**Scope:** Full fft_nano ACP gateway with stdio transport.

- [ ] Create `src/acp/` module (gateway, adapters, event projector)
- [ ] Implement `initialize`, `session/new`, `session/prompt`, `session/cancel`
- [ ] Implement `projectEventToAcpNotification()` for streaming
- [ ] Add `acp-stdio.ts` entry point (separate bin in package.json)
- [ ] Wire adapters in `wiring.ts` with `buildAcpGatewayAdapters()`
- [ ] Add config env vars to `app-config.ts`
- [ ] Map permission gate to `session/request_permission`
- [ ] Tests: unit tests for event projector, integration test for session flow
- [ ] Verify with Zed / ACP Inspector / neovim CodeCompanion

**Deliverable:** `node dist/acp-stdio.js` works as an ACP agent with full
fft_nano pipeline.

### Phase 3: WebSocket transport + session management

**Scope:** Remote access and session lifecycle.

- [ ] Add `acp-transport-ws.ts` (WebSocket server, token auth)
- [ ] Implement `session/list`, `session/load`, `session/delete`
- [ ] Session persistence (SQLite or file-backed)
- [ ] Multi-session support (concurrent sessions per connection)
- [ ] Wire in `wiring.ts` alongside TUI gateway
- [ ] Tests: WS transport, concurrent sessions, auth rejection

**Deliverable:** Remote ACP access on port 28991 with session management.

### Phase 4: Ecosystem + polish

**Scope:** Registry, advanced features, documentation.

- [ ] Register fft_nano in the ACP Agent Registry
- [ ] Add `scripts/start.sh acp` convenience command
- [ ] Document in AGENTS.md and README
- [ ] Optional: `fs/read_text_file`, `terminal/create` client capabilities
- [ ] Optional: ACP v2 migration when stabilized
- [ ] Monitor A2A (successor to IBM ACP) for agent-to-agent interop needs

**Deliverable:** Production-ready ACP integration with ecosystem presence.

---

## 8. Risk Assessment

| Risk | Mitigation |
|---|---|
| ACP v2 introduces breaking changes | v2 is in draft; v1 is stable. SDK abstracts wire format. |
| `pi-acp` adapter diverges from fft_nano's pi usage | Phase 1 spike validates compatibility before committing to Phase 2. |
| Permission gate latency over ACP | ACP `session/request_permission` is async; editor shows non-blocking approval UI. Timeout after 60s defaults to deny. |
| Kernel surface pressure | Design explicitly avoids new kernel primitives (§3.3). |
| Port conflicts with TUI (28989) / Web (28990) | ACP WS defaults to 28991. |
| Singleton lock contention (data/fft_nano.lock) | ACP gateway runs inside the existing host process, not a second instance. |
| Session model mismatch | ACP sessions map to existing main chat identity, not new session namespace (§3.4). |
| Evaluator loop interference | Event projector filters by `run_origin` to exclude evaluator runs (§3.8). |
| Heartbeat/curator interaction | ACP activity updates `state.lastInboundAt`, preventing idle curation (§3.9). |
| Multi-user ACP concurrency | Single-user design: all ACP clients share main chat session (§3.4). |
| `processMessage` queue blocking | ACP sessions use same queue as Telegram; no bypass needed (§3.6). |
| `runDirectSessionTurn` vs `processMessage` | Use `processMessage` for ACP (queued, async); `runDirectSessionTurn` is for synchronous TUI turns only (§3.6). |

---

## 9. Files to Create / Modify

### New files

| File | Purpose |
|---|---|
| `src/acp/acp-gateway.ts` | ACP JSON-RPC server + method dispatch |
| `src/acp/acp-adapters.ts` | `AcpGatewayAdapters` interface |
| `src/acp/acp-event-projector.ts` | HostEvent → ACP notification mapping |
| `src/acp/acp-transport-stdio.ts` | Stdio transport entry point |
| `src/acp/acp-transport-ws.ts` | WebSocket transport (phase 3) |
| `src/acp/acp-types.ts` | ACP protocol type definitions |
| `src/acp/acp-session-map.ts` | ACP session → chatJid mapping |
| `src/acp-stdio.ts` | Bin entry point for stdio mode |
| `tests/acp-event-projector.test.ts` | Unit tests for event projection |
| `tests/acp-gateway.test.ts` | Integration tests for gateway |
| `tests/acp-session-map.test.ts` | Unit tests for session mapping |

### Modified files

| File | Change |
|---|---|
| `src/wiring.ts` | Wire ACP gateway alongside TUI gateway |
| `src/app-config.ts` | Add ACP config env vars |
| `src/agent-runner.ts` | ACP-aware permission gate routing |
| `src/pi-runner.ts` | Pass ACP session flag to `onExtensionUIRequest` |
| `package.json` | Add `@agentclientprotocol/sdk` dep, `acp-stdio` bin |
| `AGENTS.md` | Document ACP usage |
| `scripts/start.sh` | Add `acp` command |

---

## 10. References

- Agent Client Protocol spec: https://agentclientprotocol.com/protocol/v1/overview
- Agent Client Protocol v2 draft: https://agentclientprotocol.com/protocol/v2/overview
- TypeScript SDK: https://npm.im/@agentclientprotocol/sdk
- pi-acp adapter: https://github.com/svkozak/pi-acp
- ACP Agent Registry: https://agentclientprotocol.com/get-started/registry
- ACP clients list: https://agentclientprotocol.com/get-started/clients
- IBM ACP (archived): https://agentcommunicationprotocol.dev
- fft_nano kernel surface: `src/kernel-surface.ts`
- TUI gateway (template): `src/tui/gateway-server.ts`
- Host event bus: `src/runtime/host-events.ts`
- Event projection (template): `projectEventToGatewayFrame()` in host-events.ts:217
