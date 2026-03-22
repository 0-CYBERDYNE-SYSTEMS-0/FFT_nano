"""Concerns special-view rendering helpers for show command."""

from __future__ import annotations

from desloppify.base.output.terminal import colorize
from desloppify.engine._concerns.generators import generate_concerns


def _show_concerns(state: dict, lang_name: str | None) -> None:
    """Render current design concerns from mechanical signals."""
    concerns = generate_concerns(state)
    if not concerns:
        print(colorize("  No design concerns detected.", "green"))
        return

    print(colorize(f"\n  {len(concerns)} design concern(s):\n", "bold"))
    dismissals = state.get("concern_dismissals", {})

    for i, concern in enumerate(concerns, 1):
        print(colorize(f"  {i}. [{concern.type}] {concern.file}", "cyan"))
        print(f"     {concern.summary}")
        for evidence in concern.evidence:
            print(colorize(f"       - {evidence}", "dim"))
        print(colorize(f"     ? {concern.question}", "yellow"))

        prev = dismissals.get(concern.fingerprint)
        if isinstance(prev, dict):
            reasoning = prev.get("reasoning", "")
            if reasoning:
                print(colorize(f"     (previously dismissed: {reasoning})", "dim"))
        print()


__all__ = ["_show_concerns"]
