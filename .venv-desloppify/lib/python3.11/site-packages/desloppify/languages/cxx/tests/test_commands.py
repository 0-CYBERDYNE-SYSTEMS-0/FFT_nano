from __future__ import annotations

from desloppify.languages.cxx.commands import get_detect_commands


def test_cxx_detect_commands_include_graph_and_tool_surfaces():
    commands = get_detect_commands()

    for name in (
        "deps",
        "cycles",
        "orphaned",
        "dupes",
        "large",
        "complexity",
        "cppcheck",
        "clang_tidy",
    ):
        assert name in commands
        assert callable(commands[name])
