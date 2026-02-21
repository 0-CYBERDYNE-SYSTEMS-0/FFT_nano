#!/usr/bin/env python3
"""Check what's new in two_dog_seeds' joint server."""

import os
import sys
import asyncio
import discord
from discord.ext import commands
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv()

async def check_server():
    """Check recent activity in two_dog_seeds' joint."""
    token = os.getenv('DISCORD_BOT_TOKEN')
    if not token:
        print("❌ DISCORD_BOT_TOKEN not found in .env")
        sys.exit(1)

    intents = discord.Intents.default()
    intents.message_content = True
    intents.guilds = True
    intents.messages = True

    bot = commands.Bot(command_prefix='!', intents=intents)

    @bot.event
    async def on_ready():
        try:
            print(f"✅ Connected as {bot.user.name}\n")

            # Find the server
            target_server = None
            for guild in bot.guilds:
                if "two_dog_seeds" in guild.name.lower():
                    target_server = guild
                    break

            if not target_server:
                print("❌ two_dog_seeds' joint server not found")
                print("Available servers:")
                for guild in bot.guilds:
                    print(f"  - {guild.name}")
                await bot.close()
                return

            print(f"📊 Server: {target_server.name}\n")
            print("=" * 80)
            print("LATEST MESSAGES BY CHANNEL\n")

            # Check all text channels
            for channel in target_server.text_channels:
                try:
                    # Get the most recent message
                    async for msg in channel.history(limit=1):
                        timestamp = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
                        author = msg.author.name
                        content = msg.content[:100] + "..." if len(msg.content) > 100 else msg.content

                        print(f"💬 #{channel.name}")
                        print(f"   Latest: {timestamp}")
                        print(f"   Author: {author}")
                        print(f"   Message: {content}")
                        print()
                        break

                except discord.Forbidden:
                    print(f"💬 #{channel.name}")
                    print(f"   ⚠️  No access")
                    print()
                except Exception as e:
                    print(f"💬 #{channel.name}")
                    print(f"   ❌ Error: {e}")
                    print()

            print("=" * 80)

        except Exception as e:
            print(f"❌ Error: {e}")
        finally:
            await bot.close()

    try:
        await bot.start(token)
    except Exception as e:
        print(f"❌ Connection error: {e}")

if __name__ == '__main__':
    asyncio.run(check_server())
