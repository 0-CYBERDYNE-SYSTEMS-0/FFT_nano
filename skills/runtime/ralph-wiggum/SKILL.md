---
name: ralph-wiggum
description: Autonomous "night shift" loop agent for research, testing, documentation, and background tasks using sessions_spawn, exec, Git, and message tools.
---

# Ralph Wiggum - The Night Shift Agent 🌙

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Ralph is your autonomous background worker. He loops through tasks, spawns sub-agents, runs shell commands, manages Git operations, and reports back — all while you sleep.

## The Big Idea

```
┌─────────────────────────────────────────────┐
│  RALPH'S LOOP (runs continuously or once)   │
├─────────────────────────────────────────────┤
│  1. Spawn sub-agent for task                │
│  2. Wait for result                         │
│  3. Execute shell commands if needed         │
│  4. Commit changes to Git                   │
│  5. Send report via message tool            │
│  6. Loop to next task (or exit)             │
└─────────────────────────────────────────────┘
```

**Ralph's job:** Run your recurring tasks automatically. Research, testing, documentation, anything that doesn't need your immediate attention.

---

## Core Tools (The "Ralph Stack")

Ralph is a wrapper around 4 Clawdbot tools:

| Tool | What Ralph Does With It |
|------|------------------------|
| `sessions_spawn` | Spawn sub-agent sessions for complex tasks |
| `exec` | Run shell commands (npm install, tests, Git) |
| `Git` | Clone, commit, push, check status |
| `message` | Send reports to you (WhatsApp, Telegram, etc.) |

---

## Basic Loop Pattern

### Simple One-Shot Task

```bash
# Ralph runs one task and reports back
sessions_spawn task:"Research recent AgTech funding trends and summarize with sources" label:"ralph-research"
# Returns session ID for tracking
```

**Result:** Sub-agent researches, completes, and Clawdbot automatically pings you.

---

### Multi-Step Loop (The "Night Shift")

```bash
# 1. Spawn research agent
SESSION_ID=$(sessions_spawn task:"Research 5 recent AgTech funding rounds, analyze patterns, create summary with sources" label:"ralph-agtech")

# 2. Wait for completion (poll)
while true; do
  STATUS=$(sessions_list | grep "$SESSION_ID" | jq -r '.status')
  if [ "$STATUS" = "completed" ]; then
    break
  fi
  sleep 60
done

# 3. Clone target repo
git clone https://github.com/user/repo.git /tmp/repo-work
cd /tmp/repo-work

# 4. Generate report from session history
SESSION_HISTORY=$(sessions_history sessionKey:$SESSION_ID)
echo "$SESSION_HISTORY" > /tmp/repo-work/agtech-research.md

# 5. Commit changes
git add .
git commit -m "docs: add AgTech funding research (Ralph Wiggum)"
git push origin main

# 6. Send notification
message action:send provider:telegram to:"@your_handle" message:"✅ Ralph completed AgTech research! Report committed to repo."

# 7. Clean up
rm -rf /tmp/repo-work
```

---

## Configuration Options

### Loop Control

| Parameter | Options | Default |
|-----------|---------|---------|
| `runOnce` | `true`/`false` | `false` |
| `interval` | Time string (`1h`, `30m`, `2d`) | `1h` |
| `maxLoops` | Number or `null` (infinite) | `null` |
| `exitOnFailure` | `true`/`false` | `false` |

### Sub-Agent Settings

| Parameter | Options | Default |
|-----------|---------|---------|
| `agentId` | Agent ID from `agents_list` | Default |
| `model` | Model alias or full provider/model | Default |
| `runTimeoutSeconds` | Timeout for each spawn | `3600` |
| `cleanup` | `delete`/`keep` | `delete` |

---

## Common Use Cases

### 1. Nightly Research & Documentation

**Goal:** Keep up with industry trends while you sleep.

```bash
# Ralph runs every night at 10 PM, researches for 2 hours
sessions_spawn \
  task:"Scan Hacker News, TechCrunch, AgFunder for AI/AgTech news. Summarize 5 most relevant articles with links and analysis." \
  label:"ralph-nightly-news" \
  runTimeoutSeconds:7200

# After completion, append to daily memory
# (See "Advanced Pattern: Daily Log" below)
```

---

### 2. Automated Testing & CI Monitoring

**Goal:** Run tests and report failures without manual checking.

```bash
# Ralph loops every 30 minutes, runs tests
while true; do
  # Spawn sub-agent to run tests
  TEST_SESSION=$(sessions_spawn \
    task:"Run full test suite, capture failing tests, create bug reports for any failures with reproduction steps" \
    label:"ralph-test-runner" \
    agentId:"coding-agent" \
    runTimeoutSeconds:1800
  )

  # Wait for result
  sleep 1800  # 30 min timeout

  # Check for failures
  TEST_HISTORY=$(sessions_history sessionKey:$TEST_SESSION)
  if echo "$TEST_HISTORY" | grep -q "FAILING"; then
    # Alert via message tool
    message action:send provider:telegram to:"@your_handle" message:"⚠️ Test failures detected. Check session: $TEST_SESSION"
  fi

  # Clean up session
  sessions_spawn task:"exit" sessionId:$TEST_SESSION cleanup:"delete"

  # Wait before next loop
  sleep 1800  # 30 min
done
```

---

### 3. Continuous Market Research (The "Money Finder")

**Goal:** Find business opportunities, partnerships, deals.

```bash
# Ralph runs daily, scans for opportunities
sessions_spawn \
  task:"Search for Texas agriculture companies looking for tech partnerships. Find CEOs, founders, decision-makers. Compile list with contact info and partnership angles." \
  label:"ralph-money-finder" \
  runTimeoutSeconds:5400  # 1.5 hours

# After completion, send to TD's WhatsApp
message action:send provider:whatsapp to:"+15416006591" message:"💰 Ralph found 5 potential partners! Check session for full details."
```

---

### 4. Competitive Intelligence

**Goal:** Track competitors, pricing changes, product launches.

```bash
# Ralph monitors competitor websites daily
sessions_spawn \
  task:"Check FarmFriend.io and 3 competitors. Look for pricing changes, new features, blog posts, announcements. Create diff report." \
  label:"ralph-competitor-watch" \
  runTimeoutSeconds:3600

# Commit report to Git for tracking
# (See "Advanced Pattern: Git Integration" below)
```

---

### 5. Documentation Maintenance

**Goal:** Keep docs fresh, update changelogs, fix broken links.

```bash
# Ralph reviews docs weekly
sessions_spawn \
  task:"Review all .md files in repo. Check for broken links, outdated info, missing examples. Create TODO list with file paths and fixes needed." \
  label:"ralph-doc-maintainer" \
  runTimeoutSeconds:7200
```

---

## Advanced Patterns

### Pattern: Daily Log

Keep a running log of Ralph's work:

```bash
# Create daily log file
DATE=$(date +%Y-%m-%d)
LOG_FILE="/Users/username/clawd/memory/${DATE}-ralph.md"

# Start log
echo "# Ralph Wiggum - ${DATE}" > "$LOG_FILE"
echo "## Tasks Completed" >> "$LOG_FILE"

# For each task, append result
echo "- [Task 1] Research completed at $(date)" >> "$LOG_FILE"
echo "  Result: $SESSION_RESULT" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
```

---

### Pattern: Git Integration

Commit Ralph's work automatically:

```bash
# Clone repo
WORK_DIR=$(mktemp -d)
git clone https://github.com/user/repo.git "$WORK_DIR"
cd "$WORK_DIR"

# Spawn Ralph session
SESSION=$(sessions_spawn task:"..." label:"ralph-task")

# Wait for completion
sleep 3600

# Get result and write to repo
RESULT=$(sessions_history sessionKey:$SESSION)
echo "$RESULT" > ralph-output.md

# Commit and push
git add .
git commit -m "docs: add Ralph Wiggum research output"
git push origin main

# Cleanup
rm -rf "$WORK_DIR"
```

---

### Pattern: Parallel Research (The "Ralph Army")

Spawn multiple Ralphs for parallel work:

```bash
# Ralph 1: Research
R1=$(sessions_spawn task:"Research AgTech trends" label:"ralph-research")

# Ralph 2: Competitive analysis
R2=$(sessions_spawn task:"Analyze competitors" label:"ralph-competitor")

# Ralph 3: Market sizing
R3=$(sessions_spawn task:"Size Texas AgTech market" label:"ralph-market")

# Wait for all to complete
sleep 7200  # 2 hours

# Aggregate results
for SESSION in $R1 $R2 $R3; do
  sessions_history sessionKey:$SESSION
done > /tmp/ralph-full-report.md

# Send summary
message action:send provider:telegram to:"@your_handle" message:"🎯 Ralph Army complete! Full report saved."
```

---

### Pattern: Conditional Looping

Only continue if previous task succeeded:

```bash
# Task 1: Research
T1=$(sessions_spawn task:"..." label:"ralph-t1")
T1_RESULT=$(sessions_history sessionKey:$T1)

# Check if successful
if echo "$T1_RESULT" | grep -q "SUCCESS"; then
  # Task 2: Only runs if T1 succeeded
  T2=$(sessions_spawn task:"..." label:"ralph-t2")
else
  # Alert and exit
  message action:send provider:telegram to:"@your_handle" message:"❌ Ralph Task 1 failed, aborting Task 2"
fi
```

---

### Pattern: Smart Retry

Retry failed tasks with backoff:

```bash
MAX_RETRIES=3
RETRY_DELAY=300  # 5 minutes

for i in $(seq 1 $MAX_RETRIES); do
  SESSION=$(sessions_spawn task:"..." label:"ralph-retry-$i")
  RESULT=$(sessions_history sessionKey:$SESSION)

  if echo "$RESULT" | grep -q "SUCCESS"; then
    break  # Success!
  fi

  if [ $i -lt $MAX_RETRIES ]; then
    echo "Retry $i failed, waiting $RETRY_DELAY seconds..."
    sleep $RETRY_DELAY
  else
    # Final failure alert
    message action:send provider:telegram to:"@your_handle" message:"❌ Ralph task failed after $MAX_RETRIES retries"
  fi
done
```

---

## Safety Limits (Critical!)

Ralph should never run wild. Set limits:

| Limit | Recommended Setting | Why |
|-------|---------------------|-----|
| `runTimeoutSeconds` | `7200` (2 hours) per spawn | Prevent infinite loops |
| `maxLoops` | `10` or `null` with `interval` | Cap total iterations |
| `cleanup` | `delete` | Clean up sessions after use |
| `exitOnFailure` | `true` for critical tasks | Stop on errors |

### Never Do This:

```bash
# ❌ BAD: Infinite loop with no timeout
while true; do
  sessions_spawn task:"..."
done
```

### Always Do This:

```bash
# ✅ GOOD: Timeout + cleanup + loop cap
MAX_LOOPS=10
LOOP_COUNT=0

while [ $LOOP_COUNT -lt $MAX_LOOPS ]; do
  SESSION=$(sessions_spawn \
    task:"..." \
    label:"ralph-task-$LOOP_COUNT" \
    runTimeoutSeconds:7200 \
    cleanup:"delete"
  )

  LOOP_COUNT=$((LOOP_COUNT + 1))
done
```

---

## Cron Integration

Run Ralph on a schedule via Clawdbot cron:

```bash
# Add cron job to run Ralph daily at 2 AM
cron action:add job:({
  "name": "ralph-nightly-research",
  "schedule": "0 2 * * *",  # 2 AM daily
  "command": "sessions_spawn task:'Research AgTech news and trends' label:'ralph-nightly' runTimeoutSeconds:7200 cleanup:'delete'",
  "enabled": true
})
```

---

## Troubleshooting

### Ralph Gets Stuck

```bash
# Check running sessions
sessions_list kinds:["ralph"]

# Kill stuck session
process action:kill sessionId:XXX

# Force cleanup
sessions_spawn task:"exit" sessionId:XXX cleanup:"delete"
```

### Session Not Found

```bash
# List all sessions to find correct sessionKey
sessions_list

# Search by label
sessions_list | grep "ralph"
```

### No Report Received

```bash
# Check session history
sessions_history sessionKey:XXX

# Verify message tool access
message action:send provider:telegram to:"@your_handle" message:"Test: Ralph reporting in."
```

---

## Best Practices

1. **Always set `runTimeoutSeconds`** — Prevent runaway processes
2. **Use `cleanup:delete`** — Keep sessions clean
3. **Send progress reports** — Use `message` tool for visibility
4. **Commit to Git** — Track Ralph's work over time
5. **Set `exitOnFailure:true`** for critical tasks
6. **Use labels** — Track what each Ralph is doing
7. **Monitor with `sessions_list`** — Check status regularly
8. **Start small** — Test one-shot before full loops

---

## Example: Full Night Shift Script

```bash
#!/bin/bash
# Ralph's Night Shift - Runs 2 AM daily

echo "🌙 Ralph starting night shift: $(date)"

# Task 1: Research AgTech news
T1=$(sessions_spawn \
  task:"Research top 10 AgTech news stories from yesterday. Summarize with links and analysis." \
  label:"ralph-nightly-news" \
  runTimeoutSeconds:3600 \
  cleanup:"delete"
)

echo "📰 Task 1 (Research) started: $T1"
sleep 3600  # Wait for completion

# Task 2: Competitive analysis
T2=$(sessions_spawn \
  task:"Check competitor websites for pricing changes, new features, announcements." \
  label:"ralph-competitor-check" \
  runTimeoutSeconds:3600 \
  cleanup:"delete"
)

echo "🔍 Task 2 (Competitors) started: $T2"
sleep 3600  # Wait for completion

# Aggregate results
DATE=$(date +%Y-%m-%d)
LOG_FILE="/Users/username/clawd/memory/${DATE}-ralph.md"

echo "# Ralph Wiggum Night Shift - ${DATE}" > "$LOG_FILE"
echo "" >> "$LOG_FILE"

echo "## AgTech News" >> "$LOG_FILE"
sessions_history sessionKey:$T1 >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

echo "## Competitive Intelligence" >> "$LOG_FILE"
sessions_history sessionKey:$T2 >> "$LOG_FILE"

# Send report
message action:send provider:telegram to:"@your_handle" message:"🌙 Ralph's night shift complete! Report saved to memory/${DATE}-ralph.md"

echo "✅ Ralph finished: $(date)"
```

---

## Getting Started

1. **Test one-shot task first:**
   ```bash
   sessions_spawn task:"Research one AgTech article" label:"ralph-test" runTimeoutSeconds:600 cleanup:"delete"
   ```

2. **Add message notifications:**
   ```bash
   # After session completes
   message action:send provider:telegram to:"@your_handle" message:"✅ Ralph task complete!"
   ```

3. **Add cron schedule:**
   ```bash
   cron action:add job:({
     "name": "ralph-daily",
     "schedule": "0 2 * * *",
     "command": "...",
     "enabled": true
   })
   ```

4. **Monitor progress:**
   ```bash
   sessions_list | grep ralph
   ```

---

**Ralph's motto:** "I do the work while you sleep. That's what loops are for!" 🌙💤

**Key benefit:** Autonomous research, testing, and documentation without your direct involvement. Free up your brain for high-leverage work.
