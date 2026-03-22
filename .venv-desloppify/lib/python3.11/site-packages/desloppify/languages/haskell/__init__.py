"""Haskell language plugin — hlint."""

from desloppify.languages._framework.generic_support.core import generic_lang
from desloppify.languages._framework.treesitter import HASKELL_SPEC

generic_lang(
    name="haskell",
    extensions=[".hs"],
    tools=[
        {
            "label": "hlint",
            "cmd": "hlint --json .",
            "fmt": "json",
            "id": "hlint_suggestion",
            "tier": 2,
            "fix_cmd": None,
        },
    ],
    exclude=[".stack-work", "dist-newstyle"],
    depth="minimal",
    detect_markers=["stack.yaml", "cabal.project"],
    treesitter_spec=HASKELL_SPEC,
)

__all__ = [
    "generic_lang",
    "HASKELL_SPEC",
]
