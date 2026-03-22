"""I/O and transactional persistence helpers for plan override commands."""

from __future__ import annotations

from pathlib import Path

from desloppify.base.discovery.file_paths import safe_write_text
from desloppify.base.exception_sets import CommandError
from desloppify.engine.plan_state import (
    PlanModel,
    get_plan_file,
    plan_path_for_state,
    save_plan,
)
from desloppify.state_io import StateModel, get_state_file, save_state


def _resolve_state_file(path: Path | None) -> Path:
    return path if path is not None else get_state_file()


def _resolve_plan_file(path: Path | None) -> Path:
    return path if path is not None else get_plan_file()


def _plan_file_for_state(state_file: Path | None) -> Path | None:
    if state_file is None:
        return None
    return plan_path_for_state(state_file)


def _snapshot_file(path: Path) -> str | None:
    if not path.exists():
        return None
    return path.read_text()


def _restore_file_snapshot(path: Path, snapshot: str | None) -> None:
    if snapshot is None:
        try:
            path.unlink()
        except FileNotFoundError:
            return
        return
    safe_write_text(path, snapshot)


def _rollback_snapshots(
    *,
    state_path: Path,
    state_snapshot: str | None,
    plan_path: Path,
    plan_snapshot: str | None,
) -> list[str]:
    failed_paths: list[str] = []
    for path, snapshot in (
        (state_path, state_snapshot),
        (plan_path, plan_snapshot),
    ):
        try:
            _restore_file_snapshot(path, snapshot)
        except OSError:
            failed_paths.append(str(path))
    return failed_paths


def save_plan_state_transactional(
    *,
    plan: PlanModel,
    plan_path: Path | None,
    state_data: StateModel,
    state_path_value: Path | None,
) -> None:
    """Persist plan+state together; rollback both files on partial write failure."""
    effective_plan_path = _resolve_plan_file(plan_path)
    effective_state_path = _resolve_state_file(state_path_value)
    try:
        plan_snapshot = _snapshot_file(effective_plan_path)
        state_snapshot = _snapshot_file(effective_state_path)
    except OSError as exc:
        raise CommandError(f"could not snapshot plan/state before save: {exc}") from exc

    try:
        save_state(state_data, effective_state_path)
        save_plan(plan, effective_plan_path)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        failed_paths = _rollback_snapshots(
            state_path=effective_state_path,
            state_snapshot=state_snapshot,
            plan_path=effective_plan_path,
            plan_snapshot=plan_snapshot,
        )
        rollback_note = ""
        if failed_paths:
            rollback_note = (
                "; rollback may be incomplete for: "
                + ", ".join(failed_paths)
            )
        raise CommandError(
            f"could not save plan/state transaction: {exc}{rollback_note}"
        ) from exc


__all__ = [
    "_plan_file_for_state",
    "save_plan_state_transactional",
]
