"""Project policy — persistent project-specific rules for triage and review."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from desloppify.base.discovery.file_paths import safe_write_text
from desloppify.base.discovery.paths import get_project_root
from desloppify.engine._state.schema import utc_now


def _default_policy_path() -> Path:
    return get_project_root() / ".desloppify" / "project_policy.json"


@dataclass(frozen=True)
class PolicyLoadResult:
    ok: bool
    policy: dict[str, Any]
    message: str = ""
    error_kind: str | None = None


def load_policy_result(path: Path | None = None) -> PolicyLoadResult:
    p = path or _default_policy_path()
    if not p.exists():
        return PolicyLoadResult(ok=True, policy={"rules": []})
    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        return PolicyLoadResult(
            ok=False,
            policy={"rules": []},
            message=str(exc),
            error_kind="policy_parse_error",
        )
    except OSError as exc:
        return PolicyLoadResult(
            ok=False,
            policy={"rules": []},
            message=str(exc),
            error_kind="policy_read_error",
        )
    if not isinstance(data, dict):
        return PolicyLoadResult(
            ok=False,
            policy={"rules": []},
            message="project policy is not a JSON object",
            error_kind="policy_invalid_shape",
        )
    data.setdefault("rules", [])
    if not isinstance(data.get("rules"), list):
        return PolicyLoadResult(
            ok=False,
            policy={"rules": []},
            message="project policy 'rules' must be a list",
            error_kind="policy_invalid_rules",
        )
    return PolicyLoadResult(ok=True, policy=data)


def load_policy(path: Path | None = None) -> dict[str, Any]:
    return load_policy_result(path).policy


def save_policy(policy: dict[str, Any], path: Path | None = None) -> None:
    p = path or _default_policy_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    safe_write_text(p, json.dumps(policy, indent=2) + "\n")


def add_rule(policy: dict[str, Any], text: str) -> int:
    """Add a rule, return its 1-based index."""
    rules = policy.setdefault("rules", [])
    rules.append({"text": text, "created_at": utc_now()})
    return len(rules)


def remove_rule(policy: dict[str, Any], index: int) -> str | None:
    """Remove a rule by 1-based index, return its text or None."""
    rules = policy.get("rules", [])
    if 1 <= index <= len(rules):
        return rules.pop(index - 1)["text"]
    return None


def render_policy_block(policy: dict[str, Any]) -> str:
    """Render rules as a prompt section. Returns empty string if no rules."""
    rules = policy.get("rules", [])
    if not rules:
        return ""
    lines = [
        "## Project Policy\n",
        "The following project-specific rules MUST be respected.",
        "Do NOT suggest or implement changes that violate these rules.",
        "Flag any action step or suggestion that would violate them.\n",
    ]
    for i, rule in enumerate(rules, 1):
        lines.append(f"{i}. {rule['text']}")
    return "\n".join(lines) + "\n"


__all__ = [
    "add_rule",
    "load_policy",
    "load_policy_result",
    "PolicyLoadResult",
    "remove_rule",
    "render_policy_block",
    "save_policy",
]
