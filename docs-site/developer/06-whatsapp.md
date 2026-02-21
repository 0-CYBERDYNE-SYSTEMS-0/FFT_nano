# WhatsApp Integration

Primary files:
- `src/index.ts` (connection, event handling)
- `src/whatsapp-auth.ts` (one-time auth)

Dependency:
- `@whiskeysockets/baileys`

## Authentication Flow

One-time auth command:
```bash
npm run auth
```

`src/whatsapp-auth.ts`:
- creates `store/auth` multi-file auth state
- prints QR to terminal
- waits for connection open
- saves creds and exits

## Runtime Socket Setup

`connectWhatsApp()` in `src/index.ts`:
- loads `store/auth`
- creates Baileys socket
- registers handlers:
  - `connection.update`
  - `creds.update`
  - `messages.upsert`

## Connection Behaviors

On QR event:
- host logs auth-required error
- on macOS, triggers notification
- exits process so operator can run auth flow

On close:
- reconnect unless logged out
- exits when logged out

On open:
- records LID->phone JID mapping for self-chat translation
- bootstraps main chat from WhatsApp self-chat when no main exists
- triggers group metadata sync
- starts scheduler + IPC watcher + message loop

## LID Translation

Recent WhatsApp behavior may emit `@lid` addresses for self chats.

`translateJid(jid)` maps known LID user to `<phone>@s.whatsapp.net` so host storage and routing stay stable.

## Message Persistence Policy

In `messages.upsert`:
- chat metadata is stored for all non-status messages
- full message content is stored only if chat is registered

Stored content extraction priority from Baileys payload:
- `conversation`
- `extendedTextMessage.text`
- image/video captions

## Main-Chat Bootstrap

If no main group exists and socket user id is known:
- register `<phone>@s.whatsapp.net` as `folder=main`

This ensures an admin/control channel exists even before Telegram main is claimed.
