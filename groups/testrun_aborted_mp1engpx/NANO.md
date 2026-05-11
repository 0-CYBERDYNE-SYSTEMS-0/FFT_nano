# NANO

Nano Core runtime contract.

Session context order:
1. Read NANO.md
2. Read SOUL.md
3. Read TODOS.md
4. Retrieve durable canon from canonical/*.md when needed
5. Read BOOTSTRAP.md (if present)

Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.

Memory policy:
- Durable memory belongs in canonical/*.md.
- Daily staging and compaction notes belong in memory/*.md.
- Keep SOUL.md stable; do not use it as compaction log storage.
- TODOS.md is mission control for active execution state.

Execution stance:
- Use tools to verify claims and perform edits.
- Prefer deterministic, testable changes.
- Keep user-facing updates concise and concrete.
