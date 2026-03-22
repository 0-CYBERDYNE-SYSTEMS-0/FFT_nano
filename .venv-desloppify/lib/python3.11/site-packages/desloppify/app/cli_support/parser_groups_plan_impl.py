"""CLI parser group builder for plan command family."""

from __future__ import annotations

import argparse

from .parser_groups_plan_impl_sections_annotations import (
    _add_annotation_subparsers,
    _add_resolve_subparser,
    _add_skip_subparsers,
)
from .parser_groups_plan_impl_sections_cluster import _add_cluster_subparser
from .parser_groups_plan_impl_sections_queue_reorder import (
    _add_promote_subparser,
    _add_queue_subparser,
    _add_reorder_subparser,
)
from .parser_groups_plan_impl_sections_triage_commit_scan import (
    _add_commit_log_subparser,
    _add_policy_subparser,
    _add_repair_state_subparser,
    _add_scan_gate_subparser,
    _add_triage_subparser,
)


def add_plan_parser(sub) -> None:
    p_plan = sub.add_parser(
        "plan",
        help="Living plan: generate, show, resolve, skip, cluster, triage",
        description="""\
Manage the living plan — a persistent layer on top of the work queue.
Track custom ordering, clusters, skips, and per-issue annotations.
Run with no subcommand to generate a full prioritized markdown plan.""",
        epilog="""\
typical workflow:
  desloppify scan                       # detect issues
  desloppify plan                       # full prioritized markdown
  desloppify plan queue                 # compact table of execution items
  desloppify plan cluster create ...    # group related issues
  desloppify plan focus <cluster>       # narrow scope
  desloppify next                       # work on the next item
  desloppify plan resolve <id> --attest .. # mark as fixed

patterns (used by reorder, skip, resolve, describe, note, etc.):
  Patterns match issues by detector, file, ID prefix, glob, or name.
  Cluster names also work as patterns — they expand to all member IDs.
  Examples: "security", "src/foo.py", "unused::*React*", "my-cluster"

subcommands:
  show       Show plan metadata summary
  queue      Compact table of execution queue items
  reset      Reset plan to empty
  promote    Promote backlog issues or clusters into the queue
  reorder    Reposition issues or clusters in the queue
  resolve    Mark issues as fixed (score movement + next-step)
  describe   Set augmented description
  note       Set note on issues
  skip       Skip issues (temporary/permanent/false_positive)
  unskip     Bring skipped issues back to queue
  backlog    Move deferred items to backlog (remove from plan)
  reopen     Reopen resolved issues
  focus      Set or clear active cluster focus
  cluster    Manage issue clusters
  triage     Staged triage workflow (after review)
  scan-gate  Check or skip scan requirement for workflow items
  repair-state Rebuild state.json from surviving plan metadata""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_plan.add_argument("--state", type=str, default=None, help="Path to state file")
    p_plan.add_argument(
        "--output", type=str, metavar="FILE",
        help="Write to file instead of stdout (refuses to overwrite existing files)",
    )

    plan_sub = p_plan.add_subparsers(dest="plan_action")

    # plan show
    plan_sub.add_parser("show", help="Show plan metadata summary")

    _add_queue_subparser(plan_sub)

    # plan reset
    plan_sub.add_parser("reset", help="Reset plan to empty")

    _add_promote_subparser(plan_sub)
    _add_reorder_subparser(plan_sub)
    _add_annotation_subparsers(plan_sub)
    _add_skip_subparsers(plan_sub)
    _add_resolve_subparser(plan_sub)
    _add_cluster_subparser(plan_sub)
    _add_triage_subparser(plan_sub)
    _add_scan_gate_subparser(plan_sub)
    _add_commit_log_subparser(plan_sub)
    _add_policy_subparser(plan_sub)
    _add_repair_state_subparser(plan_sub)


__all__ = ["add_plan_parser"]
