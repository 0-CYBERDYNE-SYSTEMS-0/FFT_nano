"""Helper routines shared by resolve render output."""

from __future__ import annotations

from typing import TYPE_CHECKING

from desloppify.base.exception_sets import CommandError
from desloppify.base.output.terminal import colorize
from desloppify.engine._state.schema import StateModel
from desloppify.state_scoring import score_snapshot

if TYPE_CHECKING:
    from desloppify.state_scoring import ScoreSnapshot


def score_snapshot_or_error(state: StateModel) -> ScoreSnapshot:
    """Return a full score snapshot or raise CommandError when unavailable."""
    snapshot = score_snapshot(state)
    if (
        snapshot.overall is None
        or snapshot.objective is None
        or snapshot.strict is None
        or snapshot.verified is None
    ):
        raise CommandError("Scores unavailable — run `desloppify scan`.")
    return snapshot


def print_strict_gap_note(status: str, *, overall: float, strict: float) -> None:
    if status != "wontfix":
        return
    strict_gap = round(overall - strict, 1)
    if strict_gap <= 0:
        return
    print(
        colorize(
            f"  Note: wontfix items still count against strict score. "
            f"Current gap: overall {overall:.1f} vs strict {strict:.1f} ({strict_gap:.1f} pts of hidden debt).",
            "yellow",
        )
    )


def print_post_resolve_guidance(
    *,
    status: str,
    has_review_issues: bool,
    overall_delta: float,
) -> None:
    if has_review_issues and abs(overall_delta) < 0.05:
        print(
            colorize(
                "  Scores unchanged (review issues don't affect scores directly).",
                "yellow",
            )
        )
        print(
            colorize(
                "  Run `desloppify review --prepare` to get updated assessment scores.",
                "dim",
            )
        )
        return
    if status == "fixed":
        print(
            colorize(
                "  Verified score updates after a scan confirms the issue disappeared.",
                "yellow",
            )
        )


__all__ = [
    "print_post_resolve_guidance",
    "print_strict_gap_note",
    "score_snapshot_or_error",
]
