"""Fixer registry assembly for TypeScript."""

from __future__ import annotations

import importlib

from desloppify.languages._framework.base.types import FixerConfig
import desloppify.languages.typescript.detectors.logs as logs_detector_mod
import desloppify.languages.typescript.detectors.smells as smells_detector_mod
import desloppify.languages.typescript.detectors.unused as unused_detector_mod

_FIXERS_MODULE = "desloppify.languages.typescript.fixers"


def _ts_fixers_mod():
    return importlib.import_module(_FIXERS_MODULE)


def _det_unused(cat):
    """Create a detector function for a specific unused category."""

    def f(path):
        return unused_detector_mod.detect_unused(path, category=cat)[0]

    return f


def _det_logs(path):
    """Detect tagged debug logs."""
    return logs_detector_mod.detect_logs(path).entries


def _det_smell(smell_id):
    """Create a detector function for a specific smell ID."""

    def f(path):
        return next(
            (
                e.get("matches", [])
                for e in smells_detector_mod.detect_smells(path)[0]
                if e["id"] == smell_id
            ),
            [],
        )

    return f


def _fix_vars(entries, *, dry_run=False):
    """Fix unused vars, returning FixResult."""
    return _ts_fixers_mod().fix_unused_vars(entries, dry_run=dry_run)


def _fix_logs(entries, *, dry_run=False):
    """Fix debug logs, normalizing result keys."""
    result = _ts_fixers_mod().fix_debug_logs(entries, dry_run=dry_run)
    for r in result.entries:
        r["removed"] = r.get("tags", r.get("removed", []))
    return result


def get_ts_fixers() -> dict[str, FixerConfig]:
    """Build the TypeScript fixer registry (lazy-loaded)."""
    fixers_mod = _ts_fixers_mod()
    removed, would_remove = "Removed", "Would remove"
    return {
        "unused-imports": FixerConfig(
            "unused imports",
            _det_unused("imports"),
            fixers_mod.fix_unused_imports,
            "unused",
            removed,
            would_remove,
        ),
        "debug-logs": FixerConfig(
            "tagged debug logs",
            _det_logs,
            _fix_logs,
            "logs",
            removed,
            would_remove,
        ),
        "unused-vars": FixerConfig(
            "unused vars",
            _det_unused("vars"),
            _fix_vars,
            "unused",
            removed,
            would_remove,
        ),
        "unused-params": FixerConfig(
            "unused params",
            _det_unused("vars"),
            fixers_mod.fix_unused_params,
            "unused",
            "Prefixed",
            "Would prefix",
        ),
        "dead-useeffect": FixerConfig(
            "dead useEffect calls",
            _det_smell("dead_useeffect"),
            fixers_mod.fix_dead_useeffect,
            "smells",
            removed,
            would_remove,
        ),
        "empty-if-chain": FixerConfig(
            "empty if/else chains",
            _det_smell("empty_if_chain"),
            fixers_mod.fix_empty_if_chain,
            "smells",
            removed,
            would_remove,
        ),
    }


__all__ = ["get_ts_fixers"]
