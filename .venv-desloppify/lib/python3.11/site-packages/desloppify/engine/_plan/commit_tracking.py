"""Pure operations for commit tracking within the living plan."""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from typing import Any

from desloppify.engine._plan.schema import CommitRecord
from desloppify.engine._state.schema import StateModel, utc_now


@dataclass(frozen=True)
class CommitRecordOptions:
    """Optional fields attached to a commit record."""

    branch: str | None = None
    issue_ids: list[str] | None = None
    note: str | None = None
    cluster_name: str | None = None


def _commit_record_options(
    *,
    options: CommitRecordOptions | None,
    legacy_kwargs: dict[str, object],
) -> CommitRecordOptions:
    """Resolve commit record options from modern or legacy kwargs."""
    allowed_keys = {"branch", "issue_ids", "note", "cluster_name"}
    unknown = sorted(set(legacy_kwargs) - allowed_keys)
    if unknown:
        joined = ", ".join(unknown)
        raise TypeError(f"Unexpected keyword argument(s): {joined}")
    if options is not None and legacy_kwargs:
        raise TypeError("Pass either options=... or legacy keyword args, not both")
    if options is not None:
        return options
    branch = legacy_kwargs.get("branch")
    issue_ids = legacy_kwargs.get("issue_ids")
    note = legacy_kwargs.get("note")
    cluster_name = legacy_kwargs.get("cluster_name")
    return CommitRecordOptions(
        branch=None if branch is None else str(branch),
        issue_ids=list(issue_ids) if isinstance(issue_ids, list) else None,
        note=None if note is None else str(note),
        cluster_name=None if cluster_name is None else str(cluster_name),
    )


def add_uncommitted_issues(plan: dict[str, Any], issue_ids: list[str]) -> int:
    """Add issue IDs to the uncommitted list (deduplicates).  Returns count added."""
    uncommitted: list[str] = plan.setdefault("uncommitted_issues", [])
    existing = set(uncommitted)
    added = 0
    for fid in issue_ids:
        if fid not in existing:
            uncommitted.append(fid)
            existing.add(fid)
            added += 1
    return added


def purge_uncommitted_ids(plan: dict[str, Any], issue_ids: list[str]) -> int:
    """Remove issue IDs from the uncommitted list.  Returns count removed."""
    to_remove = set(issue_ids)
    uncommitted: list[str] = plan.get("uncommitted_issues", [])
    original = len(uncommitted)
    plan["uncommitted_issues"] = [fid for fid in uncommitted if fid not in to_remove]
    return original - len(plan["uncommitted_issues"])


def get_uncommitted_issues(plan: dict[str, Any]) -> list[str]:
    """Return the current uncommitted issue IDs."""
    return list(plan.get("uncommitted_issues", []))


def record_commit(
    plan: dict[str, Any],
    sha: str,
    *,
    options: CommitRecordOptions | None = None,
    **legacy_kwargs,
) -> CommitRecord:
    """Move uncommitted issues into a new CommitRecord.

    If *issue_ids* is None, all uncommitted issues are recorded.
    """
    record_options = _commit_record_options(
        options=options,
        legacy_kwargs=legacy_kwargs,
    )
    uncommitted = plan.get("uncommitted_issues", [])
    if record_options.issue_ids is None:
        ids_to_record = list(uncommitted)
    else:
        ids_to_record = list(record_options.issue_ids)

    record: CommitRecord = {
        "sha": sha,
        "branch": record_options.branch,
        "issue_ids": ids_to_record,
        "recorded_at": utc_now(),
        "note": record_options.note,
    }
    record["cluster_name"] = record_options.cluster_name

    commit_log: list[CommitRecord] = plan.setdefault("commit_log", [])
    commit_log.append(record)

    # Remove recorded IDs from uncommitted
    recorded_set = set(ids_to_record)
    plan["uncommitted_issues"] = [fid for fid in uncommitted if fid not in recorded_set]

    return record


def find_commit_for_issue(plan: dict[str, Any], issue_id: str) -> CommitRecord | None:
    """Find the CommitRecord that contains a given issue ID."""
    for record in plan.get("commit_log", []):
        if issue_id in record.get("issue_ids", []):
            return record
    return None


def commit_tracking_summary(plan: dict[str, Any]) -> dict[str, int]:
    """Return summary counts: uncommitted, committed, total."""
    uncommitted = len(plan.get("uncommitted_issues", []))
    committed = sum(
        len(r.get("issue_ids", [])) for r in plan.get("commit_log", [])
    )
    return {
        "uncommitted": uncommitted,
        "committed": committed,
        "total": uncommitted + committed,
    }


def _issue_summary(state: StateModel, issue_id: str) -> str:
    """Extract a short summary for a issue ID from state."""
    issue = (state.get("work_items") or state.get("issues", {})).get(issue_id, {})
    summary = issue.get("summary", "")
    if summary:
        return summary[:80]
    return issue_id


def _score_delta_line(plan: dict[str, Any], state: StateModel) -> str:
    """Build a score delta summary line from plan_start_scores to current."""
    start = plan.get("plan_start_scores", {})
    current_dim = state.get("dimension_scores", {})
    if not start or not current_dim:
        return ""

    start_strict = start.get("strict")
    if start_strict is None:
        return ""

    # Compute current strict from dimension_scores.
    try:
        from desloppify.engine._scoring.results.core import compute_health_score

        current_strict = compute_health_score(current_dim, score_key="strict")
    except (ImportError, TypeError, ValueError, KeyError):
        return ""

    delta = current_strict - start_strict
    sign = "+" if delta >= 0 else ""
    return f"Score: {start_strict:.1f} → {current_strict:.1f} strict ({sign}{delta:.1f})"


def generate_pr_body(plan: dict[str, Any], state: StateModel) -> str:
    """Generate the PR description markdown from commit_log."""
    lines: list[str] = ["## Code Health Improvements", ""]

    commit_log: list[dict] = plan.get("commit_log", [])
    if commit_log:
        lines.append("### Commits")
        lines.append("")
        total_issues = 0
        for record in commit_log:
            sha = record.get("sha", "?")[:7]
            note = record.get("note") or ""
            issue_ids = record.get("issue_ids", [])
            total_issues += len(issue_ids)

            header = f"**{sha}**"
            if note:
                header += f" — {note}"
            lines.append(header)

            for fid in issue_ids:
                summary = _issue_summary(state, fid)
                if summary and summary != fid:
                    lines.append(f"- `{fid}` — {summary}")
                else:
                    lines.append(f"- `{fid}`")
            lines.append("")

        lines.append("### Summary")
        commit_count = len(commit_log)
        lines.append(
            f"{total_issues} issue{'s' if total_issues != 1 else ''} "
            f"resolved across {commit_count} commit{'s' if commit_count != 1 else ''}"
        )
        score_line = _score_delta_line(plan, state)
        if score_line:
            lines.append(score_line)
    else:
        lines.append("*No commits recorded yet.*")

    return "\n".join(lines)


def suggest_commit_message(
    plan: dict[str, Any],
    template: str,
) -> str:
    """Generate a suggested commit message from uncommitted issues."""
    uncommitted = plan.get("uncommitted_issues", [])
    if not uncommitted:
        return ""

    # Extract common detector/category
    detectors: set[str] = set()
    dirs: set[str] = set()
    for fid in uncommitted:
        parts = fid.split("::")
        if parts:
            detectors.add(parts[0])
        if len(parts) >= 2:
            file_part = parts[1]
            slash_idx = file_part.rfind("/")
            if slash_idx > 0:
                dirs.add(file_part[:slash_idx + 1])

    summary_parts: list[str] = []
    if len(detectors) == 1:
        summary_parts.append(f"{next(iter(detectors))}")
    else:
        summary_parts.append(f"{len(detectors)} detector{'s' if len(detectors) != 1 else ''}")
    if len(dirs) == 1:
        summary_parts.append(f"in {next(iter(dirs))}")

    summary = " ".join(summary_parts)

    return template.format(
        status="autofix",
        count=len(uncommitted),
        summary=summary,
    )


def filter_issue_ids_by_pattern(issue_ids: list[str], patterns: list[str]) -> list[str]:
    """Filter issue IDs by glob patterns (used for --only)."""
    result: list[str] = []
    for fid in issue_ids:
        for pattern in patterns:
            if fnmatch.fnmatch(fid, pattern):
                result.append(fid)
                break
    return result


__all__ = [
    "add_uncommitted_issues",
    "commit_tracking_summary",
    "filter_issue_ids_by_pattern",
    "find_commit_for_issue",
    "generate_pr_body",
    "get_uncommitted_issues",
    "purge_uncommitted_ids",
    "record_commit",
    "suggest_commit_message",
]
