# Telegram Integration

Primary files:
- `src/telegram.ts`
- `src/telegram-format.ts`
- command handling in `src/index.ts`

## Chat JID Format

Telegram chat IDs are normalized as `telegram:<numeric-chat-id>`.

Helpers:
- `isTelegramJid(jid)`
- `parseTelegramChatId(jid)`

## Polling and State

`createTelegramBot(...).startPolling(...)` uses long polling (`getUpdates`) and persists `offset` in:
- `data/telegram_state.json`

Handled update kinds:
- `message`
- `edited_message`
- `callback_query`

## Inbound Message Normalization

Message abstraction includes:
- chat metadata
- sender metadata
- message type (`text|photo|video|voice|audio|document|sticker|location|contact|unknown`)
- optional media payload (`fileId`, size, mime, filename)

Mention handling:
- if bot username mention is present and no trigger exists, content is rewritten to prepend `@<ASSISTANT_NAME>` for non-command messages.

## Outbound Behavior

`sendMessage` path:
1. split markdown text into safe chunks
2. render markdown -> Telegram HTML safely
3. retry on transient API errors
4. fallback to plain text if HTML entity parse fails

Typing indicator:
- `setTyping(chatJid, true)` starts periodic `sendChatAction(typing)` refresh loop
- disabled when run completes

## Media Download

`downloadFile(fileId)` does:
1. `getFile`
2. fetch from `/file/bot<TOKEN>/<file_path>`
3. return `Buffer` and metadata

Host persistence path for inbound media (registered groups only):
- `groups/<group>/inbox/telegram/<timestamp>_<msgid>_<sanitized-name>.<ext>`
- exposed to agent as `/workspace/group/inbox/telegram/...`

Size guard:
- max bytes from `TELEGRAM_MEDIA_MAX_MB`
- checked both hinted size and downloaded size

## Command Menu Scopes

Startup refresh writes:
- default command scope for all chats (common commands)
- chat-specific command scope for main chat (common + admin commands)

If main chat changes, previous main scope is reset.

## Command Surface (From `src/index.ts`)

Common:
- `/help`
- `/status`
- `/id`
- `/models [query]`
- `/model [provider/model|reset]`
- `/think [off|minimal|low|medium|high|xhigh]`
- `/reasoning [off|on|stream]`
- `/new` and `/reset`
- `/stop`
- `/usage [all|reset]`
- `/queue ...`
- `/compact [instructions]`

Admin-only (main chat):
- `/main <secret>`
- `/freechat add|remove|list`
- `/tasks`
- `/task_pause <id>`
- `/task_resume <id>`
- `/task_cancel <id>`
- `/groups`
- `/reload`
- `/panel`
- `/coder <task>`
- `/coder-plan <task>`
- `/subagents ...`

## Callback Panel Actions

Inline button callback data:
- `panel:tasks`
- `panel:coder`
- `panel:groups`
- `panel:health`

Only executable in main chat.
