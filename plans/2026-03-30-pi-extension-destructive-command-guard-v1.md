# Pi Extension: Destructive Command Guard

## Objective

Implement a real-time, blocking destructive command guard using pi's native extension system. The guard intercepts `tool_call` events **before** tool execution, blocks destructive commands, and presents a confirmation dialog to the user via pi's RPC extension UI protocol. This replaces the current log-only audit in `bash-guard.ts` with actual enforcement.

## Background

**Current state**: `src/bash-guard.ts` detects 16 destructive command patterns via regex. When matched, it logs a `logger.warn()` at `src/pi-runner.ts:894-907`. The command **executes normally** -- nothing is blocked. The only "safety" is a system prompt instruction at `src/system-prompt.ts:552-564` that tells the LLM to ask before running destructive commands. This is advisory only.

**Why pi extensions**: Pi's extension system fires `tool_call` events **before** tool execution. An extension can return `{ block: true, reason: "..." }` to prevent the tool from running. Pi's RPC mode supports `extension_ui_request`/`extension_ui_response` protocol for interactive confirmation dialogs. This is the correct enforcement layer -- inside pi's process, before execution, with native UI support.

**Pi extension auto-discovery paths**:
- `~/.pi/agent/extensions/*.ts` -- global (all pi sessions)
- `~/.pi/agent/extensions/*/index.ts` -- global (subdirectory)
- `.pi/extensions/*.ts` -- project-local
- `.pi/extensions/*/index.ts` -- project-local (subdirectory)
- `--extension <path>` flag -- explicit load

FFT Nano's pi home directory is `data/pi/<group>/.pi/` (`src/pi-runner.ts:278`). The extension needs to be placed at `data/pi/<group>/.pi/agent/extensions/` for auto-discovery, OR passed via `--extension` flag.

**Critical constraint**: FFT Nano currently spawns pi with `stdio: ['ignore', 'pipe', 'pipe']` (`src/pi-runner.ts:809`) -- stdin is **ignored**. Pi's RPC extension UI protocol requires stdin for `extension_ui_response` messages. To enable interactive confirmation dialogs, stdin must be changed to `'pipe'` and the host must handle `extension_ui_request` events from stdout and write `extension_ui_response` messages to stdin.

## Implementation Plan

### Phase 1: Create the Pi Extension

- [ ] Create `src/extensions/fft-permission-gate.ts` -- the pi extension that intercepts `tool_call` events and blocks destructive commands. Uses the same 16 patterns from `src/bash-guard.ts` for consistency. Two modes: (1) when `ctx.hasUI` is true (RPC mode with host handling confirmation), call `ctx.ui.confirm()` and block if denied; (2) when `ctx.hasUI` is false (JSON mode without RPC), hard-block immediately with no confirmation. Extension detects whether it's running in a subagent context via an env var (`FFT_NANO_SUBAGENT=1`) and hard-blocks in that case regardless of UI availability. Also blocks `write`/`edit` tool calls targeting protected paths (`.env`, `.git/`, `node_modules/`, `data/`) -- porting the pattern from pi's `protected-paths.ts` example.

### Phase 2: Extension Delivery to Pi Sessions

- [ ] Add extension sync logic to `src/pi-runner.ts` -- after `syncSkills()` runs (which copies skills to `data/pi/<group>/.pi/skills/`), copy the extension file to `data/pi/<group>/.pi/agent/extensions/fft-permission-gate.ts`. This runs in `ensureGroupDirs()` or as a new step in `runContainerAgent()` before spawning pi. The extension must be present on disk before pi starts so auto-discovery picks it up.

- [ ] Alternative approach: use `--extension <path>` flag in `buildPiArgs()` at `src/pi-runner.ts:368` to explicitly load the extension. This is more reliable than auto-discovery (no path guessing) and works regardless of pi's auto-discovery configuration. The extension file path would be resolved from the project root (`src/extensions/fft-permission-gate.ts`) and passed as an absolute path. This approach is preferred because it guarantees the extension loads and doesn't depend on pi's auto-discovery behavior.

### Phase 3: Enable RPC Mode for Extension UI Protocol

- [ ] Change `stdio` from `['ignore', 'pipe', 'pipe']` to `['pipe', 'pipe', 'pipe']` at `src/pi-runner.ts:809`. This enables stdin so the host can send `extension_ui_response` messages back to pi. This is required for the confirmation dialog flow -- pi emits `extension_ui_request` on stdout, host presents it to the user, user confirms/denies, host writes `extension_ui_response` to stdin.

- [ ] Add `extension_ui_request` handler in `processStdoutLine()` at `src/pi-runner.ts:869-935`. When a line with `type: "extension_ui_request"` is parsed, extract the `id`, `method`, `title`, `message` (for confirm), and route to a new `onExtensionUIRequest` callback. The handler must pause stdout processing while waiting for the user's response (the extension is blocked waiting for the response, so pi won't emit more events until the response is sent).

- [ ] Add `extension_ui_response` writer function. When the user responds to a confirmation request (via Telegram inline button or text reply), construct the appropriate response JSON (`{ type: "extension_ui_response", id: "<id>", confirmed: true/false }`) and write it to `child.stdin` followed by a newline. Handle the `cancelled` response type for timeouts.

### Phase 4: User Confirmation Flow in Chat

- [ ] Add `onExtensionUIRequest` callback to `ContainerRuntimeEvent` type or as a separate callback parameter on `runContainerAgent()`. The callback receives the UI request details and returns a Promise that resolves with the user's response.

- [ ] Implement Telegram confirmation delivery in `src/telegram.ts` (or wherever `onRuntimeEvent` is handled). When a `confirm` request arrives, send a Telegram message with the command details and inline buttons "Allow" / "Block". Store the pending request by ID. When the user taps a button, resolve the pending promise with the response, which triggers the `extension_ui_response` write to stdin.

- [ ] Implement WhatsApp confirmation delivery similarly if WhatsApp is enabled. Same pattern: message with command details, user replies, resolve promise.

- [ ] Add timeout handling. Pi extensions support `timeout` on confirm dialogs. If the user doesn't respond within the timeout, pi auto-resolves to `false` (blocked). The host should also clean up any pending UI state when the timeout fires. Default timeout: 60 seconds (configurable via `FFT_NANO_CONFIRM_TIMEOUT_MS`).

### Phase 5: Subagent Integration

- [ ] Set `FFT_NANO_SUBAGENT=1` env var when spawning subagent pi processes in `src/coding-orchestrator.ts`. This tells the extension to hard-block destructive commands without prompting (subagents can't do interactive confirmation).

- [ ] Verify the extension loads for subagent sessions. Since subagents use the same `runContainerAgent()` → `buildPiArgs()` path, the `--extension` flag will be passed. The extension reads `FFT_NANO_SUBAGENT` and switches to hard-block mode.

### Phase 6: Update Existing Guards

- [ ] Keep `src/bash-guard.ts` as a secondary audit trail. The host-side audit at `src/pi-runner.ts:894-907` continues to log destructive commands. This provides a fallback log if the extension somehow fails to load, and gives visibility into all destructive command attempts across all sessions.

- [ ] Update `src/system-prompt.ts:552-564` to reflect that destructive commands are now **enforced** at the runtime level, not just advisory. Change the wording from "forbidden without explicit user confirmation" to "blocked by the permission gate extension. You will be prompted to confirm before any destructive command executes."

- [ ] Make `delegationExtensionAvailable: true` at `src/pi-runner.ts:520` meaningful. Currently hardcoded. Could check for the actual existence of the extension file and set it conditionally, or just leave it as-is since the extension will always be present.

### Phase 7: Testing

- [ ] Write unit tests for the extension logic in isolation (pattern matching, block decision, env var detection). Since the extension runs inside pi and imports `@mariozechner/pi-coding-agent` types, test the core guard logic as a pure function extracted from the extension.

- [ ] Write integration test that spawns pi with the extension loaded, sends a destructive bash command, and verifies it gets blocked. Use `--mode json` and verify the blocked tool result appears in stdout.

- [ ] Write integration test for the RPC confirmation flow: spawn pi in RPC mode, trigger a destructive command, handle the `extension_ui_request`, send `extension_ui_response` with `confirmed: true`, verify the command executes. Then test with `confirmed: false` and verify the command is blocked.

- [ ] Write test for subagent mode: set `FFT_NANO_SUBAGENT=1`, trigger destructive command, verify hard-block without any UI request.

- [ ] Write test for protected paths: trigger `write` to `.env` path, verify block.

### Phase 8: Documentation

- [ ] Add pi extension documentation section to `AGENTS.md` covering: what extensions are, how FFT Nano uses them, the permission gate extension, the RPC UI protocol, and how to add new extensions.

## Verification Criteria

- Pi extension loads on every agent session (main agent and subagents)
- Destructive bash commands are blocked before execution in subagent mode (no UI prompt)
- Destructive bash commands trigger a confirmation dialog in main agent mode (Telegram inline buttons)
- User can approve or deny the command; approval allows execution, denial blocks with reason
- Protected paths (`.env`, `.git/`, `node_modules/`, `data/`) are blocked for `write`/`edit` tools
- Host-side audit log (`bash-guard.ts`) continues to record all destructive command detections
- System prompt accurately reflects that enforcement is runtime, not advisory
- Timeout on confirmation defaults to blocked (safe default)
- All existing tests pass (275+ tests)
- New tests cover extension logic, RPC flow, subagent mode, and protected paths

## Potential Risks and Mitigations

1. **Stdin pipe breaks existing behavior**
   Risk: Changing `stdio` from `['ignore', 'pipe', 'pipe']` to `['pipe', 'pipe', 'pipe']` could affect how pi behaves if it expects stdin to be closed.
   Mitigation: Pi's JSON mode is designed for RPC with stdin open. The `rpc-demo.ts` example in pi's package uses exactly this configuration. Test thoroughly with both interactive and non-interactive scenarios.

2. **Extension not loading**
   Risk: If the extension file isn't in the right path or pi's auto-discovery doesn't find it, destructive commands won't be blocked.
   Mitigation: Use `--extension <absolute-path>` flag instead of relying on auto-discovery. This guarantees the extension loads. Log a warning at startup if the extension file doesn't exist at the expected path.

3. **RPC response race condition**
   Risk: If the host is slow to send `extension_ui_response`, pi might timeout or the user might send another message that interferes.
   Mitigation: Pause stdout processing while waiting for the user's confirmation response. Pi is blocked waiting for the response, so no new events will arrive. The timeout in the extension ensures pi doesn't hang forever.

4. **Extension conflicts with pi version**
   Risk: The extension API might change between pi versions.
   Mitigation: Pin the pi version in `package.json`. The extension uses only the stable `tool_call` event and `ctx.ui.confirm()` API, which are core features unlikely to change. Test against the installed pi version (v0.60.0).

5. **Confirmation UX in Telegram**
   Risk: Inline buttons might not work well in all Telegram clients, or the confirmation message might get lost in a busy chat.
   Mitigation: Use Telegram's `reply_markup` with inline keyboard buttons. Pin the confirmation message or use a high-visibility format. Set a reasonable timeout (60s) and auto-deny if the user doesn't respond.

## Alternative Approaches

1. **Host-side process kill on detection**: Instead of using pi extensions, kill the pi process when a destructive command is detected in stdout. This is simpler but loses the agent's context and requires a full session restart. The extension approach is superior because it blocks the specific tool call without killing the session.

2. **Wrapper script around bash tool**: Create a custom pi tool that wraps bash with destructive command detection. This would replace pi's built-in bash tool. More invasive, harder to maintain, and doesn't leverage pi's native extension system.

3. **Keep current log-only approach, rely on system prompt**: Simplest but provides no enforcement. The LLM can ignore the instruction. Not acceptable for a system that controls physical farm equipment.
