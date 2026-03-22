"""PowerShell language plugin — PSScriptAnalyzer."""

from desloppify.languages._framework.generic_support.core import generic_lang
from desloppify.languages._framework.treesitter import POWERSHELL_SPEC

generic_lang(
    name="powershell",
    extensions=[".ps1", ".psm1"],
    tools=[
        {
            "label": "PSScriptAnalyzer",
            "cmd": (
                "pwsh -Command \"Invoke-ScriptAnalyzer -Path . -Recurse"
                " | ForEach-Object { '{0}:{1}: {2}' -f $_.ScriptName,$_.Line,$_.Message }\""
            ),
            "fmt": "gnu",
            "id": "psscriptanalyzer_warning",
            "tier": 2,
            "fix_cmd": None,
        },
    ],
    depth="minimal",
    treesitter_spec=POWERSHELL_SPEC,
)

__all__ = [
    "generic_lang",
    "POWERSHELL_SPEC",
]
