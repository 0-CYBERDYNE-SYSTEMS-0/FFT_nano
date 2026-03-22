"""Zig language plugin — zig build."""

from desloppify.languages._framework.generic_support.core import generic_lang
from desloppify.languages._framework.treesitter import ZIG_SPEC

generic_lang(
    name="zig",
    extensions=[".zig"],
    tools=[
        {
            "label": "zig build",
            "cmd": "zig build 2>&1",
            "fmt": "gnu",
            "id": "zig_error",
            "tier": 3,
            "fix_cmd": None,
        },
    ],
    depth="minimal",
    detect_markers=["build.zig"],
    treesitter_spec=ZIG_SPEC,
)

__all__ = [
    "generic_lang",
    "ZIG_SPEC",
]
