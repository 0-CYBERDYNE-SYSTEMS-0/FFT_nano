"""langs command: list all available language plugins with depth and tools."""

from __future__ import annotations

import argparse
import logging

from desloppify.base.output.terminal import colorize
from desloppify.languages.framework import (
    LangConfig,
    load_all,
    make_lang_config,
    registry_state,
    shared_phase_labels,
)

logger = logging.getLogger(__name__)

_DEPTH_BARS = {
    "full": 8,
    "standard": 5,
    "shallow": 3,
    "minimal": 2,
}

_DEPTH_MAX = 8


def _depth_bar(depth: str) -> str:
    """Render a depth bar like ████░░░░."""
    filled = _DEPTH_BARS.get(depth, 2)
    empty = _DEPTH_MAX - filled
    return "\u2588" * filled + "\u2591" * empty


def _get_tool_labels(cfg: LangConfig) -> str:
    """Extract tool labels from phases."""
    if cfg.integration_depth == "full":
        return "custom detectors"
    labels = [p.label for p in cfg.phases if p.label not in shared_phase_labels()]
    suffix = " (auto-fix)" if cfg.fixers else ""
    return (", ".join(labels) if labels else "none") + suffix


def cmd_langs(args: argparse.Namespace) -> None:
    """List all available languages with depth and tool info."""
    load_all()

    configs: list[tuple[str, LangConfig]] = []
    for name, obj in sorted(registry_state.all_items()):
        if isinstance(obj, LangConfig):
            configs.append((name, obj))
        else:
            try:
                cfg = make_lang_config(name, obj)
                configs.append((name, cfg))
            except (TypeError, ValueError, KeyError, AttributeError) as exc:
                logger.debug("Skipping unresolvable lang config %s: %s", name, exc)
                continue

    # Sort: full first, then standard, shallow, minimal; alphabetical within
    depth_order = {"full": 0, "standard": 1, "shallow": 2, "minimal": 3}
    configs.sort(key=lambda x: (depth_order.get(x[1].integration_depth, 9), x[0]))

    # Column widths
    name_width = max(len(name) for name, _ in configs) + 2 if configs else 14
    name_width = max(name_width, 14)

    print()
    header = f"{'Language':<{name_width}}{'Depth':<14}Tools"
    print(colorize(header, "bold"))
    print("\u2500" * 60)

    for name, cfg in configs:
        depth = getattr(cfg, "integration_depth", "full")
        bar = _depth_bar(depth)
        tools = _get_tool_labels(cfg)
        print(f"{name:<{name_width}}{bar}    {tools}")
    print()
