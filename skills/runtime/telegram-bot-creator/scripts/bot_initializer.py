#!/usr/bin/env python3
"""
Quick bot scaffolder. Generates starter bot structure.

Usage:
    python3 bot_initializer.py --name my_bot --framework aiogram
"""

import argparse
import os
from pathlib import Path


def create_aiogram_bot(bot_name: str, output_dir: Path) -> None:
    """Generate aiogram bot structure."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # main.py
    main_py = output_dir / "main.py"
    main_py.write_text('''#!/usr/bin/env python3
"""
Telegram bot using aiogram framework.

Setup:
    pip install aiogram python-dotenv
    export TELEGRAM_BOT_TOKEN="your_token_here"
    python3 main.py
"""

import os
import asyncio
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from dotenv import load_dotenv
from agent_adapter import TelegramAgentAdapter

load_dotenv()
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

# Initialize bot and dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


class YourAgent(TelegramAgentAdapter):
    """Replace with your actual agent implementation."""

    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Wire your agent/backend here
        return f"Agent received: {message}"


agent = YourAgent(bot_token=BOT_TOKEN)


@dp.message(Command(start=True))
async def cmd_start(message: types.Message):
    await message.answer("👋 Hello! I'm your Telegram agent.\\n\\nSend me a message!")


@dp.message()
async def handle_message(message: types.Message):
    """Handle all incoming messages."""
    user_id = str(message.from_user.id)
    user_message = message.text

    # Send typing indicator
    await bot.send_chat_action(message.chat.id, "typing")

    # Process through agent
    response = await agent.handle_message(user_id, user_message)

    # Send response
    await message.answer(response)


async def main():
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
''')

    # .env.example
    env_example = output_dir / ".env.example"
    env_example.write_text("""TELEGRAM_BOT_TOKEN=your_bot_token_here
LOG_LEVEL=INFO
""")

    # requirements.txt
    req_txt = output_dir / "requirements.txt"
    req_txt.write_text("""aiogram==3.0.0
python-dotenv==1.0.0
aiohttp==3.9.0
""")

    print(f"✅ aiogram bot created at {output_dir}")
    print(f"   1. Copy agent_adapter.py to {output_dir}")
    print(f"   2. Update YOUR_AGENT class in main.py")
    print(f"   3. Set TELEGRAM_BOT_TOKEN in .env")
    print(f"   4. Run: python3 main.py")


def create_python_telegram_bot(bot_name: str, output_dir: Path) -> None:
    """Generate python-telegram-bot structure."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # main.py
    main_py = output_dir / "main.py"
    main_py.write_text('''#!/usr/bin/env python3
"""
Telegram bot using python-telegram-bot framework.

Setup:
    pip install python-telegram-bot python-dotenv
    export TELEGRAM_BOT_TOKEN="your_token_here"
    python3 main.py
"""

import os
import asyncio
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from dotenv import load_dotenv
from agent_adapter import TelegramAgentAdapter

logging.basicConfig(level=logging.INFO)
load_dotenv()

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")


class YourAgent(TelegramAgentAdapter):
    """Replace with your actual agent implementation."""

    async def process_agent_request(self, message: str, user_id: str) -> str:
        # Wire your agent/backend here
        return f"Agent received: {message}"


agent = YourAgent(bot_token=BOT_TOKEN)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Send message on /start."""
    await update.message.reply_text("👋 Hello! Send me a message!")


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle all incoming messages."""
    user_id = str(update.effective_user.id)
    user_message = update.message.text

    # Process through agent
    response = await agent.handle_message(user_id, user_message)

    # Send response
    await update.message.reply_text(response)


def main():
    """Start the bot."""
    app = Application.builder().token(BOT_TOKEN).build()

    # Handlers
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Start polling
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
''')

    env_example = output_dir / ".env.example"
    env_example.write_text("""TELEGRAM_BOT_TOKEN=your_bot_token_here
LOG_LEVEL=INFO
""")

    req_txt = output_dir / "requirements.txt"
    req_txt.write_text("""python-telegram-bot==21.0
python-dotenv==1.0.0
""")

    print(f"✅ python-telegram-bot created at {output_dir}")


def main():
    parser = argparse.ArgumentParser(description="Initialize a Telegram bot project")
    parser.add_argument("--name", required=True, help="Bot name/project directory")
    parser.add_argument(
        "--framework",
        choices=["aiogram", "python-telegram-bot"],
        default="aiogram",
        help="Bot framework to use"
    )
    parser.add_argument("--output", default=".", help="Output directory")

    args = parser.parse_args()

    output_dir = Path(args.output) / args.name

    if args.framework == "aiogram":
        create_aiogram_bot(args.name, output_dir)
    else:
        create_python_telegram_bot(args.name, output_dir)

    print(f"\n📁 Project structure created at {output_dir}/")


if __name__ == "__main__":
    main()
