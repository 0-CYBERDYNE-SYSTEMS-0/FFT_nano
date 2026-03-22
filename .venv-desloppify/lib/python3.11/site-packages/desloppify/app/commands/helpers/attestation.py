"""Shared attestation and note validation helpers."""

from __future__ import annotations

import sys
from collections.abc import Sequence

from desloppify.base.output.terminal import colorize

_REQUIRED_ATTESTATION_PHRASES = ("i have actually", "not gaming")
_ATTESTATION_KEYWORD_HINT = ("I have actually", "not gaming")
_MIN_NOTE_LENGTH = 50


def _emit_warning(message: str) -> None:
    """Write resolve preflight warnings to stderr consistently."""
    print(colorize(message, "yellow"), file=sys.stderr)


def _missing_attestation_keywords(
    attestation: str | None,
    *,
    required_phrases: Sequence[str] | None = None,
) -> list[str]:
    normalized = " ".join((attestation or "").strip().lower().split())
    phrases = tuple(required_phrases or _REQUIRED_ATTESTATION_PHRASES)
    return [
        phrase for phrase in phrases if phrase not in normalized
    ]


def validate_attestation(
    attestation: str | None,
    *,
    required_phrases: Sequence[str] | None = None,
) -> bool:
    return not _missing_attestation_keywords(
        attestation,
        required_phrases=required_phrases,
    )


def show_attestation_requirement(
    label: str,
    attestation: str | None,
    example: str,
    *,
    required_phrases: Sequence[str] | None = None,
) -> None:
    phrases = tuple(required_phrases or _REQUIRED_ATTESTATION_PHRASES)
    missing = _missing_attestation_keywords(
        attestation,
        required_phrases=phrases,
    )
    if not attestation:
        _emit_warning(f"{label} requires --attest.")
    elif missing:
        missing_str = ", ".join(f"'{keyword}'" for keyword in missing)
        _emit_warning(
            f"{label} attestation is missing required keyword(s): {missing_str}."
        )
    display_phrases = (
        _ATTESTATION_KEYWORD_HINT if required_phrases is None else tuple(required_phrases)
    )
    if len(display_phrases) == 2:
        phrase_text = f"'{display_phrases[0]}' and '{display_phrases[1]}'"
    else:
        phrase_text = ", ".join(f"'{phrase}'" for phrase in display_phrases)
    _emit_warning(f"Required keywords: {phrase_text}.")
    print(colorize(f'Example: --attest "{example}"', "dim"), file=sys.stderr)


def validate_note_length(note: str | None) -> bool:
    """Return True if the note meets the minimum length requirement."""
    return note is not None and len(note.strip()) >= _MIN_NOTE_LENGTH


def show_note_length_requirement(note: str | None) -> None:
    """Emit a warning about minimum note length."""
    current = len((note or "").strip())
    _emit_warning(
        f"Note must be at least {_MIN_NOTE_LENGTH} characters (got {current}). "
        f"Describe what you actually did."
    )


__all__ = [
    "_MIN_NOTE_LENGTH",
    "show_attestation_requirement",
    "show_note_length_requirement",
    "validate_attestation",
    "validate_note_length",
]
