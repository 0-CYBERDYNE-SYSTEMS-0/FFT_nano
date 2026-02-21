# Discord API Quick Reference

Reference for common Discord.py methods, patterns, and best practices when working with the Discord API.

## ID Formats

All Discord IDs are **integers (snowflakes)**:

- **Channel ID**: `123456789012345678` (integer)
- **Message ID**: `987654321098765432` (integer)
- **Guild ID**: `111222333444555666` (integer)
- **User ID**: `777888999000111222` (integer)

### Getting IDs

Enable Developer Mode in Discord:
1. User Settings > App Settings > Advanced
2. Toggle ON "Developer Mode"
3. Right-click any channel/user/server > "Copy ID"

## Common Discord.py Patterns

### Sending Messages

```python
# Simple text message
await channel.send("Hello, World!")

# Message with embed
embed = discord.Embed(
    title="Title Here",
    description="Description here",
    color=0x5865F2  # Discord Blurple
)
await channel.send(content="Optional text", embed=embed)

# Message with file
file = discord.File("path/to/image.png")
await channel.send(file=file)

# Message with multiple files
files = [discord.File("image1.png"), discord.File("image2.png")]
await channel.send(files=files)
```

### Reading Messages

```python
# Get single message
message = await channel.fetch_message(message_id)

# Read last N messages
async for message in channel.history(limit=10):
    print(message.content)

# Read messages before a specific message
async for message in channel.history(limit=10, before=message_id):
    print(message.content)

# Read messages after a specific message
async for message in channel.history(limit=10, after=message_id):
    print(message.content)
```

### Editing Messages

```python
# Edit message content
await message.edit(content="New content")

# Edit message embed
new_embed = discord.Embed(title="Updated", description="New info")
await message.edit(embed=new_embed)
```

### Deleting Messages

```python
# Delete a message
await message.delete()

# Delete with delay (seconds)
await message.delete(delay=5.0)
```

### Working with Channels

```python
# Get channel by ID (cached)
channel = bot.get_channel(channel_id)

# Fetch channel by ID (API call)
channel = await bot.fetch_channel(channel_id)

# List all channels in guild
for channel in guild.channels:
    print(f"{channel.name}: {channel.id}")

# Get text channels only
text_channels = guild.text_channels

# Get voice channels only
voice_channels = guild.voice_channels
```

### Working with Guilds

```python
# Get guild by ID (cached)
guild = bot.get_guild(guild_id)

# Fetch guild by ID (API call)
guild = await bot.fetch_guild(guild_id)

# List all guilds bot is in
for guild in bot.guilds:
    print(f"{guild.name}: {guild.id}")
```

## Embed Formatting

### Basic Embed

```python
embed = discord.Embed(
    title="Embed Title",
    description="Embed Description",
    color=0x00FF00  # Green
)
```

### Embed with Fields

```python
embed = discord.Embed(title="Title")
embed.add_field(name="Field 1", value="Value 1", inline=False)
embed.add_field(name="Field 2", value="Value 2", inline=True)
embed.add_field(name="Field 3", value="Value 3", inline=True)
```

### Embed with Image/Thumbnail

```python
embed = discord.Embed(title="Image Example")
embed.set_image(url="https://example.com/image.png")
embed.set_thumbnail(url="https://example.com/thumbnail.png")
```

### Embed with Footer/Timestamp

```python
from datetime import datetime

embed = discord.Embed(title="Title")
embed.set_footer(text="Footer text")
embed.timestamp = datetime.now()
```

### Common Embed Colors

```python
# Discord brand colors
DISCORD_BLURPLE = 0x5865F2
DISCORD_GREEN = 0x57F287
DISCORD_YELLOW = 0xFEE75C
DISCORD_FUCHSIA = 0xEB459E
DISCORD_RED = 0xED4245

# Traffic light colors
GREEN = 0x00FF00
YELLOW = 0xFFFF00
RED = 0xFF0000

# Generic colors
BLUE = 0x0000FF
ORANGE = 0xFFA500
PURPLE = 0x800080
```

## File Handling

### Uploading Files

```python
# Single file
file = discord.File("/path/to/file.png", filename="custom_name.png")
await channel.send(file=file)

# Multiple files (max 10)
files = [
    discord.File("image1.png"),
    discord.File("image2.png"),
    discord.File("image3.png")
]
await channel.send(files=files)

# File with caption
await channel.send(content="Check this out!", file=discord.File("image.png"))
```

### Downloading Attachments

```python
# Get attachment from message
for attachment in message.attachments:
    await attachment.save(f"./downloads/{attachment.filename}")

# Download with custom name
for attachment in message.attachments:
    await attachment.save(f"./downloads/custom_name.png")

# Check if attachment is an image
if attachment.content_type and attachment.content_type.startswith('image/'):
    await attachment.save(f"./{attachment.filename}")
```

### File Size Limits

- **Regular servers**: 8 MB per file
- **Server Boost Level 2**: 50 MB per file
- **Server Boost Level 3**: 100 MB per file
- **Nitro users**: 500 MB per file (in Nitro-boosted servers)

## Permissions

### Required Bot Permissions

For this skill's scripts to work, the bot needs these permissions:

- **View Channels**: See channels in the server
- **Send Messages**: Post messages
- **Attach Files**: Upload images and files
- **Read Message History**: Read past messages
- **Manage Messages**: Edit/delete messages (optional)

### Checking Permissions

```python
# Check if bot has permission in channel
if channel.permissions_for(guild.me).send_messages:
    await channel.send("I can send messages here!")

# Check multiple permissions
perms = channel.permissions_for(guild.me)
if perms.send_messages and perms.attach_files:
    await channel.send(file=discord.File("image.png"))
```

## Rate Limiting

Discord enforces rate limits to prevent abuse. The discord.py library handles rate limiting automatically.

### Rate Limit Guidelines

- **Sending messages**: ~5 messages per 5 seconds per channel
- **Editing messages**: ~5 edits per 5 seconds
- **Deleting messages**: ~5 deletes per 5 seconds
- **Global rate limit**: 50 requests per second across all endpoints

### Best Practices

1. Don't spam messages rapidly
2. Use bulk operations when possible
3. The library automatically waits for rate limits to reset
4. Add delays between operations if doing batch processing

## Intents

Intents control what events your bot receives. **Message Content Intent** is privileged and must be enabled in the Developer Portal.

### Required Intents

```python
intents = discord.Intents.default()
intents.message_content = True  # REQUIRED for reading message content
intents.guilds = True           # Server information
intents.messages = True         # Message events

bot = commands.Bot(command_prefix='!', intents=intents)
```

### Enabling Privileged Intents

1. Go to Discord Developer Portal
2. Select your application
3. Click "Bot" in sidebar
4. Scroll to "Privileged Gateway Intents"
5. Toggle ON "Message Content Intent"
6. Click "Save Changes"

## Error Handling

### Common Exceptions

```python
try:
    await channel.send("Hello!")
except discord.Forbidden:
    # Bot lacks permission
    print("Missing permission to send messages")
except discord.NotFound:
    # Channel/message doesn't exist
    print("Channel not found")
except discord.HTTPException as e:
    # General HTTP error
    print(f"HTTP error: {e.status} - {e.text}")
```

### HTTP Status Codes

- **401 Unauthorized**: Invalid token
- **403 Forbidden**: Missing permissions
- **404 Not Found**: Resource doesn't exist
- **429 Too Many Requests**: Rate limited
- **500 Internal Server Error**: Discord server issue

## Message Formatting

### Text Formatting

```python
# Bold
await channel.send("**bold text**")

# Italic
await channel.send("*italic text*")

# Underline
await channel.send("__underlined text__")

# Strikethrough
await channel.send("~~strikethrough text~~")

# Code
await channel.send("`inline code`")

# Code block
await channel.send("```python\nprint('Hello')\n```")

# Spoiler
await channel.send("||spoiler text||")

# Quote
await channel.send("> quoted text")
```

### Mentions

```python
# Mention user
await channel.send(f"Hello {user.mention}!")

# Mention channel
await channel.send(f"Check out {channel.mention}")

# Mention role
await channel.send(f"Hey {role.mention}!")

# Everyone/Here (requires permission)
await channel.send("@everyone Important message!")
await channel.send("@here Who's online?")
```

## Async/Await Patterns

### Running Async Functions

```python
import asyncio

# Run async function
asyncio.run(my_async_function())

# Get or create event loop
loop = asyncio.get_event_loop()
loop.run_until_complete(my_async_function())

# Multiple concurrent operations
await asyncio.gather(
    channel1.send("Message 1"),
    channel2.send("Message 2"),
    channel3.send("Message 3")
)
```

### Helper Function

```python
def run_async(coro):
    """Run async function from sync context."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)

# Usage
result = run_async(send_message(channel_id, "Hello!"))
```

## Debugging

### Enable Debug Logging

```python
import logging

logging.basicConfig(level=logging.DEBUG)
```

### Common Debug Checks

```python
# Check bot is connected
print(f"Bot user: {bot.user}")
print(f"Guilds: {len(bot.guilds)}")

# Check channel access
channel = bot.get_channel(channel_id)
print(f"Channel: {channel}")
print(f"Can send: {channel.permissions_for(channel.guild.me).send_messages}")

# Check message details
print(f"Message ID: {message.id}")
print(f"Author: {message.author}")
print(f"Content: {message.content}")
print(f"Attachments: {len(message.attachments)}")
```

## Additional Resources

- **Discord.py Documentation**: https://discordpy.readthedocs.io/
- **Discord API Documentation**: https://discord.com/developers/docs/
- **Discord.py Examples**: https://github.com/Rapptz/discord.py/tree/master/examples
- **Discord Developer Portal**: https://discord.com/developers/applications
