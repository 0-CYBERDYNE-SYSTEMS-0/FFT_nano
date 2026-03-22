"""Tests for ``desloppify.languages.gdscript`` configuration wiring."""

from __future__ import annotations

from desloppify.languages.gdscript import GdscriptConfig


def test_config_name():
    cfg = GdscriptConfig()
    assert cfg.name == "gdscript"


def test_config_extensions():
    cfg = GdscriptConfig()
    assert cfg.extensions == [".gd"]


def test_config_detect_commands_populated():
    cfg = GdscriptConfig()
    for name in ("deps", "cycles", "orphaned", "dupes", "large", "complexity"):
        assert name in cfg.detect_commands


def test_config_has_core_phases():
    cfg = GdscriptConfig()
    labels = [phase.label for phase in cfg.phases]
    assert "Structural analysis" in labels
    assert "Coupling + cycles + orphaned" in labels


def test_file_finder_skips_godot_artifacts(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "player.gd").write_text("extends Node\n")
    (tmp_path / ".godot").mkdir()
    (tmp_path / ".godot" / "cache.gd").write_text("extends Node\n")
    (tmp_path / ".import").mkdir()
    (tmp_path / ".import" / "meta.gd").write_text("extends Node\n")

    cfg = GdscriptConfig()
    from desloppify.base.runtime_state import RuntimeContext, runtime_scope
    from desloppify.base.discovery.source import clear_source_file_cache_for_tests
    ctx = RuntimeContext(project_root=tmp_path)
    with runtime_scope(ctx):
        clear_source_file_cache_for_tests()
        files = cfg.file_finder(tmp_path)

    assert files == ["src/player.gd"]
