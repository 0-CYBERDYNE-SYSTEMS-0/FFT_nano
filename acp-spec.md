# ACP Integration Spec — fft_nano

> Status: DRAFT
> Branch: `feat/telegram-hermes-streaming` (to be moved to `feat/acp-gateway`)
> Restore point: `3e79d0e`

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

---

## 4. Protocol Mapping

### 4.1 ACP methods → fft_nano operations

| ACP Method | Direction | fft_nano mapping |
|---|---|---|
| `initialize` | Client→Agent | Return capabilities, protocol version, agent info |
| `session/new` | Client→Agent | Create session key `acp:<uuid>`, register in session map |
| `session/prompt` | Client→Agent | Route to `processMessage()` / `runDirectSessionTurn()` |
| `session/update` | Agent→Client | Project from `HostEventBus` (see §4.2) |
| `session/cancel` | Client→Agent | Call `abortChat()` adapter (same as TUI `chat.abort`) |
| `session/list` | Client→Agent | Return active ACP sessions |
| `session/load` | Client→Agent | Resume session from history (P1) |
| `session/delete` | Client→Agent | Remove session (P1) |
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
| `tool_progress` (status=`start`) | Tool call block (status: `running`) |
| `tool_progress` (status=`ok`) | Tool call update (status: `completed`, output) |
| `tool_progress` (status=`error`) | Tool call update (status: `error`) |
| `run_progress` (phase=`thinking`) | Thought/reasoning indicator |
| `run_progress` (phase=`spawn`) | Status notification |
| `run_progress` (phase=`completed`) | Final status |
| `run_progress` (phase=`failed`) | Error status |

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
    sessionKey: string;
    text: string;
    requestId: string;
  }) => Promise<void>;
  abortChat: (sessionKey: string) => { ok: boolean };
  getHistory: (sessionKey: string, limit: number) => Promise<AcpHistoryMessage[]>;
  resetSession: (sessionKey: string) => { ok: boolean };
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
  const acpAdapters = buildAcpGatewayAdapters(deps);
  acpGateway = startAcpGateway(acpAdapters, {
    stdio: config.acpStdio,
    port: config.acpPort,
    host: config.acpHost,
    eventBus: hostEventBus,
  });
}
```

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
branch: if the run's session key starts with `acp:`, route the permission
prompt through the ACP connection instead of the Telegram inline keyboard.

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
| Permission gate latency over ACP | ACP `session/request_permission` is async; editor shows non-blocking approval UI. |
| Kernel surface pressure | Design explicitly avoids new kernel primitives (§3.3). |
| Port conflicts with TUI (28989) / Web (28990) | ACP WS defaults to 28991. |
| Singleton lock contention (data/fft_nano.lock) | ACP stdio mode runs inside the existing host process, not a second instance. |

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
| `src/acp-stdio.ts` | Bin entry point for stdio mode |
| `tests/acp-event-projector.test.ts` | Unit tests for event projection |
| `tests/acp-gateway.test.ts` | Integration tests for gateway |

### Modified files

| File | Change |
|---|---|
| `src/wiring.ts` | Wire ACP gateway alongside TUI gateway |
| `src/app-config.ts` | Add ACP config env vars |
| `src/agent-runner.ts` | ACP-aware permission gate routing |
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
