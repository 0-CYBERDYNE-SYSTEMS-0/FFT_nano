"""CLI rendering for TypeScript pattern census and anomalies."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from desloppify.base.output.terminal import colorize, print_table
from .analysis import (
    _build_census,
    detect_pattern_anomalies,
)
from .catalog import PATTERN_FAMILIES


def cmd_patterns(args: argparse.Namespace) -> None:
    """Show full pattern census matrix plus competing-pattern anomalies."""
    path = Path(args.path)
    census, _evidence = _build_census(path)
    result = detect_pattern_anomalies(path)
    anomalies = result.entries

    if args.json:
        serializable = {
            area: {family: sorted(patterns) for family, patterns in families.items()}
            for area, families in census.items()
        }
        print(
            json.dumps(
                {
                    "areas": len(census),
                    "anomalies": len(anomalies),
                    "families": {
                        name: {
                            "type": fam["type"],
                            "description": fam["description"],
                        }
                        for name, fam in PATTERN_FAMILIES.items()
                    },
                    "census": serializable,
                    "anomaly_details": anomalies,
                },
                indent=2,
            )
        )
        return

    family_names = sorted(PATTERN_FAMILIES.keys())
    if census:
        print(
            colorize(
                f"\nPattern Census ({len(census)} areas × {len(family_names)} families)\n",
                "bold",
            )
        )

        for name in family_names:
            fam = PATTERN_FAMILIES[name]
            marker = colorize("▶", "yellow") if fam["type"] == "competing" else colorize("·", "dim")
            print(f"  {marker} {name}: {fam['description']}")
        print()

        rows = []
        for area in sorted(census.keys()):
            cells = []
            for family in family_names:
                patterns = census[area].get(family, set())
                cells.append(", ".join(sorted(patterns)) if patterns else colorize("-", "dim"))
            rows.append([area, *cells])

        headers = ["Area", *family_names]
        widths = [40] + [max(15, len(f) + 2) for f in family_names]
        print_table(headers, rows, widths)
    else:
        print(colorize("No pattern usage found.", "dim"))

    print()
    if anomalies:
        print(colorize(f"Competing-pattern anomalies: {len(anomalies)}\n", "bold"))
        for anomaly in anomalies[: args.top]:
            patterns_str = ", ".join(anomaly["patterns_used"])
            conf_badge = colorize(
                f"[{anomaly['confidence']}]",
                "yellow" if anomaly["confidence"] == "medium" else "dim",
            )
            print(f"  {colorize(anomaly['area'], 'cyan')} :: {anomaly['family']} {conf_badge}")
            print(f"    Patterns: {patterns_str}")
            for pname, matches in (anomaly.get("pattern_evidence") or {}).items():
                files = [m.get("file", "") for m in matches[:3]]
                if files:
                    print(f"    Evidence {pname}: {', '.join(files)}")
            print(colorize(f"    {anomaly['review']}", "yellow"))
            print()
    else:
        print(colorize("No competing-pattern anomalies detected.", "green"))
    print()


__all__ = ["cmd_patterns"]
