"""Julia language plugin — tree-sitter structural analysis."""

from desloppify.languages._framework.generic_support.core import generic_lang
from desloppify.languages._framework.treesitter import JULIA_SPEC

generic_lang(
    name="julia",
    extensions=[".jl"],
    tools=[
        {
            "label": "JuliaFormatter",
            "cmd": "julia -e 'using JuliaFormatter; format(\".\", verbose=true)'",
            "fmt": "gnu",
            "id": "julia_format",
            "tier": 3,
            "fix_cmd": None,
        },
    ],
    exclude=[".julia", "deps"],
    depth="minimal",
    detect_markers=["Project.toml", "JuliaProject.toml"],
    treesitter_spec=JULIA_SPEC,
    entry_patterns=["main.jl"],
)

__all__ = [
    "generic_lang",
    "JULIA_SPEC",
]
