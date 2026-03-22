"""Shared narrative signal computation helpers."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.config import (
    DEFAULT_TARGET_STRICT_SCORE,
    MAX_TARGET_STRICT_SCORE,
    MIN_TARGET_STRICT_SCORE,
)
from desloppify.base.config import (
    load_config as _load_config,
)
from desloppify.base.discovery.paths import get_project_root
from desloppify.engine._state.issue_semantics import (
    is_review_finding,
    is_assessment_request,
)
from desloppify.intelligence.narrative._constants import STRUCTURAL_MERGE
from desloppify.intelligence.narrative.types import (
    BadgeStatus,
    PrimaryAction,
    RiskFlag,
    StrictTarget,
    VerificationStep,
)
from desloppify.engine._state.filtering import path_scoped_issues
from desloppify.state_io import Issue, StateModel
from desloppify.state_scoring import score_snapshot as state_score_snapshot

_RISK_SEVERITY_ORDER = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 4,
}

_HIGH_IGNORE_SUPPRESSION_THRESHOLD = 30.0
_WONTFIX_GAP_THRESHOLD = 1.0


def resolve_target_strict_score(config: dict | None) -> tuple[int, str | None]:
    """Resolve strict-score target from config with bounded fallback."""
    raw_target = DEFAULT_TARGET_STRICT_SCORE
    if isinstance(config, dict):
        raw_target = config.get("target_strict_score", DEFAULT_TARGET_STRICT_SCORE)
    try:
        target = int(raw_target)
    except (TypeError, ValueError):
        return (
            DEFAULT_TARGET_STRICT_SCORE,
            (
                f"Invalid config `target_strict_score={raw_target!r}`; using "
                f"{DEFAULT_TARGET_STRICT_SCORE}"
            ),
        )
    if target < MIN_TARGET_STRICT_SCORE or target > MAX_TARGET_STRICT_SCORE:
        return (
            DEFAULT_TARGET_STRICT_SCORE,
            (
                f"Invalid config `target_strict_score={raw_target!r}`; using "
                f"{DEFAULT_TARGET_STRICT_SCORE}"
            ),
        )
    return target, None


def compute_strict_target(strict_score: float | None, config: dict | None) -> StrictTarget:
    """Build strict-target context for command rendering and agents."""
    target, warning = resolve_target_strict_score(config)
    if not isinstance(strict_score, int | float):
        return {
            "target": float(target),
            "current": None,
            "gap": None,
            "state": "unavailable",
            "warning": warning,
        }

    current = round(float(strict_score), 1)
    gap = round(float(target) - current, 1)
    if gap > 0:
        state = "below"
    elif gap < 0:
        state = "above"
    else:
        state = "at"
    return {
        "target": float(target),
        "current": current,
        "gap": gap,
        "state": state,
        "warning": warning,
    }


def count_open_by_detector(issues: dict) -> dict[str, int]:
    """Count open issues by detector, merging structural sub-detectors."""
    by_detector: dict[str, int] = {}
    for issue in issues.values():
        if issue["status"] != "open" or issue.get("suppressed"):
            continue
        detector = issue.get("detector", "unknown")
        if detector in STRUCTURAL_MERGE:
            detector = "structural"
        by_detector[detector] = by_detector.get(detector, 0) + 1
        if is_review_finding(issue) and issue.get("detail", {}).get("holistic"):
            by_detector["review_holistic"] = by_detector.get("review_holistic", 0) + 1
        if is_assessment_request(issue):
            by_detector["assessment_request"] = by_detector.get("assessment_request", 0) + 1
    if by_detector.get("review", 0) > 0:
        by_detector["review_uninvestigated"] = sum(
            1
            for issue in issues.values()
            if issue.get("status") == "open"
            and not issue.get("suppressed")
            and is_review_finding(issue)
            and not issue.get("detail", {}).get("investigation")
        )
    return by_detector


def resolve_badge_path(project_root: Path) -> tuple[str, Path]:
    """Resolve badge path from config, defaulting to root-level scorecard.png."""
    default_rel = "scorecard.png"
    config = {}
    try:
        config = _load_config()
    except (AttributeError, OSError):
        config = {}

    raw_path = default_rel
    if isinstance(config, dict):
        config.setdefault("badge_path", default_rel)
        configured = config.get("badge_path")
        if isinstance(configured, str) and configured.strip():
            raw_path = configured.strip()

    path = Path(raw_path)
    is_root_anchored = bool(path.root)
    if not path.is_absolute() and not is_root_anchored:
        return raw_path, project_root / path

    try:
        rel_path = str(path.relative_to(project_root))
    except ValueError:
        rel_path = str(path)
    return rel_path, path


def compute_badge_status() -> BadgeStatus:
    """Check configured scorecard path and whether README references it."""
    project_root = get_project_root()
    scorecard_rel, scorecard_path = resolve_badge_path(project_root)
    generated = scorecard_path.exists()

    in_readme = False
    if generated:
        for readme_name in ("README.md", "readme.md", "README.MD"):
            readme_path = project_root / readme_name
            if readme_path.exists():
                try:
                    in_readme = scorecard_rel in readme_path.read_text(
                        encoding="utf-8", errors="replace"
                    )
                except OSError:
                    in_readme = False
                break

    recommendation = None
    if generated and not in_readme:
        recommendation = f'Add to README: <img src="{scorecard_rel}" width="100%">'

    return {
        "generated": generated,
        "in_readme": in_readme,
        "path": scorecard_rel,
        "recommendation": recommendation,
    }


def compute_primary_action(actions: list[dict]) -> PrimaryAction | None:
    """Pick the highest-priority action for user-facing guidance."""
    if not actions:
        return None
    top = actions[0]
    command = str(top.get("command", "")).strip()
    if not command:
        return None
    description = str(top.get("description", "")).strip() or "run highest-impact action"
    return {
        "command": command,
        "description": description,
    }


def compute_why_now(
    phase: str,
    strategy: dict[str, object],
    primary_action: dict | None,
) -> str:
    """Explain why the recommended action should happen now."""
    hint = str(strategy.get("hint", "")).strip() if isinstance(strategy, dict) else ""
    if hint:
        return hint
    if primary_action and primary_action.get("description"):
        return str(primary_action["description"])
    phase_default = {
        "first_scan": "Start with highest-impact issues to establish a clean baseline.",
        "regression": "Recent regressions should be contained before new work.",
        "stagnation": "Current approach is stalling; tackle a different high-impact lane.",
        "maintenance": "Keep the codebase stable by resolving new risk quickly.",
    }
    return phase_default.get(phase, "Address the highest-impact open issues first.")


def compute_verification_step(_command: str | None) -> VerificationStep:
    """Verification step returned with every narrative plan."""
    return {
        "command": "desloppify scan",
        "reason": "revalidate after changes",
    }


def compute_risk_flags(state: StateModel, debt: dict) -> list[RiskFlag]:
    """Build ordered risk flags from suppression and wontfix debt signals."""
    flags: list[RiskFlag] = []

    ignore_integrity = state.get("ignore_integrity", {})
    suppressed_pct = float(ignore_integrity.get("suppressed_pct", 0.0) or 0.0)
    ignored_count = int(ignore_integrity.get("ignored", 0) or 0)
    if suppressed_pct >= _HIGH_IGNORE_SUPPRESSION_THRESHOLD or ignored_count >= 100:
        severity = "high" if suppressed_pct >= 40.0 or ignored_count >= 200 else "medium"
        message = (
            f"{suppressed_pct:.1f}% issues hidden by ignore patterns"
            if suppressed_pct > 0
            else f"{ignored_count} issues hidden by ignore patterns"
        )
        flags.append(
            {
                "type": "high_ignore_suppression",
                "severity": severity,
                "message": message,
            }
        )

    wontfix_count = int(debt.get("wontfix_count", 0) or 0)
    overall_gap = float(debt.get("overall_gap", 0.0) or 0.0)
    if overall_gap >= _WONTFIX_GAP_THRESHOLD or wontfix_count > 0:
        severity = "high" if overall_gap >= 5.0 or wontfix_count >= 50 else "medium"
        flags.append(
            {
                "type": "wontfix_gap",
                "severity": severity,
                "message": (
                    f"Strict/lenient gap is {overall_gap:.1f} pts with "
                    f"{wontfix_count} wontfix issues"
                ),
            }
        )

    flags.sort(key=lambda flag: _RISK_SEVERITY_ORDER.get(flag.get("severity"), 99))
    return flags


def history_for_lang(raw_history: list[dict], lang: str | None) -> list[dict]:
    if not lang:
        return raw_history
    return [entry for entry in raw_history if entry.get("lang") in (lang, None)]


def scoped_issues(state: StateModel) -> dict[str, Issue]:
    return path_scoped_issues(
        (state.get("work_items") or state.get("issues", {})), state.get("scan_path")
    )


def score_snapshot(state: StateModel) -> tuple[float | None, float | None]:
    scores = state_score_snapshot(state)
    return scores.strict, scores.overall


__all__ = [
    "compute_badge_status",
    "compute_primary_action",
    "compute_risk_flags",
    "compute_strict_target",
    "compute_verification_step",
    "compute_why_now",
    "count_open_by_detector",
    "history_for_lang",
    "resolve_target_strict_score",
    "score_snapshot",
    "scoped_issues",
]
