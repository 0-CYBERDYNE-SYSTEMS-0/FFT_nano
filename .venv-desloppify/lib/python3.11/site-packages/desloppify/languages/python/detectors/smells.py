"""Python code smell detection configuration and public entrypoint."""

from __future__ import annotations

import logging
from pathlib import Path

from .smells_runtime import (
    build_string_line_set,
    match_is_in_string,
)
from .smells_runtime import (
    detect_smells_runtime as _detect_smells_runtime,
)

logger = logging.getLogger(__name__)


def _is_test_path(filepath: str) -> bool:
    normalized = filepath.replace("\\", "/")
    return normalized.startswith("tests/") or "/tests/" in normalized


def _smell(smell_id: str, label: str, severity: str, pattern: str | None = None) -> dict:
    return {"id": smell_id, "label": label, "pattern": pattern, "severity": severity}


SMELL_CHECKS = [
    _smell(
        "eval_exec",
        "eval()/exec() usage",
        "high",
        r"(?<!\.)(?<!\w)(?:eval|exec)\s*\(",
    ),
    _smell(
        "magic_number",
        "Magic numbers (>1000 in logic)",
        "low",
        r"(?:==|!=|>=?|<=?|[+\-*/])\s*\d{4,}",
    ),
    _smell("todo_fixme", "TODO/FIXME/HACK comments", "low", r"#\s*(?:TODO|FIXME|HACK|XXX)"),
    _smell(
        "hardcoded_url",
        "Hardcoded URL in source code",
        "medium",
        r"""(?:['"])https?://[^\s'"]+(?:['"])""",
    ),
    _smell(
        "debug_tag",
        "Vestigial debug tag in log/print",
        "low",
        r"""(?:f?['"])\[([A-Z][A-Z0-9_]{2,})\]\s""",
    ),
    _smell(
        "workaround_tag",
        "Workaround tag in comment ([PascalCaseTag])",
        "low",
        r"#.*\[([A-Z][a-z]+(?:[A-Z][a-z]+)+)\]",
    ),
    _smell(
        "star_import_no_all",
        "Star import target has no __all__ (uncontrolled namespace)",
        "medium",
    ),
    _smell("empty_except", "Empty except block (except: pass)", "high"),
    _smell("swallowed_error", "Catch block that only logs (swallowed error)", "high"),
    _smell("monster_function", "Monster function (>150 LOC)", "high"),
    _smell("dead_function", "Dead function (body is only pass/return)", "medium"),
    _smell("inline_class", "Class defined inside a function", "medium"),
    _smell(
        "deferred_import",
        "Function-level import (possible circular import workaround)",
        "low",
    ),
    _smell(
        "subprocess_no_timeout",
        "subprocess call without timeout (can hang forever)",
        "high",
    ),
    _smell(
        "lru_cache_mutable",
        "lru_cache on function that reads mutable global state",
        "medium",
    ),
    _smell(
        "unsafe_file_write",
        "Non-atomic file write (use temp+rename for safety)",
        "medium",
    ),
    _smell(
        "duplicate_constant",
        "Constant defined identically in multiple modules",
        "medium",
    ),
    _smell(
        "unreachable_code",
        "Code after unconditional return/raise/break/continue",
        "high",
    ),
    _smell("constant_return", "Function always returns the same constant value", "medium"),
    _smell("regex_backtrack", "Regex with nested quantifiers (ReDoS risk)", "high"),
    _smell(
        "naive_comment_strip",
        "re.sub strips comments without string awareness",
        "medium",
    ),
    _smell(
        "callback_logging",
        "Logging callback parameter (use module-level logger instead)",
        "medium",
    ),
    _smell(
        "hardcoded_path_sep",
        "Hardcoded '/' path separator (breaks on Windows)",
        "medium",
    ),
    _smell(
        "vestigial_parameter",
        "Parameter annotated as unused/deprecated in comments",
        "medium",
    ),
    _smell("noop_function", "Non-trivial function whose body does nothing", "high"),
    _smell(
        "stderr_traceback",
        "traceback.print_exc() bypasses structured logging",
        "high",
        r"traceback\.print_exc\s*\(",
    ),
    _smell(
        "import_path_mutation",
        "sys.path mutation at import time (boundary purity leak)",
        "high",
    ),
    _smell(
        "import_env_mutation",
        "Environment loading at import time (boundary purity leak)",
        "medium",
    ),
    _smell(
        "import_runtime_init",
        "Runtime initialization at import time (boundary purity leak)",
        "medium",
    ),
    _smell(
        "sys_exit_in_library",
        "sys.exit() outside CLI entry point — use exceptions",
        "high",
    ),
    _smell(
        "silent_except",
        "Except handler silently suppresses error (pass/continue, no log)",
        "high",
    ),
    _smell(
        "optional_param_sprawl",
        "Too many optional params — consider a config object",
        "medium",
    ),
    _smell("annotation_quality", "Loose type annotation — use specific types", "medium"),
    _smell(
        "nested_closure",
        "Deeply nested inner functions — extract to module level",
        "medium",
    ),
    _smell(
        "mutable_ref_hack",
        "Mutable-list ref hack — use nonlocal or a dataclass",
        "medium",
    ),
    _smell(
        "high_cyclomatic_complexity",
        "High cyclomatic complexity (>12 decision points)",
        "medium",
    ),
]


def detect_smells(path: Path) -> tuple[list[dict], int]:
    """Detect Python code smell patterns. Returns (entries, total_files_checked)."""
    return _detect_smells_runtime(
        path,
        smell_checks=SMELL_CHECKS,
        is_test_path_fn=_is_test_path,
        logger=logger,
    )


__all__ = [
    "SMELL_CHECKS",
    "build_string_line_set",
    "match_is_in_string",
    "detect_smells",
]
