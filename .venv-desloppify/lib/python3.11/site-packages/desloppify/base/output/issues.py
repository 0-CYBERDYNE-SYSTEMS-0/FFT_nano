"""Rendering and scoring helpers for work-item work orders."""

from __future__ import annotations

import logging
from datetime import datetime

from desloppify.base.registry import DETECTORS
from desloppify.base.scoring_constants import (
    CONFIDENCE_WEIGHTS,
    HOLISTIC_MULTIPLIER,
)
from desloppify.engine._state.issue_semantics import is_triage_finding

logger = logging.getLogger(__name__)


def issue_weight(issue: dict) -> tuple[float, float, str]:
    """Compute (weight, impact_pts, work_item_id) for a tracked work item."""
    confidence = issue.get("confidence", "low")
    is_holistic = issue.get("detail", {}).get("holistic", False)

    weight = CONFIDENCE_WEIGHTS.get(confidence, 0.3)
    if is_holistic:
        weight *= HOLISTIC_MULTIPLIER

    return weight, weight, issue.get("id", "")


def _append_assessment_context(
    lines: list[str], issue: dict, subjective_assessments: dict | None
) -> None:
    if not subjective_assessments:
        return

    detail = issue.get("detail", {})
    dimension = detail.get("dimension", "")
    assessment = subjective_assessments.get(dimension)
    if not assessment:
        return

    display_dimension = dimension.replace("_", " ")
    source = assessment.get("source", "review")
    assessed_at = assessment.get("assessed_at", "")[:10]
    lines.append(
        f"**Dimension assessment**: {display_dimension} — {assessment['score']}/100 "
        f"({source} review, {assessed_at})"
    )
    lines.append(
        "Fixing this work item and re-reviewing should improve the "
        f"{display_dimension} score.\n"
    )


def _append_evidence(lines: list[str], detail: dict) -> None:
    evidence = detail.get("evidence", [])
    if evidence:
        lines.append("## Evidence\n")
        for item in evidence:
            lines.append(f"- {item}")
        lines.append("")

    evidence_lines = detail.get("evidence_lines", [])
    if evidence_lines:
        lines.append("## Code References\n")
        for item in evidence_lines:
            lines.append(f"- {item}")
        lines.append("")


def _append_files(
    lines: list[str], issue: dict, detail: dict, is_holistic: bool
) -> None:
    if is_holistic:
        related_files = detail.get("related_files", [])
        if not related_files:
            return
        lines.append("## Files\n")
        for related in related_files:
            lines.append(f"- `{related}`")
        lines.append("")
        return

    file_path = issue.get("file", "")
    if file_path and file_path != ".":
        lines.append("## Files\n")
        lines.append(f"- `{file_path}`")
        lines.append("")


def _append_investigation(lines: list[str], issue_id: str, detail: dict) -> bool:
    investigation = detail.get("investigation")
    if not investigation:
        return False

    investigated_at = detail.get("investigated_at", "")
    date_suffix = ""
    if investigated_at:
        try:
            date_suffix = (
                f" ({datetime.fromisoformat(investigated_at).strftime('%Y-%m-%d')})"
            )
        except (ValueError, TypeError) as exc:
            logger.debug(
                "Invalid investigated_at value %r on %s: %s",
                investigated_at,
                issue_id,
                exc,
            )
            date_suffix = " (invalid date)"

    lines.append(f"## Investigation{date_suffix}\n")
    lines.append(f"{investigation}\n")
    return True


def _append_footer(
    lines: list[str],
    *,
    has_investigation: bool,
    lang_name: str,
    issue_id: str,
    number: int | None,
) -> None:
    if has_investigation:
        lines.append("## Ready to Fix\n")
        lines.append("When done:\n")
        lines.append("```bash")
        lines.append(f'desloppify plan resolve "{issue_id}"')
        lines.append("```\n")
        return

    lines.append("## Status: Needs Investigation\n")
    lines.append("Investigate the files above, then resolve with a note:\n")
    lines.append("```bash")
    lines.append(
        f'desloppify plan resolve "{issue_id}" --note "description of fix"'
    )
    lines.append("```\n")
    lines.append("Or save detailed analysis first:\n")
    lines.append("```bash")
    lines.append(
        f'desloppify show "{issue_id}" --notes analysis.md'
    )
    lines.append("```\n")


def render_issue_detail(
    issue: dict,
    lang_name: str,
    number: int | None = None,
    subjective_assessments: dict | None = None,
) -> str:
    """Render one tracked work item as a markdown work order from state."""
    issue_id = issue["id"]
    detail = issue.get("detail", {})
    detector = issue.get("detector", "")
    is_holistic = detail.get("holistic", False)
    is_review = is_triage_finding(issue)

    # Derive dimension: from detail for review, from registry for mechanical.
    raw_dimension = detail.get("dimension", "")
    if raw_dimension:
        dimension = raw_dimension.replace("_", " ")
    else:
        meta = DETECTORS.get(detector)
        dimension = meta.dimension.replace("_", " ") if meta else "unknown"

    confidence = issue.get("confidence", "low")

    parts = issue_id.split("::")
    identifier = parts[-2] if len(parts) >= 3 else issue.get("file", "unknown")
    weight, impact_pts, _ = issue_weight(issue)
    label = "+++" if weight >= 8 else "++" if weight >= 5 else "+"

    lines: list[str] = []
    lines.append(f"# {dimension}: {identifier}\n")
    lines.append(f"**Work item**: `{issue_id}`  ")
    if not is_review:
        meta = DETECTORS.get(detector)
        detector_display = meta.display if meta else detector
        lines.append(f"**Detector**: {detector_display} | **Confidence**: {confidence}  ")
    else:
        lines.append(f"**Dimension**: {dimension} | **Confidence**: {confidence}  ")
    lines.append(f"**Score impact**: {label} (~{impact_pts:.1f} pts)\n")

    _append_assessment_context(lines, issue, subjective_assessments)

    lines.append("## Problem\n")
    lines.append(f"{issue.get('summary', '')}\n")

    _append_evidence(lines, detail)

    suggestion = detail.get("suggestion", "")
    if suggestion:
        lines.append("## Suggested Fix\n")
        lines.append(f"{suggestion}\n")

    _append_files(lines, issue, detail, is_holistic)

    reasoning = detail.get("reasoning", "")
    if reasoning:
        lines.append("## Why This Matters\n")
        lines.append(f"{reasoning}\n")

    has_investigation = _append_investigation(lines, issue_id, detail)
    _append_footer(
        lines,
        has_investigation=has_investigation,
        lang_name=lang_name,
        issue_id=issue_id,
        number=number,
    )
    return "\n".join(lines)
