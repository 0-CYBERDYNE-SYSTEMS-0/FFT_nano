"""AI-debt heuristic signals for review context."""

from __future__ import annotations

import re
from collections.abc import Callable

_COMMENT_RE = re.compile(r"^\s*(?:#|//|/\*|\*)")
_LOG_RE = re.compile(
    r"\b(?:console\.(?:log|warn|error|debug|info)|print\(|logging\.(?:debug|info|warning|error))\b"
)
_GUARD_RE = re.compile(
    r"\b(?:if\s*\(\s*\w+\s*(?:===?\s*null|!==?\s*null|===?\s*undefined|!==?\s*undefined)"
    r"|try\s*\{|try\s*:)\b"
)
_FUNC_BODY_RE = re.compile(r"(?:def\s+\w+|function\s+\w+|=>\s*\{)", re.MULTILINE)


def gather_ai_debt_signals(
    file_contents: dict[str, str],
    *,
    rel_fn: Callable[[str], str],
) -> dict[str, object]:
    """Compute per-file AI-debt heuristic signals.

    Returns ``{"file_signals": {path: {signal: value}}, "codebase_avg_comment_ratio": float}``.
    Top 20 files by signal count.
    """
    all_ratios: list[float] = []
    file_signals: dict[str, dict[str, float]] = {}

    for filepath, content in file_contents.items():
        rpath = rel_fn(filepath)
        lines = content.splitlines()
        if not lines:
            continue

        total = len(lines)
        comment_lines = sum(1 for line in lines if _COMMENT_RE.match(line))
        comment_ratio = comment_lines / total

        all_ratios.append(comment_ratio)

        log_count = len(_LOG_RE.findall(content))
        func_count = len(_FUNC_BODY_RE.findall(content))
        log_density = log_count / max(func_count, 1)

        guard_count = len(_GUARD_RE.findall(content))
        guard_density = guard_count / max(func_count, 1)

        signals: dict[str, float] = {}
        if comment_ratio > 0.3:
            signals["comment_ratio"] = round(comment_ratio, 2)
        if log_density > 3.0:
            signals["log_density"] = round(log_density, 1)
        if guard_density > 2.0:
            signals["guard_density"] = round(guard_density, 1)

        if signals:
            file_signals[rpath] = signals

    # Top 20 by signal count
    top = dict(sorted(file_signals.items(), key=lambda item: -len(item[1]))[:20])
    avg_ratio = sum(all_ratios) / len(all_ratios) if all_ratios else 0.0

    return {
        "file_signals": top,
        "codebase_avg_comment_ratio": round(avg_ratio, 3),
    }


__all__ = ["gather_ai_debt_signals"]
