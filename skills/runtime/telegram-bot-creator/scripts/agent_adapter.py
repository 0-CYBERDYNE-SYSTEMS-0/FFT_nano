#!/usr/bin/env python3
"""
Base adapter class for bridging backend agents/pipelines to Telegram.

This provides a reusable pattern for wrapping agents (following agentskills.io spec
or custom implementations) and exposing them as Telegram handlers.

Usage:
    from agent_adapter import TelegramAgentAdapter

    class MyAgent(TelegramAgentAdapter):
        async def process_agent_request(self, message: str, user_id: str) -> str:
            # Your agent logic here
            return agent_response
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import json
import logging

logger = logging.getLogger(__name__)


class TelegramAgentAdapter(ABC):
    """
    Base class for adapting backend agents to Telegram.

    Subclass this and implement process_agent_request() to wire your agent logic.
    """

    def __init__(self, bot_token: str, agent_config: Optional[Dict[str, Any]] = None):
        self.bot_token = bot_token
        self.agent_config = agent_config or {}
        self.user_state = {}  # Simple in-memory state; replace with DB in production

    async def handle_message(self, user_id: str, message: str) -> str:
        """
        Main entry point for incoming Telegram messages.

        Manages state, routes to agent, handles errors.
        """
        try:
            # Load or initialize user state
            if user_id not in self.user_state:
                self.user_state[user_id] = self._init_user_state(user_id)

            # Process through agent
            response = await self.process_agent_request(message, user_id)

            # Update state
            self.user_state[user_id]['last_message'] = message

            return response

        except Exception as e:
            logger.error(f"Agent error for user {user_id}: {e}")
            return self._error_response(str(e))

    @abstractmethod
    async def process_agent_request(self, message: str, user_id: str) -> str:
        """
        Implement this method with your agent logic.

        Args:
            message: User message from Telegram
            user_id: Telegram user ID

        Returns:
            Agent response to send back to user
        """
        pass

    def _init_user_state(self, user_id: str) -> Dict[str, Any]:
        """Initialize state for a new user."""
        return {
            'user_id': user_id,
            'created_at': self._get_timestamp(),
            'message_count': 0,
            'context': {},
        }

    def _error_response(self, error: str) -> str:
        """Format error response."""
        return f"⚠️ Error processing request: {error}\n\nPlease try again or contact support."

    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        from datetime import datetime
        return datetime.utcnow().isoformat()

    def get_user_state(self, user_id: str) -> Dict[str, Any]:
        """Retrieve user state."""
        return self.user_state.get(user_id, {})

    def update_user_state(self, user_id: str, key: str, value: Any) -> None:
        """Update a specific user state value."""
        if user_id not in self.user_state:
            self.user_state[user_id] = self._init_user_state(user_id)
        self.user_state[user_id][key] = value

    def clear_user_state(self, user_id: str) -> None:
        """Clear user state (e.g., on /reset command)."""
        self.user_state.pop(user_id, None)


# Example agent implementation
class ExampleCustomAgent(TelegramAgentAdapter):
    """
    Example implementation showing how to create a simple agent.
    Replace with your actual agent logic.
    """

    async def process_agent_request(self, message: str, user_id: str) -> str:
        """Simple echo agent for demonstration."""
        # In production, call your actual agent/LLM here
        return f"📢 You said: {message}\n\nThis is where your agent processes the request."


if __name__ == "__main__":
    # Quick test
    import asyncio

    agent = ExampleCustomAgent(bot_token="test_token")

    async def test():
        response = await agent.handle_message("user123", "Hello, agent!")
        print(response)

    asyncio.run(test())
