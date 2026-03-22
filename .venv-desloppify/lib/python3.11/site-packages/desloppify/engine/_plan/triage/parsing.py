"""Parsing helpers for cluster triage output."""

from __future__ import annotations

import re

from desloppify.engine._plan.schema import VALID_EPIC_DIRECTIONS

from .prompt import ContradictionNote, DismissedIssue, TriageResult

ISSUE_ID_RE = re.compile(r"[a-z_]+::[a-f0-9]{8,}")
BRACKET_SHORT_ID_RE = re.compile(r"\[([a-z0-9_]{6,16})\]")

def _literal_issue_citations(text: str, valid_ids: set[str]) -> set[str]:
    return {valid_id for valid_id in valid_ids if valid_id in text}


def _short_issue_id_map(valid_ids: set[str]) -> dict[str, str]:
    short_map: dict[str, str] = {}
    ambiguous_short: set[str] = set()
    for valid_id in valid_ids:
        suffix = valid_id.rsplit("::", 1)[-1]
        short = suffix[:8].lower()
        if not short:
            continue
        existing = short_map.get(short)
        if existing is None:
            short_map[short] = valid_id
        elif existing != valid_id:
            ambiguous_short.add(short)

    for short in ambiguous_short:
        short_map.pop(short, None)
    return short_map


def _bracketed_short_id_citations(text: str, valid_ids: set[str]) -> set[str]:
    short_map = _short_issue_id_map(valid_ids)
    cited: set[str] = set()
    for short in BRACKET_SHORT_ID_RE.findall(text.lower()):
        mapped = short_map.get(short)
        if mapped:
            cited.add(mapped)
    return cited


def _full_issue_id_citations(text: str, valid_ids: set[str]) -> set[str]:
    return {
        match.group()
        for match in ISSUE_ID_RE.finditer(text)
        if match.group() in valid_ids
    }


def _hex_suffix_citations(text: str, valid_ids: set[str]) -> set[str]:
    cited: set[str] = set()
    for token in re.findall(r"[0-9a-f]{8,}", text):
        for valid_id in valid_ids:
            if valid_id.endswith("::" + token):
                cited.add(valid_id)
                break
    return cited


def extract_issue_citations(text: str, valid_ids: set[str]) -> set[str]:
    """Extract issue IDs cited in free text.

    Matches full issue IDs (e.g. ``review::abcdef12``) or bare 8+ char
    hex suffixes that correspond to a known issue.
    """
    if not text or not valid_ids:
        return set()

    cited: set[str] = set()
    cited.update(_literal_issue_citations(text, valid_ids))
    cited.update(_bracketed_short_id_citations(text, valid_ids))
    cited.update(_full_issue_id_citations(text, valid_ids))
    cited.update(_hex_suffix_citations(text, valid_ids))
    return cited


def _parse_action_steps(raw_steps: object) -> list[dict]:
    steps: list[dict] = []
    if not isinstance(raw_steps, list):
        return steps
    for raw_step in raw_steps:
        if isinstance(raw_step, dict):
            title = str(raw_step.get("title", "")).strip()
            if not title:
                continue
            step: dict = {"title": title}
            detail = raw_step.get("detail")
            if isinstance(detail, str) and detail.strip():
                step["detail"] = detail.strip()
            refs = raw_step.get("issue_refs")
            if isinstance(refs, list):
                normalized_refs = [str(ref).strip() for ref in refs if str(ref).strip()]
                if normalized_refs:
                    step["issue_refs"] = normalized_refs
            done = raw_step.get("done")
            if isinstance(done, bool):
                step["done"] = done
            steps.append(step)
    return steps


def _normalize_direction(raw_epic: dict) -> str:
    direction = str(raw_epic.get("direction", "simplify")).strip()
    if direction not in VALID_EPIC_DIRECTIONS:
        return "simplify"
    return direction


def _valid_epic_issue_ids(raw_ids: object, valid_ids: set[str]) -> list[str]:
    if not isinstance(raw_ids, list):
        return []
    return [issue_id for issue_id in raw_ids if isinstance(issue_id, str) and issue_id in valid_ids]


def _parse_epic(raw_epic: object, valid_ids: set[str]) -> dict | None:
    if not isinstance(raw_epic, dict):
        return None

    name = str(raw_epic.get("name", "")).strip()
    if not name:
        return None

    return {
        "name": name,
        "thesis": str(raw_epic.get("thesis", "")),
        "direction": _normalize_direction(raw_epic),
        "root_cause": str(raw_epic.get("root_cause", "")),
        "issue_ids": _valid_epic_issue_ids(raw_epic.get("issue_ids", []), valid_ids),
        "dismissed": _valid_epic_issue_ids(raw_epic.get("dismissed", []), valid_ids),
        "agent_safe": bool(raw_epic.get("agent_safe", False)),
        "dependency_order": int(raw_epic.get("dependency_order", 999)),
        "action_steps": _parse_action_steps(raw_epic.get("action_steps", [])),
        "status": str(raw_epic.get("status", "pending")),
    }


def _parse_dismissed_issue(raw_dismissal: object, valid_ids: set[str]) -> DismissedIssue | None:
    if not isinstance(raw_dismissal, dict):
        return None
    issue_id = str(raw_dismissal.get("issue_id", ""))
    if issue_id not in valid_ids:
        return None
    return DismissedIssue(issue_id=issue_id, reason=str(raw_dismissal.get("reason", "")))


def _parse_contradiction_note(raw_note: object) -> ContradictionNote | None:
    if not isinstance(raw_note, dict):
        return None
    return ContradictionNote(
        kept=str(raw_note.get("kept", "")),
        dismissed=str(raw_note.get("dismissed", "")),
        reason=str(raw_note.get("reason", "")),
    )


def parse_triage_result(raw: dict, valid_ids: set[str]) -> TriageResult:
    """Parse and validate raw LLM output into a TriageResult.

    Invalid issue IDs are silently dropped from clusters and dismissals.
    """
    strategy_summary = str(raw.get("strategy_summary", ""))

    epics: list[dict] = []
    raw_clusters = raw.get("clusters", raw.get("epics", []))
    for raw_epic in raw_clusters:
        epic = _parse_epic(raw_epic, valid_ids)
        if epic is not None:
            epics.append(epic)

    dismissed_issues: list[DismissedIssue] = []
    for d in raw.get("dismissed_issues", []):
        dismissed_issue = _parse_dismissed_issue(d, valid_ids)
        if dismissed_issue is not None:
            dismissed_issues.append(dismissed_issue)

    contradiction_notes: list[ContradictionNote] = []
    for c in raw.get("contradiction_notes", []):
        contradiction_note = _parse_contradiction_note(c)
        if contradiction_note is not None:
            contradiction_notes.append(contradiction_note)

    priority_rationale = str(raw.get("priority_rationale", ""))

    return TriageResult(
        strategy_summary=strategy_summary,
        epics=epics,
        dismissed_issues=dismissed_issues,
        contradiction_notes=contradiction_notes,
        priority_rationale=priority_rationale,
    )

__all__ = ["ISSUE_ID_RE", "extract_issue_citations", "parse_triage_result"]
