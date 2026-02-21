#!/usr/bin/env python3
"""
List channels in Discord server(s).

Usage:
    python list_channels.py [--guild-id ID]
"""

import sys
import argparse
import json
from discord_client import create_client, run_async


async def list_channels(guild_id: int = None, output_format: str = 'text') -> dict:
    """
    List channels in Discord server(s).

    Args:
        guild_id: Specific guild ID (optional, lists all if not provided)
        output_format: Output format ('text' or 'json')

    Returns:
        Dictionary with channels information
    """
    client = await create_client()

    try:
        guilds_data = []

        if guild_id:
            # List channels for specific guild
            guild = client.get_guild(guild_id)
            if not guild:
                raise ValueError(f"Guild {guild_id} not found. Bot may not be a member.")

            guilds_to_process = [guild]
        else:
            # List channels for all guilds bot is in
            guilds_to_process = client.bot.guilds

        for guild in guilds_to_process:
            channels_data = []

            for channel in guild.channels:
                channel_info = {
                    'id': channel.id,
                    'name': channel.name,
                    'type': str(channel.type),
                    'category': channel.category.name if channel.category else None,
                    'position': channel.position
                }
                channels_data.append(channel_info)

            guild_info = {
                'guild_id': guild.id,
                'guild_name': guild.name,
                'channels': sorted(channels_data, key=lambda x: (x['category'] or '', x['position'])),
                'count': len(channels_data)
            }

            guilds_data.append(guild_info)

            # Print in text format
            if output_format == 'text':
                print(f"\n{'=' * 80}")
                print(f"Server: {guild.name} (ID: {guild.id})")
                print(f"{'=' * 80}\n")

                # Group by category
                categorized = {}
                uncategorized = []

                for ch in channels_data:
                    if ch['category']:
                        if ch['category'] not in categorized:
                            categorized[ch['category']] = []
                        categorized[ch['category']].append(ch)
                    else:
                        uncategorized.append(ch)

                # Print categorized channels
                for category, channels in sorted(categorized.items()):
                    print(f"📁 {category}")
                    for ch in sorted(channels, key=lambda x: x['position']):
                        type_emoji = {
                            'text': '💬',
                            'voice': '🔊',
                            'category': '📁',
                            'stage_voice': '🎙️',
                            'forum': '📋'
                        }.get(ch['type'], '❓')
                        print(f"   {type_emoji} {ch['name']}")
                        print(f"      ID: {ch['id']} | Type: {ch['type']}")
                    print()

                # Print uncategorized channels
                if uncategorized:
                    print(f"📂 Uncategorized")
                    for ch in sorted(uncategorized, key=lambda x: x['position']):
                        type_emoji = {
                            'text': '💬',
                            'voice': '🔊',
                            'category': '📁',
                            'stage_voice': '🎙️',
                            'forum': '📋'
                        }.get(ch['type'], '❓')
                        print(f"   {type_emoji} {ch['name']}")
                        print(f"      ID: {ch['id']} | Type: {ch['type']}")
                    print()

                print(f"Total channels: {len(channels_data)}\n")

        result = {
            'success': True,
            'guilds': guilds_data,
            'guild_count': len(guilds_data),
            'total_channels': sum(g['count'] for g in guilds_data)
        }

        if output_format == 'json':
            print(json.dumps(result, indent=2))
        elif not guild_id:
            print(f"{'=' * 80}")
            print(f"✅ Listed channels from {len(guilds_data)} server(s)")
            print(f"   Total channels: {result['total_channels']}")

        return result

    except Exception as e:
        print(f"❌ Error listing channels: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for listing channels."""
    parser = argparse.ArgumentParser(
        description='List channels in Discord server(s)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List channels from all servers bot is in
  python list_channels.py

  # List channels from specific server
  python list_channels.py --guild-id 123456789

  # Output as JSON
  python list_channels.py --format json
        """
    )

    parser.add_argument('--guild-id', type=int, help='Specific guild ID (optional)')
    parser.add_argument('--format', type=str, choices=['text', 'json'], default='text', help='Output format')

    args = parser.parse_args()

    try:
        result = run_async(list_channels(
            guild_id=args.guild_id,
            output_format=args.format
        ))
        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
