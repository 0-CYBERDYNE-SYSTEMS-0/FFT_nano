"""Holistic remediation plan engine."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import safe_write_text
from desloppify.base.scoring_constants import (
    CONFIDENCE_WEIGHTS,
    HOLISTIC_MULTIPLIER,
)
from desloppify.engine._state.schema import Issue, StateModel, utc_now
from desloppify.engine._state.schema_scores import (
    get_objective_score,
    get_overall_score,
    get_strict_score,
)


def _score_snapshot(state: StateModel) -> tuple[float, float, float]:
    return (
        get_overall_score(state) or 0.0,
        get_objective_score(state) or 0.0,
        get_strict_score(state) or 0.0,
    )


def render_empty_remediation_plan(state: StateModel, lang_name: str) -> str:
    """Generate a short plan when no holistic issues are open."""
    overall, objective, strict = _score_snapshot(state)
    return (
        "# Holistic Review: Remediation Plan\n\n"
        f"**Scores**: overall {overall:.1f}/100 · "
        f"objective {objective:.1f}/100 · strict {strict:.1f}/100\n\n"
        "No open holistic issues. The codebase is clean at the architectural level.\n\n"
        "To start a new holistic review cycle:\n"
        "```bash\n"
        f"desloppify --lang {lang_name} review --prepare --path <src>\n"
        "```\n"
    )


def _collect_holistic_issues(
    state: StateModel,
) -> list[tuple[str, Issue]]:
    issues = (state.get("work_items") or state.get("issues", {}))
    return [
        (issue_id, issue)
        for issue_id, issue in issues.items()
        if issue["status"] == "open"
        and issue.get("detector") == "review"
        and issue.get("detail", {}).get("holistic")
    ]


def _review_potential(state: StateModel) -> int:
    total = 0
    for language_potentials in state.get("potentials", {}).values():
        total += language_potentials.get("review", 0)
    return total


def _entry_weight(confidence: str) -> float:
    return (
        CONFIDENCE_WEIGHTS.get(confidence, 0.3)
        * HOLISTIC_MULTIPLIER
    )


def _build_entries(
    holistic_issues: list[tuple[str, Issue]], potential: int
) -> tuple[list[dict[str, Any]], float]:
    entries: list[dict[str, Any]] = []
    total_weight = 0.0

    for issue_id, issue in holistic_issues:
        detail = issue.get("detail", {})
        confidence = issue.get("confidence", "low")
        weight = _entry_weight(confidence)
        entries.append(
            {
                "id": issue_id,
                "dimension": detail.get("dimension", "unknown"),
                "summary": issue.get("summary", ""),
                "confidence": confidence,
                "weight": weight,
                "impact_pts": (weight / potential * 100) if potential > 0 else 0,
                "related_files": detail.get("related_files", []),
                "evidence": detail.get("evidence", []),
                "suggestion": detail.get("suggestion", ""),
                "reasoning": detail.get("reasoning", ""),
            }
        )
        total_weight += weight

    entries.sort(key=lambda entry: -entry["weight"])
    total_impact = (total_weight / potential * 100) if potential > 0 else 0
    return entries, total_impact


def _render_header(
    lines: list[str],
    overall: float,
    objective: float,
    strict: float,
    entries: list[dict[str, Any]],
    total_impact: float,
) -> None:
    append = lines.append
    append("# Holistic Review: Remediation Plan\n")
    append(f"**Generated**: {utc_now()[:10]}  ")
    append(
        f"**Current scores**: overall {overall:.1f}/100 · "
        f"objective {objective:.1f}/100 · strict {strict:.1f}/100  "
    )
    append(f"**Open holistic issues**: {len(entries)}  ")
    append(f"**Estimated improvement**: ~{total_impact:.1f} pts if all addressed\n")
    append("---\n")


def _render_usage(lines: list[str], lang_name: str) -> None:
    append = lines.append
    append("## How to use this plan\n")
    append("1. Work through issues in priority order (highest impact first)")
    append("2. For each issue, follow the suggested fix steps")
    append("3. After fixing, run the `resolve` command shown for that issue")
    append("4. Run `desloppify scan` to update automated issues and score")
    append("5. To re-evaluate holistic issues, re-run the full cycle:")
    append(
        f"   `desloppify --lang {lang_name} review --prepare --path <src>`"
    )
    append("   Then have an agent investigate and import — previously addressed")
    append("   issues auto-resolve if not re-reported.\n")
    append("---\n")


def _render_entry(
    lines: list[str], entry: dict[str, Any], idx: int, lang_name: str
) -> None:
    append = lines.append
    impact_label = (
        "+++" if entry["weight"] >= 8 else "++" if entry["weight"] >= 5 else "+"
    )
    append(f"## Priority {idx}: {entry['summary']}\n")
    append(
        f"**Dimension**: {entry['dimension'].replace('_', ' ')} | "
        f"**Confidence**: {entry['confidence']} | "
        f"**Impact**: {impact_label} (~{entry['impact_pts']:.1f} pts)\n"
    )

    if entry["evidence"]:
        append("### Evidence\n")
        for evidence in entry["evidence"]:
            append(f"- {evidence}")
        append("")

    if entry["suggestion"]:
        append("### Suggested fix\n")
        append(f"{entry['suggestion']}\n")

    if entry["related_files"]:
        append("### Files to modify\n")
        for related_file in entry["related_files"]:
            append(f"- `{related_file}`")
        append("")

    if entry["reasoning"]:
        append("### Why this matters\n")
        append(f"{entry['reasoning']}\n")

    append("### After fixing\n")
    append("```bash")
    append(f'desloppify --lang {lang_name} resolve fixed "{entry["id"]}"')
    append("```\n")
    append("---\n")


def _render_re_evaluate(lines: list[str], lang_name: str) -> None:
    append = lines.append
    append("## Re-evaluate\n")
    append("After addressing issues, re-run the holistic review cycle:\n")
    append("```bash")
    append(f"desloppify --lang {lang_name} review --prepare --path <src>")
    append("# Agent investigates batches and writes issues.json")
    append(f"desloppify --lang {lang_name} review --import issues.json")
    append("```\n")
    append(
        "Previously addressed issues will auto-resolve if not re-reported by the agent."
    )
    append("")


def generate_remediation_plan(
    state: StateModel, lang_name: str, *, output_path: Path | None = None
) -> str:
    """Generate prioritized markdown remediation steps for open holistic issues."""
    holistic_issues = _collect_holistic_issues(state)
    if not holistic_issues:
        content = render_empty_remediation_plan(state, lang_name)
        if output_path:
            safe_write_text(output_path, content)
        return content

    overall, objective, strict = _score_snapshot(state)
    entries, total_impact = _build_entries(holistic_issues, _review_potential(state))

    lines: list[str] = []
    _render_header(lines, overall, objective, strict, entries, total_impact)
    _render_usage(lines, lang_name)
    for idx, entry in enumerate(entries, start=1):
        _render_entry(lines, entry, idx, lang_name)
    _render_re_evaluate(lines, lang_name)

    content = "\n".join(lines)
    if output_path:
        safe_write_text(output_path, content)
    return content
