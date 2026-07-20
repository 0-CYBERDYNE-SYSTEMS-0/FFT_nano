# Hermes-Grade Telegram Streaming for FFT_nano

**Status:** W1–W9 implemented on `feat/telegram-hermes-streaming`; W10 is
partially implemented; W11–W13 remain optional follow-ups.

**Goal:** bring FFT_nano's Telegram delivery close to Hermes Agent's streaming
feel without importing Hermes's container/IPC architecture. The implementation
is entirely in-process.

## Reference behavior

The Hermes comparison used these upstream source areas:

| Concern                                            | Hermes source                           |
| -------------------------------------------------- | --------------------------------------- |
| Stream cadence, overflow, transports, fallbacks    | `gateway/stream_consumer.py`            |
| Telegram drafts, edits, chunking, ingress batching | `plugins/platforms/telegram/adapter.py` |
| Streaming defaults                                 | `gateway/config.py`                     |

The relevant Hermes rules are:

- Flush at 800ms or after 24 new characters; use a cursor on live frames.
- Use native drafts for private chats and progressive edits for groups.
- Seal overflow and pre-tool text into permanent messages; resume below a
  tool boundary.
- Suppress partial and exact silence markers.
- Stop preview edits after three consecutive 429s, then use a fresh final
  message instead of leaving a frozen preview.

## FFT_nano architecture

```
pi runtime events
  → src/pi-runner.ts
  → src/agent-runner.ts
  → src/streaming/stream-consumer.ts
  → src/streaming/telegram-adapter.ts
  → src/telegram.ts Telegram Bot API client
```

`StreamConsumer` serializes each run with `answerChain`; there is no IPC file
queue, so Hermes's sequence-number requirement is not applicable. Completion
bridges the consumer's preview state through `TelegramPreviewRegistry` and
`src/telegram-delivery.ts`.

JavaScript `String.length` measures UTF-16 code units, which is Telegram's
message-length unit. It is therefore correct for the 4096-character budget.

## Implemented work items

| Item               | FFT_nano implementation                                                                                                                                                                                  | Regression coverage                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| W1 cursor          | `STREAM_CURSOR` is appended only by live `sendOrEdit`; final and sealed messages are cursor-free.                                                                                                        | `tests/streaming/stream-consumer.test.ts`                                                    |
| W2 cadence         | Private chats use 800ms plus the 24-character fast trigger. Groups retain `FFT_NANO_TELEGRAM_GROUP_EDIT_INTERVAL_MS` (3000ms default), including while a previous request is in flight.                  | `tests/streaming/stream-consumer.test.ts`                                                    |
| W3 think filtering | `src/streaming/stream-filter.ts` strips reasoning tags and holds trailing partial tag prefixes.                                                                                                          | `tests/stream-filter.test.ts`                                                                |
| W4 silence markers | `NO_REPLY` and `[SILENT]` are held back in all live delivery modes, including `append`. A final marker retracts queued, sent, sealed, appended, and Activity bubbles; delete failures redact the bubble. | `tests/streaming/stream-consumer.test.ts`, `tests/session-isolation-background-runs.test.ts` |
| W5 flood safety    | Preview edits stop after three consecutive 429s. Preview and finalization edits pass `maxAttempts: 1`, so a 429 consumes one raw `editMessageText` call before fresh-send fallback.                      | `tests/telegram-hermes-streaming.test.ts`                                                    |
| W6 overflow        | `StreamConsumer` seals newline-preferred chunks under `SEAL_SAFE_LIMIT`, preserves surrogate pairs, and balances fenced-code chunks.                                                                     | `tests/streaming/stream-consumer.test.ts`, `tests/telegram-streaming.test.ts`                |
| W7 tool boundaries | A tool start seals the current content, sends one permanent tool-start line, and opens the next bubble below it.                                                                                         | `tests/streaming/stream-consumer.test.ts`                                                    |
| W8 mode resolution | Draft mode is enabled only for positive/private Telegram IDs; groups use message edits from the first frame.                                                                                             | `src/streaming/stream-consumer.ts`                                                           |
| W9 ordering        | In-process `answerChain` serialization replaces IPC sequence ordering.                                                                                                                                   | `tests/streaming/stream-consumer.test.ts`                                                    |

### Completion and retry rules

- Sealed output is finalized only for a successful, non-silence final result.
  Silence markers call `StreamConsumer.retract()` before the sealed/non-sealed
  completion split and never mark a run externally completed.
- `retract()` drains both content and Activity chains, deletes every recorded
  message, and falls back to `OUTBOUND_DUMP_FALLBACK` when deletion fails.
- `lastAnswerFlushAt` is recorded when an outbound content request starts, not
  when it completes. A group delta arriving during a slow send cannot queue an
  immediate edit after that send resolves.
- `finalizeTelegramPreviewMessage()` gives every direct final edit a
  one-attempt retry budget. A 429 falls back to a fresh final send rather than
  multiplying the flood-control budget.

### Delivery-mode scope

- `off`: no streaming consumer.
- `status`: progress-only activity; no content preview.
- `stream` and `partial`: cursor, filtering, sealing, tool boundaries, and
  flood protection.
- `append`: durable word-aware blocks, with the same silence-marker holdback
  and retraction guarantee as other live modes.
- `draft`: private-chat draft frames; permanent overflow seals use real
  messages.

## Optional follow-ups

- **W10 (partial):** permanent final/sealed messages use the Markdown-to-HTML
  formatter with plain fallback. Live frames remain plain text because partial
  markdown can be invalid.
- **W11:** lifecycle tool-progress bubbles.
- **W12:** configurable fresh-final-after-seconds behavior.
- **W13:** Telegram ingress batching.

## Acceptance criteria

- A 12,000-character stream seals complete, non-duplicated chunks and leaves a
  live tail bubble.
- Two tool calls produce text → tool line → text → tool line → text; no text
  resumes by editing above a tool line.
- Group edits respect the configured cadence even if a preceding Telegram call
  is still in flight.
- Exact `NO_REPLY` and `[SILENT]` leave no visible content, append block, or
  Activity receipt; a failed delete is redacted.
- Three preview 429s make exactly three raw edit attempts; a final-edit 429
  makes one raw edit attempt before a fresh final send.

## Verification

Run from this repository's feature branch:

```bash
node --import tsx --test \
  tests/message-dispatch.test.ts \
  tests/pi-json-parser.test.ts \
  tests/stream-filter.test.ts \
  tests/streaming/stream-consumer.test.ts \
  tests/telegram-hermes-streaming.test.ts \
  tests/telegram.test.ts \
  tests/session-isolation-background-runs.test.ts
npm run typecheck
npm run build
npm run secret-scan
npm run pack-check
npm run release-check
git diff --check
```

## Reference map

| Behavior                                              | FFT_nano source                                                    | Tests                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Event ingestion                                       | `src/pi-runner.ts`, `src/agent-runner.ts`                          | `tests/pi-json-parser.test.ts`                                                      |
| Flush, cursor, cadence, overflow, silence, retraction | `src/streaming/stream-consumer.ts`                                 | `tests/streaming/stream-consumer.test.ts`                                           |
| Think/silence filtering                               | `src/streaming/stream-filter.ts`                                   | `tests/stream-filter.test.ts`                                                       |
| Bot transport and retry budget                        | `src/telegram.ts`, `src/streaming/telegram-adapter.ts`             | `tests/telegram-hermes-streaming.test.ts`, `tests/telegram.test.ts`                 |
| Final preview reconciliation                          | `src/telegram-delivery.ts`                                         | `tests/telegram-hermes-streaming.test.ts`, `tests/telegram-streaming.test.ts`       |
| Completion policy                                     | `src/agent-runner.ts`, `src/pipeline/message-dispatch-pipeline.ts` | `tests/session-isolation-background-runs.test.ts`, `tests/message-dispatch.test.ts` |
