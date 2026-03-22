"""Core review parser option group."""

from __future__ import annotations

import argparse


def _add_core_options(p_review: argparse.ArgumentParser) -> None:
    g_core = p_review.add_argument_group("core options")
    g_core.add_argument("--path", type=str, default=None, help="Project root directory (default: auto-detected)")
    g_core.add_argument("--state", type=str, default=None, help="Path to state file")
    g_core.add_argument(
        "--prepare",
        action="store_true",
        help="Prepare review data (output to query.json)",
    )
    g_core.add_argument(
        "--import",
        dest="import_file",
        type=str,
        metavar="FILE",
        help="Import review issues from JSON file",
    )
    g_core.add_argument(
        "--validate-import",
        dest="validate_import_file",
        type=str,
        metavar="FILE",
        help="Validate review import payload and selected trust mode without mutating state",
    )
    g_core.add_argument(
        "--allow-partial",
        action="store_true",
        help=(
            "Allow partial review import when invalid issues are skipped "
            "(default: fail on any skipped issue)"
        ),
    )
    g_core.add_argument(
        "--dimensions",
        type=str,
        default=None,
        help="Comma-separated dimensions to evaluate",
    )
    g_core.add_argument(
        "--retrospective",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Include historical review issue status/note context in the packet "
            "to support root-cause vs symptom analysis during review "
            "(enabled by default; use --no-retrospective to disable)"
        ),
    )
    g_core.add_argument(
        "--retrospective-max-issues",
        type=int,
        default=30,
        help="Max recent historical issues to include in review context (default: 30)",
    )
    g_core.add_argument(
        "--retrospective-max-batch-items",
        type=int,
        default=20,
        help="Max history items included per batch focus slice (default: 20)",
    )
    g_core.add_argument(
        "--force-review-rerun",
        action="store_true",
        help="Bypass the objective-plan-drained gate for review reruns",
    )


__all__ = ["_add_core_options"]
