"""Language runtime-option parsing helpers."""

from __future__ import annotations

import sys

from desloppify.base.output.terminal import colorize


class LangRuntimeOptionsError(ValueError):
    """Raised when --lang-opt values cannot be parsed or normalized."""

    def __init__(self, message: str, *, supported_options: list[str] | None = None):
        super().__init__(message)
        self.supported_options = supported_options or []


def parse_lang_opt_assignments(raw_values: list[str] | None) -> dict[str, str]:
    """Parse repeated KEY=VALUE --lang-opt inputs."""
    values = raw_values or []
    parsed: dict[str, str] = {}
    for raw in values:
        text = (raw or "").strip()
        if not text:
            continue
        if "=" not in text:
            raise ValueError(f"Invalid --lang-opt '{raw}'. Expected KEY=VALUE.")
        key, value = text.split("=", 1)
        key = key.strip().replace("-", "_")
        if not key:
            raise ValueError(f"Invalid --lang-opt '{raw}'. Missing option key.")
        parsed[key] = value.strip()
    return parsed


def resolve_lang_runtime_options(args, lang) -> dict[str, object]:
    """Resolve runtime options from generic --lang-opt inputs."""
    try:
        options = parse_lang_opt_assignments(getattr(args, "lang_opt", None))
    except ValueError as exc:
        raise LangRuntimeOptionsError(str(exc)) from exc

    try:
        return lang.normalize_runtime_options(options, strict=True)
    except KeyError as exc:
        supported = sorted((lang.runtime_option_specs or {}).keys())
        raise LangRuntimeOptionsError(
            str(exc),
            supported_options=supported,
        ) from exc


def print_lang_runtime_options_error(exc: LangRuntimeOptionsError, *, lang_name: str) -> None:
    """Render a runtime-option parse/validation error."""
    print(colorize(f"  {exc}", "red"), file=sys.stderr)
    hint = ", ".join(exc.supported_options) if exc.supported_options else "(none)"
    print(
        colorize(f"  Supported {lang_name} runtime options: {hint}", "dim"),
        file=sys.stderr,
    )


__all__ = [
    "LangRuntimeOptionsError",
    "parse_lang_opt_assignments",
    "print_lang_runtime_options_error",
    "resolve_lang_runtime_options",
]
