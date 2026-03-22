"""Centralized score update display for all state-changing commands."""

from __future__ import annotations

from desloppify.base.config import target_strict_score_from_config
from desloppify.base import config as config_mod
from desloppify.base.output.terminal import colorize
from desloppify.state_scoring import ScoreSnapshot, score_snapshot


def _format_delta(value: float, prev: float | None) -> tuple[str, str]:
    """Return (delta_str, color) for a score change."""
    delta = value - prev if prev is not None else 0
    delta_str = f" ({'+' if delta > 0 else ''}{delta:.1f})" if delta != 0 else ""
    color = "green" if delta > 0 else ("red" if delta < 0 else "dim")
    return delta_str, color


def print_score_update(
    state: dict,
    prev: ScoreSnapshot,
    *,
    config: dict | None = None,
    label: str = "Scores",
) -> None:
    """Print score quartet with deltas and strict target progress."""
    new = score_snapshot(state)
    if (
        new.overall is None
        or new.objective is None
        or new.strict is None
        or new.verified is None
    ):
        print(colorize(f"\n  {label} unavailable — run `desloppify scan`.", "yellow"))
        return

    overall_s, overall_c = _format_delta(new.overall, prev.overall)
    objective_s, objective_c = _format_delta(new.objective, prev.objective)
    strict_s, strict_c = _format_delta(new.strict, prev.strict)
    verified_s, verified_c = _format_delta(new.verified, prev.verified)

    print(
        f"\n  {label}: "
        + colorize(f"overall {new.overall:.1f}/100{overall_s}", overall_c)
        + colorize(f"  objective {new.objective:.1f}/100{objective_s}", objective_c)
        + colorize(f"  strict {new.strict:.1f}/100{strict_s}", strict_c)
        + colorize(f"  verified {new.verified:.1f}/100{verified_s}", verified_c)
    )

    # Score-drop reassurance after structural fixes
    if new.strict is not None and prev.strict is not None and new.strict < prev.strict:
        print(colorize(
            "  Score dropped — this is normal after structural fixes. "
            "New issues may surface; keep working the queue.",
            "yellow",
        ))

    # Always show strict target + next-command nudge
    if config is None:
        config = config_mod.load_config()

    target = target_strict_score_from_config(config)
    print_strict_target_nudge(new.strict, target)


def print_strict_target_nudge(
    strict: float, target: float, *, show_next: bool = True,
) -> None:
    """Print a one-liner with strict→target and optional next-command nudge."""
    gap = round(target - strict, 1)
    if gap > 0:
        suffix = " — run `desloppify next` to find the next improvement" if show_next else ""
        print(colorize(f"  Strict {strict:.1f} (target: {target:.1f}){suffix}", "dim"))
    else:
        print(colorize(f"  Strict {strict:.1f} — target {target:.1f} reached!", "green"))


__all__ = ["print_score_update", "print_strict_target_nudge"]
