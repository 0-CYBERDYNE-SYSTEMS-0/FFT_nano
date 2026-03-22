"""Shared subjective follow-up rendering helpers."""

from __future__ import annotations

from typing import Protocol

from desloppify.base.output.terminal import colorize


class SubjectiveFollowup(Protocol):
    """Contract for objects passed to print_subjective_followup."""

    low_assessed: object  # falsy when no dimensions are below threshold
    threshold_label: str
    rendered: str
    command: str
    integrity_lines: list[tuple[str, str]]


def print_subjective_followup(
    followup: SubjectiveFollowup,
    *,
    leading_newline: bool = False,
    objective_backlog: int = 0,
) -> bool:
    """Render common subjective quality/integrity guidance lines.

    When *objective_backlog* > 0, quality nudges are suppressed entirely — the
    queue already surfaces subjective work when it becomes actionable.
    Integrity warnings are always shown (anti-gaming safeguard).

    Returns True when any line is rendered.
    """
    printed = False
    prefix = "\n" if leading_newline else ""
    if followup.low_assessed and objective_backlog <= 0:
        print(
            colorize(
                f"{prefix}  Subjective quality (<{followup.threshold_label}%): "
                f"{followup.rendered}",
                "cyan",
            )
        )
        print(
            colorize(
                f"  Next command to improve subjective scores: {followup.command}",
                "dim",
            )
        )
        printed = True

    if followup.integrity_lines:
        if printed:
            print()
        for style, message in followup.integrity_lines:
            print(colorize(f"  {message}", style))
        printed = True
    return printed


__all__ = ["print_subjective_followup"]
