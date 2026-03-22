"""Structural-area reporting helpers for status output."""

from __future__ import annotations

from collections import defaultdict

from desloppify.base.output.terminal import colorize
from desloppify.base.discovery.paths import get_area
from desloppify.engine._state.filtering import path_scoped_issues


def collect_structural_areas(
    state: dict,
) -> list[tuple[str, list]] | None:
    """Collect T3/T4 structural issues grouped by area."""
    issues = path_scoped_issues(
        (state.get("work_items") or state.get("issues", {})), state.get("scan_path")
    )
    structural = [
        issue
        for issue in issues.values()
        if issue["tier"] in (3, 4) and issue["status"] in ("open", "wontfix")
    ]
    if len(structural) < 5:
        return None

    areas: dict[str, list] = defaultdict(list)
    for issue in structural:
        area = get_area(str(issue.get("file", "")))
        areas[area].append(issue)
    if len(areas) < 2:
        return None

    return sorted(areas.items(), key=lambda pair: -sum(f["tier"] for f in pair[1]))


def build_area_rows(
    sorted_areas: list[tuple[str, list]],
    *,
    max_areas: int = 15,
) -> list[list[str]]:
    """Build table rows from sorted area issues."""
    rows: list[list[str]] = []
    for area, area_issues in sorted_areas[:max_areas]:
        t3 = sum(1 for issue in area_issues if issue["tier"] == 3)
        t4 = sum(1 for issue in area_issues if issue["tier"] == 4)
        open_count = sum(1 for issue in area_issues if issue["status"] == "open")
        debt_count = sum(1 for issue in area_issues if issue["status"] == "wontfix")
        weight = sum(issue["tier"] for issue in area_issues)
        rows.append(
            [
                area,
                str(len(area_issues)),
                f"T3:{t3} T4:{t4}",
                str(open_count),
                str(debt_count),
                str(weight),
            ]
        )
    return rows


def render_area_workflow(
    sorted_areas: list[tuple[str, list]],
    *,
    max_areas: int = 15,
) -> None:
    """Print overflow count and workflow instructions for structural work."""
    remaining = len(sorted_areas) - max_areas
    if remaining > 0:
        print(colorize(f"\n  ... and {remaining} more areas", "dim"))

    print(colorize("\n  Workflow:", "dim"))
    print(colorize("    1. desloppify show <area> --status wontfix --top 50", "dim"))
    print(
        colorize(
            "    2. Create tasks/<date>-<area-name>.md with decomposition plan",
            "dim",
        )
    )
    print(
        colorize("    3. Farm each task doc to a sub-agent for implementation", "dim")
    )
    print()


__all__ = [
    "build_area_rows",
    "collect_structural_areas",
    "render_area_workflow",
]
