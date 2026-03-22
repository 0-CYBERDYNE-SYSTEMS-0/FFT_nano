"""Policy subcommand handlers for plan command."""

from __future__ import annotations

import argparse

from desloppify.base.output.terminal import colorize
from desloppify.engine.plan_state import (
    add_rule,
    load_policy_result,
    remove_rule,
    save_policy,
)


def cmd_policy_dispatch(args: argparse.Namespace) -> None:
    """Dispatch policy subcommand."""
    action = getattr(args, "policy_action", None)
    if action == "add":
        _cmd_policy_add(args)
    elif action == "remove":
        _cmd_policy_remove(args)
    else:
        _cmd_policy_list(args)


def _cmd_policy_add(args: argparse.Namespace) -> None:
    text = getattr(args, "rule_text", "")
    if not text or not text.strip():
        print(colorize("  Rule text is required.", "red"))
        return
    result = load_policy_result()
    _print_policy_load_warning(result)
    policy = result.policy
    idx = add_rule(policy, text.strip())
    save_policy(policy)
    print(colorize(f"  Added rule #{idx}: {text.strip()}", "green"))


def _cmd_policy_list(_args: argparse.Namespace) -> None:
    result = load_policy_result()
    _print_policy_load_warning(result)
    policy = result.policy
    rules = policy.get("rules", [])
    if not rules:
        print(colorize("  No project policy rules defined.", "dim"))
        print(colorize('  Add one: desloppify plan policy add "rule text"', "dim"))
        return
    print(colorize("  Project Policy Rules", "bold"))
    print()
    for i, rule in enumerate(rules, 1):
        print(f"  {i}. {rule['text']}")
    print()
    print(colorize(
        f"  {len(rules)} rule(s). These are enforced during triage sense-check and review.",
        "dim",
    ))


def _cmd_policy_remove(args: argparse.Namespace) -> None:
    index = getattr(args, "rule_index", None)
    if index is None:
        print(colorize("  --index is required for remove.", "red"))
        return
    result = load_policy_result()
    _print_policy_load_warning(result)
    policy = result.policy
    removed = remove_rule(policy, index)
    if removed is None:
        print(colorize(f"  No rule at index {index}.", "red"))
        return
    save_policy(policy)
    print(colorize(f"  Removed rule #{index}: {removed}", "green"))


def _print_policy_load_warning(result) -> None:
    if getattr(result, "ok", True):
        return
    detail = getattr(result, "message", "") or "unknown error"
    print(
        colorize(
            f"  Warning: ignoring malformed project policy ({detail}).",
            "yellow",
        )
    )


__all__ = ["cmd_policy_dispatch"]
