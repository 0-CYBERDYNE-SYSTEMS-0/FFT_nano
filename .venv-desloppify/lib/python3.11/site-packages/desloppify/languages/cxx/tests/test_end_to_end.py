from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from desloppify.languages._framework.runtime_support.runtime import make_lang_run
from desloppify.languages.cxx import CxxConfig
from desloppify.languages.cxx.phases import phase_coupling

_FIXTURES = Path(__file__).parent / "fixtures"


def _run_scan_fixture(name: str) -> SimpleNamespace:
    root = _FIXTURES / name
    lang = make_lang_run(CxxConfig())
    issues, potentials = phase_coupling(root, lang)
    return SimpleNamespace(
        root=root,
        dep_graph=lang.dep_graph or {},
        issues=issues,
        potentials=potentials,
    )


def test_cmake_fixture_produces_dep_graph_and_transitive_imports():
    result = _run_scan_fixture("cmake_sample")
    main = str((result.root / "src" / "main.cpp").resolve())
    a_header = str((result.root / "include" / "a.hpp").resolve())
    b_header = str((result.root / "include" / "b.hpp").resolve())

    assert result.dep_graph
    assert a_header in result.dep_graph[main]["imports"]
    assert b_header in result.dep_graph[a_header]["imports"]
    assert not any(issue["detector"] == "cycles" for issue in result.issues)


def test_makefile_fixture_uses_best_effort_fallback():
    result = _run_scan_fixture("makefile_sample")
    main = str((result.root / "src" / "main.cpp").resolve())
    header = str((result.root / "include" / "local.hpp").resolve())

    assert result.dep_graph
    assert not (result.root / "compile_commands.json").exists()
    assert header in result.dep_graph[main]["imports"]
