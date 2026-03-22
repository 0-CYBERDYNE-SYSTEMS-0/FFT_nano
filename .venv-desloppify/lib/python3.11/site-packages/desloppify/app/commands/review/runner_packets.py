"""Packet sanitization, hashing, and artifact layout helpers for review batches."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from desloppify.base.exception_sets import PacketValidationError

_BLIND_PACKET_DROP_KEYS = {
    "narrative",
    "next_command",
    "score_snapshot",
    "strict_target",
    "strict_target_progress",
    "subjective_at_target",
}

_BLIND_CONFIG_SCORE_HINT_KEYS = {
    "target_strict_score",
    "strict_target_score",
    "target_score",
    "strict_score",
    "objective_score",
    "overall_score",
    "verified_strict_score",
}


def write_packet_snapshot(
    packet: dict[str, Any],
    *,
    stamp: str,
    review_packet_dir: Path,
    blind_path: Path,
    safe_write_text_fn,
) -> tuple[Path, Path]:
    """Persist immutable and blind packet snapshots for runner workflows."""
    review_packet_dir.mkdir(parents=True, exist_ok=True)
    packet_path = review_packet_dir / f"holistic_packet_{stamp}.json"
    safe_write_text_fn(packet_path, json.dumps(packet, indent=2) + "\n")
    blind_packet = _build_blind_packet(packet)
    safe_write_text_fn(blind_path, json.dumps(blind_packet, indent=2) + "\n")
    return packet_path, blind_path


def _build_blind_packet(packet: dict[str, Any]) -> dict[str, Any]:
    """Return a blind-review packet with score anchoring metadata removed."""
    blind = deepcopy(packet)
    for key in _BLIND_PACKET_DROP_KEYS:
        blind.pop(key, None)

    config = blind.get("config")
    if isinstance(config, dict):
        sanitized = _sanitize_blind_config(config)
        if sanitized:
            blind["config"] = sanitized
        else:
            blind.pop("config", None)
    return blind


def build_blind_packet(packet: dict[str, Any]) -> dict[str, Any]:
    """Public wrapper for blind packet sanitization."""
    return _build_blind_packet(packet)


def run_stamp() -> str:
    """Stable UTC run stamp for artifact paths."""
    return datetime.now(UTC).strftime("%Y%m%d_%H%M%S")


def _sanitize_blind_config(config: dict[str, Any]) -> dict[str, Any]:
    """Drop score/target hints from config while preserving unrelated options."""
    sanitized: dict[str, Any] = {}
    for key, value in config.items():
        lowered = key.strip().lower()
        if not lowered:
            continue
        if lowered in _BLIND_CONFIG_SCORE_HINT_KEYS:
            continue
        if "target" in lowered:
            continue
        if lowered.endswith("_score"):
            continue
        sanitized[key] = value
    return sanitized


def sha256_file(path: Path) -> str | None:
    """Compute sha256 hex digest for path contents (or None on read failure)."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return sha256(data).hexdigest()


def build_batch_import_provenance(
    *,
    runner: str,
    blind_packet_path: Path,
    run_stamp: str,
    batch_indexes: list[int],
) -> dict[str, Any]:
    """Build provenance payload used to trust assessment-bearing imports."""
    packet_hash = sha256_file(blind_packet_path)
    batch_indexes_1 = sorted({int(index) + 1 for index in batch_indexes})
    return {
        "kind": "blind_review_batch_import",
        "blind": True,
        "runner": runner,
        "run_stamp": run_stamp,
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "batch_count": len(batch_indexes_1),
        "batch_indexes": batch_indexes_1,
        "packet_path": str(blind_packet_path),
        "packet_sha256": packet_hash,
    }


def selected_batch_indexes(
    *,
    raw_selection: str | None,
    batch_count: int,
    parse_fn,
    colorize_fn,
) -> list[int]:
    """Validate selected batch indexes or raise CommandError."""
    try:
        selected = parse_fn(raw_selection, batch_count)
    except ValueError as exc:
        raise PacketValidationError(str(exc), exit_code=2) from exc
    if selected:
        return selected
    raise PacketValidationError("no batches selected", exit_code=2)


def prepare_run_artifacts(
    *,
    stamp: str,
    selected_indexes: list[int],
    batches: list[dict[str, Any]],
    packet_path: Path,
    run_root: Path,
    repo_root: Path,
    build_prompt_fn,
    safe_write_text_fn,
    colorize_fn,
) -> tuple[Path, Path, dict[int, Path], dict[int, Path], dict[int, Path]]:
    """Build prompt/output/log paths and persist prompts for selected batches."""
    run_dir = run_root / stamp
    prompts_dir = run_dir / "prompts"
    results_dir = run_dir / "results"
    logs_dir = run_dir / "logs"
    prompts_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    selected_1_based = [idx + 1 for idx in selected_indexes]
    print(colorize_fn(f"\n  Running holistic batches: {selected_1_based}", "bold"))
    print(colorize_fn(f"  Run artifacts: {run_dir}", "dim"))

    prompt_files: dict[int, Path] = {}
    output_files: dict[int, Path] = {}
    log_files: dict[int, Path] = {}
    for idx in selected_indexes:
        batch = batches[idx] if isinstance(batches[idx], dict) else {}
        prompt_text = build_prompt_fn(
            repo_root=repo_root,
            packet_path=packet_path,
            batch_index=idx,
            batch=batch,
        )
        prompt_file = prompts_dir / f"batch-{idx + 1}.md"
        output_file = results_dir / f"batch-{idx + 1}.raw.txt"
        log_file = logs_dir / f"batch-{idx + 1}.log"
        safe_write_text_fn(prompt_file, prompt_text)
        prompt_files[idx] = prompt_file
        output_files[idx] = output_file
        log_files[idx] = log_file
    return run_dir, logs_dir, prompt_files, output_files, log_files


__all__ = [
    "build_batch_import_provenance",
    "build_blind_packet",
    "prepare_run_artifacts",
    "run_stamp",
    "selected_batch_indexes",
    "sha256_file",
    "write_packet_snapshot",
]
