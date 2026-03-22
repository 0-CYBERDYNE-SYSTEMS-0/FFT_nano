"""Merge conceptually duplicate open review issues."""

from __future__ import annotations

import argparse
from typing import Any, NamedTuple, TypedDict

from desloppify.app.commands.helpers.query import write_query
from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.helpers.queue_progress import show_score_with_plan_context
from desloppify.base.output.issues import issue_weight
from desloppify.base.output.terminal import colorize
from desloppify.engine._state.persistence import save_state
from desloppify.engine._state.schema import StateModel, utc_now
from desloppify.engine._state.schema_scores import (
    get_objective_score,
    get_overall_score,
    get_strict_score,
    get_verified_strict_score,
)
from desloppify.engine.work_queue import list_open_review_issues
from desloppify.intelligence.narrative.core import NarrativeContext, compute_narrative
from desloppify.intelligence.review.issue_merge import (
    merge_list_fields,
    normalize_word_set,
    pick_longer_text,
    track_merged_from,
)


class ResolutionAttestationPayload(TypedDict, total=False):
    """Resolution metadata attached to auto-resolved duplicate issues."""

    kind: str
    text: str
    attested_at: str
    scan_verified: bool


class ReviewIssueDetailPayload(TypedDict, total=False):
    """Issue detail fields used by conceptual merge logic."""

    holistic: bool
    dimension: str
    related_files: list[str]
    evidence: list[str]
    suggestion: str
    merged_from: list[str]
    merged_at: str


class ReviewIssueStatePayload(TypedDict, total=False):
    """Open review issue contract used during merge grouping and resolution."""

    id: str
    detector: str
    summary: str
    detail: ReviewIssueDetailPayload
    status: str
    resolved_at: str
    note: str
    resolution_attestation: ResolutionAttestationPayload | dict[str, Any]


class _ScoreSnapshot(NamedTuple):
    overall: float | None
    objective: float | None
    strict: float | None
    verified: float | None


def _score_snapshot(state: StateModel) -> _ScoreSnapshot:
    return _ScoreSnapshot(
        overall=get_overall_score(state),
        objective=get_objective_score(state),
        strict=get_strict_score(state),
        verified=get_verified_strict_score(state),
    )


def _summary_similarity(a: str, b: str) -> float:
    left = normalize_word_set(a)
    right = normalize_word_set(b)
    if not left or not right:
        return 0.0
    overlap = len(left & right)
    union = len(left | right)
    return float(overlap) / float(union) if union else 0.0


def _parse_holistic_identifier(issue_id: str) -> str:
    parts = [part for part in str(issue_id).split("::") if part]
    if len(parts) < 2:
        return ""
    candidate = parts[-2].strip()
    if not candidate or candidate in {"holistic", "changed", "stale", "unreviewed"}:
        return ""
    return candidate


def _related_files_set(issue: ReviewIssueStatePayload) -> set[str]:
    related = issue.get("detail", {}).get("related_files", [])
    if not isinstance(related, list):
        return set()
    return {str(path).strip() for path in related if str(path).strip()}


def _same_issue_concept(
    left: ReviewIssueStatePayload,
    right: ReviewIssueStatePayload,
    *,
    similarity_threshold: float,
) -> bool:
    left_detail = left.get("detail", {})
    right_detail = right.get("detail", {})
    if left_detail.get("dimension") != right_detail.get("dimension"):
        return False

    left_summary = str(left.get("summary", "")).strip()
    right_summary = str(right.get("summary", "")).strip()
    similarity = _summary_similarity(left_summary, right_summary)

    left_files = _related_files_set(left)
    right_files = _related_files_set(right)
    files_overlap = not left_files or not right_files or bool(left_files & right_files)

    left_identifier = _parse_holistic_identifier(left.get("id", ""))
    right_identifier = _parse_holistic_identifier(right.get("id", ""))
    if left_identifier and right_identifier and left_identifier == right_identifier:
        # Identifier match still requires at least one corroborating signal
        return similarity >= 0.3 or files_overlap

    return similarity >= similarity_threshold and files_overlap


def _merge_issue_details(
    primary: ReviewIssueStatePayload,
    duplicate: ReviewIssueStatePayload,
) -> None:
    primary_detail = primary.setdefault("detail", {})
    duplicate_detail = duplicate.get("detail", {})

    merge_list_fields(primary_detail, duplicate_detail, ("related_files", "evidence"))
    pick_longer_text(primary_detail, duplicate_detail, "suggestion")
    track_merged_from(primary_detail, duplicate.get("id", ""))


def _similarity_threshold(args: argparse.Namespace) -> float:
    try:
        similarity = float(getattr(args, "similarity", 0.8))
    except (TypeError, ValueError):
        similarity = 0.8
    return max(0.0, min(1.0, similarity))


def _open_holistic_review_issues(
    items: list[ReviewIssueStatePayload],
) -> list[ReviewIssueStatePayload]:
    return [
        issue
        for issue in items
        if issue.get("detector") == "review"
        and issue.get("detail", {}).get("holistic")
    ]


def _merge_groups(
    open_holistic: list[ReviewIssueStatePayload],
    *,
    similarity_threshold: float,
) -> list[list[ReviewIssueStatePayload]]:
    consumed: set[str] = set()
    merge_groups: list[list[ReviewIssueStatePayload]] = []
    for candidate in open_holistic:
        candidate_id = candidate.get("id", "")
        if not candidate_id or candidate_id in consumed:
            continue
        group = [candidate]
        consumed.add(candidate_id)
        for other in open_holistic:
            other_id = other.get("id", "")
            if not other_id or other_id in consumed:
                continue
            if _same_issue_concept(
                candidate,
                other,
                similarity_threshold=similarity_threshold,
            ):
                consumed.add(other_id)
                group.append(other)
        if len(group) > 1:
            merge_groups.append(group)
    return merge_groups


def _apply_merge_groups(
    merge_groups: list[list[ReviewIssueStatePayload]],
    *,
    dry_run: bool,
    timestamp: str,
) -> list[tuple[str, list[str]]]:
    merged_pairs: list[tuple[str, list[str]]] = []
    for group in merge_groups:
        ranked = sorted(
            group,
            key=lambda issue: (issue_weight(issue)[0], issue.get("id", "")),
            reverse=True,
        )
        primary = ranked[0]
        duplicates = ranked[1:]
        merged_pairs.append((primary.get("id", ""), [d.get("id", "") for d in duplicates]))
        if dry_run:
            continue
        for duplicate in duplicates:
            _merge_issue_details(primary, duplicate)
            duplicate["status"] = "auto_resolved"
            duplicate["resolved_at"] = timestamp
            duplicate["note"] = f"merged into {primary.get('id', '')}"
            duplicate["resolution_attestation"] = {
                "kind": "issue_merge",
                "text": "Merged conceptually duplicate review issue",
                "attested_at": timestamp,
                "scan_verified": False,
            }
        primary_detail = primary.setdefault("detail", {})
        primary_detail["merged_at"] = timestamp
    return merged_pairs


def do_merge(args: argparse.Namespace) -> None:
    """Merge conceptually duplicate open review issues."""
    runtime = command_runtime(args)
    state = runtime.state
    state_file = runtime.state_path
    narrative = compute_narrative(state, context=NarrativeContext(command="review"))
    items: list[ReviewIssueStatePayload] = [
        issue for issue in list_open_review_issues(state) if isinstance(issue, dict)
    ]

    if not items:
        print(colorize("\n  No review issues open.\n", "dim"))
        return

    similarity = _similarity_threshold(args)
    open_holistic = _open_holistic_review_issues(items)
    if len(open_holistic) < 2:
        print(colorize("\n  Not enough holistic review issues to merge.\n", "dim"))
        return

    merge_groups = _merge_groups(open_holistic, similarity_threshold=similarity)
    if not merge_groups:
        print(
            colorize(
                "\n  No duplicate issue concepts found at the current similarity threshold.\n",
                "dim",
            )
        )
        return

    dry_run = bool(getattr(args, "dry_run", False))
    prev = _score_snapshot(state)
    timestamp = utc_now()
    merged_pairs = _apply_merge_groups(
        merge_groups,
        dry_run=dry_run,
        timestamp=timestamp,
    )

    print(
        colorize(
            f"\n  Merge groups: {len(merge_groups)} | "
            f"duplicate issues: {sum(len(group) - 1 for group in merge_groups)}",
            "bold",
        )
    )
    for index, (primary_id, duplicate_ids) in enumerate(merged_pairs, 1):
        preview = ", ".join(duplicate_ids[:3])
        if len(duplicate_ids) > 3:
            preview = f"{preview}, +{len(duplicate_ids) - 3} more"
        print(colorize(f"  [{index}] keep {primary_id}", "dim"))
        print(colorize(f"      merge {preview}", "dim"))

    if dry_run:
        print(colorize("\n  Dry run only: no state changes written.\n", "yellow"))
        return

    save_state(state, state_file)
    print(colorize("\n  State updated with merged issue groups.", "green"))
    show_score_with_plan_context(state, prev)
    write_query(
        {
            "command": "review",
            "action": "merge",
            "groups": len(merge_groups),
            "duplicates_merged": sum(len(group) - 1 for group in merge_groups),
            "next_command": "desloppify show review --status open",
            "narrative": narrative,
        }
    )
