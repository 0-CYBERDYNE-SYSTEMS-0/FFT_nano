"""TypeScript-specific security detectors."""

from __future__ import annotations

import logging
from pathlib import Path

from desloppify.base.output.fallbacks import log_best_effort_failure
from desloppify.base.signal_patterns import is_server_only_path
from desloppify.engine.policy.zones import FileZoneMap, Zone
from desloppify.languages.typescript.detectors.contracts import DetectorResult
from desloppify.languages.typescript.detectors.security.entries import (
    _make_security_entry,
)
from desloppify.languages.typescript.detectors.security.file_checks import (
    _file_level_security_issues,
)
from desloppify.languages.typescript.detectors.security.line_checks import (
    _line_security_issues,
)

logger = logging.getLogger(__name__)


def detect_ts_security(
    files: list[str],
    zone_map: FileZoneMap | None,
) -> DetectorResult[dict]:
    """Detect TypeScript-specific security issues with explicit population semantics."""
    entries: list[dict] = []
    scanned = 0

    for filepath in files:
        if zone_map is not None:
            zone = zone_map.get(filepath)
            if zone in (Zone.TEST, Zone.CONFIG, Zone.GENERATED, Zone.VENDOR):
                continue

        try:
            content = Path(filepath).read_text(errors="replace")
        except OSError as exc:
            log_best_effort_failure(logger, f"read TypeScript security source {filepath}", exc)
            entries.append(
                _make_security_entry(
                    filepath,
                    1,
                    str(exc),
                    check_id="scan_read_error",
                    summary="Failed to read file during TypeScript security scan",
                    severity="low",
                    confidence="high",
                    remediation="Ensure file is readable and rerun security scan.",
                )
            )
            continue

        scanned += 1
        normalized_path = filepath.replace("\\", "/")
        is_server_only = is_server_only_path(normalized_path)
        lines = content.splitlines()
        has_dev_guard = "__IS_DEV_ENV__" in content or "isDev" in content

        for line_num, line in enumerate(lines, 1):
            stripped = line.lstrip()
            if stripped.startswith("//"):
                continue
            entries.extend(
                _line_security_issues(
                    filepath=filepath,
                    normalized_path=normalized_path,
                    lines=lines,
                    line_num=line_num,
                    line=line,
                    is_server_only=is_server_only,
                    has_dev_guard=has_dev_guard,
                )
            )

        entries.extend(
            _file_level_security_issues(
                filepath=filepath,
                normalized_path=normalized_path,
                lines=lines,
                content=content,
            )
        )

    return DetectorResult(entries=entries, population_kind="files", population_size=scanned)


__all__ = [
    "detect_ts_security",
]
