# Runtime Message Flow

This page documents how incoming chat content becomes a model run and response.

Primary implementation: `src/index.ts` (`processMessage`, `runAgent`, `sendMessage`, loops).

## Ingress Paths

Telegram:
- `startTelegram()` creates bot, polling loop, callback/message event handling.
- Inbound messages are normalized into `TelegramInboundMessage` and stored via `storeTextMessage` for registered chats.

WhatsApp:
- `connectWhatsApp()` attaches Baileys event handlers.
- `messages.upsert` stores metadata for all chats and full content for registered groups.

## Registration and Main-Channel Rules

Main channel behavior:
- Main group responds to all messages.
- Non-main group responds only when trigger prefix matches (`TRIGGER_PATTERN`) unless free-chat enabled for that chat.

Auto-registration:
- Telegram can auto-register when `TELEGRAM_AUTO_REGISTER` is enabled.
- WhatsApp can auto-bootstrap self-chat as main if no main group exists.

## Prompt Assembly Pipeline

For each message in `processMessage(msg)`:
1. Resolve group and chat preferences.
2. Fetch pending messages since last agent interaction (`getMessagesSince`).
3. Apply queue policy:
   - `queueMode`: `collect|interrupt|followup|steer|steer-backlog`
   - `queueCap` and `queueDrop` (`old|new|summarize`)
   - optional debounce note injection.
4. Build final prompt lines:
   - `[timestamp] sender: content`
5. Append mode-specific steering notes.
6. Route substantial main-chat coding work to the host coding orchestrator when applicable.

## Delegation Trigger Routing

Delegation parsing uses `parseDelegationTrigger` from `src/coding-delegation.ts`:
- `/coder <task>` -> `force_delegate_execute`
- `/coding <task>` -> `force_delegate_execute`
- `/coder-plan <task>` or `/coder_plan <task>` -> `force_delegate_plan`
- exact alias phrases (`use coding agent`, `use your coding agent skill`) -> execute delegation

Safety gate:
- Delegation is main-chat-only.
- Main-chat natural-language substantial coding asks can also auto-route through `isSubstantialCodingTask(...)`.

## Model Invocation

Direct runs use `runAgent(group, prompt, ...)`, which does:
1. Write per-group task snapshot (`current_tasks.json`).
2. Write groups snapshot (`available_groups.json`, main only).
3. Build container input with per-chat overrides:
   - provider/model
   - think/reasoning levels
   - continue/new-session mode (`noContinue`)
4. Call `runContainerAgent` in `src/pi-runner.ts`, which launches `pi` directly and optionally wraps it in the configured sandbox.
5. Retry once after runtime health verification when applicable.

Coder runs use `runCodingTask(...)`, which calls the host-side orchestrator in `src/coding-orchestrator.ts`:
1. Create a structured worker request.
2. Create an isolated worktree for execute mode.
3. Run `pi` in that isolated workspace with explicit tool mode (`read_only` or `full`).
4. Return a structured worker result including changed files, diff summary, artifacts, and test commands.

## Success/Failure Semantics

On successful run (`ok`):
- update usage counters
- advance `lastAgentTimestamp` for chat
- finalize Telegram preview in place when host-local preview streaming was active, otherwise send final result normally

On failure:
- no timestamp advance (message retried next loop)
- container errors may still return user-visible short error summary while marking prompt as consumed where appropriate

## Heartbeat Runs

Heartbeat loop (main chat only):
- interval from `FFT_NANO_HEARTBEAT_EVERY` (default 30m)
- prompt from `FFT_NANO_HEARTBEAT_PROMPT`
- suppresses output when result is only `HEARTBEAT_OK`

## Command Path vs Agent Path

Telegram command handler intercepts lightweight/admin commands before agent invocation.
Examples: `/help`, `/status`, `/tasks`, `/queue`, `/model`, `/compact`, `/subagents`.

If command returns `false` for pass-through (`/coder*`, `/coding`), normal message routing decides whether to call `runAgent(...)` or the host coding worker path.
