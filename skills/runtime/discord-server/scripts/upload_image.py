#!/usr/bin/env python3
"""
Upload images to Discord channels.

Supports PNG, JPEG, WEBP, and GIF formats.

Usage:
    python upload_image.py <channel_id> <image_path> [--caption "message"]
"""

import sys
import argparse
import os
from pathlib import Path
import discord
from discord_client import create_client, run_async


async def upload_image(
    channel_id: int,
    image_path: str,
    caption: str = None,
    filename: str = None
) -> dict:
    """
    Upload an image to a Discord channel.

    Args:
        channel_id: Discord channel ID
        image_path: Path to image file
        caption: Optional caption/message text
        filename: Optional custom filename (uses original if not provided)

    Returns:
        Dictionary with upload details
    """
    # Validate image path
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image file not found: {image_path}")

    # Check file extension
    valid_extensions = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
    file_ext = Path(image_path).suffix.lower()
    if file_ext not in valid_extensions:
        raise ValueError(
            f"Unsupported image format: {file_ext}\n"
            f"Supported formats: {', '.join(valid_extensions)}"
        )

    client = await create_client()

    try:
        channel = await client.fetch_channel(channel_id)

        # Prepare file
        file_name = filename or Path(image_path).name
        file = discord.File(image_path, filename=file_name)

        # Upload image
        message = await channel.send(content=caption, file=file)

        # Get attachment info
        attachment = message.attachments[0] if message.attachments else None

        result = {
            'success': True,
            'message_id': message.id,
            'channel_id': channel.id,
            'channel_name': channel.name,
            'caption': caption,
            'url': message.jump_url,
            'timestamp': message.created_at.isoformat(),
            'attachment': {
                'filename': attachment.filename,
                'url': attachment.url,
                'size': attachment.size,
                'width': attachment.width,
                'height': attachment.height
            } if attachment else None
        }

        print(f"✅ Image uploaded successfully!")
        print(f"   Channel: #{channel.name}")
        print(f"   Message ID: {message.id}")
        print(f"   URL: {message.jump_url}")
        if attachment:
            print(f"   Image URL: {attachment.url}")
            print(f"   Size: {attachment.width}x{attachment.height} ({attachment.size} bytes)")

        return result

    except discord.NotFound:
        print(f"❌ Error: Channel {channel_id} not found.", file=sys.stderr)
        print(f"   Make sure the channel ID is correct and the bot has access.", file=sys.stderr)
        raise

    except discord.Forbidden:
        print(f"❌ Error: Bot lacks permission to send files in channel {channel_id}.", file=sys.stderr)
        print(f"   Grant the bot 'Attach Files' permission in this channel.", file=sys.stderr)
        raise

    except discord.HTTPException as e:
        if e.status == 413:
            print(f"❌ Error: File too large. Discord limit is 8MB (25MB with Nitro).", file=sys.stderr)
        else:
            print(f"❌ HTTP Error uploading image: {str(e)}", file=sys.stderr)
        raise

    except Exception as e:
        print(f"❌ Error uploading image: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


async def upload_multiple_images(
    channel_id: int,
    image_paths: list,
    caption: str = None
) -> dict:
    """
    Upload multiple images to a Discord channel in a single message.

    Args:
        channel_id: Discord channel ID
        image_paths: List of paths to image files (max 10)
        caption: Optional caption/message text

    Returns:
        Dictionary with upload details
    """
    if len(image_paths) > 10:
        raise ValueError("Discord allows maximum 10 files per message")

    # Validate all paths
    for path in image_paths:
        if not os.path.exists(path):
            raise FileNotFoundError(f"Image file not found: {path}")

    client = await create_client()

    try:
        channel = await client.fetch_channel(channel_id)

        # Prepare files
        files = [discord.File(path) for path in image_paths]

        # Upload images
        message = await channel.send(content=caption, files=files)

        # Get attachment info
        attachments = []
        for att in message.attachments:
            attachments.append({
                'filename': att.filename,
                'url': att.url,
                'size': att.size,
                'width': att.width,
                'height': att.height
            })

        result = {
            'success': True,
            'message_id': message.id,
            'channel_id': channel.id,
            'channel_name': channel.name,
            'caption': caption,
            'url': message.jump_url,
            'timestamp': message.created_at.isoformat(),
            'attachments': attachments,
            'count': len(attachments)
        }

        print(f"✅ {len(attachments)} images uploaded successfully!")
        print(f"   Channel: #{channel.name}")
        print(f"   Message ID: {message.id}")
        print(f"   URL: {message.jump_url}")

        return result

    except Exception as e:
        print(f"❌ Error uploading images: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for uploading images."""
    parser = argparse.ArgumentParser(
        description='Upload image(s) to a Discord channel',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload single image
  python upload_image.py 123456789 /path/to/image.png

  # Upload with caption
  python upload_image.py 123456789 /path/to/image.png --caption "Check this out!"

  # Upload multiple images
  python upload_image.py 123456789 image1.png image2.png image3.png --caption "Gallery"

  # Custom filename
  python upload_image.py 123456789 /path/to/image.png --filename "artwork.png"
        """
    )

    parser.add_argument('channel_id', type=int, help='Discord channel ID')
    parser.add_argument('image_paths', nargs='+', help='Path(s) to image file(s)')
    parser.add_argument('--caption', type=str, help='Message caption')
    parser.add_argument('--filename', type=str, help='Custom filename (single image only)')

    args = parser.parse_args()

    try:
        if len(args.image_paths) == 1:
            # Single image upload
            result = run_async(upload_image(
                channel_id=args.channel_id,
                image_path=args.image_paths[0],
                caption=args.caption,
                filename=args.filename
            ))
        else:
            # Multiple image upload
            if args.filename:
                print("Warning: --filename ignored for multiple image upload", file=sys.stderr)
            result = run_async(upload_multiple_images(
                channel_id=args.channel_id,
                image_paths=args.image_paths,
                caption=args.caption
            ))

        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
