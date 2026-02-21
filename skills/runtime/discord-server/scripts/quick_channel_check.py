#!/usr/bin/env python3
"""Quick check of channels and message counts."""

import os
import sys
import asyncio
import discord
from discord.ext import commands
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv()

async def check_channels():
    """Check channels and count recent messages."""
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

            # Find Farm Friend Interactive server
            farm_friend = None
            for guild in bot.guilds:
                if "farm friend" in guild.name.lower():
                    farm_friend = guild
                    break

            if not farm_friend:
                print("❌ Farm Friend Interactive server not found")
                print("Available servers:")
                for guild in bot.guilds:
                    print(f"  - {guild.name}")
                await bot.close()
                return

            print(f"📊 Server: {farm_friend.name}\n")
            print("=" * 80)

            total_recent = 0

            # Check text channels
            for channel in farm_friend.text_channels:
                try:
                    # Get recent messages (last 100)
                    messages = []
                    async for msg in channel.history(limit=100):
                        messages.append(msg)

                    # Count messages from last 7 days
                    seven_days_ago = datetime.utcnow() - timedelta(days=7)
                    recent_count = sum(1 for m in messages if m.created_at.replace(tzinfo=None) > seven_days_ago)

                    print(f"💬 {channel.name}")
                    print(f"   Total (last 100): {len(messages)}")
                    print(f"   Last 7 days: {recent_count}")
                    print()

                    total_recent += recent_count

                except discord.Forbidden:
                    print(f"💬 {channel.name}")
                    print(f"   ⚠️  No access to read messages")
                    print()
                except Exception as e:
                    print(f"💬 {channel.name}")
                    print(f"   ❌ Error: {e}")
                    print()

            print("=" * 80)
            print(f"📈 Total messages in last 7 days: {total_recent}")

        except Exception as e:
            print(f"❌ Error: {e}")
        finally:
            await bot.close()

    try:
        await bot.start(token)
    except Exception as e:
        print(f"❌ Connection error: {e}")

if __name__ == '__main__':
    asyncio.run(check_channels())
