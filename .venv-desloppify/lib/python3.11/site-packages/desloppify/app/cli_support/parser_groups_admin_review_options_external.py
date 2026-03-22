"""External review parser option groups."""

from __future__ import annotations

import argparse


def _add_external_review_options(p_review: argparse.ArgumentParser) -> None:
    g_external = p_review.add_argument_group("external review")
    g_external.add_argument(
        "--external-start",
        action="store_true",
        help=(
            "Start a cloud external review session (generates blind packet, "
            "session id/token, and reviewer template)"
        ),
    )
    g_external.add_argument(
        "--external-submit",
        action="store_true",
        help=(
            "Submit external reviewer JSON via a started session; "
            "CLI injects canonical provenance before import"
        ),
    )
    g_external.add_argument(
        "--session-id",
        type=str,
        default=None,
        help="External review session id for --external-submit",
    )
    g_external.add_argument(
        "--external-runner",
        choices=["claude"],
        default="claude",
        help="External reviewer runner for --external-start (default: claude)",
    )
    g_external.add_argument(
        "--session-ttl-hours",
        type=int,
        default=24,
        help="External review session expiration in hours (default: 24)",
    )


__all__ = ["_add_external_review_options"]
