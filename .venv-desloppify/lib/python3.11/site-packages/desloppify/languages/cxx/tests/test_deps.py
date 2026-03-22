from __future__ import annotations

from pathlib import Path

from desloppify.languages.cxx._helpers import build_cxx_dep_graph


def _write(root: Path, rel_path: str, content: str) -> Path:
    target = root / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    return target


def test_build_dep_graph_falls_back_to_makefile_include_scan(tmp_path):
    source = _write(
        tmp_path,
        "src/main.cpp",
        '#include "local.hpp"\nint main() { return 0; }\n',
    )
    header = _write(tmp_path, "include/local.hpp", "#pragma once\n")
    _write(tmp_path, "Makefile", "all:\n\t@echo ok\n")

    graph = build_cxx_dep_graph(tmp_path)

    assert graph
    assert str(header.resolve()) in graph[str(source.resolve())]["imports"]
