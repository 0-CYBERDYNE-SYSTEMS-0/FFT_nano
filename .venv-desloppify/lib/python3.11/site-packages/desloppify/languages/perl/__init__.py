"""Perl language plugin — perlcritic."""

from desloppify.languages._framework.generic_support.core import generic_lang
from desloppify.languages._framework.treesitter import PERL_SPEC

generic_lang(
    name="perl",
    extensions=[".pl", ".pm"],
    tools=[
        {
            "label": "perlcritic",
            "cmd": "perlcritic --quiet --severity=1 . 2>&1",
            "fmt": "gnu",
            "id": "perlcritic_violation",
            "tier": 2,
            "fix_cmd": None,
        },
    ],
    depth="minimal",
    treesitter_spec=PERL_SPEC,
)

__all__ = [
    "generic_lang",
    "PERL_SPEC",
]
