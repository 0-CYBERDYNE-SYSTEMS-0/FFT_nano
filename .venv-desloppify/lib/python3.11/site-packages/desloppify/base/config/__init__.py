"""Project-wide + language-specific config (.desloppify/config.json)."""

from __future__ import annotations

import copy
import json
import logging
import shutil
import sys
from pathlib import Path
from typing import Any

from .migration import (
    _migrate_from_state_files as _migrate_from_state_files_impl,
)
from .schema import (
    CONFIG_SCHEMA,
    DEFAULT_TARGET_STRICT_SCORE,
    MAX_TARGET_STRICT_SCORE,
    MIN_TARGET_STRICT_SCORE,
    _coerce_target_strict_score,
    coerce_target_score,
    default_config,
    target_strict_score_from_config,
)
from desloppify.base.discovery.file_paths import safe_write_text
from desloppify.base.discovery.paths import get_project_root
from desloppify.base.output.fallbacks import log_best_effort_failure


def _rename_key(d: dict, old: str, new: str) -> bool:
    if old not in d:
        return False
    d.setdefault(new, d.pop(old))
    return True


def _default_config_file() -> Path:
    """Resolve config path from the active runtime project root."""
    return get_project_root() / ".desloppify" / "config.json"


logger = logging.getLogger(__name__)


def _load_config_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("config file root must be a JSON object")
    return payload


def _load_config_payload(path: Path) -> dict[str, Any]:
    if path.exists():
        try:
            return _load_config_json(path)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError, ValueError) as ex:
            backup = path.with_suffix(".json.bak")
            if backup.exists():
                logger.warning(
                    "Primary config load failed for %s; attempting backup %s: %s",
                    path,
                    backup,
                    ex,
                )
                try:
                    backup_payload = _load_config_json(backup)
                    logger.warning(
                        "Recovered config from backup %s after primary load failure at %s",
                        backup,
                        path,
                    )
                    print(
                        f"  ⚠ Config file corrupted ({ex}), loaded from backup.",
                        file=sys.stderr,
                    )
                    return backup_payload
                except (
                    json.JSONDecodeError,
                    UnicodeDecodeError,
                    OSError,
                    ValueError,
                ) as backup_ex:
                    logger.warning(
                        "Backup config load failed from %s after corruption in %s: %s",
                        backup,
                        path,
                        backup_ex,
                    )
                    logger.debug(
                        "Backup config load failed from %s: %s",
                        backup,
                        backup_ex,
                    )
            logger.warning(
                "Config file load failed for %s and backup recovery was unavailable. "
                "Falling back to defaults: %s",
                path,
                ex,
            )
            print(f"  ⚠ Config file corrupted ({ex}). Using defaults.", file=sys.stderr)
            rename_failed = False
            try:
                path.rename(path.with_suffix(".json.corrupted"))
            except OSError as rename_ex:
                rename_failed = True
                logger.debug(
                    "Failed to rename corrupted config file %s: %s",
                    path,
                    rename_ex,
                )
            if rename_failed:
                logger.debug(
                    "Corrupted config file retained at original path: %s",
                    path,
                )
            return {}
    # First run — try migrating from state files
    return _migrate_from_state_files(path)


def _migrate_legacy_noise_keys(config: dict[str, Any]) -> bool:
    changed = False
    for old, new in (
        ("finding_noise_budget", "issue_noise_budget"),
        ("finding_noise_global_budget", "issue_noise_global_budget"),
    ):
        changed |= _rename_key(config, old, new)
    return changed


def _apply_schema_defaults_and_normalization(config: dict[str, Any]) -> bool:
    changed = False
    for key, schema in CONFIG_SCHEMA.items():
        if key not in config:
            config[key] = copy.deepcopy(schema.default)
            changed = True
            continue
        if key != "badge_path":
            continue
        try:
            normalized = _validate_badge_path(str(config[key]))
            if normalized != config[key]:
                config[key] = normalized
                changed = True
        except ValueError:
            config[key] = copy.deepcopy(schema.default)
            changed = True
    return changed


def load_config(path: Path | None = None) -> dict[str, Any]:
    """Load config from disk, auto-migrating from state files if needed.

    Fills missing keys with defaults. If no config.json exists, attempts
    migration from state-*.json files.
    """
    p = path or _default_config_file()
    config = _load_config_payload(p)
    changed = _migrate_legacy_noise_keys(config)
    changed |= _apply_schema_defaults_and_normalization(config)

    if changed and p.exists():
        try:
            save_config(config, p)
        except OSError as exc:
            log_best_effort_failure(logger, f"persist migrated config to {p}", exc)

    return config


def save_config(config: dict, path: Path | None = None) -> None:
    """Save config to disk atomically."""
    p = path or _default_config_file()
    if p.exists():
        backup = p.with_suffix(".json.bak")
        try:
            shutil.copy2(str(p), str(backup))
        except OSError as backup_ex:
            logger.debug(
                "Failed to create config backup %s: %s",
                backup,
                backup_ex,
            )
    safe_write_text(p, json.dumps(config, indent=2) + "\n")


def add_ignore_pattern(config: dict, pattern: str) -> None:
    """Append a pattern to the ignore list (deduplicates)."""
    ignores = config.setdefault("ignore", [])
    if pattern not in ignores:
        ignores.append(pattern)


def add_exclude_pattern(config: dict, pattern: str) -> None:
    """Append a pattern to the exclude list (deduplicates)."""
    excludes = config.setdefault("exclude", [])
    if pattern not in excludes:
        excludes.append(pattern)


def set_ignore_metadata(config: dict, pattern: str, *, note: str, added_at: str) -> None:
    """Record note + timestamp for an ignore pattern."""
    meta = config.setdefault("ignore_metadata", {})
    if not isinstance(meta, dict):
        meta = {}
        config["ignore_metadata"] = meta
    meta[pattern] = {"note": note, "added_at": added_at}


def _validate_badge_path(raw: str) -> str:
    """Require badge_path to point to a filename (root or nested path)."""
    value = raw.strip()
    path = Path(value)
    if (
        not value
        or value.endswith(("/", "\\"))
        or path.name in {"", ".", ".."}
    ):
        raise ValueError(
            "Expected file path for badge_path "
            f"(example: scorecard.png or assets/scorecard.png), got: {raw}"
        )
    return value


def _set_int_config_value(config: dict, key: str, raw: str) -> None:
    if raw.lower() == "never":
        config[key] = 0
    else:
        config[key] = int(raw)
    if key != "target_strict_score":
        return
    target_strict_score, target_valid = _coerce_target_strict_score(config[key])
    if not target_valid:
        raise ValueError(
            f"Expected integer {MIN_TARGET_STRICT_SCORE}-{MAX_TARGET_STRICT_SCORE} "
            f"for {key}, got: {raw}"
        )
    config[key] = target_strict_score


def _set_bool_config_value(config: dict, key: str, raw: str) -> None:
    normalized = raw.lower()
    if normalized in ("true", "1", "yes"):
        config[key] = True
        return
    if normalized in ("false", "0", "no"):
        config[key] = False
        return
    raise ValueError(f"Expected true/false for {key}, got: {raw}")


def _set_str_config_value(config: dict, key: str, raw: str) -> None:
    if key == "badge_path":
        config[key] = _validate_badge_path(raw)
        return
    config[key] = raw


def _set_list_config_value(config: dict, key: str, raw: str) -> None:
    config.setdefault(key, [])
    if raw not in config[key]:
        config[key].append(raw)


_SCHEMA_SETTERS = {
    int: _set_int_config_value,
    bool: _set_bool_config_value,
    str: _set_str_config_value,
    list: _set_list_config_value,
}


def set_config_value(config: dict, key: str, raw: str) -> None:
    """Parse and set a config value from a raw string.

    Handles special cases:
    - "never" → 0 for age keys
    - "true"/"false" for bools
    """
    if key not in CONFIG_SCHEMA:
        raise KeyError(f"Unknown config key: {key}")

    schema = CONFIG_SCHEMA[key]
    setter = _SCHEMA_SETTERS.get(schema.type)
    if setter is not None:
        setter(config, key, raw)
        return
    if schema.type is dict:
        raise ValueError(f"Cannot set dict key '{key}' via CLI — use subcommands")
    config[key] = raw


def unset_config_value(config: dict, key: str) -> None:
    """Reset a config key to its default value."""
    if key not in CONFIG_SCHEMA:
        raise KeyError(f"Unknown config key: {key}")
    config[key] = copy.deepcopy(CONFIG_SCHEMA[key].default)


def config_for_query(config: dict[str, Any]) -> dict[str, Any]:
    """Return a sanitized config dict suitable for query.json."""
    return {k: config.get(k, schema.default) for k, schema in CONFIG_SCHEMA.items()}


def _migrate_from_state_files(config_path: Path) -> dict:
    """Compatibility wrapper for state-file config migration."""
    return _migrate_from_state_files_impl(config_path, save_config_fn=save_config)


__all__ = [
    "CONFIG_SCHEMA",
    "DEFAULT_TARGET_STRICT_SCORE",
    "MAX_TARGET_STRICT_SCORE",
    "MIN_TARGET_STRICT_SCORE",
    "add_exclude_pattern",
    "add_ignore_pattern",
    "coerce_target_score",
    "config_for_query",
    "default_config",
    "load_config",
    "save_config",
    "set_config_value",
    "set_ignore_metadata",
    "target_strict_score_from_config",
    "unset_config_value",
]
