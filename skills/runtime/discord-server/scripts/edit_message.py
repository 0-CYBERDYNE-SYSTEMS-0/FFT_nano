#!/usr/bin/env python3
"""
Edit existing bot messages in Discord channels.

Usage:
    python edit_message.py <channel_id> <message_id> <new_content>
"""

import sys
import argparse
import discord
from discord_client import create_client, run_async


async def edit_message(
    channel_id: int,
    message_id: int,
    new_content: str,
    embed_title: str = None,
    embed_description: str = None,
    embed_color: str = None
) -> dict:
    """
    Edit an existing bot message.

    Args:
        channel_id: Discord channel ID
        message_id: Discord message ID
        new_content: New message content
        embed_title: Optional new embed title
        embed_description: Optional new embed description
        embed_color: Optional new embed color (hex string)

    Returns:
        Dictionary with edit details
    """
    client = await create_client()

    try:
        message = await client.fetch_message(channel_id, message_id)

        # Verify bot owns the message
        if message.author.id != client.bot.user.id:
            raise ValueError(
                f"Cannot edit message {message_id}: Message was not sent by this bot.\n"
                f"Message author: {message.author.name} (ID: {message.author.id})\n"
                f"Bot ID: {client.bot.user.id}"
            )

        # Create embed if requested
        embed = None
        if embed_title or embed_description:
            color = int(embed_color, 16) if embed_color else 0x5865F2
            embed = discord.Embed(
                title=embed_title,
                description=embed_description,
                color=color
            )

        # Edit message
        await message.edit(content=new_content, embed=embed)

        result = {
            'success': True,
            'message_id': message.id,
            'channel_id': channel_id,
            'old_content': message.content,
            'new_content': new_content,
            'url': message.jump_url,
            'edited_at': message.edited_at.isoformat() if message.edited_at else None
        }

        print(f"✅ Message edited successfully!")
        print(f"   Message ID: {message.id}")
        print(f"   URL: {message.jump_url}")

        return result

    except discord.NotFound:
        print(f"❌ Error: Message {message_id} not found in channel {channel_id}.", file=sys.stderr)
        raise

    except discord.Forbidden:
        print(f"❌ Error: Bot lacks permission to edit messages in channel {channel_id}.", file=sys.stderr)
        raise

    except ValueError as e:
        print(f"❌ {str(e)}", file=sys.stderr)
        raise

    except Exception as e:
        print(f"❌ Error editing message: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for editing messages."""
    parser = argparse.ArgumentParser(
        description='Edit an existing bot message in Discord',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Edit message content
  python edit_message.py 123456789 987654321 "Updated message content"

  # Edit with embed
  python edit_message.py 123456789 987654321 "Check this update!" \\
    --embed-title "Status Update" \\
    --embed-description "Everything is working now"
        """
    )

    parser.add_argument('channel_id', type=int, help='Discord channel ID')
    parser.add_argument('message_id', type=int, help='Discord message ID to edit')
    parser.add_argument('new_content', type=str, help='New message content')
    parser.add_argument('--embed-title', type=str, help='New embed title')
    parser.add_argument('--embed-description', type=str, help='New embed description')
    parser.add_argument('--embed-color', type=str, default='0x5865F2', help='New embed color (hex)')

    args = parser.parse_args()

    try:
        result = run_async(edit_message(
            channel_id=args.channel_id,
            message_id=args.message_id,
            new_content=args.new_content,
            embed_title=args.embed_title,
            embed_description=args.embed_description,
            embed_color=args.embed_color
        ))
        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
