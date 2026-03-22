"""zone command: show/set/clear zone classifications."""

from __future__ import annotations

import argparse
from pathlib import Path

from desloppify.app.commands.helpers.lang import resolve_lang
from desloppify.app.commands.helpers.rendering import print_agent_plan
from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.helpers.state import state_path
from desloppify.base import config as config_mod
from desloppify.base.discovery.file_paths import rel
from desloppify.base.exception_sets import CommandError
from desloppify.base.output.terminal import colorize
from desloppify.engine.policy.zones import FileZoneMap, Zone
from desloppify.state_io import load_state, save_state


def cmd_zone(args: argparse.Namespace) -> None:
    """Handle zone subcommands: show, set, clear."""
    action = getattr(args, "zone_action", None)
    if action in (None, "show"):
        _zone_show(args)
    elif action == "set":
        _zone_set(args)
    elif action == "clear":
        _zone_clear(args)
    else:
        raise CommandError("Usage: desloppify zone {show|set|clear}")


def _zone_show(args: argparse.Namespace):
    """Show zone classifications for all scanned files."""
    state_file = state_path(args)
    if not state_file.exists():
        raise CommandError("No state file found — run a scan first.")
    lang = resolve_lang(args)
    if not lang or not lang.file_finder:
        raise CommandError("No language detected — run a scan first.")

    path = Path(args.path)
    overrides = command_runtime(args).config.get("zone_overrides", {})

    files = lang.file_finder(path)
    zone_map = FileZoneMap(
        files, lang.zone_rules, rel_fn=rel, overrides=overrides or None
    )

    # Group files by zone
    by_zone: dict[str, list[str]] = {}
    for f in sorted(files, key=lambda f: rel(f)):
        zone = zone_map.get(f)
        by_zone.setdefault(zone.value, []).append(f)

    total = len(files)
    print(colorize(f"\nZone classifications ({total} files)\n", "bold"))

    for zone_val in ["production", "test", "config", "generated", "script", "vendor"]:
        zone_files = by_zone.get(zone_val, [])
        if not zone_files:
            continue
        print(colorize(f"  {zone_val} ({len(zone_files)} files)", "bold"))
        for f in zone_files:
            rp = rel(f)
            is_override = rp in overrides
            suffix = colorize(" (override)", "cyan") if is_override else ""
            print(f"    {rp}{suffix}")
        print()

    if overrides:
        print(colorize(f"  {len(overrides)} override(s) active", "dim"))
    print(colorize("  Override: desloppify zone set <file> <zone>", "dim"))
    print(colorize("  Clear:    desloppify zone clear <file>", "dim"))
    print_agent_plan(
        ["Fix misclassified files, then re-scan."],
        next_command="desloppify scan",
    )


def _zone_set(args: argparse.Namespace):
    """Set a zone override for a file."""
    filepath = args.zone_path
    zone_value = args.zone_value

    # Validate zone value
    valid_zones = {z.value for z in Zone}
    if zone_value not in valid_zones:
        raise CommandError(
            f"Invalid zone: {zone_value}. Valid: {', '.join(sorted(valid_zones))}"
        )

    normalized = rel(filepath)
    config = command_runtime(args).config
    config.setdefault("zone_overrides", {})[normalized] = zone_value
    try:
        config_mod.save_config(config)
    except OSError as e:
        raise CommandError(f"could not save config: {e}") from e
    print(f"  Set {normalized} → {zone_value}")

    # Apply immediately to state
    try:
        sp = state_path(args)
        if sp.exists():
            state = load_state(sp)
            issues = (state.get("work_items") or state.get("issues", {}))
            updated = 0
            for issue in issues.values():
                if issue.get("file") == normalized:
                    issue["zone"] = zone_value
                    updated += 1
            if updated:
                save_state(state, sp)
            print(f"  Applied to {updated} issue(s).")
    except (ImportError, OSError, TypeError, ValueError):
        print(colorize("  (Will apply on next scan.)", "dim"))
        return


def _zone_clear(args: argparse.Namespace):
    """Clear a zone override for a file."""
    filepath = args.zone_path

    normalized = rel(filepath)
    config = command_runtime(args).config
    overrides = config.get("zone_overrides", {})
    if normalized in overrides:
        del overrides[normalized]
        try:
            config_mod.save_config(config)
        except OSError as e:
            raise CommandError(f"could not save config: {e}") from e
        print(f"  Cleared override for {normalized}")

        # Re-stamp matching issues to default zone; next scan will reclassify.
        try:
            sp = state_path(args)
            if sp.exists():
                state = load_state(sp)
                issues = (state.get("work_items") or state.get("issues", {}))
                updated = 0
                for issue in issues.values():
                    if issue.get("file") == normalized:
                        issue["zone"] = "production"
                        updated += 1
                if updated:
                    save_state(state, sp)
                print(f"  Re-stamped {updated} issue(s) to 'production' (will reclassify on next scan).")
        except (ImportError, OSError, TypeError, ValueError):
            print(colorize("  (Will apply on next scan.)", "dim"))
            return
    else:
        print(colorize(f"  No override found for {normalized}", "yellow"))
