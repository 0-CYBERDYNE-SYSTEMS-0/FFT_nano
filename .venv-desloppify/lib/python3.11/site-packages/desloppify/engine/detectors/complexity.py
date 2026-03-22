"""Complexity signal detection: configurable per-language complexity signals."""

from __future__ import annotations

import inspect
import logging
import re
from pathlib import Path

from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.base.discovery.file_paths import resolve_scan_file

logger = logging.getLogger(__name__)


def detect_complexity(
    path: Path, signals, file_finder, threshold: int = 15, min_loc: int = 50
) -> tuple[list[dict], int]:
    """Detect files with complexity signals."""
    files = file_finder(path)
    entries = []
    for filepath in files:
        try:
            p = resolve_scan_file(filepath, scan_root=path)
            content = p.read_text()
            lines = content.splitlines()
            loc = len(lines)
            if loc < min_loc:
                continue

            file_signals = []
            score = 0

            for sig in signals:
                try:
                    if sig.compute:
                        # Pass filepath to compute fns that accept it (tree-sitter signals).
                        accepts_filepath = "_filepath" in inspect.signature(
                            sig.compute
                        ).parameters
                        if accepts_filepath:
                            result = sig.compute(content, lines, _filepath=filepath)
                        else:
                            result = sig.compute(content, lines)
                        if result:
                            count, label = result
                            file_signals.append(label)
                            excess = (
                                max(0, count - sig.threshold) if sig.threshold else count
                            )
                            score += excess * sig.weight
                    elif sig.pattern:
                        count = len(re.findall(sig.pattern, content, re.MULTILINE))
                        if count > sig.threshold:
                            file_signals.append(f"{count} {sig.name}")
                            score += (count - sig.threshold) * sig.weight
                except (TypeError, ValueError, KeyError, AttributeError, re.error) as exc:
                    log_best_effort_failure(
                        logger,
                        f"compute complexity signal '{sig.name}' for {filepath}",
                        exc,
                    )
                    continue

            if file_signals and score >= threshold:
                entries.append(
                    {
                        "file": filepath,
                        "loc": loc,
                        "score": score,
                        "signals": file_signals,
                    }
                )
        except (OSError, UnicodeDecodeError) as exc:
            log_best_effort_failure(
                logger,
                f"read complexity detector candidate {filepath}",
                exc,
            )
            continue
    return sorted(entries, key=lambda e: -e["score"]), len(files)


__all__ = ["detect_complexity"]
