"""Dry-run output writer for batch execution."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


def maybe_handle_dry_run(
    *,
    args,
    stamp: str,
    selected_indexes: list[int],
    run_dir: Path,
    logs_dir: Path,
    immutable_packet_path: Path,
    prompt_packet_path: Path,
    prompt_files: dict,
    output_files: dict,
    safe_write_text_fn,
    colorize_fn,
    append_run_log,
) -> bool:
    """Write dry-run artifacts and guidance. Returns True when handled."""
    if not getattr(args, "dry_run", False):
        return False

    dry_summary: dict[str, object] = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "run_stamp": stamp,
        "runner": "dry-run",
        "parallel": False,
        "selected_batches": [idx + 1 for idx in selected_indexes],
        "successful_batches": [idx + 1 for idx in selected_indexes],
        "failed_batches": [],
        "immutable_packet": str(immutable_packet_path),
        "blind_packet": str(prompt_packet_path),
        "run_dir": str(run_dir),
        "logs_dir": str(logs_dir),
        "batches": {
            str(idx + 1): {
                "status": "pending",
                "prompt_path": str(prompt_files[idx]),
                "result_path": str(output_files[idx]),
            }
            for idx in selected_indexes
        },
    }
    dry_summary_path = run_dir / "run_summary.json"
    safe_write_text_fn(dry_summary_path, json.dumps(dry_summary, indent=2) + "\n")

    n = len(selected_indexes)
    print(
        colorize_fn(
            f"  Dry run: {n} prompt(s) generated, runner execution skipped.", "yellow"
        )
    )
    print(colorize_fn(f"  Run directory: {run_dir}", "dim"))
    print(colorize_fn(f"  Immutable packet: {immutable_packet_path}", "dim"))
    print(colorize_fn(f"  Blind packet: {prompt_packet_path}", "dim"))
    print(colorize_fn(f"  Prompts: {run_dir / 'prompts'}", "dim"))
    print(colorize_fn(f"  Results: {run_dir / 'results'}  (write subagent output here)", "dim"))
    print()
    print(
        colorize_fn(
            f"  Next: launch {n} subagent(s), one per prompt file. "
            "Each writes JSON output to the matching results/ file.",
            "bold",
        )
    )
    print(
        colorize_fn(
            f"  Then: desloppify review --import-run {run_dir} --scan-after-import",
            "bold",
        )
    )
    append_run_log("run-finished dry-run")
    return True


__all__ = ["maybe_handle_dry_run"]
