"""detect command: run a single detector directly (bypass state tracking)."""

from __future__ import annotations

import argparse
import sys

from desloppify.languages import framework as lang_api
from desloppify.app.commands.helpers.lang import resolve_lang, resolve_lang_settings
from desloppify.app.commands.helpers.command_runtime import command_runtime
from desloppify.app.commands.helpers.runtime_options import (
    LangRuntimeOptionsError,
    print_lang_runtime_options_error,
    resolve_lang_runtime_options,
)
from desloppify.base.exception_sets import CommandError
from desloppify.base.output.terminal import colorize
from desloppify.languages.framework import LangRunOverrides, make_lang_run


def _resolve_detector_key(
    detector: str, detect_commands: dict[str, object]
) -> str | None:
    """Resolve detector input to a command key."""
    detector = detector.strip()
    if detector in detect_commands:
        return detector

    normalized = detector.lower().replace("-", "_")
    if normalized in detect_commands:
        return normalized

    denormalized = detector.lower().replace("_", "-")
    if denormalized in detect_commands:
        return denormalized

    return None


def cmd_detect(args: argparse.Namespace) -> None:
    """Run a single detector directly (bypass state tracking)."""
    detector_input = args.detector

    # Resolve language (from --lang flag or auto-detection)
    lang_cfg = resolve_lang(args)

    if not lang_cfg:
        langs = ", ".join(lang_api.available_langs()) or "registered language plugins"
        raise CommandError(
            f"No language specified. Use --lang <name> (available: {langs})."
        )

    # Validate detector name
    detector = _resolve_detector_key(detector_input, lang_cfg.detect_commands)
    if detector is None:
        available = ", ".join(sorted(lang_cfg.detect_commands))
        raise CommandError(
            f"Unknown detector for {lang_cfg.name}: {detector_input}\n"
            f"  Available: {available}"
        )

    # Set default thresholds for detectors that expect them
    if getattr(args, "threshold", None) is None:
        if detector == "large":
            args.threshold = lang_cfg.large_threshold
        elif detector == "complexity":
            args.threshold = lang_cfg.complexity_threshold
        elif detector == "dupes":
            args.threshold = 0.8

    runtime = command_runtime(args)
    lang_settings = resolve_lang_settings(runtime.config, lang_cfg)
    try:
        lang_options = resolve_lang_runtime_options(args, lang_cfg)
    except LangRuntimeOptionsError as exc:
        print_lang_runtime_options_error(exc, lang_name=lang_cfg.name)
        raise CommandError(str(exc), exit_code=2) from exc
    lang = make_lang_run(
        lang_cfg,
        overrides=LangRunOverrides(
            runtime_settings=lang_settings,
            runtime_options=lang_options,
        ),
    )
    args.lang_runtime_options = dict(lang_options)
    try:
        lang.detect_commands[detector](args)
    finally:
        args.lang_runtime_options = None
    if not getattr(args, "json", False):
        scan_path = getattr(args, "path", ".") or "."
        print(
            colorize(f"\n  Next command: `desloppify scan --path {scan_path}`", "dim"),
            file=sys.stderr,
        )
