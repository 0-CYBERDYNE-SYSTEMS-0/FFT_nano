"""Display helpers for triage stage workflow."""

from __future__ import annotations

from desloppify.app.commands.helpers.issue_id_display import short_issue_id
from desloppify.base.output.terminal import colorize

from ..review_coverage import manual_clusters_with_issues


def _print_observe_report_requirement() -> None:
    print(colorize("  --report is required for --stage observe.", "red"))
    print(colorize("  Verify the queued issues one by one against the code.", "dim"))
    print(colorize("  State whether each issue is genuine, false positive, exaggerated, or not worth fixing.", "dim"))
    print(colorize("  Cite the files you read and the concrete evidence behind each verdict.", "dim"))


def _print_reflect_report_requirement() -> None:
    print(colorize("  --report is required for --stage reflect.", "red"))
    print(colorize("  Compare current issues against completed work and form a holistic strategy:", "dim"))
    print(colorize("  - What clusters were previously completed? Did fixes hold?", "dim"))
    print(colorize("  - Are any dimensions recurring (resolved before, open again)?", "dim"))
    print(colorize("  - What contradictions did you find? Which direction will you take?", "dim"))
    print(colorize("  - Big picture: what to prioritize, what to defer, what to skip?", "dim"))


def _print_complete_summary(plan: dict, stages: dict) -> None:
    print(colorize("  Triage summary:", "bold"))
    if "observe" in stages:
        observe_stage = stages["observe"]
        print(colorize(f"    Observe: {observe_stage.get('issue_count', '?')} issues analysed", "dim"))
    if "reflect" in stages:
        reflect_stage = stages["reflect"]
        recurring = reflect_stage.get("recurring_dims", [])
        if recurring:
            print(colorize(f"    Reflect: {len(recurring)} recurring dimension(s)", "dim"))
        else:
            print(colorize("    Reflect: no recurring patterns", "dim"))
    if "organize" not in stages:
        return
    manual = manual_clusters_with_issues(plan)
    print(colorize(f"    Organize: {len(manual)} enriched cluster(s)", "dim"))
    for name in manual:
        cluster = plan.get("clusters", {}).get(name, {})
        steps = cluster.get("action_steps", [])
        print(colorize(f"      {name}: {len(steps)} steps", "dim"))
    if "enrich" in stages:
        shallow = stages["enrich"].get("shallow_count", 0)
        if shallow:
            print(colorize(f"    Enrich: {shallow} step(s) still without detail", "dim"))
        else:
            print(colorize("    Enrich: all steps detailed", "dim"))
    if "sense-check" in stages:
        print(colorize("    Sense-check: content, structure & value verified", "dim"))


def _print_new_issues_since_last(si) -> None:
    print(colorize(f"  {len(si.new_since_last)} new issue(s) since last triage:", "cyan"))
    review_issues = getattr(si, "review_issues", getattr(si, "open_issues", {}))
    for fid in sorted(si.new_since_last):
        issue = review_issues.get(fid, {})
        print(f"    * [{short_issue_id(fid)}] {issue.get('summary', '')}")
    print()


__all__ = [
    "_print_complete_summary",
    "_print_new_issues_since_last",
    "_print_observe_report_requirement",
    "_print_reflect_report_requirement",
]
