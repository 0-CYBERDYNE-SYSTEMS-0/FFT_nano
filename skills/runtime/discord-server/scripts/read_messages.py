#!/usr/bin/env python3
"""
Read messages from Discord channels.

Usage:
    python read_messages.py <channel_id> [--limit N] [--before ID] [--after ID]
"""

import sys
import argparse
import json
from discord_client import create_client, run_async


async def read_messages(
    channel_id: int,
    limit: int = 10,
    before: int = None,
    after: int = None,
    output_format: str = 'text'
) -> dict:
    """
    Read messages from a Discord channel.

    Args:
        channel_id: Discord channel ID
        limit: Number of messages to read (default: 10, max: 100)
        before: Read messages before this message ID
        after: Read messages after this message ID
        output_format: Output format ('text' or 'json')

    Returns:
        Dictionary with messages
    """
    client = await create_client()

    try:
        channel = await client.fetch_channel(channel_id)

        messages_data = []

        print(f"📖 Reading messages from #{channel.name}...\n")

        async for message in channel.history(limit=limit, before=before, after=after):
            message_info = {
                'message_id': message.id,
                'author': {
                    'name': message.author.name,
                    'id': message.author.id,
                    'bot': message.author.bot
                },
                'content': message.content,
                'timestamp': message.created_at.isoformat(),
                'edited_at': message.edited_at.isoformat() if message.edited_at else None,
                'attachments': [
                    {
                        'filename': att.filename,
                        'url': att.url,
                        'size': att.size,
                        'content_type': att.content_type
                    }
                    for att in message.attachments
                ],
                'embeds': [
                    {
                        'title': embed.title,
                        'description': embed.description,
                        'url': embed.url
                    }
                    for embed in message.embeds
                ],
                'url': message.jump_url
            }

            messages_data.append(message_info)

            # Print in text format
            if output_format == 'text':
                print(f"{'=' * 80}")
                print(f"Message ID: {message.id}")
                print(f"Author: {message.author.name} {'[BOT]' if message.author.bot else ''}")
                print(f"Time: {message.created_at}")
                print(f"URL: {message.jump_url}")
                print(f"\nContent:")
                print(message.content or "(no text content)")

                if message.attachments:
                    print(f"\nAttachments ({len(message.attachments)}):")
                    for att in message.attachments:
                        print(f"  - {att.filename} ({att.content_type})")
                        print(f"    {att.url}")

                if message.embeds:
                    print(f"\nEmbeds ({len(message.embeds)}):")
                    for embed in message.embeds:
                        if embed.title:
                            print(f"  Title: {embed.title}")
                        if embed.description:
                            print(f"  Description: {embed.description}")

                print()

        result = {
            'success': True,
            'channel_id': channel_id,
            'channel_name': channel.name,
            'messages': messages_data,
            'count': len(messages_data)
        }

        if output_format == 'json':
            print(json.dumps(result, indent=2))
        else:
            print(f"{'=' * 80}")
            print(f"✅ Read {len(messages_data)} message(s)")

        return result

    except Exception as e:
        print(f"❌ Error reading messages: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for reading messages."""
    parser = argparse.ArgumentParser(
        description='Read messages from a Discord channel',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Read last 10 messages
  python read_messages.py 123456789

  # Read last 50 messages
  python read_messages.py 123456789 --limit 50

  # Read messages before a specific message ID
  python read_messages.py 123456789 --before 987654321 --limit 20

  # Output as JSON
  python read_messages.py 123456789 --format json
        """
    )

    parser.add_argument('channel_id', type=int, help='Discord channel ID')
    parser.add_argument('--limit', type=int, default=10, help='Number of messages to read (default: 10)')
    parser.add_argument('--before', type=int, help='Read messages before this message ID')
    parser.add_argument('--after', type=int, help='Read messages after this message ID')
    parser.add_argument('--format', type=str, choices=['text', 'json'], default='text', help='Output format')

    args = parser.parse_args()

    try:
        result = run_async(read_messages(
            channel_id=args.channel_id,
            limit=args.limit,
            before=args.before,
            after=args.after,
            output_format=args.format
        ))
        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
