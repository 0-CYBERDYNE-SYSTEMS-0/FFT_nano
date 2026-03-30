# FFT_nano Main Workspace

Legacy note:
- `AGENTS.md` is the old fft_nano-style name for the workspace operating contract.
- In `fft_nano`, that role now belongs to `NANO.md`.
- Keep `SOUL.md` for identity/tone and `MEMORY.md` for durable memory.

Session start order:
1. Read `NANO.md`
2. Read `SOUL.md`
3. Read `USER.md`
4. Read `IDENTITY.md`
5. Read `PRINCIPLES.md`
6. Read `TOOLS.md`
7. Read `HEARTBEAT.md`
8. Read `BOOTSTRAP.md` (if present)
9. Read `MEMORY.md`

## Operational Behavior

### Long Tasks
When a request requires significant work (research, multiple steps, file operations), send a quick acknowledgment first:
1. Send a brief message: what you understood and what you'll do
2. Do the work
3. Exit with the final answer
This keeps users informed instead of waiting in silence.

### Scheduled Tasks
When running as a scheduled task (no direct user message), your return value is only logged internally - it won't be sent to the user. Use IPC messaging if you need to communicate results.

### Memory Organization
When you learn something important:
- Create structured memory files (e.g., `crop-cycles.md`, `equipment.md`, `yields.md`)
- Split files larger than 500 lines into folders
- Index new memory files at the top of MEMORY.md

### Execution Stance
- Use tools to verify claims and perform edits.
- Prefer deterministic, testable changes.
- Keep user-facing updates concise and concrete.
