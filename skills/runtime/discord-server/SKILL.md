---
name: discord-server
description: Complete Discord server interaction via Discord bot API for posting messages, uploading/downloading images and files, editing/deleting messages, reading channel content, responding to mentions, and full server integration. Use when users need to (1) Post AI-generated images or content to Discord channels, (2) Download images from Discord for processing, (3) Automate Discord notifications and updates, (4) Manage bot messages (edit/delete), (5) Read channel messages and attachments, (6) Respond to bot mentions or tags, (7) List and interact with server channels, or (8) any other Discord server integration tasks.
---

# Discord Server Integration

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

Complete Discord bot integration for posting, downloading, and managing content on Discord servers.

## Overview

This skill provides Python scripts for comprehensive Discord server interaction through the Discord bot API. All operations use a bot token for authentication and support common Discord operations including message posting, image uploads/downloads, message management, and channel navigation.

## Prerequisites

Before using this skill, complete the setup process:

1. **Bot Token Required**: See [references/setup_guide.md](references/setup_guide.md) for exact click-by-click instructions to create a Discord bot and obtain your token
2. **Environment Configuration**: Copy `assets/.env.template` to `.env` and add your bot token
3. **Python Dependencies**: Install `discord.py`, `python-dotenv`, and `aiohttp`

```bash
pip install discord.py python-dotenv aiohttp
```

## Quick Start

### 1. Set Up Environment

```bash
# Copy template
cp assets/.env.template .env

# Edit .env and add your token
DISCORD_BOT_TOKEN=your_token_here
```

### 2. Test Connection

```bash
python scripts/discord_client.py
```

Expected output:
```
✅ Bot connected as YourBotName (ID: 123456789)
```

### 3. Get Channel IDs

Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode), then right-click any channel and select "Copy Channel ID".

Or use the list_channels script:

```bash
python scripts/list_channels.py
```

### 4. Post Your First Message

```bash
python scripts/post_message.py CHANNEL_ID "Hello, Discord!"
```

## Core Operations

### Posting Messages

Use `scripts/post_message.py` to send text messages:

```bash
# Simple message
python scripts/post_message.py 123456789 "Hello, World!"

# Message with embed
python scripts/post_message.py 123456789 "Important update" \
  --embed-title "Status Report" \
  --embed-description "All systems operational" \
  --embed-color 0x00FF00
```

**When to use**: Sending notifications, status updates, or text announcements to Discord channels.

### Uploading Images

Use `scripts/upload_image.py` to upload images and files:

```bash
# Upload single image
python scripts/upload_image.py 123456789 /path/to/image.png

# Upload with caption
python scripts/upload_image.py 123456789 /path/to/image.png \
  --caption "Check out this AI-generated artwork!"

# Upload multiple images (up to 10)
python scripts/upload_image.py 123456789 image1.png image2.png image3.png \
  --caption "Gallery of variations"
```

**Supported formats**: PNG, JPEG, WEBP, GIF

**When to use**: Sharing AI-generated images, posting visual content, creating image galleries.

### Downloading Images

Use `scripts/download_images.py` to download images from Discord:

```bash
# Download from specific message
python scripts/download_images.py 123456789 --message-id 987654321 \
  --output-dir ./downloads

# Download from last 20 messages
python scripts/download_images.py 123456789 --limit 20 \
  --output-dir ./input_images
```

**When to use**: Fetching reference images, downloading user-uploaded images for processing, collecting image datasets.

### Editing Messages

Use `scripts/edit_message.py` to edit bot messages:

```bash
# Edit message content
python scripts/edit_message.py 123456789 987654321 "Updated content"
```

**Note**: Can only edit messages posted by the bot itself.

**When to use**: Updating status messages, correcting posted content, showing progress updates.

### Deleting Messages

Use `scripts/delete_message.py` to delete bot messages:

```bash
python scripts/delete_message.py 123456789 987654321
```

**Note**: Can only delete messages posted by the bot itself.

**When to use**: Removing outdated messages, cleaning up test posts.

### Reading Messages

Use `scripts/read_messages.py` to read channel content:

```bash
# Read last 10 messages
python scripts/read_messages.py 123456789

# Read last 50 messages
python scripts/read_messages.py 123456789 --limit 50

# Read messages before specific message
python scripts/read_messages.py 123456789 --before 987654321 --limit 20

# Output as JSON for parsing
python scripts/read_messages.py 123456789 --format json
```

**When to use**: Monitoring channel activity, analyzing message content, checking for specific messages.

### Listing Channels

Use `scripts/list_channels.py` to discover available channels:

```bash
# List all channels from all servers
python scripts/list_channels.py

# List channels from specific server
python scripts/list_channels.py --guild-id 123456789

# JSON output
python scripts/list_channels.py --format json
```

**When to use**: Finding channel IDs, discovering server structure, verifying bot access.

### Responding to Mentions

Use `scripts/get_mentions.py` to find where the bot is mentioned:

```bash
# Get mentions from all channels
python scripts/get_mentions.py

# Get mentions from specific channel
python scripts/get_mentions.py --channel-id 123456789

# Check more messages per channel
python scripts/get_mentions.py --limit 50
```

**When to use**: Building interactive bots, responding to user requests, monitoring bot tags.

## Common Workflows

### Workflow 1: AI Image Generation → Discord

Generate image with AI and post to Discord:

```bash
# After generating image with your app
python scripts/upload_image.py 123456789 ./output.png \
  --caption "Fresh AI creation!"
```

### Workflow 2: Discord → AI Processing → Discord

Download, process, and re-upload:

```bash
# Download image
python scripts/download_images.py 123456789 \
  --message-id 987654321 --output-dir ./temp

# Process with your app (creates ./processed.png)

# Upload result
python scripts/upload_image.py 123456789 ./processed.png \
  --caption "Processed version ready!"
```

### Workflow 3: Progress Updates

Update a message to show progress:

```python
from post_message import post_message
from edit_message import edit_message
from discord_client import run_async

async def show_progress():
    # Post initial message
    result = await post_message(123456789, "Processing: 0%")
    msg_id = result['message_id']

    # Update progress
    await edit_message(123456789, msg_id, "Processing: 50%")
    # ... do work ...
    await edit_message(123456789, msg_id, "Complete! ✅")

run_async(show_progress())
```

### Workflow 4: Batch Image Processing

Process multiple images from a channel:

```bash
# Download recent images
python scripts/download_images.py 123456789 --limit 20 \
  --output-dir ./batch_input

# Process images with your app (saves to ./batch_output/)

# Upload all results
python scripts/upload_image.py 123456789 \
  ./batch_output/*.png --caption "Batch processing complete!"
```

## Integration with Python Code

All scripts can be imported and used programmatically:

```python
import sys
sys.path.append('./scripts')
from upload_image import upload_image
from download_images import download_recent_images
from discord_client import run_async

async def my_workflow():
    # Download images
    result = await download_recent_images(
        channel_id=123456789,
        limit=10,
        output_dir='./input'
    )

    # Upload images
    await upload_image(
        channel_id=123456789,
        image_path='./output.png',
        caption='Done!'
    )

run_async(my_workflow())
```

## Advanced Usage

### Custom Embed Messages

```bash
python scripts/post_message.py 123456789 "Status Update" \
  --embed-title "System Status" \
  --embed-description "All systems operational" \
  --embed-color 0x00FF00
```

### Batch Operations

```python
# Upload multiple images efficiently
from upload_image import upload_multiple_images
from discord_client import run_async

async def batch_upload():
    await upload_multiple_images(
        channel_id=123456789,
        image_paths=['img1.png', 'img2.png', 'img3.png'],
        caption='Triple feature!'
    )

run_async(batch_upload())
```

### Error Handling

```python
import discord
from upload_image import upload_image
from discord_client import run_async

async def safe_upload():
    try:
        await upload_image(123456789, './image.png')
    except discord.Forbidden:
        print("Missing permissions")
    except discord.NotFound:
        print("Channel not found")
    except FileNotFoundError:
        print("Image not found")

run_async(safe_upload())
```

## Troubleshooting

### "Invalid Token" Error
- Token may be incorrect or expired
- Reset token in Discord Developer Portal
- Update `.env` file with new token

### "Missing Access" Error
- Bot lacks permission to access channel
- Right-click channel > Edit Channel > Permissions
- Add bot role with appropriate permissions

### "Message Content Intent" Error
- Enable Message Content Intent in Discord Developer Portal
- Application > Bot > Privileged Gateway Intents
- Toggle ON "Message Content Intent"

### Bot Not Responding
- Verify bot is online (green status in server)
- Check you're using correct channel ID
- Verify bot has Send Messages permission

## Reference Documentation

**For detailed information, see:**

- **[references/setup_guide.md](references/setup_guide.md)** - Complete step-by-step setup instructions with exact clicks to obtain bot token
- **[references/api_reference.md](references/api_reference.md)** - Discord API patterns, embed formatting, permissions, and error handling
- **[references/examples.md](references/examples.md)** - Comprehensive workflows, integration patterns, and advanced usage examples

## Script Reference

| Script | Purpose | Key Arguments |
|--------|---------|---------------|
| `discord_client.py` | Test bot connection | None (run directly) |
| `post_message.py` | Send text messages | `channel_id`, `content`, optional embeds |
| `upload_image.py` | Upload images/files | `channel_id`, `image_path(s)`, optional caption |
| `download_images.py` | Download images | `channel_id`, optional `message_id` or `limit` |
| `edit_message.py` | Edit bot messages | `channel_id`, `message_id`, `new_content` |
| `delete_message.py` | Delete bot messages | `channel_id`, `message_id` |
| `read_messages.py` | Read channel messages | `channel_id`, optional `limit`, `before`, `after` |
| `list_channels.py` | List available channels | Optional `guild_id` |
| `get_mentions.py` | Find bot mentions | Optional `channel_id`, `limit` |

## Security Best Practices

1. Never commit `.env` file to version control
2. Add `.env` to `.gitignore`
3. Never share bot token publicly
4. Regenerate token if exposed
5. Use minimal required permissions
6. Keep bot code private

## Assets

- **`.env.template`** - Environment variable template for bot configuration
