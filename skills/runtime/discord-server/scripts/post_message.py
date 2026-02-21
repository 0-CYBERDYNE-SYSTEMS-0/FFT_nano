#!/usr/bin/env python3
"""
Post text messages to Discord channels.

Usage:
    python post_message.py <channel_id> <message_content> [--embed]
"""

import sys
import argparse
import discord
from discord_client import create_client, run_async


async def post_message(
    channel_id: int,
    content: str,
    embed_title: str = None,
    embed_description: str = None,
    embed_color: str = None
) -> dict:
    """
    Post a message to a Discord channel.

    Args:
        channel_id: Discord channel ID
        content: Message text content
        embed_title: Optional embed title
        embed_description: Optional embed description
        embed_color: Optional embed color (hex string like '0x5865F2')

    Returns:
        Dictionary with message details
    """
    client = await create_client()

    try:
        channel = await client.fetch_channel(channel_id)

        # Create embed if requested
        embed = None
        if embed_title or embed_description:
            color = int(embed_color, 16) if embed_color else 0x5865F2
            embed = discord.Embed(
                title=embed_title,
                description=embed_description,
                color=color
            )

        # Send message
        message = await channel.send(content=content, embed=embed)

        result = {
            'success': True,
            'message_id': message.id,
            'channel_id': channel.id,
            'channel_name': channel.name,
            'content': message.content,
            'url': message.jump_url,
            'timestamp': message.created_at.isoformat()
        }

        print(f"✅ Message posted successfully!")
        print(f"   Channel: #{channel.name}")
        print(f"   Message ID: {message.id}")
        print(f"   URL: {message.jump_url}")

        return result

    except discord.NotFound:
        print(f"❌ Error: Channel {channel_id} not found.", file=sys.stderr)
        print(f"   Make sure the channel ID is correct and the bot has access.", file=sys.stderr)
        raise

    except discord.Forbidden:
        print(f"❌ Error: Bot lacks permission to send messages in channel {channel_id}.", file=sys.stderr)
        print(f"   Grant the bot 'Send Messages' permission in this channel.", file=sys.stderr)
        raise

    except Exception as e:
        print(f"❌ Error posting message: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for posting messages."""
    parser = argparse.ArgumentParser(
        description='Post a message to a Discord channel',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Post simple message
  python post_message.py 123456789 "Hello, Discord!"

  # Post message with embed
  python post_message.py 123456789 "Check this out!" \\
    --embed-title "Important Update" \\
    --embed-description "Here's what's new..." \\
    --embed-color 0x00FF00
        """
    )

    parser.add_argument('channel_id', type=int, help='Discord channel ID')
    parser.add_argument('content', type=str, help='Message content')
    parser.add_argument('--embed-title', type=str, help='Embed title')
    parser.add_argument('--embed-description', type=str, help='Embed description')
    parser.add_argument('--embed-color', type=str, default='0x5865F2', help='Embed color (hex)')

    args = parser.parse_args()

    try:
        result = run_async(post_message(
            channel_id=args.channel_id,
            content=args.content,
            embed_title=args.embed_title,
            embed_description=args.embed_description,
            embed_color=args.embed_color
        ))
        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
