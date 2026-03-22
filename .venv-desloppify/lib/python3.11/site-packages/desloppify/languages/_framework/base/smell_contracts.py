"""Typed boundary models for smell detector payload normalization."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

SmellSeverity = Literal["high", "medium", "low"]
_VALID_SEVERITIES: frozenset[str] = frozenset({"high", "medium", "low"})


@dataclass(frozen=True)
class SmellMatch:
    """Normalized one-line smell evidence item."""

    file: str
    line: int
    content: str = ""

    def to_mapping(self) -> dict[str, Any]:
        return {
            "file": self.file,
            "line": self.line,
            "content": self.content,
        }


@dataclass(frozen=True)
class SmellEntry:
    """Normalized smell entry with explicit severity and typed matches."""

    smell_id: str
    label: str
    severity: SmellSeverity
    matches: tuple[SmellMatch, ...]

    def to_mapping(self) -> dict[str, Any]:
        return {
            "id": self.smell_id,
            "label": self.label,
            "severity": self.severity,
            "matches": [match.to_mapping() for match in self.matches],
        }


def normalize_smell_matches(
    raw_matches: Iterable[Mapping[str, Any]],
    *,
    content_key: str = "content",
    default_content: str = "",
) -> list[SmellMatch]:
    """Normalize detector match rows into SmellMatch models."""
    normalized: list[SmellMatch] = []
    for raw in raw_matches:
        file_value = raw.get("file")
        if not isinstance(file_value, str) or not file_value:
            raise ValueError("smell match missing string file")

        line_value = raw.get("line")
        if isinstance(line_value, bool):
            raise ValueError("smell match line must be an integer")
        if not isinstance(line_value, int):
            try:
                line_value = int(line_value)
            except (TypeError, ValueError) as exc:
                raise ValueError("smell match line must be an integer") from exc

        content_value = raw.get(content_key, default_content)
        if content_value is None:
            content_value = default_content
        if not isinstance(content_value, str):
            content_value = str(content_value)

        normalized.append(
            SmellMatch(
                file=file_value,
                line=line_value,
                content=content_value,
            )
        )
    return normalized


def normalize_smell_entries(raw_entries: Iterable[Mapping[str, Any]]) -> list[SmellEntry]:
    """Normalize smell detector entries and validate required contract keys."""
    normalized: list[SmellEntry] = []
    for raw in raw_entries:
        smell_id = raw.get("id")
        if not isinstance(smell_id, str) or not smell_id:
            raise ValueError("smell entry missing string id")

        label = raw.get("label")
        if not isinstance(label, str) or not label:
            raise ValueError(f"smell entry {smell_id!r} missing string label")

        severity = raw.get("severity")
        if not isinstance(severity, str) or severity not in _VALID_SEVERITIES:
            raise ValueError(f"smell entry {smell_id!r} has invalid severity")

        matches_raw = raw.get("matches", [])
        if not isinstance(matches_raw, list):
            raise ValueError(f"smell entry {smell_id!r} matches must be a list")

        matches = tuple(normalize_smell_matches(matches_raw))
        normalized.append(
            SmellEntry(
                smell_id=smell_id,
                label=label,
                severity=severity,
                matches=matches,
            )
        )
    return normalized


__all__ = [
    "SmellEntry",
    "SmellMatch",
    "SmellSeverity",
    "normalize_smell_entries",
    "normalize_smell_matches",
]
