"""Passthrough/forwarding detection: shared classification algorithm.

Language-specific extraction lives in language plugins. This module provides
the shared core that classifies parameters as passthrough vs direct-use.
"""

from __future__ import annotations

import re
from collections.abc import Callable


def classify_passthrough_tier(
    passthrough_count: int,
    ratio: float,
    *,
    has_spread: bool = False,
) -> tuple[int, str] | None:
    """Classify passthrough severity into (tier, confidence) or None to skip."""
    rules: list[tuple[bool, tuple[int, str]]] = [
        (passthrough_count >= 20 or ratio >= 0.8, (4, "high")),
        (
            passthrough_count >= 8 and ratio >= 0.5,
            (3, "high" if ratio >= 0.7 else "medium"),
        ),
        (has_spread and passthrough_count >= 4, (3, "medium")),
    ]
    for matched, classification in rules:
        if matched:
            return classification
    return None


def classify_params(
    params: list[str],
    body: str,
    make_pattern: Callable[[str], str],
    occurrences_per_match: int = 2,
) -> tuple[list[str], list[str]]:
    """Classify params as passthrough vs direct-use from body text matches."""
    passthrough = []
    direct = []
    for name in params:
        total = len(re.findall(rf"\b{re.escape(name)}\b", body))
        if total == 0:
            # Unused param — not passthrough, not direct-use either.
            # Count as direct (it's destructured, just unused).
            direct.append(name)
            continue
        pt_matches = len(re.findall(make_pattern(name), body))
        pt_occurrences = pt_matches * occurrences_per_match
        if pt_occurrences >= total:
            passthrough.append(name)
        else:
            direct.append(name)
    return passthrough, direct


__all__ = ["classify_params", "classify_passthrough_tier"]
