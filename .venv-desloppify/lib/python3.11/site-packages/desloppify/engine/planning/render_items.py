"""Plan item section rendering helpers."""

from __future__ import annotations

from collections import defaultdict

from desloppify.base.config import DEFAULT_TARGET_STRICT_SCORE
from desloppify.engine._work_queue.core import QueueBuildOptions
from desloppify.engine.planning.queue_policy import build_execution_queue
from desloppify.engine.planning.types import PlanState

# Backward-compatible test seam for plan-item queue building.
build_work_queue = build_execution_queue


def _subjective_threshold_for_state(state: PlanState | dict | None) -> float:
    raw_target = (
        (state or {}).get("config", {}).get("target_strict_score", DEFAULT_TARGET_STRICT_SCORE)
        if isinstance(state, dict)
        else DEFAULT_TARGET_STRICT_SCORE
    )
    try:
        subjective_threshold = float(raw_target)
    except (TypeError, ValueError):
        subjective_threshold = DEFAULT_TARGET_STRICT_SCORE
    return max(0.0, min(100.0, subjective_threshold))


def render_queue_item_sections(
    open_items: list[dict],
    *,
    include_header: bool = True,
) -> list[str]:
    """Render per-file sections from an already-built queue item list."""
    by_file: dict[str, list] = defaultdict(list)
    for item in open_items:
        by_file[item.get("file", ".")].append(item)

    lines: list[str] = []
    total_count = len(open_items)
    if not open_items:
        return lines

    if include_header:
        lines.extend(
            [
                "---",
                f"## Open Items ({total_count})",
                "",
            ]
        )

    sorted_files = sorted(by_file.items(), key=lambda item: (-len(item[1]), item[0]))
    for filepath, file_items in sorted_files:
        display_path = "Codebase-wide" if filepath == "." else filepath
        lines.append(f"### `{display_path}` ({len(file_items)} issues)")
        lines.append("")
        for item in file_items:
            if item.get("kind") == "subjective_dimension":
                lines.append(f"- [ ] [subjective] {item.get('summary', '')}")
                lines.append(f"      `{item.get('id', '')}`")
                if item.get("primary_command"):
                    lines.append(f"      action: `{item['primary_command']}`")
                continue

            conf_badge = f"[{item.get('confidence', 'medium')}]"
            lines.append(f"- [ ] {conf_badge} {item.get('summary', '')}")
            lines.append(f"      `{item.get('id', '')}`")
        lines.append("")

    return lines


def plan_item_sections(
    issues: dict,
    *,
    state: PlanState | None = None,
    plan: dict | None = None,
) -> list[str]:
    """Build per-file sections from the execution queue."""
    queue_state: PlanState | dict = state or {"issues": issues}
    if "issues" not in queue_state:
        queue_state = {**queue_state, "issues": issues}

    queue = build_work_queue(
        queue_state,
        options=QueueBuildOptions(
            count=None,
            status="open",
            include_subjective=True,
            subjective_threshold=_subjective_threshold_for_state(state),
            plan=plan,
        ),
    )
    return render_queue_item_sections(queue.get("items", []))


__all__ = ["plan_item_sections", "render_queue_item_sections"]
