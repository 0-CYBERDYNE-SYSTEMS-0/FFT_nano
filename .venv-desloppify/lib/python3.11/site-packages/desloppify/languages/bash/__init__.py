"""Bash/Shell language plugin — shellcheck."""

from desloppify.languages._framework.generic_support.core import generic_lang
from desloppify.languages._framework.treesitter import BASH_SPEC

generic_lang(
    name="bash",
    extensions=[".sh", ".bash"],
    tools=[
        {
            "label": "shellcheck",
            "cmd": "find . -name '*.sh' -o -name '*.bash' | xargs shellcheck -f gcc 2>/dev/null",
            "fmt": "gnu",
            "id": "shellcheck_warning",
            "tier": 2,
            "fix_cmd": None,
        },
    ],
    depth="shallow",
    treesitter_spec=BASH_SPEC,
)

__all__ = [
    "generic_lang",
    "BASH_SPEC",
]
