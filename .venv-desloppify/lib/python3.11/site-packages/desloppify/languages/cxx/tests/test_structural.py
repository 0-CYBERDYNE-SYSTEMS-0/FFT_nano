from __future__ import annotations

from types import SimpleNamespace

import desloppify.languages.cxx.phases as phases_mod


def fake_cxx_lang():
    return SimpleNamespace(
        file_finder=lambda _path: [],
        large_threshold=500,
        complexity_threshold=15,
        complexity_map={},
        zone_map=None,
    )


def test_phase_structural_flags_large_or_complex_cxx_file(tmp_path, monkeypatch):
    captured: dict[str, object] = {}

    def fake_run(path, lang, **kwargs):
        captured["path"] = path
        captured["lang"] = lang
        captured["signals"] = kwargs["complexity_signals"]
        return [], {}

    monkeypatch.setattr(phases_mod, "run_structural_phase", fake_run)

    issues, complexity = phases_mod.phase_structural(tmp_path, fake_cxx_lang())

    assert isinstance(issues, list)
    assert isinstance(complexity, dict)
    assert captured["path"] == tmp_path
    assert captured["signals"] is phases_mod.CXX_COMPLEXITY_SIGNALS
