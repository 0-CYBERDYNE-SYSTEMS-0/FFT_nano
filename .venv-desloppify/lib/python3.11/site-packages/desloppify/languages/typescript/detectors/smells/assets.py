"""Non-TS asset smell checks used by TypeScript smell detection."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from desloppify.base.discovery.paths import get_project_root
from desloppify.base.discovery.source import find_source_files
from desloppify.base.output.fallbacks import log_best_effort_failure

logger = logging.getLogger(__name__)


def _script_is_documented(readme_text: str, script_name: str) -> bool:
    escaped = re.escape(script_name)
    command_patterns = [
        rf"\bnpm\s+(?:run\s+)?{escaped}\b",
        rf"\bpnpm\s+{escaped}\b",
        rf"\byarn\s+{escaped}\b",
        rf"\bbun\s+run\s+{escaped}\b",
    ]
    if any(re.search(pattern, readme_text, flags=re.IGNORECASE) for pattern in command_patterns):
        return True
    return bool(re.search(rf"`{escaped}`", readme_text))


def detect_non_ts_asset_smells(path: Path, smell_counts: dict[str, list[dict]]) -> int:
    """Scan adjacent non-TS assets (CSS/docs) for repo-health smells."""
    scanned_files = 0
    css_files = find_source_files(path, [".css", ".scss", ".sass", ".less"])
    scanned_files += len(css_files)

    for filepath in css_files:
        try:
            full = Path(filepath) if Path(filepath).is_absolute() else get_project_root() / filepath
            content = full.read_text()
            lines = content.splitlines()
        except (OSError, UnicodeDecodeError) as exc:
            log_best_effort_failure(logger, f"read stylesheet smell candidate {filepath}", exc)
            continue

        if len(lines) >= 300:
            smell_counts["css_monolith"].append(
                {
                    "file": filepath,
                    "line": 1,
                    "content": f"{len(lines)} LOC stylesheet",
                }
            )

        important_count = content.count("!important")
        if important_count >= 8:
            first_line = next(
                (idx + 1 for idx, line in enumerate(lines) if "!important" in line),
                1,
            )
            smell_counts["css_important_overuse"].append(
                {
                    "file": filepath,
                    "line": first_line,
                    "content": f"{important_count} !important declarations",
                }
            )

    readme_path = get_project_root() / "README.md"
    package_path = get_project_root() / "package.json"
    if not readme_path.is_file() or not package_path.is_file():
        return scanned_files

    scanned_files += 1
    try:
        readme_text = readme_path.read_text()
        package_payload = json.loads(package_path.read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        log_best_effort_failure(logger, "read package/readme for docs drift smell", exc)
        return scanned_files

    scripts = package_payload.get("scripts")
    if not isinstance(scripts, dict):
        return scanned_files

    key_scripts = [
        script for script in ("dev", "build", "test", "lint", "typecheck") if script in scripts
    ]
    if len(key_scripts) < 2:
        return scanned_files

    missing = [script for script in key_scripts if not _script_is_documented(readme_text, script)]
    if len(missing) >= 2:
        smell_counts["docs_scripts_drift"].append(
            {
                "file": "README.md",
                "line": 1,
                "content": f"Missing script docs: {', '.join(missing[:5])}",
            }
        )
    return scanned_files


__all__ = ["detect_non_ts_asset_smells"]
