"""Visualization command handlers."""

from __future__ import annotations

import argparse
from pathlib import Path

from desloppify.app.output._viz_cmd_context import load_cmd_context
from desloppify.app.output.visualize import (
    TreeTextOptions,
    generate_tree_text,
    generate_visualization,
)
from desloppify.base.exception_sets import CommandError
from desloppify.base.output.terminal import colorize


def _cmd_viz(args: argparse.Namespace) -> None:
    path, lang, state = load_cmd_context(args)
    output = Path(getattr(args, "output", None) or ".desloppify/treemap.html")
    print(colorize("Collecting file data and building dependency graph...", "dim"))
    _, output_result = generate_visualization(path, state, output, lang=lang)
    if output_result.status != "written":
        message = output_result.message or "unknown write failure"
        raise CommandError(
            "Visualization generation failed "
            f"({output_result.status}): {output} ({message})",
        )
    print(colorize(f"\nTreemap written to {output}", "green"))
    print(colorize(f"Open in browser: file://{output.resolve()}", "dim"))


def _cmd_tree(args: argparse.Namespace) -> None:
    path, lang, state = load_cmd_context(args)
    try:
        tree_text = generate_tree_text(
            path,
            state,
            options=TreeTextOptions(
                max_depth=getattr(args, "depth", 2),
                focus=getattr(args, "focus", None),
                min_loc=getattr(args, "min_loc", 0),
                sort_by=getattr(args, "sort", "loc"),
                detail=getattr(args, "detail", False),
            ),
            lang=lang,
        )
    except OSError as exc:
        raise CommandError(f"Tree generation failed: {exc}") from exc
    print(tree_text)


def cmd_viz(args: argparse.Namespace) -> None:
    _cmd_viz(args)


def cmd_tree(args: argparse.Namespace) -> None:
    _cmd_tree(args)


__all__ = ["cmd_tree", "cmd_viz"]
