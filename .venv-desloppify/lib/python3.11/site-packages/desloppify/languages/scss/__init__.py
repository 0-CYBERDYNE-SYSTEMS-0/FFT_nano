"""SCSS language plugin -- stylelint."""

from desloppify.languages._framework.generic_support.core import generic_lang

generic_lang(
    name="scss",
    extensions=[".scss", ".sass"],
    tools=[
        {
            "label": "stylelint",
            "cmd": "stylelint '**/*.scss' '**/*.sass' --formatter unix --max-warnings 1000",
            "fmt": "gnu",
            "id": "stylelint_issue",
            "tier": 2,
            "fix_cmd": "stylelint --fix '**/*.scss' '**/*.sass'",
        },
    ],
    exclude=["node_modules", "_output", ".quarto", "vendor"],
    detect_markers=["_scss", ".stylelintrc"],
    treesitter_spec=None,
)

__all__ = [
    "generic_lang",
]
