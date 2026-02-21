#!/usr/bin/env python3
"""
Comprehensive example Telegram bot showing multiple patterns:
- Simple routing agent
- LLM-based agent (Claude via OpenRouter)
- Multi-step workflow
- Command handling
- Error handling

Demonstrates how to integrate backends with Telegram.
"""

import os
import asyncio
import logging
from typing import Optional

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from dotenv import load_dotenv

# Assumes agent_adapter.py is in same directory or Python path
from agent_adapter import TelegramAgentAdapter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# ============================================================================
# Example 1: Simple Support Routing Agent
# ============================================================================

class SupportRoutingAgent(TelegramAgentAdapter):
    """Route support requests to appropriate team."""

    async def process_agent_request(self, message: str, user_id: str) -> str:
        message_lower = message.lower()

        if any(word in message_lower for word in ["invoice", "payment", "bill"]):
            return "📊 Routing to Billing Team...\nA specialist will help you shortly."

        elif any(word in message_lower for word in ["error", "bug", "crash", "not working"]):
            return "🔧 Routing to Technical Support...\nOur engineers are standing by."

        elif any(word in message_lower for word in ["refund", "return", "cancel"]):
            return "↩️ Routing to Refunds Team...\nWe'll process this quickly."

        else:
            return "ℹ️ I didn't quite understand. Please tell me about:\n- Billing\n- Technical issues\n- Returns/Refunds"


# ============================================================================
# Example 2: LLM-Based Conversational Agent
# ============================================================================

class ConversationalAgent(TelegramAgentAdapter):
    """Claude-powered conversational agent using OpenRouter."""

    async def process_agent_request(self, message: str, user_id: str) -> str:
        if not OPENROUTER_KEY:
            return "⚠️ LLM not configured. Set OPENROUTER_API_KEY."

        try:
            import httpx

            # Get conversation history from state
            state = self.get_user_state(user_id)
            conversation = state.get("conversation", [])

            # Add user message
            conversation.append({"role": "user", "content": message})
            self.update_user_state(user_id, "conversation", conversation)

            # Call OpenRouter/Claude
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://openrouter.io/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
                    json={
                        "model": "claude-3-5-sonnet:free",
                        "messages": conversation,
                        "max_tokens": 1024,
                    },
                    timeout=30.0
                )

            data = response.json()
            assistant_message = data["choices"][0]["message"]["content"]

            # Add assistant response to history
            conversation.append({"role": "assistant", "content": assistant_message})
            self.update_user_state(user_id, "conversation", conversation)

            return assistant_message

        except Exception as e:
            logger.error(f"LLM error: {e}")
            return f"⚠️ Error: {str(e)}"


# ============================================================================
# Example 3: Multi-Step Workflow (Customer Onboarding)
# ============================================================================

class OnboardingAgent(TelegramAgentAdapter):
    """Multi-step user onboarding workflow."""

    async def process_agent_request(self, message: str, user_id: str) -> str:
        state = self.get_user_state(user_id)
        step = state.get("onboarding_step", 0)

        if step == 0:
            # Step 1: Collect name
            if message.strip():
                self.update_user_state(user_id, "onboarding_step", 1)
                self.update_user_state(user_id, "name", message)
                return f"✅ Got it, {message}!\n\nWhat's your email?"
            else:
                return "What's your name?"

        elif step == 1:
            # Step 2: Collect email
            if "@" in message:
                self.update_user_state(user_id, "onboarding_step", 2)
                self.update_user_state(user_id, "email", message)
                return f"Perfect, {message}!\n\nWhat's your use case (e.g., automation, monitoring, alerts)?"
            else:
                return "❌ That doesn't look like an email. Try again:"

        elif step == 2:
            # Step 3: Collect use case, then finish
            self.update_user_state(user_id, "onboarding_step", 3)
            self.update_user_state(user_id, "use_case", message)

            name = state.get("name")
            email = state.get("email")

            return (
                f"🎉 Onboarding complete!\n\n"
                f"Name: {name}\n"
                f"Email: {email}\n"
                f"Use case: {message}\n\n"
                f"Welcome aboard! Use /help for commands."
            )

        else:
            # Already onboarded
            return "You're already set up! Type /help for commands."


# ============================================================================
# Router & Dispatcher Setup
# ============================================================================

# Initialize agents
support_agent = SupportRoutingAgent(bot_token=BOT_TOKEN)
chat_agent = ConversationalAgent(bot_token=BOT_TOKEN)
onboarding_agent = OnboardingAgent(bot_token=BOT_TOKEN)


@dp.message(Command(start=True))
async def cmd_start(message: types.Message):
    """Handle /start command."""
    user_id = str(message.from_user.id)

    # Check if user is already onboarded
    state = onboarding_agent.get_user_state(user_id)
    if state.get("onboarding_step", 0) == 3:
        await message.answer("Welcome back! 👋\n\nTry /support, /chat, or /reset")
    else:
        await message.answer(
            "👋 Welcome!\n\nLet's set you up. What's your name?"
        )
        onboarding_agent.update_user_state(user_id, "onboarding_step", 0)


@dp.message(Command("support"))
async def cmd_support(message: types.Message):
    """Switch to support mode."""
    user_id = str(message.from_user.id)
    support_agent.update_user_state(user_id, "mode", "support")
    await message.answer("🎯 Support mode active.\n\nWhat do you need help with?")


@dp.message(Command("chat"))
async def cmd_chat(message: types.Message):
    """Switch to chat mode (LLM)."""
    user_id = str(message.from_user.id)
    chat_agent.update_user_state(user_id, "mode", "chat")
    await message.answer("💬 Chat mode active.\n\nTalk to me about anything!")


@dp.message(Command("reset"))
async def cmd_reset(message: types.Message):
    """Reset user state."""
    user_id = str(message.from_user.id)
    onboarding_agent.clear_user_state(user_id)
    chat_agent.clear_user_state(user_id)
    support_agent.clear_user_state(user_id)
    await message.answer("🔄 Reset complete. Type /start to begin again.")


@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    """Show help."""
    help_text = (
        "/start - Begin onboarding\n"
        "/support - Get support (routing agent)\n"
        "/chat - Talk to AI assistant\n"
        "/reset - Clear your data\n"
        "/help - This message"
    )
    await message.answer(f"📚 Available commands:\n\n{help_text}")


@dp.message()
async def handle_message(message: types.Message):
    """Route messages to appropriate agent based on mode."""
    user_id = str(message.from_user.id)
    user_message = message.text

    # Typing indicator
    await bot.send_chat_action(message.chat.id, "typing")

    # Determine which agent to use
    state = onboarding_agent.get_user_state(user_id)
    mode = state.get("mode", "onboarding")

    if mode == "support":
        response = await support_agent.handle_message(user_id, user_message)
    elif mode == "chat":
        response = await chat_agent.handle_message(user_id, user_message)
    else:
        # Onboarding mode
        response = await onboarding_agent.handle_message(user_id, user_message)

    # Send response (split if too long)
    if len(response) > 4096:
        for chunk in [response[i : i + 4096] for i in range(0, len(response), 4096)]:
            await message.answer(chunk)
    else:
        await message.answer(response)


async def main():
    """Start the bot."""
    logger.info("Starting Telegram bot...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
