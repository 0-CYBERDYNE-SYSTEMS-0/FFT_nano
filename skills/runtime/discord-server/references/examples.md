# Discord Integration Examples

Common usage patterns and workflows combining Discord operations with AI image processing.

## Basic Examples

### Example 1: Post AI-Generated Image

Generate an image with your photo editor and post it to Discord:

```bash
# Generate image with your app (saves to ./output.png)
# Then upload to Discord
python scripts/upload_image.py 123456789 ./output.png --caption "Check out this AI-generated image!"
```

### Example 2: Download Image for Processing

Download an image from Discord, process it, and post the result:

```bash
# Download image from specific message
python scripts/download_images.py 123456789 --message-id 987654321 --output-dir ./input

# Process the image with your app (saves to ./output.png)

# Upload processed image back to Discord
python scripts/upload_image.py 123456789 ./output.png --caption "Processed version"
```

### Example 3: Automated Workflow Notification

Send status updates during long-running processes:

```bash
# Start notification
python scripts/post_message.py 123456789 "Starting image processing batch..."

# Get the message ID from output, then update it
python scripts/edit_message.py 123456789 MESSAGE_ID "Processing complete! ✅"
```

## AI + Discord Workflows

### Workflow 1: Discord → AI Editing → Discord

Complete pipeline: download, edit, upload

```python
#!/usr/bin/env python3
import sys
sys.path.append('./scripts')
from download_images import download_images_from_message
from upload_image import upload_image
from discord_client import run_async

async def edit_and_repost():
    # Download image from Discord
    result = await download_images_from_message(
        channel_id=123456789,
        message_id=987654321,
        output_dir='./temp'
    )

    input_image = result['downloads'][0]['local_path']

    # Process image with your AI (pseudocode)
    # output_image = process_image(input_image, "make it vibrant")
    output_image = "./processed.png"

    # Upload result back to Discord
    await upload_image(
        channel_id=123456789,
        image_path=output_image,
        caption="Here's your edited version!"
    )

run_async(edit_and_repost())
```

### Workflow 2: Batch Process Recent Images

Process multiple recent images from a channel:

```python
#!/usr/bin/env python3
import sys
sys.path.append('./scripts')
from download_images import download_recent_images
from upload_image import upload_multiple_images
from discord_client import run_async

async def batch_process():
    # Download last 10 images
    result = await download_recent_images(
        channel_id=123456789,
        limit=20,  # Check last 20 messages
        output_dir='./input'
    )

    # Process each image (pseudocode)
    processed_paths = []
    for download in result['downloads']:
        input_path = download['local_path']
        # output_path = process_image(input_path)
        processed_paths.append(output_path)

    # Upload all processed images
    await upload_multiple_images(
        channel_id=123456789,
        image_paths=processed_paths,
        caption=f"Processed {len(processed_paths)} images!"
    )

run_async(batch_process())
```

### Workflow 3: Respond to Mentions

Monitor mentions and respond with processed images:

```python
#!/usr/bin/env python3
import sys
sys.path.append('./scripts')
from get_mentions import get_mentions
from download_images import download_images_from_message
from upload_image import upload_image
from discord_client import run_async

async def respond_to_mentions():
    # Get recent mentions
    result = await get_mentions(limit=10)

    for mention in result['mentions']:
        message_id = mention['message_id']
        channel_id = mention['channel_id']

        # Check if message has attachments
        if mention['attachments']:
            # Download image from mention
            download_result = await download_images_from_message(
                channel_id=channel_id,
                message_id=message_id,
                output_dir='./temp'
            )

            if download_result['downloads']:
                input_image = download_result['downloads'][0]['local_path']

                # Process image (pseudocode)
                # output_image = process_image(input_image, "enhance quality")
                output_image = "./enhanced.png"

                # Reply with processed image
                await upload_image(
                    channel_id=channel_id,
                    image_path=output_image,
                    caption=f"Here's the enhanced version!"
                )

run_async(respond_to_mentions())
```

## Common Patterns

### Pattern 1: Progress Updates

Update a single message to show progress:

```python
import asyncio
from post_message import post_message
from edit_message import edit_message
from discord_client import run_async

async def show_progress():
    # Post initial message
    result = await post_message(123456789, "Processing: 0%")
    message_id = result['message_id']

    # Update progress
    for i in range(0, 101, 25):
        await asyncio.sleep(2)  # Simulate work
        await edit_message(
            123456789,
            message_id,
            f"Processing: {i}%"
        )

    await edit_message(
        123456789,
        message_id,
        "✅ Complete!"
    )

run_async(show_progress())
```

### Pattern 2: Error Handling

Robust error handling for Discord operations:

```python
import discord
from upload_image import upload_image
from discord_client import run_async

async def safe_upload():
    try:
        await upload_image(
            channel_id=123456789,
            image_path="./output.png",
            caption="Generated image"
        )
    except discord.Forbidden:
        print("Bot lacks permission. Check channel permissions.")
    except discord.NotFound:
        print("Channel not found. Verify channel ID.")
    except FileNotFoundError:
        print("Image file not found. Check path.")
    except Exception as e:
        print(f"Unexpected error: {str(e)}")

run_async(safe_upload())
```

### Pattern 3: Gallery Creation

Create a gallery by posting multiple related images:

```python
from upload_image import upload_multiple_images
from discord_client import run_async

async def create_gallery():
    images = [
        "./style_1.png",
        "./style_2.png",
        "./style_3.png",
        "./style_4.png"
    ]

    await upload_multiple_images(
        channel_id=123456789,
        image_paths=images,
        caption="🎨 Style Variations"
    )

run_async(create_gallery())
```

### Pattern 4: Channel Organization

List channels and find the right one to post to:

```python
from list_channels import list_channels
from upload_image import upload_image
from discord_client import run_async

async def find_and_post():
    # List all channels
    result = await list_channels(output_format='json')

    # Find channel by name
    target_channel_id = None
    for guild in result['guilds']:
        for channel in guild['channels']:
            if channel['name'] == 'ai-generated':
                target_channel_id = channel['id']
                break

    if target_channel_id:
        await upload_image(
            channel_id=target_channel_id,
            image_path="./output.png",
            caption="Posted to the right channel!"
        )

run_async(find_and_post())
```

## Integration with photoLiquidity Project

### Example: Auto-Post AI Edits

Integrate with your Next.js photo editor:

```javascript
// In your Next.js API route or component
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function postToDiscord(imagePath, caption) {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  const skillPath = '/path/to/discord-server/scripts';

  try {
    const { stdout, stderr } = await execAsync(
      `python ${skillPath}/upload_image.py ${channelId} ${imagePath} --caption "${caption}"`
    );

    console.log('Posted to Discord:', stdout);
    return { success: true };
  } catch (error) {
    console.error('Discord upload failed:', error);
    return { success: false, error: error.message };
  }
}

// Usage in your app
const result = await postToDiscord(
  './public/output.png',
  'Check out this AI edit!'
);
```

### Example: Download Ref Images for Editing

Fetch reference images from Discord for style matching:

```javascript
async function getRefImagesFromDiscord() {
  const channelId = process.env.DISCORD_REF_CHANNEL_ID;
  const skillPath = '/path/to/discord-server/scripts';

  try {
    const { stdout } = await execAsync(
      `python ${skillPath}/download_images.py ${channelId} --limit 5 --output-dir ./public/refs`
    );

    // Parse downloaded images
    const refImages = fs.readdirSync('./public/refs')
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .map(f => `/refs/${f}`);

    return refImages;
  } catch (error) {
    console.error('Failed to fetch refs:', error);
    return [];
  }
}
```

## Advanced Workflows

### Workflow: Automated Daily Gallery

Post a daily gallery of AI creations:

```python
#!/usr/bin/env python3
from datetime import datetime
from upload_image import upload_multiple_images
from post_message import post_message
from discord_client import run_async
import glob

async def daily_gallery():
    # Get today's creations
    today = datetime.now().strftime("%Y-%m-%d")
    pattern = f"./output/{today}_*.png"
    images = glob.glob(pattern)

    if not images:
        print("No images for today")
        return

    # Post gallery
    await upload_multiple_images(
        channel_id=123456789,
        image_paths=images[:10],  # Max 10 images
        caption=f"📅 Daily Gallery - {today}\n{len(images)} creations today!"
    )

run_async(daily_gallery())
```

### Workflow: Interactive Editing Session

Monitor a channel and process images as they're posted:

```python
#!/usr/bin/env python3
import asyncio
from read_messages import read_messages
from discord_client import run_async

async def monitor_channel():
    last_message_id = None

    while True:
        # Read messages after last check
        result = await read_messages(
            channel_id=123456789,
            limit=5,
            after=last_message_id
        )

        for message in result['messages']:
            if message['attachments']:
                print(f"New image from {message['author']['name']}")
                # Process image here
                last_message_id = message['message_id']

        await asyncio.sleep(30)  # Check every 30 seconds

# Run indefinitely
run_async(monitor_channel())
```

## Shell Script Examples

### Bash Script: Complete Pipeline

```bash
#!/bin/bash
CHANNEL_ID=123456789
MESSAGE_ID=987654321
SCRIPTS_DIR="./scripts"

echo "Downloading image from Discord..."
python $SCRIPTS_DIR/download_images.py $CHANNEL_ID --message-id $MESSAGE_ID --output-dir ./temp

echo "Processing image..."
# Your image processing command here
# e.g., python process_image.py ./temp/*.png ./output.png

echo "Uploading result to Discord..."
python $SCRIPTS_DIR/upload_image.py $CHANNEL_ID ./output.png --caption "Processed image ready!"

echo "Cleaning up..."
rm -rf ./temp

echo "Done!"
```

### Cron Job: Hourly Status Update

```bash
#!/bin/bash
# Add to crontab: 0 * * * * /path/to/status_update.sh

CHANNEL_ID=123456789
SCRIPTS_DIR="/path/to/discord-server/scripts"

STATUS="System operational - $(date '+%Y-%m-%d %H:%M')"

python $SCRIPTS_DIR/post_message.py $CHANNEL_ID "$STATUS"
```

## Tips and Best Practices

1. **Store Channel IDs in Environment Variables**
   ```bash
   export DISCORD_MAIN_CHANNEL=123456789
   export DISCORD_GALLERY_CHANNEL=987654321
   ```

2. **Use JSON Output for Parsing**
   ```bash
   python scripts/read_messages.py 123456789 --format json > messages.json
   jq '.messages[].content' messages.json
   ```

3. **Rate Limiting in Loops**
   ```python
   for image in images:
       await upload_image(channel_id, image, caption)
       await asyncio.sleep(1)  # Respect rate limits
   ```

4. **Log All Operations**
   ```python
   import logging
   logging.basicConfig(
       filename='discord_ops.log',
       level=logging.INFO,
       format='%(asctime)s - %(message)s'
   )
   ```

5. **Handle Network Errors**
   ```python
   from tenacity import retry, stop_after_attempt, wait_exponential

   @retry(stop=stop_after_attempt(3), wait=wait_exponential())
   async def reliable_upload(channel_id, image_path):
       await upload_image(channel_id, image_path)
   ```
