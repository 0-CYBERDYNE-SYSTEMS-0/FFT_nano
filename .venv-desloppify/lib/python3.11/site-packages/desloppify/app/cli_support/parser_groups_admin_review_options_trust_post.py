"""Trust/attestation and post-processing option groups for review command."""

from __future__ import annotations

import argparse


def _add_trust_options(p_review: argparse.ArgumentParser) -> None:
    g_trust = p_review.add_argument_group("trust & attestation")
    g_trust.add_argument(
        "--manual-override",
        action="store_true",
        help=(
            "Allow untrusted assessment score imports. Issues always import; "
            "scores require trusted blind provenance unless this override is set."
        ),
    )
    g_trust.add_argument(
        "--attested-external",
        action="store_true",
        help=(
            "Accept external blind-run assessments as durable scores when "
            "paired with --attest and valid blind packet provenance "
            "(intended for cloud Claude subagent workflows)."
        ),
    )
    g_trust.add_argument(
        "--attest",
        type=str,
        default=None,
        help=(
            "Required with --manual-override or --attested-external. "
            "For attested external imports include both phrases "
            "'without awareness' and 'unbiased'."
        ),
    )


def _add_postprocessing_options(p_review: argparse.ArgumentParser) -> None:
    g_post = p_review.add_argument_group("post-processing")
    g_post.add_argument(
        "--merge",
        action="store_true",
        help="Merge conceptually duplicate open review issues",
    )
    g_post.add_argument(
        "--similarity",
        type=float,
        default=0.8,
        help="Summary similarity threshold for merge (0-1, default: 0.8)",
    )


__all__ = ["_add_postprocessing_options", "_add_trust_options"]
