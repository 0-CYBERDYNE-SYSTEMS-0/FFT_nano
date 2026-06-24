# HEARTBEAT.md

- Check for active failures in runtime logs and surface only actionable alerts.
- Check pending coding/delegation threads and report if blocked.
- Check whether main workspace has unresolved TODOs from recent runs.
- Evaluate memories. Update relative docs with new memories if any.

## Maintenance Rituals (enforced owner)

Run these during heartbeat if they have not run recently:

### Daily Memory Compaction
- If >7 files exist in `memory/`: read oldest, promote any durable signal to MEMORY.md or knowledge/, then `mv` (never `rm`) to `memory/trash/`.
- Report counts and any novel signal extracted before moving files.
- If file count is large and exhaustive reading would stall, read a stratified sample (oldest, newest, middle) and state the sample scope explicitly.

### MEMORY.md Tier Review
- Scan Active Context entries. If any entry is >30 days old: keep (update validated date), archive to `memory/archive/`, or delete.

### Daily-Log Promotion
- Read yesterday's daily log if it exists. Scan for decisions, constraints, or preferences worth keeping. Promote durable signal immediately to MEMORY.md or a skill.

If no actionable update exists, respond exactly: HEARTBEAT_OK
