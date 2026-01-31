# Main Channel - Admin Context

You are running in the **main channel**, which has elevated privileges. You can:
- Manage registered groups (add, remove, list)
- Schedule tasks for any group
- View tasks from all groups
- Access all group folders
- **Run Bash commands** (only main has this access)

---

## Managing Groups

### Finding Available Groups

Groups appear in the database when messages are received. Query the SQLite database to find groups:

```sql
-- Find all group chats (JIDs ending in @g.us)
SELECT DISTINCT chat_jid, name FROM chats WHERE chat_jid LIKE '%@g.us';

-- Or find chats with recent messages
SELECT chat_jid, MAX(timestamp) as last_message
FROM messages
WHERE chat_jid LIKE '%@g.us'
GROUP BY chat_jid
ORDER BY last_message DESC;
```

Database location: `store/messages.db`

### Registered Groups Config

Groups are registered in `data/registered_groups.json`:

```json
{
  "1234567890-1234567890@g.us": {
    "name": "Family Chat",
    "folder": "family-chat",
    "trigger": "@Andy",
    "added_at": "2024-01-31T12:00:00.000Z"
  }
}
```

Fields:
- **Key**: The WhatsApp JID (unique identifier for the chat)
- **name**: Display name for the group
- **folder**: Folder name under `groups/` for this group's files and memory
- **trigger**: The trigger word (usually same as global, but could differ)
- **added_at**: ISO timestamp when registered

### Adding a Group

1. Query the database to find the group's JID
2. Read the current `data/registered_groups.json`
3. Add the new group entry
4. Write the updated JSON back
5. Create the group folder: `groups/{folder-name}/`
6. Optionally create an initial `CLAUDE.md` for the group

Example folder name conventions:
- "Family Chat" → `family-chat`
- "Work Team" → `work-team`
- Use lowercase, hyphens instead of spaces

### Removing a Group

1. Read `data/registered_groups.json`
2. Remove the entry for that group
3. Write the updated JSON back
4. The group folder and its files remain (don't delete them)

### Listing Groups

Read `data/registered_groups.json` and format it nicely for the user.

---

## Global Memory

You can read and write to `groups/CLAUDE.md` (the parent directory) for facts that should apply to all groups. Only update global memory when explicitly asked to "remember this globally" or similar.

---

## Scheduling for Other Groups

When scheduling tasks for other groups, use the `target_group` parameter:
- `schedule_task(prompt: "...", schedule_type: "cron", schedule_value: "0 9 * * 1", target_group: "family-chat")`

The task will run in that group's context with access to their files and memory.
