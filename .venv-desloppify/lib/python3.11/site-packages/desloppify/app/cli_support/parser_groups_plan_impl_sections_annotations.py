"""Annotation/skip/resolve parser section builders for plan command."""

from __future__ import annotations

import argparse


def _add_annotation_subparsers(plan_sub) -> None:
    # plan describe <patterns> "<text>"
    p_describe = plan_sub.add_parser("describe", help="Set augmented description")
    p_describe.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_describe.add_argument("text", type=str, help="Description text")

    # plan note <patterns> "<text>"
    p_note = plan_sub.add_parser("note", help="Set note on issues")
    p_note.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_note.add_argument("text", type=str, help="Note text")


def _add_skip_subparsers(plan_sub) -> None:
    # plan skip <patterns> [--reason] [--review-after N] [--permanent] [--false-positive] [--note] [--attest]
    p_skip = plan_sub.add_parser(
        "skip",
        help="Skip issues: temporary (default), --permanent (wontfix), or --false-positive",
    )
    p_skip.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_skip.add_argument("--reason", type=str, default=None, help="Why this is being skipped")
    p_skip.add_argument(
        "--review-after", type=int, default=None, metavar="N",
        help="Re-surface after N scans (temporary only)",
    )
    p_skip.add_argument(
        "--permanent", action="store_true",
        help="Mark as wontfix (score-affecting, requires --note and --attest)",
    )
    p_skip.add_argument(
        "--false-positive", action="store_true",
        help="Mark as false positive (requires --attest)",
    )
    p_skip.add_argument("--note", type=str, default=None, help="Explanation (required for --permanent)")
    p_skip.add_argument(
        "--attest", type=str, default=None,
        help="Attestation (required for --permanent and --false-positive)",
    )
    p_skip.add_argument(
        "--confirm", action="store_true", default=False,
        help="Required when skipping more than 5 items at once",
    )

    # plan unskip <patterns>
    p_unskip = plan_sub.add_parser(
        "unskip", help="Bring skipped issues back to queue (reopens permanent/fp in state)"
    )
    p_unskip.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_unskip.add_argument(
        "--force", action="store_true", default=False,
        help="Also unskip protected items (permanent/false_positive with notes)",
    )

    # plan backlog <patterns>
    p_backlog = plan_sub.add_parser(
        "backlog",
        help="Move deferred items to backlog (remove from plan tracking entirely)",
    )
    p_backlog.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )


def _add_resolve_subparser(plan_sub) -> None:
    # plan reopen <patterns>
    p_reopen = plan_sub.add_parser(
        "reopen", help="Reopen resolved issues and move back to queue"
    )
    p_reopen.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )

    # plan resolve <patterns> --attest [--note]
    p_resolve = plan_sub.add_parser(
        "resolve",
        help="Mark issues as fixed (shows score movement + next step)",
        epilog="""\
examples:
  desloppify plan resolve "unused::src/foo.tsx::React" \\
    --attest "I have actually removed the import and I am not gaming the score."
  desloppify plan resolve security --note "patched XSS" \\
    --attest "I have actually ..."  """,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p_resolve.add_argument(
        "patterns", nargs="+", metavar="PATTERN",
        help="Issue ID(s), detector, file path, glob, or cluster name",
    )
    p_resolve.add_argument(
        "--note", type=str, default=None, help="Explanation of the fix"
    )
    p_resolve.add_argument(
        "--attest",
        type=str,
        default=None,
        help=(
            "Required anti-gaming attestation. Must include BOTH keywords "
            "'I have actually' and 'not gaming'."
        ),
    )
    p_resolve.add_argument(
        "--confirm",
        action="store_true",
        default=False,
        help="Auto-generate attestation from --note (requires --note)",
    )
    p_resolve.add_argument(
        "--force-resolve",
        action="store_true",
        default=False,
        dest="force_resolve",
        help="Bypass triage guardrail when new issues are pending triage",
    )


__all__ = [
    "_add_annotation_subparsers",
    "_add_resolve_subparser",
    "_add_skip_subparsers",
]
