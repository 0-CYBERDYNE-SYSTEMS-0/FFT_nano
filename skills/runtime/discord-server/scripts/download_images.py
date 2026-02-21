#!/usr/bin/env python3
"""
Download images from Discord channels.

Downloads images from a specific message or recent messages in a channel.

Usage:
    python download_images.py <channel_id> [--message-id ID] [--output-dir PATH] [--limit N]
"""

import sys
import argparse
import os
from pathlib import Path
import aiohttp
from discord_client import create_client, run_async


async def download_file(url: str, output_path: str):
    """Download a file from URL to local path."""
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status == 200:
                with open(output_path, 'wb') as f:
                    f.write(await response.read())
            else:
                raise Exception(f"Failed to download: HTTP {response.status}")


async def download_images_from_message(
    channel_id: int,
    message_id: int,
    output_dir: str = '.'
) -> dict:
    """
    Download all images from a specific message.

    Args:
        channel_id: Discord channel ID
        message_id: Discord message ID
        output_dir: Directory to save images (default: current directory)

    Returns:
        Dictionary with download details
    """
    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    client = await create_client()

    try:
        message = await client.fetch_message(channel_id, message_id)

        if not message.attachments:
            print(f"⚠️  No attachments found in message {message_id}")
            return {'success': True, 'downloads': [], 'count': 0}

        downloads = []

        for attachment in message.attachments:
            # Check if it's an image
            if not attachment.content_type or not attachment.content_type.startswith('image/'):
                print(f"⏭️  Skipping non-image: {attachment.filename}")
                continue

            # Download image
            output_path = os.path.join(output_dir, attachment.filename)

            print(f"⬇️  Downloading {attachment.filename}...")
            await download_file(attachment.url, output_path)

            downloads.append({
                'filename': attachment.filename,
                'url': attachment.url,
                'local_path': output_path,
                'size': attachment.size,
                'width': attachment.width,
                'height': attachment.height
            })

            print(f"   ✅ Saved to {output_path}")

        result = {
            'success': True,
            'message_id': message_id,
            'channel_id': channel_id,
            'downloads': downloads,
            'count': len(downloads)
        }

        print(f"\n✅ Downloaded {len(downloads)} image(s)")

        return result

    except Exception as e:
        print(f"❌ Error downloading images: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


async def download_recent_images(
    channel_id: int,
    limit: int = 10,
    output_dir: str = '.'
) -> dict:
    """
    Download images from recent messages in a channel.

    Args:
        channel_id: Discord channel ID
        limit: Number of messages to check (default: 10)
        output_dir: Directory to save images (default: current directory)

    Returns:
        Dictionary with download details
    """
    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    client = await create_client()

    try:
        channel = await client.fetch_channel(channel_id)

        downloads = []
        messages_checked = 0

        print(f"🔍 Checking last {limit} messages in #{channel.name}...")

        async for message in channel.history(limit=limit):
            messages_checked += 1

            if not message.attachments:
                continue

            for attachment in message.attachments:
                # Check if it's an image
                if not attachment.content_type or not attachment.content_type.startswith('image/'):
                    continue

                # Generate unique filename with message ID prefix
                filename = f"{message.id}_{attachment.filename}"
                output_path = os.path.join(output_dir, filename)

                print(f"⬇️  Downloading {attachment.filename} from message {message.id}...")
                await download_file(attachment.url, output_path)

                downloads.append({
                    'filename': filename,
                    'original_filename': attachment.filename,
                    'url': attachment.url,
                    'local_path': output_path,
                    'size': attachment.size,
                    'width': attachment.width,
                    'height': attachment.height,
                    'message_id': message.id,
                    'author': str(message.author)
                })

                print(f"   ✅ Saved to {output_path}")

        result = {
            'success': True,
            'channel_id': channel_id,
            'channel_name': channel.name,
            'messages_checked': messages_checked,
            'downloads': downloads,
            'count': len(downloads)
        }

        print(f"\n✅ Downloaded {len(downloads)} image(s) from {messages_checked} messages")

        return result

    except Exception as e:
        print(f"❌ Error downloading images: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for downloading images."""
    parser = argparse.ArgumentParser(
        description='Download images from Discord channel',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download images from specific message
  python download_images.py 123456789 --message-id 987654321

  # Download images from last 20 messages
  python download_images.py 123456789 --limit 20

  # Save to specific directory
  python download_images.py 123456789 --limit 10 --output-dir ./discord_images
        """
    )

    parser.add_argument('channel_id', type=int, help='Discord channel ID')
    parser.add_argument('--message-id', type=int, help='Specific message ID to download from')
    parser.add_argument('--limit', type=int, default=10, help='Number of recent messages to check (default: 10)')
    parser.add_argument('--output-dir', type=str, default='.', help='Output directory (default: current directory)')

    args = parser.parse_args()

    try:
        if args.message_id:
            # Download from specific message
            result = run_async(download_images_from_message(
                channel_id=args.channel_id,
                message_id=args.message_id,
                output_dir=args.output_dir
            ))
        else:
            # Download from recent messages
            result = run_async(download_recent_images(
                channel_id=args.channel_id,
                limit=args.limit,
                output_dir=args.output_dir
            ))

        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
