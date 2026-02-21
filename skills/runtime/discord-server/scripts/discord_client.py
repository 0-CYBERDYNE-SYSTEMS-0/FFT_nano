#!/usr/bin/env python3
"""
Core Discord bot client wrapper for server interactions.

This module provides a reusable Discord client that handles authentication,
connection management, and provides helper methods for common Discord operations.
"""

import os
import sys
import asyncio
import discord
from discord.ext import commands
from typing import Optional, List
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class DiscordClient:
    """Discord bot client wrapper with helper methods."""

    def __init__(self, token: Optional[str] = None):
        """
        Initialize Discord client.

        Args:
            token: Discord bot token. If None, reads from DISCORD_BOT_TOKEN env var.
        """
        self.token = token or os.getenv('DISCORD_BOT_TOKEN')

        if not self.token:
            raise ValueError(
                "Discord bot token not found. Please set DISCORD_BOT_TOKEN "
                "environment variable or pass token directly.\n"
                "See references/setup_guide.md for instructions on obtaining a token."
            )

        # Configure intents
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.messages = True

        # Initialize bot
        self.bot = commands.Bot(command_prefix='!', intents=intents)
        self.ready = False

        @self.bot.event
        async def on_ready():
            """Handle bot ready event."""
            self.ready = True
            print(f'✅ Bot connected as {self.bot.user.name} (ID: {self.bot.user.id})')

    async def start_bot(self):
        """Start the bot and wait for ready status."""
        try:
            await self.bot.start(self.token)
        except discord.LoginFailure:
            raise ValueError(
                "Invalid Discord bot token. Please check your token and try again.\n"
                "See references/setup_guide.md for instructions on obtaining a valid token."
            )
        except Exception as e:
            raise RuntimeError(f"Failed to connect to Discord: {str(e)}")

    async def wait_until_ready(self):
        """Wait until bot is ready."""
        await self.bot.wait_until_ready()

    async def close(self):
        """Close the Discord connection."""
        await self.bot.close()

    def get_channel(self, channel_id: int) -> Optional[discord.TextChannel]:
        """
        Get a channel by ID.

        Args:
            channel_id: Discord channel ID

        Returns:
            TextChannel object or None if not found
        """
        return self.bot.get_channel(channel_id)

    def get_guild(self, guild_id: int) -> Optional[discord.Guild]:
        """
        Get a guild (server) by ID.

        Args:
            guild_id: Discord guild ID

        Returns:
            Guild object or None if not found
        """
        return self.bot.get_guild(guild_id)

    async def fetch_channel(self, channel_id: int) -> discord.TextChannel:
        """
        Fetch a channel by ID (makes API call).

        Args:
            channel_id: Discord channel ID

        Returns:
            TextChannel object

        Raises:
            discord.NotFound: If channel doesn't exist
            discord.Forbidden: If bot lacks permission
        """
        return await self.bot.fetch_channel(channel_id)

    async def fetch_message(self, channel_id: int, message_id: int) -> discord.Message:
        """
        Fetch a message by channel and message ID.

        Args:
            channel_id: Discord channel ID
            message_id: Discord message ID

        Returns:
            Message object

        Raises:
            discord.NotFound: If message doesn't exist
            discord.Forbidden: If bot lacks permission
        """
        channel = await self.fetch_channel(channel_id)
        return await channel.fetch_message(message_id)


async def create_client(token: Optional[str] = None) -> DiscordClient:
    """
    Create and initialize a Discord client.

    Args:
        token: Discord bot token. If None, reads from DISCORD_BOT_TOKEN env var.

    Returns:
        Initialized DiscordClient instance
    """
    client = DiscordClient(token)

    # Start bot in background task
    task = asyncio.ensure_future(client.start_bot())

    # Wait for bot to be ready
    await client.wait_until_ready()

    return client


def run_async(coro):
    """
    Helper to run async functions from sync context.

    Args:
        coro: Coroutine to run

    Returns:
        Result of the coroutine
    """
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    return loop.run_until_complete(coro)


if __name__ == '__main__':
    """Test the Discord client connection."""
    async def test_connection():
        print("Testing Discord bot connection...")

        # Get token
        token = os.getenv('DISCORD_BOT_TOKEN')
        if not token:
            raise ValueError("DISCORD_BOT_TOKEN not found in environment")

        # Configure intents
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.messages = True

        # Create bot
        bot = commands.Bot(command_prefix='!', intents=intents)

        @bot.event
        async def on_ready():
            print(f"✅ Successfully connected!")
            print(f"Bot name: {bot.user.name}")
            print(f"Bot ID: {bot.user.id}")
            print(f"Guilds: {len(bot.guilds)}")
            for guild in bot.guilds:
                print(f"  - {guild.name} (ID: {guild.id})")
            await bot.close()

        try:
            await bot.start(token)
        except discord.LoginFailure:
            print(f"❌ Invalid Discord bot token. Please check your token and try again.", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"❌ Error: {str(e)}", file=sys.stderr)
            sys.exit(1)

    try:
        run_async(test_connection())
    except KeyboardInterrupt:
        print("\nBot connection test cancelled")
    except Exception as e:
        print(f"❌ Error: {str(e)}", file=sys.stderr)
        sys.exit(1)
