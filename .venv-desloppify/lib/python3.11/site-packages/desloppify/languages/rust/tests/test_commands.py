"""Tests for Rust command registry wiring."""

from __future__ import annotations

from desloppify.languages.rust.commands import get_detect_commands


def test_get_detect_commands_includes_base_and_rust_specific_commands():
    commands = get_detect_commands()

    for name in (
        "deps",
        "cycles",
        "dupes",
        "smells",
        "rust_import_hygiene",
        "rust_async_locking",
        "rust_unsafe_api",
        "cargo_error",
    ):
        assert name in commands
        assert callable(commands[name])
