"""Tests for TypeScript detector entrypoint result contracts."""

from __future__ import annotations

import inspect
from pathlib import Path
from unittest.mock import patch

from desloppify.languages.typescript.detectors.deprecated import (
    cmd_deprecated,
    detect_deprecated_result,
)
from desloppify.languages.typescript.detectors.logs import detect_logs
from desloppify.languages.typescript.detectors.patterns.analysis import (
    detect_pattern_anomalies,
)
from desloppify.languages.typescript.detectors.security.detector import detect_ts_security


def _write(tmp_path: Path, rel_path: str, content: str) -> None:
    target = tmp_path / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def test_logs_result_contract(tmp_path):
    _write(tmp_path, "a.ts", "console.log('[Tag] hello')\n")
    result = detect_logs(tmp_path)
    assert result.population_kind == "files"
    assert result.entries
    assert result.population_size == 1


def test_pattern_result_contract(tmp_path):
    _write(tmp_path, "src/a.ts", "const x = 1;\n")
    _write(tmp_path, "src/b.ts", "const y = 2;\n")
    result = detect_pattern_anomalies(tmp_path)
    assert result.population_kind == "areas"
    assert result.entries == []
    assert result.population_size == 0


def test_deprecated_result_contract(tmp_path):
    _write(
        tmp_path,
        "legacy.ts",
        "/** @deprecated use newOne */ export function oldOne() {}\n",
    )
    result = detect_deprecated_result(tmp_path)
    assert result.population_kind == "deprecated_symbols"
    assert result.entries
    assert result.population_size == len(result.entries)


def test_security_result_contract():
    content = "const out = eval(userInput);\n"
    with patch.object(Path, "read_text", return_value=content):
        result = detect_ts_security(["/fake/src/test.ts"], None)
    assert result.population_size == 1
    assert result.entries and result.entries[0]["detail"]["kind"] == "eval_injection"


def test_cmd_deprecated_uses_structured_result_api():
    source = inspect.getsource(cmd_deprecated)
    assert "detect_deprecated_result" in source
