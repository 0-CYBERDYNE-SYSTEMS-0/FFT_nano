#!/usr/bin/env python3
"""
Get messages where the bot is mentioned.

Usage:
    python get_mentions.py [--channel-id ID] [--limit N]
"""

import sys
import argparse
import json
from discord_client import create_client, run_async


async def get_mentions(
    channel_id: int = None,
    limit: int = 10,
    output_format: str = 'text'
) -> dict:
    """
    Get messages where the bot is mentioned.

    Args:
        channel_id: Specific channel ID (optional, searches all if not provided)
        limit: Number of messages to check per channel (default: 10)
        output_format: Output format ('text' or 'json')

    Returns:
        Dictionary with mentions
    """
    client = await create_client()

    try:
        mentions_data = []

        if channel_id:
            # Search in specific channel
            channels_to_search = [await client.fetch_channel(channel_id)]
        else:
            # Search in all text channels across all guilds
            channels_to_search = []
            for guild in client.bot.guilds:
                for channel in guild.text_channels:
                    channels_to_search.append(channel)

        print(f"🔍 Searching for mentions in {len(channels_to_search)} channel(s)...\n")

        for channel in channels_to_search:
            try:
                async for message in channel.history(limit=limit):
                    # Check if bot is mentioned
                    if client.bot.user in message.mentions or client.bot.user.mentioned_in(message):
                        mention_info = {
                            'message_id': message.id,
                            'channel_id': channel.id,
                            'channel_name': channel.name,
                            'guild_name': channel.guild.name if hasattr(channel, 'guild') else None,
                            'author': {
                                'name': message.author.name,
                                'id': message.author.id,
                                'bot': message.author.bot
                            },
                            'content': message.content,
                            'timestamp': message.created_at.isoformat(),
                            'url': message.jump_url,
                            'attachments': [att.url for att in message.attachments]
                        }

                        mentions_data.append(mention_info)

                        # Print in text format
                        if output_format == 'text':
                            print(f"{'=' * 80}")
                            print(f"Guild: {channel.guild.name if hasattr(channel, 'guild') else 'DM'}")
                            print(f"Channel: #{channel.name}")
                            print(f"Author: {message.author.name}")
                            print(f"Time: {message.created_at}")
                            print(f"URL: {message.jump_url}")
                            print(f"\nMessage:")
                            print(message.content)

                            if message.attachments:
                                print(f"\nAttachments:")
                                for att in message.attachments:
                                    print(f"  - {att.filename}: {att.url}")

                            print()

            except Exception as e:
                # Skip channels where bot lacks permission
                if output_format == 'text':
                    print(f"⏭️  Skipping #{channel.name}: {str(e)}", file=sys.stderr)
                continue

        result = {
            'success': True,
            'mentions': mentions_data,
            'count': len(mentions_data),
            'channels_searched': len(channels_to_search)
        }

        if output_format == 'json':
            print(json.dumps(result, indent=2))
        else:
            print(f"{'=' * 80}")
            print(f"✅ Found {len(mentions_data)} mention(s) across {len(channels_to_search)} channel(s)")

        return result

    except Exception as e:
        print(f"❌ Error getting mentions: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for getting mentions."""
    parser = argparse.ArgumentParser(
        description='Get messages where the bot is mentioned',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Get mentions from all channels
  python get_mentions.py

  # Get mentions from specific channel
  python get_mentions.py --channel-id 123456789

  # Check last 50 messages per channel
  python get_mentions.py --limit 50

  # Output as JSON
  python get_mentions.py --format json
        """
    )

    parser.add_argument('--channel-id', type=int, help='Specific channel ID (optional)')
    parser.add_argument('--limit', type=int, default=10, help='Messages to check per channel (default: 10)')
    parser.add_argument('--format', type=str, choices=['text', 'json'], default='text', help='Output format')

    args = parser.parse_args()

    try:
        result = run_async(get_mentions(
            channel_id=args.channel_id,
            limit=args.limit,
            output_format=args.format
        ))
        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
