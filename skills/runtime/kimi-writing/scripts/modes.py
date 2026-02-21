"""
Mode selection and configuration for Kimi-K2.5
"""

from typing import Dict, Any
import os


class ModeConfig:
    """Configuration for writing modes"""

    # Default configurations
    MODES = {
        "thinking": {
            "temperature": 1.0,
            "top_p": 0.95,
            "max_tokens": 8192,
            "description": "Deep reasoning, step-by-step analysis, complex tasks",
            "best_for": [
                "Complex narratives",
                "Long-form articles",
                "Technical documentation",
                "Research papers",
                "Nuanced arguments"
            ]
        },
        "instant": {
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 4096,
            "description": "Quick responses, direct output, speed-focused",
            "best_for": [
                "Copy headlines",
                "Social media posts",
                "Email subject lines",
                "Quick summaries",
                "Direct answers"
            ]
        }
    }

    @classmethod
    def get_config(cls, mode: str) -> Dict[str, Any]:
        """Get configuration for a mode"""
        return cls.MODES.get(mode, cls.MODES["thinking"])

    @classmethod
    def auto_select(cls, prompt: str, force_thinking: bool = False) -> str:
        """
        Automatically select mode based on prompt

        Args:
            prompt: User's writing request
            force_thinking: Force thinking mode regardless

        Returns:
            Mode name ('thinking' or 'instant')
        """
        if force_thinking:
            return "thinking"

        from .domain_analyzer import DomainAnalyzer

        # Use domain analyzer's heuristic
        if DomainAnalyzer.should_use_thinking_mode(prompt):
            return "thinking"

        return "instant"

    @classmethod
    def describe_mode(cls, mode: str) -> str:
        """Get description of a mode"""
        config = cls.get_config(mode)
        return f"{mode.upper()} Mode: {config['description']}"


def get_mode_config(mode: str) -> Dict[str, Any]:
    """Convenience function"""
    return ModeConfig.get_config(mode)


def select_mode(prompt: str, override: str = None, force_thinking: bool = False) -> str:
    """
    Select mode with override support

    Args:
        prompt: User's writing request
        override: Manually specified mode
        force_thinking: Force thinking mode

    Returns:
        Mode name
    """
    if override:
        return override

    return ModeConfig.auto_select(prompt, force_thinking=force_thinking)
