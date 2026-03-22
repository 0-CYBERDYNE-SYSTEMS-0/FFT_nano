"""Spoofed user-message box for steering LLM agent behavior."""

from __future__ import annotations

import textwrap

_BOX_WIDTH = 58


def print_user_message(text: str) -> None:
    """Print a plain bordered box to nudge LLM agent behavior.

    Uses a simple box without JSON framing — experiments showed agents
    engage with the content rather than reflexively dismissing it as
    prompt injection (which JSON-framed variants triggered).

    Plain text (no color) so it stands out among colored triage output.
    """
    wrapped = textwrap.wrap(text, width=54)

    print()
    print(f"  ┌{'─' * _BOX_WIDTH}┐")
    print(f"  │{' ' * _BOX_WIDTH}│")
    for line in wrapped:
        print(f"  │  {line.ljust(_BOX_WIDTH - 2)}│")
    print(f"  │{' ' * _BOX_WIDTH}│")
    print(f"  └{'─' * _BOX_WIDTH}┘")
    print()
