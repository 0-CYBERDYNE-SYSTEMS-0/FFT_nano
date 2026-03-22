"""Shared triage display primitives used by multiple rendering modules."""

from __future__ import annotations

from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_triage import (
    TRIAGE_CMD_CLUSTER_ENRICH_COMPACT,
    TRIAGE_STAGE_LABELS,
    compute_triage_progress,
    triage_manual_stage_command,
    triage_runner_commands,
)

from ..review_coverage import manual_clusters_with_issues
from ..stages.helpers import unenriched_clusters


def print_stage_progress(stages: dict, plan: dict | None = None) -> None:
    """Print the triage-stage progress indicator."""
    print(colorize("  Stages:", "dim"))
    progress = compute_triage_progress(stages)
    stage_labels = dict(TRIAGE_STAGE_LABELS)
    for stage in progress.stages:
        label = stage_labels.get(stage.name, stage.name)
        if stage.recorded and stage.confirmed:
            print(colorize(f"    ✓ {label} (confirmed)", "green"))
        elif stage.recorded:
            print(colorize(f"    ✓ {label} (needs confirm)", "yellow"))
        elif stage.name == progress.current_stage:
            print(colorize(f"    → {label} (current)", "yellow"))
        else:
            print(colorize(f"    ○ {label}", "dim"))

    if progress.blocked_reason:
        print(colorize(f"\n    {progress.blocked_reason}", "yellow"))
        if progress.next_command:
            print(colorize(f"      Next: {progress.next_command}", "dim"))

    if plan and "reflect" in stages and "organize" not in stages:
        gaps = unenriched_clusters(plan)
        manual = manual_clusters_with_issues(plan)
        if not manual:
            print(colorize("\n    No manual clusters yet. Preferred next step:", "yellow"))
            for label, command in triage_runner_commands(only_stages="organize"):
                print(colorize(f"      {label}: {command}", "dim"))
            print(
                colorize(
                    f"      Manual fallback: {triage_manual_stage_command('organize')}",
                    "dim",
                )
            )
        elif gaps:
            print(colorize(f"\n    {len(gaps)} cluster(s) need enrichment:", "yellow"))
            for name, missing in gaps:
                print(colorize(f"      {name}: missing {', '.join(missing)}", "yellow"))
            print(colorize(f"      Fix: {TRIAGE_CMD_CLUSTER_ENRICH_COMPACT}", "dim"))
        else:
            print(colorize(f"\n    All {len(manual)} manual cluster(s) enriched.", "green"))


__all__ = ["print_stage_progress"]
