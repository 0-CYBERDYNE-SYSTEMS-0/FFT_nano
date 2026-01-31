# NanoClaw Global Memory

This file is read by all group conversations. Only the main channel can write here.

## About

Personal Claude assistant via WhatsApp.

Assistant name is configured in `src/config.py` (ASSISTANT_NAME).

## Commands

From any group:
- `@{name} [message]` - Talk to Claude
- `/clear` - Reset conversation (keeps memory)
- `@{name} list tasks` - Show scheduled tasks

From main channel only:
- `@{name} add group "Name"` - Register a new group
- `@{name} remove group "Name"` - Unregister a group
- `@{name} list groups` - Show registered groups
- `@{name} remember [fact]` - Add to global memory

## Preferences

<!-- Add global preferences here -->

## Notes

<!-- Add persistent notes here -->
