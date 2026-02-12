# Coder Delegation Safety

Hard constraints:

- Delegation trigger must be explicit (`/coder`, `/coder-plan`, alias phrases).
- Delegation only in main/admin chat.
- Non-main chats cannot run coder delegation.
- Scheduled task turns cannot run coder delegation.

Expected user-facing feedback:

- Start message with request id before delegated run.
- Progress streaming when available.
- No duplicate final message after streamed delegation result.
