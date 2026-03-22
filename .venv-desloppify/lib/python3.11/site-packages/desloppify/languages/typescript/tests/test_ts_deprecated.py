"""Tests for desloppify.languages.typescript.detectors.deprecated — @deprecated symbol detection."""

from pathlib import Path

import pytest

import desloppify.base.discovery.paths as paths_api_mod
import desloppify.languages.typescript.detectors.deprecated as deprecated_detector_mod


@pytest.fixture(autouse=True)
def _root(tmp_path, set_project_root, monkeypatch):
    """Point PROJECT_ROOT at the tmp directory via RuntimeContext."""
    monkeypatch.setattr(paths_api_mod, "SRC_PATH", tmp_path)


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


def _detect(path: Path) -> tuple[list[dict], int]:
    result = deprecated_detector_mod.detect_deprecated_result(path)
    return result.entries, result.population_size


# ── _extract_deprecated_symbol ───────────────────────────────


class TestExtractDeprecatedSymbol:
    def test_inline_jsdoc_top_level_const(self, tmp_path):
        """Inline JSDoc @deprecated on top-level const is extracted."""

        _write(
            tmp_path,
            "old.ts",
            "/** @deprecated Use newThing instead */ export const oldThing = 1;\n",
        )
        symbol, kind = deprecated_detector_mod._extract_deprecated_symbol(
            str(tmp_path / "old.ts"),
            1,
            "/** @deprecated Use newThing instead */ export const oldThing = 1;",
        )
        assert symbol == "oldThing"
        assert kind == "top-level"

    def test_inline_jsdoc_property(self, tmp_path):
        """Inline JSDoc @deprecated on a property is extracted as property kind."""

        _write(
            tmp_path,
            "types.ts",
            (
                "interface Config {\n"
                "  /** @deprecated */ oldField?: string;\n"
                "  newField: string;\n"
                "}\n"
            ),
        )
        symbol, kind = deprecated_detector_mod._extract_deprecated_symbol(
            str(tmp_path / "types.ts"), 2, "  /** @deprecated */ oldField?: string;"
        )
        assert symbol == "oldField"
        assert kind == "property"

    def test_multiline_jsdoc_function(self, tmp_path):
        """Multi-line JSDoc @deprecated on function is extracted."""

        _write(
            tmp_path,
            "api.ts",
            (
                "/**\n"
                " * @deprecated Use newFetch instead\n"
                " */\n"
                "export function oldFetch() { return null; }\n"
            ),
        )
        symbol, kind = deprecated_detector_mod._extract_deprecated_symbol(
            str(tmp_path / "api.ts"), 2, " * @deprecated Use newFetch instead"
        )
        assert symbol == "oldFetch"
        assert kind == "top-level"

    def test_multiline_jsdoc_interface(self, tmp_path):
        """Multi-line JSDoc @deprecated on interface is extracted."""

        _write(
            tmp_path,
            "types.ts",
            (
                "/**\n"
                " * @deprecated Use NewType instead\n"
                " */\n"
                "export interface OldType {\n"
                "  field: string;\n"
                "}\n"
            ),
        )
        symbol, kind = deprecated_detector_mod._extract_deprecated_symbol(
            str(tmp_path / "types.ts"), 2, " * @deprecated Use NewType instead"
        )
        assert symbol == "OldType"
        assert kind == "top-level"

    def test_inline_comment_deprecation(self, tmp_path):
        """// @deprecated on same line as a property is extracted."""

        _write(
            tmp_path,
            "types.ts",
            ("interface Config {\n  shotImageEntryId?: string; // @deprecated\n}\n"),
        )
        symbol, kind = deprecated_detector_mod._extract_deprecated_symbol(
            str(tmp_path / "types.ts"), 2, "  shotImageEntryId?: string; // @deprecated"
        )
        assert symbol == "shotImageEntryId"
        assert kind == "property"

    def test_returns_none_for_unresolvable(self, tmp_path):
        """Returns (None, 'unknown') when the symbol cannot be determined."""

        _write(tmp_path, "weird.ts", "@deprecated\n\n\n")
        symbol, kind = deprecated_detector_mod._extract_deprecated_symbol(
            str(tmp_path / "weird.ts"), 1, "@deprecated"
        )
        assert symbol is None
        assert kind == "unknown"


# ── detect_deprecated ────────────────────────────────────────


class TestDetectDeprecated:
    def test_finds_deprecated_annotations(self, tmp_path):
        """detect_deprecated finds files with @deprecated JSDoc tags."""

        _write(
            tmp_path,
            "old.ts",
            (
                "/**\n"
                " * @deprecated Use newHelper instead\n"
                " */\n"
                "export function oldHelper() { return null; }\n"
            ),
        )
        entries, count = _detect(tmp_path)
        assert len(entries) >= 1
        assert entries[0]["symbol"] == "oldHelper"
        assert entries[0]["kind"] == "top-level"

    def test_deduplicates_same_symbol_in_file(self, tmp_path):
        """Same symbol with multiple @deprecated annotations in one file is deduplicated."""

        _write(
            tmp_path,
            "dupes.ts",
            (
                "/**\n"
                " * @deprecated\n"
                " * @deprecated (duplicate)\n"
                " */\n"
                "export function oldThing() {}\n"
            ),
        )
        entries, _ = _detect(tmp_path)
        symbols = [e["symbol"] for e in entries if e["symbol"] == "oldThing"]
        assert len(symbols) <= 1

    def test_empty_directory(self, tmp_path):
        """Empty directory returns no entries."""

        entries, count = _detect(tmp_path)
        assert entries == []
        assert count == 0

    def test_file_without_deprecated(self, tmp_path):
        """Files without @deprecated produce no entries."""

        _write(tmp_path, "clean.ts", "export function activeHelper() { return 1; }\n")
        entries, _ = _detect(tmp_path)
        assert entries == []

    def test_distinguishes_top_level_and_property(self, tmp_path):
        """Entries correctly classify top-level vs property deprecations."""

        _write(
            tmp_path,
            "mixed.ts",
            (
                "/**\n"
                " * @deprecated Use new API\n"
                " */\n"
                "export function oldFunc() {}\n"
                "\n"
                "interface Config {\n"
                "  /** @deprecated */ oldProp?: string;\n"
                "}\n"
            ),
        )
        entries, _ = _detect(tmp_path)
        kinds = {e["kind"] for e in entries}
        assert "top-level" in kinds
        assert "property" in kinds

    def test_detects_mixed_case_deprecated_markers(self, tmp_path):
        """Mixed-case @Deprecated markers should be detected."""
        _write(
            tmp_path,
            "legacy.ts",
            (
                "/**\n"
                " * @Deprecated Use newFunc\n"
                " */\n"
                "export function oldFunc() {}\n"
            ),
        )
        entries, _ = _detect(tmp_path)
        symbols = {e["symbol"] for e in entries}
        assert "oldFunc" in symbols
