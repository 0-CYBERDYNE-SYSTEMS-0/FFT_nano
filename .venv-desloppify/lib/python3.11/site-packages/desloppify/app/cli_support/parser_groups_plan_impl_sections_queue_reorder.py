"""Queue/reorder parser section builders for plan command."""

from __future__ import annotations

import argparse


def _add_queue_subparser(plan_sub) -> None:
    p_queue = plan_sub.add_parser("queue", help="Compact table of execution queue items")
    p_queue.add_argument("--top", type=int, default=30, help="Max items (default: 30, 0=all)")
    p_queue.add_argument("--cluster", type=str, default=None, metavar="NAME",
                         help="Filter to a specific cluster")
    p_queue.add_argument("--include-skipped", action="store_true",
                         help="Include skipped items at end")
    p_queue.add_argument("--sort", choices=["priority", "recent"], default="priority",
                         help="Sort order (default: priority)")


def _add_promote_subparser(plan_sub) -> None:
    p_promote = plan_sub.add_parser(
        "promote",
        help="Promote backlog issues or clusters into the queue",
        epilog="""\
patterns accept issue IDs, detector names, file paths, globs, or cluster names.
cluster names expand to all member IDs automatically.

examples:
  desloppify plan promote security top
  desloppify plan promote auto/test_coverage bottom
  desloppify plan promote my-cluster before -t workflow::run-scan""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_promote.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_promote.add_argument(
        "position", nargs="?", choices=["top", "bottom", "before", "after"], default="bottom",
        help="Where to insert in the active queue (default: bottom)",
    )
    p_promote.add_argument(
        "-t", "--target", default=None,
        help="Required for before/after (issue ID or cluster name)",
    )


def _add_reorder_subparser(plan_sub) -> None:
    p_move = plan_sub.add_parser(
        "reorder",
        help="Reposition issues in the queue",
        epilog="""\
patterns accept issue IDs, detector names, file paths, globs, or cluster names.
cluster names expand to all member IDs automatically.

examples:
  desloppify plan reorder security top                         # all issues from detector
  desloppify plan reorder "unused::src/foo.ts::*" top          # glob pattern
  desloppify plan reorder smells bottom                        # deprioritize
  desloppify plan reorder my-cluster top                       # cluster members
  desloppify plan reorder my-cluster unused top                # mix clusters + issues
  desloppify plan reorder unused before -t security            # before a issue/cluster
  desloppify plan reorder smells after -t my-cluster           # after a cluster
  desloppify plan reorder security up -t 3                     # shift up 3 positions""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_move.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_move.add_argument(
        "position", choices=["top", "bottom", "before", "after", "up", "down"],
        help="Where to move",
    )
    p_move.add_argument(
        "-t", "--target", default=None,
        help="Required for before/after (issue ID or cluster name) and up/down (integer offset)",
    )

__all__ = ["_add_promote_subparser", "_add_queue_subparser", "_add_reorder_subparser"]
