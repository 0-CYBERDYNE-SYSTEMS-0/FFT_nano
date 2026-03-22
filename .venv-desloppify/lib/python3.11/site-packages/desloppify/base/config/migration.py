"""State-file to config.json migration helpers."""

from __future__ import annotations

import copy
import json
import logging
from pathlib import Path

from .schema import CONFIG_SCHEMA
from desloppify.base.discovery.file_paths import safe_write_text
from desloppify.base.output.fallbacks import log_best_effort_failure

logger = logging.getLogger(__name__)


def _merge_config_value(config: dict, key: str, value: object) -> None:
    """Merge a config value into the target dict."""
    if key not in config:
        config[key] = copy.deepcopy(value)
        return
    if isinstance(value, list) and isinstance(config[key], list):
        for item in value:
            if item not in config[key]:
                config[key].append(item)
        return
    if isinstance(value, dict) and isinstance(config[key], dict):
        for dk, dv in value.items():
            if dk not in config[key]:
                config[key][dk] = copy.deepcopy(dv)
        return


def _load_state_file_payload(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text())
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        logger.debug("Skipping unreadable state file %s: %s", path, exc)
        return None
    if isinstance(payload, dict):
        return payload
    return None


def _merge_legacy_state_config(config: dict, old_config: dict) -> None:
    for key, value in old_config.items():
        if key not in CONFIG_SCHEMA:
            continue
        _merge_config_value(config, key, value)


def _strip_config_from_state_file(path: Path, state_data: dict) -> None:
    if "config" not in state_data:
        return
    del state_data["config"]
    try:
        safe_write_text(path, json.dumps(state_data, indent=2) + "\n")
    except OSError as exc:
        log_best_effort_failure(
            logger,
            f"rewrite state file {path} after config migration",
            exc,
        )


def _migrate_single_state_file(config: dict, path: Path) -> bool:
    state_data = _load_state_file_payload(path)
    if state_data is None:
        return False
    old_config = state_data.get("config")
    if not isinstance(old_config, dict) or not old_config:
        return False

    _merge_legacy_state_config(config, old_config)
    return True


def _migrate_from_state_files(config_path: Path, *, save_config_fn=None) -> dict:
    """Migrate config keys from state-*.json files into config.json.

    Reads state["config"] from all state files, merges them (union for
    lists, merge for dicts), writes config.json, and strips "config" from
    the state files.  Stripping is deferred until after a successful save
    so that a save failure leaves the source state files intact.
    """
    config: dict = {}
    state_dir = config_path.parent
    if not state_dir.exists():
        return config

    state_files = sorted(state_dir.glob("state-*.json"), key=lambda p: p.name) + sorted(
        state_dir.glob("state.json"), key=lambda p: p.name
    )
    migrated_any = False
    migrated_files: list[Path] = []
    for sf in state_files:
        if _migrate_single_state_file(config, sf):
            migrated_any = True
            migrated_files.append(sf)

    if migrated_any and config and save_config_fn is not None:
        try:
            save_config_fn(config, config_path)
        except OSError as exc:
            log_best_effort_failure(
                logger, f"save migrated config to {config_path}", exc
            )
        else:
            for sf in migrated_files:
                state_data = _load_state_file_payload(sf)
                if state_data is None:
                    continue
                _strip_config_from_state_file(sf, state_data)

    return config


__all__ = ["_migrate_from_state_files"]
