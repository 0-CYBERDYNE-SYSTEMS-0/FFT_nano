# Telegram Delivery Modes

Use `/delivery` or `/settings` to choose the mode for the current chat.

| Mode     | Behavior                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream` | Edits one answer message as text arrives. Status and tool activity use a separate temporary Activity message.                                                    |
| `append` | Sends durable answer blocks without editing previous blocks. Status uses a separate Activity message.                                                            |
| `off`    | Sends no preview. Only the final answer is delivered.                                                                                                            |
| `draft`  | Uses Telegram's ephemeral native draft API in private chats, then sends the final answer normally. Groups and unsupported Bot API servers fall back to `stream`. |

Interactive runs refresh a silent Activity message every 30 seconds while the
agent is reasoning, running a tool, or waiting for approval. This is not the
scheduled FFT_nano host heartbeat and does not start new work.

Environment controls:

```dotenv
# Minimum answer-edit interval for Telegram groups.
FFT_NANO_TELEGRAM_GROUP_EDIT_INTERVAL_MS=3000

# In-run Activity refresh interval. Set to 0 to disable.
FFT_NANO_TELEGRAM_HEARTBEAT_MS=30000

# Source-side delta throttle before StreamConsumer coalescing.
FFT_NANO_TELEGRAM_DRAFT_MIN_MS=800
```

`StreamConsumer` uses latest-wins coalescing. If Telegram is slow, intermediate
frames are discarded and the next edit uses the newest available answer text.
The normal source cadence is 800ms; 24 or more new characters can trigger an
earlier flush after the 400ms safety floor.
