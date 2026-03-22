"""Tests for ``desloppify.languages.dart`` configuration wiring."""

from __future__ import annotations

from desloppify.languages.dart import DartConfig


def test_config_name():
    cfg = DartConfig()
    assert cfg.name == "dart"


def test_config_extensions():
    cfg = DartConfig()
    assert cfg.extensions == [".dart"]


def test_config_detect_commands_populated():
    cfg = DartConfig()
    for name in ("deps", "cycles", "orphaned", "dupes", "large", "complexity"):
        assert name in cfg.detect_commands


def test_config_has_core_phases():
    cfg = DartConfig()
    labels = [phase.label for phase in cfg.phases]
    assert "Structural analysis" in labels
    assert "Coupling + cycles + orphaned" in labels


def test_file_finder_skips_build_artifacts(tmp_path):
    (tmp_path / "lib").mkdir()
    (tmp_path / "lib" / "app.dart").write_text("void main() {}")
    (tmp_path / ".dart_tool").mkdir()
    (tmp_path / ".dart_tool" / "generated.dart").write_text("void g() {}")
    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "output.dart").write_text("void o() {}")

    cfg = DartConfig()
    from desloppify.base.runtime_state import RuntimeContext, runtime_scope
    from desloppify.base.discovery.source import clear_source_file_cache_for_tests
    ctx = RuntimeContext(project_root=tmp_path)
    with runtime_scope(ctx):
        clear_source_file_cache_for_tests()
        files = cfg.file_finder(tmp_path)

    assert files == ["lib/app.dart"]
