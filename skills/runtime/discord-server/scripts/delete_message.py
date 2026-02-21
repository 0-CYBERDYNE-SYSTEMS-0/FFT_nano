#!/usr/bin/env python3
"""
Delete bot messages from Discord channels.

Usage:
    python delete_message.py <channel_id> <message_id>
"""

import sys
import argparse
from discord_client import create_client, run_async


async def delete_message(channel_id: int, message_id: int) -> dict:
    """
    Delete a bot message.

    Args:
        channel_id: Discord channel ID
        message_id: Discord message ID

    Returns:
        Dictionary with deletion details
    """
    client = await create_client()

    try:
        message = await client.fetch_message(channel_id, message_id)

        # Verify bot owns the message
        if message.author.id != client.bot.user.id:
            raise ValueError(
                f"Cannot delete message {message_id}: Message was not sent by this bot.\n"
                f"Message author: {message.author.name} (ID: {message.author.id})\n"
                f"Bot ID: {client.bot.user.id}"
            )

        # Store info before deletion
        content = message.content
        channel_name = message.channel.name

        # Delete message
        await message.delete()

        result = {
            'success': True,
            'message_id': message_id,
            'channel_id': channel_id,
            'channel_name': channel_name,
            'deleted_content': content
        }

        print(f"✅ Message deleted successfully!")
        print(f"   Channel: #{channel_name}")
        print(f"   Message ID: {message_id}")

        return result

    except ValueError as e:
        print(f"❌ {str(e)}", file=sys.stderr)
        raise

    except Exception as e:
        print(f"❌ Error deleting message: {str(e)}", file=sys.stderr)
        raise

    finally:
        await client.close()


def main():
    """Command-line interface for deleting messages."""
    parser = argparse.ArgumentParser(
        description='Delete a bot message from Discord',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Delete a message
  python delete_message.py 123456789 987654321
        """
    )

    parser.add_argument('channel_id', type=int, help='Discord channel ID')
    parser.add_argument('message_id', type=int, help='Discord message ID to delete')

    args = parser.parse_args()

    try:
        result = run_async(delete_message(
            channel_id=args.channel_id,
            message_id=args.message_id
        ))
        sys.exit(0)

    except Exception as e:
        sys.exit(1)


if __name__ == '__main__':
    main()
