"""Workflow item rendering helpers for next terminal output."""

from __future__ import annotations

from desloppify.engine.plan_triage import (
    triage_manual_stage_command,
    triage_run_stages_command,
)


def step_text(step: str | dict) -> str:
    if isinstance(step, dict):
        title = step.get("title", str(step))
        effort = step.get("effort", "")
        return f"{title}  [{effort}]" if effort else title
    return str(step)


def step_full(step: str | dict, *, indent: str = "    ") -> list[str]:
    """Return the full step rendering: title + effort + detail + refs."""
    import textwrap

    if isinstance(step, str):
        return [f"{indent}{step}"]
    lines: list[str] = [f"{indent}{step_text(step)}"]
    detail = step.get("detail", "")
    if detail:
        for line in textwrap.wrap(detail, width=90):
            lines.append(f"{indent}  {line}")
    refs = step.get("issue_refs", [])
    if refs:
        short_refs = [r.rsplit("::", 1)[-1] for r in refs]
        lines.append(f"{indent}  Refs: {', '.join(short_refs)}")
    return lines


def _detail_mapping(item: dict) -> dict:
    detail = item.get("detail", {})
    return detail if isinstance(detail, dict) else {}


def _print_command_list(
    title: str,
    entries: object,
    *,
    colorize_fn,
) -> None:
    if not isinstance(entries, list) or not entries:
        return
    print(colorize_fn(title, "dim"))
    for idx, entry in enumerate(entries, 1):
        if not isinstance(entry, dict):
            continue
        label = str(entry.get("label", "")).strip()
        command = str(entry.get("command", "")).strip()
        if label and command:
            print(colorize_fn(f"  {idx}. {label}: {command}", "dim"))
        elif command:
            print(colorize_fn(f"  {idx}. {command}", "dim"))
        elif label:
            print(colorize_fn(f"  {idx}. {label}", "dim"))


def _print_blocked_stage_actions(
    *,
    blocked_by: list[str],
    colorize_fn,
) -> None:
    deps = ", ".join(dep.replace("triage::", "") for dep in blocked_by)
    print(colorize_fn(f"  Blocked by: {deps}", "dim"))
    first_dep = blocked_by[0] if blocked_by else ""
    dep_name = first_dep.replace("triage::", "")
    if not dep_name:
        return
    print(
        colorize_fn(
            f"  Next step: {triage_run_stages_command(only_stages=dep_name)}",
            "dim",
        )
    )
    print(
        colorize_fn(
            f"  Alt runner: {triage_run_stages_command(runner='claude', only_stages=dep_name)}",
            "dim",
        )
    )
    print(
        colorize_fn(
            f"  Manual fallback: {triage_manual_stage_command(dep_name)}",
            "dim",
        )
    )


def _print_runner_commands(detail: dict, *, colorize_fn) -> None:
    _print_command_list("  Runners:", detail.get("runner_commands", []), colorize_fn=colorize_fn)
    manual_fallback = detail.get("manual_fallback", "")
    if manual_fallback:
        print(colorize_fn(f"  Manual fallback: {manual_fallback}", "dim"))


def render_workflow_stage(item: dict, *, colorize_fn, workflow_stage_name_fn) -> None:
    """Render a triage workflow stage item."""
    blocked = item.get("is_blocked", False)
    detail = _detail_mapping(item)
    stage = workflow_stage_name_fn(item)
    tag = " [blocked]" if blocked else ""
    style = "dim" if blocked else "bold"
    print(colorize_fn(f"  (Planning stage: {stage}{tag})", style))
    print(colorize_fn("  " + "─" * 60, "dim"))
    print(f"  {colorize_fn(item.get('summary', ''), 'yellow')}")
    total = detail.get("total_review_issues", 0)
    if total:
        print(colorize_fn(f"  {total} review work items to analyze", "dim"))
    if blocked:
        _print_blocked_stage_actions(
            blocked_by=item.get("blocked_by", []),
            colorize_fn=colorize_fn,
        )
    else:
        print(colorize_fn(f"\n  Action: {item.get('primary_command', '')}", "cyan"))
        _print_runner_commands(detail, colorize_fn=colorize_fn)


def render_workflow_action(item: dict, *, colorize_fn) -> None:
    print(colorize_fn("  (Workflow step)", "bold"))
    print(colorize_fn("  " + "─" * 60, "dim"))
    print(f"  {colorize_fn(item.get('summary', ''), 'yellow')}")
    detail = _detail_mapping(item)
    _print_command_list(
        "\n  Planning tools:",
        detail.get("planning_tools", []),
        colorize_fn=colorize_fn,
    )
    _print_command_list(
        "\n  Decision options:",
        detail.get("decision_options", []),
        colorize_fn=colorize_fn,
    )
    print(colorize_fn(f"\n  Action: {item.get('primary_command', '')}", "cyan"))


__all__ = ["render_workflow_action", "render_workflow_stage", "step_full", "step_text"]
