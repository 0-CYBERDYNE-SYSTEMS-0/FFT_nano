# telegram-spec.md — Hermes-Grade Telegram Streaming for nano-core

**Status:** ready for implementation
**Author:** traced from Hermes Agent v0.18.2 source (upstream 299e409f) + nano-core current implementation
**Audience:** nano-core dev team
**Goal:** make nano-core's Telegram streaming UX match Hermes Agent's: live animated draft previews, clean overflow continuation, tool-boundary bubbles, markdown parity, and flood-resilient delivery.

---

## 1. Background — how Hermes does it (the reference implementation)

Hermes source on this machine: `~/hermes-agent`. Two files matter:

| Concern | File |
|---|---|
| Stream orchestration (flush cadence, overflow, transports, fallbacks) | `~/hermes-agent/gateway/stream_consumer.py` (1,966 lines) |
| Telegram Bot API specifics (drafts, edits, chunking, ingress batching) | `~/hermes-agent/plugins/platforms/telegram/adapter.py` (9,416 lines) |
| Defaults | `~/hermes-agent/gateway/config.py:668-670` |

### 1.1 Pipeline

```
model token stream
  → stream_delta_callback → GatewayStreamConsumer queue
  → flush loop (cadence below)
  → transport: native draft (DM) | progressive edit (groups)
  → Telegram Bot API
```

### 1.2 Flush cadence (`stream_consumer.py:627-641`)

Flush a frame when **any** of:
- **0.8s** elapsed since last flush (`DEFAULT_STREAMING_EDIT_INTERVAL = 0.8`)
- **≥24 new chars** accumulated (`DEFAULT_STREAMING_BUFFER_THRESHOLD = 24`)
- stream finished / tool-boundary segment break / commentary message (immediate)

Mid-stream frames append cursor `" ▉"` (`DEFAULT_STREAMING_CURSOR`).
Frame budget: `safe_limit = 4096 − len(cursor) − 100`.

### 1.3 Transports

Config `streaming.transport`: `auto | draft | edit | off`.

- **DMs:** native `sendMessageDraft` (Bot API 9.5+). One monotonically-increasing `draft_id` per response — reusing the same id across consecutive calls is what animates the preview client-side. Draft frames try MarkdownV2 first, retry once as plain text on "can't parse entities". **A single draft failure disables drafts for the rest of that run** → falls back to edit path.
- **Groups/topics/channels:** progressive `editMessageText` on one preview message. Drafts are DM-only — mode is resolved up front from chat type, not by trial-and-error.
- Drafts have no `message_id` and can't be "promoted". The final answer always lands as a real `sendMessage`; the client clears the draft preview naturally.

### 1.4 Overflow (>4096 mid-stream) (`stream_consumer.py:705-741`)

- Length measured in **UTF-16 code units** — that's Telegram's unit.
- While accumulated text > `safe_limit` and a preview message exists:
  - cut at last `\n` before budget; if that cut is `< safe_limit/2`, hard-cut at `safe_limit`
  - emit the head as a **sealed chunk** with `finalize=True` (MarkdownV2 applied NOW — it will never be edited again)
  - open a fresh message for the remainder
- Non-streamed long sends chunk via `truncate_message` — word/code-fence aware, adds `(1/2)` indicators.

### 1.5 Robustness rules

- **Flood strikes:** 3 consecutive flood-control (429) edit failures → edits disabled for the remainder of the run; edit interval backs off adaptively.
- **Final-edit flood:** don't burn flood budget retrying a turn-final edit — deliver a fresh final `sendMessage` instead (`FALLBACK_ON_FINAL_EDIT_FLOOD`).
- **Finalize always** (`REQUIRES_EDIT_FINALIZE`): the final edit runs even if text is unchanged from the last frame — converts plain stream text → MarkdownV2. Prevents "format snap".
- **Think-tag filter:** `<think>`, `<reasoning>`, `<thinking>`, `<thought>` (+ caps variants, `<REASONING_SCRATCHPAD>`) stripped from the preview stream; partial open-tag prefixes are held back so a split tag never flashes on screen.
- **Silence markers:** exact final responses of `NO_REPLY` / `[SILENT]` etc. are retracted, never shown. *Partial* markers mid-stream (e.g. `"NO"` → `"NO_REPLY"`) are held back until resolved.
- **Tool boundaries:** when a tool call starts, the current text bubble is sealed and a new bubble opens below the tool-progress line. Text never resumes by editing a bubble *above* tool output.
- **Typing keepalive:** `sendChatAction` refreshed while waiting on the model; per-chat 30s cooldown after a typing-call failure so a Telegram-side blip doesn't spam the API.

### 1.6 Ingress batching (receiving side)

Telegram clients split long user messages; Hermes reassembles before invoking the agent:
- ≤320 codepoints → 180ms settle; ≤1024 → 240ms; longer → 300ms cap
- near-4096 continuations → 1s; photo albums → 800ms

---

## 2. nano-core current state (as-is)

```
container: pi (JSON stdout events)
  → container/agent-runner/src/index.ts  accumulate assistantSoFar
  → maybeSendDraft(): 1s throttle (floor 400ms, NANO_CORE_TELEGRAM_DRAFT_MIN_MS),
    dedupe identical frames, 1s ticker, force-flush on close
  → writeIpcTelegramDraftUpdate(): atomic tmp+rename JSON into WORKSPACE_IPC_MESSAGES_DIR
host: src/index.ts IPC watcher (~:5736)
  → parseTelegramDraftIpcMessage (src/telegram-draft-ipc.ts)
  → authz + isTelegramJid + Telegram-enabled guards
  → sendTelegramDraftWithFallback(): draft-first, message-edit fallback
  → final result delivery via consumeTelegramHostStreamedRun (:4618/:4837)
```

Already have (keep): native `sendMessageDraft` + edit fallback + block mode, 4096 cap, dedupe, failure backoff (1s/3s/10s, disable after 4 failures/120s), typing refresh, atomic IPC, unauthorized-IPC guard, streamed-run completion tracking, `TELEGRAM_MAX_MESSAGE_LEN = 4096`.

**Note for implementers:** JS `String.length` counts UTF-16 code units — the same unit Telegram uses. Plain `.length` is correct for the 4096 budget (surrogate pairs count 2, matching Telegram). No `utf16_len` port needed.

### Gaps vs Hermes

| # | Gap | Hermes behavior | nano-core today |
|---|---|---|---|
| 1 | Cursor | `" ▉"` mid-stream, stripped at final | none |
| 2 | Overflow | seal head as finalized message, continue in new bubble | tail-window: `...` + last 4093 chars (`container/agent-runner/src/telegram-draft.ts:30-32`) |
| 3 | Tool boundaries | seal bubble, open new one below tool line | none — one continuous preview |
| 4 | Markdown parity | drafts render MarkdownV2 mid-stream (plain fallback) | drafts are plain text; final snaps to formatted |
| 5 | Content filters | think-tags + silence markers suppressed | none in stream path |
| 6 | Finalize semantics | final edit always runs; flood strikes w/ fresh-final fallback | single disable-on-error |
| 7 | Cadence | 800ms interval **+** ≥24-char immediate trigger | 1000ms interval only |
| 8 | Mode resolution | drafts for DM, edit for groups — decided up front | draft attempted everywhere, falls back on first error |

---

## 3. Target design

### 3.1 IPC schema (container → host)

Existing message stays valid. Additive changes only — older agent-runners keep working.

```jsonc
// existing — streaming frame (extended)
{
  "type": "telegram_draft_update",
  "chatJid": "...", "requestId": "...", "draftId": 123,
  "text": "accumulated text so far ▉",      // cursor included by container
  "messageThreadId": 456,                    // optional
  "seq": 7                                   // NEW: monotonic per requestId, host drops stale frames
}

// NEW — sealed overflow chunk: send as a REAL finalized message now
{
  "type": "telegram_sealed_chunk",
  "chatJid": "...", "requestId": "...",
  "text": "first ~4000 chars, markdown-final",
  "messageThreadId": 456
}

// NEW — tool boundary: seal current preview, next frames open a new bubble
{
  "type": "telegram_segment_break",
  "chatJid": "...", "requestId": "..."
}

// NEW (phase 3) — tool progress line
{
  "type": "telegram_tool_event",
  "chatJid": "...", "requestId": "...",
  "tool": "terminal", "status": "started"    // started | finished
}
```

All writes keep the atomic tmp+rename pattern (`container/agent-runner/src/telegram-draft.ts:35-67`). Parser: extend `parseTelegramDraftIpcMessage` into a typed union in `src/telegram-draft-ipc.ts`; keep the unauthorized-IPC and non-Telegram-JID guards in `src/index.ts` applied to every new type.

### 3.2 Container-side algorithm (`container/agent-runner/src/index.ts`)

```
SAFE = 4096 - CURSOR.length - 100        // CURSOR = " ▉"
on each pi text delta:
  delta = filterThinkTags(delta)          // hold partial tag prefixes
  accumulated += delta
  // overflow: seal head, continue in new bubble
  while accumulated.length > SAFE:
    cut = accumulated.lastIndexOf('\n', SAFE)
    if cut < SAFE / 2: cut = SAFE
    writeIpc({ type: 'telegram_sealed_chunk', text: accumulated.slice(0, cut) })
    accumulated = accumulated.slice(cut).replace(/^\n+/, '')
    // draft continues with remainder; host resets preview state
flush rule (maybeSendDraft):
  now - lastSentAt >= 800ms   OR   newCharsSinceLastFrame >= 24   OR   force
  frame text = accumulated + CURSOR
on tool call start (from pi event stream):
  flush current frame (force) → writeIpc({ type: 'telegram_segment_break' })
on close:
  suppress if final text is an exact silence marker (NO_REPLY / [SILENT])
  force-flush final frame WITHOUT cursor
```

Constants: `CURSOR = ' ▉'`, interval default **800ms** (env `NANO_CORE_TELEGRAM_DRAFT_MIN_MS`, floor 400ms — keep env name for compat), char trigger **24**, `SILENCE_MARKERS = ['NO_REPLY', '[SILENT]']`, think-tag set per §1.5.

### 3.3 Host-side algorithm (`src/telegram-draft-ipc.ts`, `src/index.ts`)

Per runKey (`chatJid:requestId:draftId`):

- **Mode resolution up front:** chat type dm/private → `draft`; group/supergroup/topic → `message` (edit path). No trial-and-error first frame. (Chat type is known at message-ingest time in `src/telegram.ts`; thread it through the run registry.)
- `telegram_draft_update` → existing `sendTelegramDraftWithFallback` path. Drop frames with `seq` ≤ last applied seq.
- `telegram_sealed_chunk` → `sendMessage` with markdown formatting (existing final-send formatter in `src/telegram-format.ts`), record messageId, reset preview state for the runKey (next draft frame starts a fresh bubble).
- `telegram_segment_break` → finalize current preview: if mode `message`, run a **final edit even if text unchanged** (applies markdown); mark preview sealed so the next frame opens a new bubble.
- **Flood tracking:** count consecutive 429s on edits per runKey; 3 strikes → stop editing, buffer silently; on run completion deliver the final answer as a fresh `sendMessage` regardless (never leave the user with a frozen partial).
- **Typing:** keep existing refresh; add per-chat 30s cooldown after a failed `sendChatAction`.
- Final delivery (`consumeTelegramHostStreamedRun`, `src/index.ts:4618/:4837`): unchanged in shape — mode `draft` still requires the real final `sendMessage`; mode `message` gets the finalize edit.

### 3.4 Markdown parity (phase 3, optional but recommended)

Draft frames pass through the same MarkdownV2 conversion as the final send. On `BadRequest: can't parse entities`, retry **that frame** as plain text (do not disable markdown for the run — a single malformed token stream shouldn't degrade the whole response). Result: no visual "snap" when the final message replaces the preview.

---

## 4. Work items

### Phase 1 — polish (small, independent, ship first)

- [x] **W1. Cursor** — append `" ▉"` to streaming frames, omit on final. (`container/agent-runner/src/index.ts maybeSendDraft`)
- [x] **W2. Cadence** — default interval 1000→800ms; add ≥24-char immediate flush.
- [x] **W3. Think-tag filter** — streaming-safe stripper with partial-prefix holdback. (new `container/agent-runner/src/stream-filter.ts` + tests)
- [x] **W4. Silence markers** — suppress exact-marker finals; hold partial prefixes mid-stream.
- [x] **W5. Finalize-always + flood strikes** — final edit unconditional; 3-strike edit disable; fresh-final `sendMessage` on completion after strikes. (`src/telegram-draft-ipc.ts`)

### Phase 2 — structural (the Hermes feel)

- [x] **W6. Overflow continuation** — sealed-chunk algorithm §3.2 + `telegram_sealed_chunk` IPC + host handler. Replaces tail-window in `normalizeTelegramDraftText` (keep tail-window only as a last-resort guard).
- [x] **W7. Segment breaks** — `telegram_segment_break` IPC emitted on tool-call start; host seals + reopens bubbles.
- [x] **W8. Up-front mode resolution** — dm→draft, group→edit, threaded through the run registry; keep first-frame fallback as belt-and-suspenders.
- [x] **W9. Frame sequencing** — `seq` field; host drops stale/out-of-order frames (IPC files can arrive out of order under load).

### Phase 3 — optional (parity extras)

- [~] **W10. MarkdownV2 draft frames** — implemented for finalization/sealed text only, see §9.7.
- [ ] **W11. Tool-progress bubbles** — `telegram_tool_event` → status line between text bubbles (mirrors Hermes `send_or_update_status`).
- [ ] **W12. Fresh-final-after-seconds** — if preview has been visible >N s, deliver final as new message and delete preview fragments (Hermes `fresh_final_after_seconds`, default off).
- [ ] **W13. Ingress batching** — adaptive 180/240/300ms text settle, 1s continuations, 800ms albums (receiving side, `src/telegram.ts`).

### Explicitly out of scope

- Rich Messages (Bot API 10.1 `sendRichMessage` / rich drafts) — opt-in even in Hermes; poor copy-as-plain-text UX on current clients.
- Voice/media streaming, reactions, model pickers — existing nano-core features, untouched.

---

## 5. Acceptance criteria

**W6 overflow:** a 12,000-char streamed response produces 3 sealed messages + a live tail bubble; no `...` tail-window in the normal path; sealed messages render markdown; nothing is dropped or duplicated.

**W7 segments:** a run with 2 tool calls shows: text bubble → tool line → text bubble → tool line → text bubble. The final answer is never an edit of a bubble above a tool line.

**W1+W2 feel:** first frame visible ≤1s after first token; sustained streaming updates ~1.25/s; no visible cursor on any finalized message.

**W5 flood:** with `editMessageText` failing 429 in tests, the run still ends with the complete answer delivered as a fresh message, and no more than 3 edit retries are attempted.

**Ordering:** 200 IPC files written in random arrival order with `seq` — host applies them monotonically.

## 6. Testing

- Follow existing patterns: `tests/telegram-draft-ipc.test.ts` (host), `container/agent-runner/src/telegram-draft.test.ts` + `pi-stream-parser.test.ts` (container).
- New: `container/agent-runner/src/stream-filter.test.ts` (W3/W4 — partial tags, split markers across deltas).
- Overflow: unit-test the cut algorithm directly (newline preference, half-budget hard cut, multi-chunk).
- Host: extend draft-ipc tests for `telegram_sealed_chunk` / `telegram_segment_break` / `seq` handling / flood-strike state machine.

## 7. Verification (pre-merge, per AGENTS.md)

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run doctor
```

## 8. Reference map

| Behavior | Hermes source | nano-core target |
|---|---|---|
| Flush loop & cadence | `gateway/stream_consumer.py:542-741` | `container/agent-runner/src/index.ts` `maybeSendDraft` |
| Overflow split | `stream_consumer.py:705-741` | same + new IPC type |
| Draft transport & fallback | `plugins/platforms/telegram/adapter.py:4812-4918` | `src/telegram-draft-ipc.ts` `sendTelegramDraftWithFallback` |
| Draft streaming resolution | `stream_consumer.py:1261-1302` | W8 mode resolution |
| Defaults | `gateway/config.py:668-670` | constants in `container/agent-runner/src/telegram-draft.ts` |
| Think/silence filtering | `stream_consumer.py:396-540`, `gateway/response_filters.py` | new `container/agent-runner/src/stream-filter.ts` |
| Tail-window (to replace) | — | `container/agent-runner/src/telegram-draft.ts:27-33` |
| IPC writer/reader | — | `container/agent-runner/src/telegram-draft.ts` / `src/telegram-draft-ipc.ts` |

---

## 9. Implementation notes (2026-07-19, post-implementation)

Implemented: **W1–W9** plus the typing cooldown, plus a scoped slice of W10 (markdown on finalize edits). W11–W13 not implemented. Deviations and discoveries below.

### 9.1 `telegram_segment_break` was dropped — sealed chunks cover both cases

Overflow seals and tool-boundary seals are the same host operation: "this text is final, deliver it as persistent chat content, reset the preview so the next frame opens a fresh bubble." So the container emits `telegram_sealed_chunk` (carrying the segment's final text) at tool boundaries too, and there is no separate `telegram_segment_break` type. This also removes the host's dependency on its own last-frame state for segment finalization — the break carries its text, so dropped/deduped frames can't lose a segment.

Host handling (`sendTelegramSealedChunk` in `src/telegram-draft-ipc.ts`):
- preview mode `message` → finalize the existing bubble in place via `editMessageText` **with markdown** (HTML formatter, per-edit plain fallback), then clear preview state;
- preview mode `draft` / none → deliver as a fresh real `sendMessage` (full markdown path);
- sealed chunks bypass the disabled-run check — unlike preview frames they carry content that is not re-sent at completion.

### 9.2 Final-delivery contract for overflowed runs

When the **final segment** emitted sealed chunks, the container seals the remaining tail at close and reports `streamed: true` in its output, so the host does not send the full result again (which would duplicate the sealed heads). Runs that only sealed at tool boundaries (no overflow in the last segment) keep the normal final path — pi's parsed result is the *last* assistant message, i.e. exactly the unsealed final segment, so there is no duplication either way.

Consequence: `verboseMode` tool sections appended by the runner are not delivered to chat when the final segment overflowed (they're host-final-path only). Full text is still persisted to history.

### 9.3 Container-side design: full-buffer refiltering, not stateful stream filters

pi emits mixed append/**replace** deltas (`message_end` replays the whole message). A stateful per-delta filter breaks under replays, so `TelegramStreamSession` (new `container/agent-runner/src/telegram-stream-session.ts`) recomputes `filterThinkTags(rawText)` on the full buffer per event and tracks a `sealedVisibleOffset` into the *filtered* text. A replace that shrinks below the sealed offset is treated as a new segment. Think-tag filtering and silence markers live in `container/agent-runner/src/stream-filter.ts`.

Segment state resets on tool boundaries, which also fixes a pre-existing quirk (assistant text from before a tool call bleeding into the next message's preview via naive append accumulation).

### 9.4 Ordering: seq is embedded in IPC filenames; host coalesces per scan

- All stream IPC files (drafts + sealed chunks) share the `draft_<ts>_<seq8>_<rand>.json` naming; the host sorts the scan lexicographically, which reproduces emission order even for same-millisecond writes.
- `seq` is monotonic per run across *both* frame types and both retry attempts (shared counter).
- The host additionally **coalesces preview frames per scan**: if one IPC poll picked up several draft frames for the same run, only the newest gets an API call. With the 800ms/24-char container cadence this is what keeps edit-mode API usage sane; the IPC poll interval was reduced 1000→500ms (`src/config.ts`) so the preview tracks the container cadence.
- Stale-`seq` preview frames are dropped in `sendTelegramDraftWithFallback`; sealed chunks always deliver (dropping one would lose content permanently).

### 9.5 W8 mode resolution needed no registry threading

`isTelegramPrivateChatJid` (positive numeric chat id = DM) already answers "draft vs edit" — groups/supergroups have negative ids. Group chats now skip the doomed first-frame draft attempt entirely; DMs keep draft-first with the message fallback as belt-and-suspenders.

### 9.6 W5 flood strikes and the frozen-partial guarantee

- Preview **edit** failures count per-run strikes (`TELEGRAM_EDIT_STRIKE_LIMIT = 3`, reset on success); under the limit the frame is skipped and the next frame retries. At the limit the run's preview is disabled **and** the run is marked broken in `TelegramStreamedRunTracker` (`markBroken`), so run completion sends the full answer as a fresh message — the user is never left with a frozen partial. (Note `apiPostWithRetry` already retries 429s with `retry_after` inside each attempt, so 3 strikes ≈ 12 raw API attempts.)
- Draft-transport failures after drafts succeeded still disable immediately (drafts are cosmetic; the final real message is guaranteed anyway).
- Initial `sendMessage` failure (no bubble exists yet) disables immediately, as before.

### 9.7 Markdown parity (W10) — implemented only for finalization

Live preview frames stay plain text. nano-core's formatter is Markdown→**HTML** (not MarkdownV2), and mid-stream partial markdown (unclosed fences etc.) would force a per-frame render+fallback dance. Instead, markdown is applied wherever text becomes permanent: sealed chunks (both delivery paths) and the group-mode bubble finalization all go through the HTML formatter with a per-edit plain fallback (`editStreamMessage` gained a `format: 'markdown'` option in `src/telegram.ts`). So the persistent artifacts always render formatted; only the transient preview is plain. Full mid-stream W10 remains open.

### 9.8 Silence markers

Suppression applies to the **stream path only** (frames held back / final frame suppressed). nano-core has no NO_REPLY protocol on the host final path, so a model that literally answers `NO_REPLY` still gets its result delivered by the host as before — changing that was out of scope.

### 9.9 Ops notes

- **Rebuild the Docker image** (`./container/build-docker.sh`) — the streaming changes live in the agent-runner baked into `nano-core-agent:latest`. Old container + new host degrades gracefully (no seq → no stale-drop, no sealed chunks, 1s cadence). New container + old host would silently drop sealed chunks — don't run that combination.
- Cadence default changed: `NANO_CORE_TELEGRAM_DRAFT_MIN_MS` now defaults to **800** (floor 400 unchanged).
- Typing keepalive: 30s per-chat cooldown after a failed `sendChatAction` (`src/telegram.ts`).
- Known small races (accepted): a sealed chunk written just before container exit can be processed after run completion (delivered late, still delivered); `bot.sendMessage` has no `message_thread_id` support, so sealed chunks in forum topics land in the general topic (matches existing final-send behavior).

### 9.10 Not implemented

- **W11** tool-progress bubbles (`telegram_tool_event`) — the IPC union + sealed-chunk reset machinery makes this a small follow-up.
- **W12** fresh-final-after-seconds — default-off in Hermes too.
- **W13** ingress batching — receiving side untouched.

---

## 10. fft_nano port notes (2026-07-19)

§1–§9 describe nano-core's container/IPC architecture. fft_nano's delivery is
in-process (`pi-runner.ts` → `StreamConsumer` in `src/streaming/` → Telegram
adapter), so the spec's behaviors were ported rather than its file layout.
Branch: `feat/telegram-hermes-streaming`.

### 10.1 Already present before the port (no work needed)

- **W8 mode resolution** — `StreamConsumer` only enables draft mode for
  positive (private) chat ids; groups use the edit path with a 3s interval.
- **W9 seq ordering** — moot: delivery is in-process and serialized on promise
  chains (`answerChain`); there is no IPC file reordering to defend against.
- **Scoped W10** — `finalizeTelegramPreviewMessage` already finalizes with the
  Markdown→HTML formatter.

### 10.2 Implemented in this port

- **W1 cursor** — `STREAM_CURSOR` (`' ▉'`) appended at transmission time in
  `StreamConsumer.sendOrEdit`; `lastText` stays cursor-free; finalize paths
  (seals, tail, host finalize, abort cleanup) always send clean text. Ordinary
  completion drains the serialized preview chain before bridging its state.
- **W2 cadence** — `FFT_NANO_TELEGRAM_DRAFT_MIN_MS` default 1000→800 (floor
  400 kept); ≥24-new-chars fast trigger in `publishDraftPreview` and
  `StreamConsumer`, so the consumer's normal cadence cannot delay the fast
  frame; private-chat interval 1000→800ms.
- **W3 think tags** — `splitInlineReasoning` extended to `<reasoning>`,
  `<thought>`, `<reasoning_scratchpad>` plus trailing partial open-tag
  holdback (a lone trailing `<` counts).
- **W4 silence markers** — `holdbackSilenceMarker` prevents partial/exact
  markers from reaching the preview, and Telegram completion retracts any
  preview without persisting or sending an exact final marker.
- **W5 frozen-partial guarantee** — three consecutive flood-control edit
  failures disable preview edits for the run and hide its stale preview state;
  completion therefore sends the full answer as a fresh message. Successful
  edits reset the strike count; generic failures retain the existing backoff.
  Queued edits re-check the disabled state, so work already waiting behind the
  third strike cannot spend more flood budget.
- **W6 overflow** — `publishDraftPreview` no longer truncates at 4096; the
  consumer tracks `sealedSourceLen` and seals head chunks (newline-preferred
  cut, half-budget hard cut, `SEAL_SAFE_LIMIT = 4096 − cursor − 100`) as
  permanent formatted messages (message mode: finalize-edit the live bubble;
  draft mode: real `sendMessage`), then streams the remainder in a fresh
  bubble. `normalizeTelegramPreviewText` remains as last-resort guard in the
  Telegram layer. Hard cuts preserve UTF-16 surrogate pairs. A failed seal or
  a cumulative outbound-guard rejection retracts delivered preview fragments
  and leaves the host's complete fresh-final fallback enabled. Long fenced
  code blocks are closed and reopened at chunk boundaries so every permanent
  bubble renders independently.
- **W7 segment breaks** — `onToolEvent(start)` seals the current segment via
  the same machinery and sends one compact permanent tool-start line before
  the next content bubble; pi's replace-style `message_end` deltas that shrink
  below the sealed boundary start a fresh segment (mirrors §9.3).
- **Retry isolation** — fresh-session, delayed, and provider-switch retry
  boundaries retract prior-attempt preview fragments and reset sealing state,
  so only the successful attempt remains visible.
- **Sealed-run completion (§9.2 equivalent)** — `hasSealedContent()` +
  `finalizeTail()`; the agent-runner bridge finalizes the tail, calls
  `noteCompleted` (→ `externallyCompleted`), and never bridges preview state
  for sealed runs. Tail-finalize failure falls back to the host's full fresh
  send (duplication over loss). Error-status runs never `noteCompleted`.
- **Seal failure policy** — a failed seal sets `sealBroken`: sealing stops,
  the run reports `hasSealedContent() === false`, and the host's full final
  delivery restores completeness.
- **Empty/error attempt cleanup** — sealed fragments are retracted unless the
  attempt produced a successful non-empty final result; an empty-output retry
  therefore cannot inherit a false externally-completed marker.
- **Sealing gate** — disabled when streamed reasoning is on
  (`showReasoning`/`reasoning stream`): that path mutates the preview prefix
  non-monotonically, which offset tracking cannot follow.
- **Typing cooldown** — 30s per-chat cooldown after a failed `sendChatAction`
  (`src/telegram.ts`), cleared on the next success.
- **Formatted seals** — `sendStreamMessage` gained a `rich` option (HTML
  render, plain resend only on 400 BadRequest); the adapter's finalize edits
  retry plain on formatted-edit failure.

The W7 tool-start line is intentionally one-shot. Full W11 lifecycle progress
(updating the same tool bubble through completion/error) remains optional and
is not implemented.

### 10.3 Interaction with /delivery and /verbose

- `off`: no streaming (consumer not constructed) — unchanged.
- `status`: `onDelta` returns early; no cursor, no sealing — unchanged.
- `stream` (and `partial` alias): full W1/W4/W6/W7 behavior on the content
  bubble; the Activity bubble (status + `/verbose` tool progress) is
  unaffected by sealing.
- `append`: untouched — durable blocks keep their word-aware chunking.
- `draft`: cursor on draft frames; overflow seals become real messages while
  the draft keeps streaming the tail under the same draft id.
- `/verbose` tool-trail footers ride only the live tail bubble; sealed
  messages carry clean content.
