"""Cluster action-step rendering helpers."""

from __future__ import annotations

import textwrap

_DETAIL_WIDTH = 90
_DETAIL_MAX_LINES = 4


def _truncate_detail(detail: str) -> list[str]:
    """Wrap and truncate detail to a readable block."""
    # Wrap long single-line details, then cap total lines
    wrapped = textwrap.wrap(detail, width=_DETAIL_WIDTH)
    if not wrapped:
        return []
    if len(wrapped) <= _DETAIL_MAX_LINES:
        return wrapped
    return wrapped[:_DETAIL_MAX_LINES] + ["..."]


def _short_refs(refs: list[str]) -> list[str]:
    """Shorten issue refs to their last segment for display."""
    return [r.rsplit("::", 1)[-1] for r in refs]


def print_step(i: int, step: dict, *, colorize_fn) -> None:
    """Print a single step with title, effort, detail, and refs."""
    done = step.get("done", False)
    marker = "[x]" if done else "[ ]"
    title = step.get("title", "")
    effort = step.get("effort", "")
    effort_tag = f"  [{effort}]" if effort else ""
    print(f"    {i}. {marker} {title}{effort_tag}")
    detail = step.get("detail", "")
    if detail:
        for line in _truncate_detail(detail):
            print(colorize_fn(f"         {line}", "dim"))
    refs = step.get("issue_refs", [])
    if refs:
        print(colorize_fn(f"         Refs: {', '.join(_short_refs(refs))}", "dim"))


__all__ = ["print_step"]
