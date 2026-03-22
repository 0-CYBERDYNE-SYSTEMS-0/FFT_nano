"""Tests for C# dependency CLI formatting helpers (deps/cli.py)."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from desloppify.languages.csharp.deps.cli import render_cycles_cli, render_deps_cli

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_args(path="/fake/project", file=None, json_flag=False, top=20, **extra):
    """Build a SimpleNamespace that looks like argparse output."""
    ns = SimpleNamespace(path=path, top=top, **extra)
    if file is not None:
        ns.file = file
    if json_flag:
        ns.json = True
    return ns


def _stub_graph_builder(graph):
    """Return a build_dep_graph stand-in that always returns *graph*."""
    def build(path, *, roslyn_cmd=None):
        return graph
    return build


def _stub_roslyn_resolver(value=None):
    """Return a resolve_roslyn_cmd stand-in."""
    return lambda args: value


# ---------------------------------------------------------------------------
# render_deps_cli — single-file mode
# ---------------------------------------------------------------------------

def test_cmd_deps_single_file_text_output(capsys, monkeypatch):
    """When --file is given, display fan-in / fan-out / instability for that file."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: "Services/Greeter.cs",
    )
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.get_coupling_score",
        lambda filepath, graph: {"fan_in": 3, "fan_out": 1, "instability": 0.25},
    )

    graph = {}
    args = _make_args(file="Services/Greeter.cs")
    render_deps_cli(
        args,
        build_dep_graph=_stub_graph_builder(graph),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    assert "Fan-in" in out
    assert "3" in out
    assert "Fan-out" in out
    assert "1" in out
    assert "0.25" in out


def test_cmd_deps_single_file_json_output(capsys, monkeypatch):
    """When --file and --json are given, output is valid JSON with coupling data."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: "Program.cs",
    )
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.get_coupling_score",
        lambda filepath, graph: {"fan_in": 0, "fan_out": 5, "instability": 1.0},
    )

    graph = {}
    args = _make_args(file="Program.cs", json_flag=True)
    render_deps_cli(
        args,
        build_dep_graph=_stub_graph_builder(graph),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload["file"] == "Program.cs"
    assert payload["fan_in"] == 0
    assert payload["fan_out"] == 5
    assert payload["instability"] == 1.0


# ---------------------------------------------------------------------------
# render_deps_cli — overview (no --file)
# ---------------------------------------------------------------------------

def test_cmd_deps_overview_text_output(capsys, monkeypatch):
    """Without --file, show a table of top files sorted by importer count."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )

    graph = {
        "/fake/A.cs": {"importer_count": 5, "import_count": 1},
        "/fake/B.cs": {"importer_count": 2, "import_count": 3},
        "/fake/C.cs": {"importer_count": 0, "import_count": 0},
    }
    args = _make_args()
    render_deps_cli(
        args,
        build_dep_graph=_stub_graph_builder(graph),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    assert "3 files" in out
    # A.cs should appear before B.cs (sorted by descending importer_count)
    pos_a = out.index("A.cs")
    pos_b = out.index("B.cs")
    assert pos_a < pos_b


def test_cmd_deps_overview_json_output(capsys, monkeypatch):
    """Without --file, --json produces valid JSON with correct entry structure."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )

    graph = {
        "/fake/A.cs": {"importer_count": 5, "import_count": 1},
        "/fake/B.cs": {"importer_count": 2, "import_count": 3},
    }
    args = _make_args(json_flag=True)
    render_deps_cli(
        args,
        build_dep_graph=_stub_graph_builder(graph),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload["files"] == 2
    assert len(payload["entries"]) == 2
    # First entry should be A.cs (highest importer_count)
    assert payload["entries"][0]["file"] == "A.cs"
    assert payload["entries"][0]["importers"] == 5
    assert payload["entries"][0]["imports"] == 1


def test_cmd_deps_overview_respects_top_limit(capsys, monkeypatch):
    """The --top flag limits how many entries appear in JSON output."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )

    graph = {
        f"/fake/{i}.cs": {"importer_count": 10 - i, "import_count": i}
        for i in range(10)
    }
    args = _make_args(json_flag=True, top=3)
    render_deps_cli(
        args,
        build_dep_graph=_stub_graph_builder(graph),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    payload = json.loads(capsys.readouterr().out)
    assert len(payload["entries"]) == 3


def test_cmd_deps_overview_empty_graph(capsys, monkeypatch):
    """An empty graph prints the header but no table rows."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p,
    )

    args = _make_args()
    render_deps_cli(
        args,
        build_dep_graph=_stub_graph_builder({}),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    assert "0 files" in out


# ---------------------------------------------------------------------------
# render_cycles_cli
# ---------------------------------------------------------------------------

def test_cmd_cycles_no_cycles_text(capsys, monkeypatch):
    """When there are no cycles, print a green message."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.detect_cycles",
        lambda graph: ([], 0),
    )

    args = _make_args()
    render_cycles_cli(
        args,
        build_dep_graph=_stub_graph_builder({}),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    assert "No import cycles" in out


def test_cmd_cycles_with_cycles_text(capsys, monkeypatch):
    """Cycles are printed with file count and file names."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.detect_cycles",
        lambda graph: (
            [{"length": 3, "files": ["/fake/A.cs", "/fake/B.cs", "/fake/C.cs"]}],
            3,
        ),
    )

    args = _make_args()
    render_cycles_cli(
        args,
        build_dep_graph=_stub_graph_builder({}),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    assert "1" in out  # count
    assert "[3 files]" in out
    assert "A.cs" in out
    assert "B.cs" in out
    assert "C.cs" in out


def test_cmd_cycles_json_output(capsys, monkeypatch):
    """--json produces valid JSON with cycle entries."""
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.detect_cycles",
        lambda graph: (
            [
                {"length": 2, "files": ["/fake/A.cs", "/fake/B.cs"]},
                {"length": 3, "files": ["/fake/C.cs", "/fake/D.cs", "/fake/E.cs"]},
            ],
            5,
        ),
    )

    args = _make_args(json_flag=True)
    render_cycles_cli(
        args,
        build_dep_graph=_stub_graph_builder({}),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    payload = json.loads(capsys.readouterr().out)
    assert payload["count"] == 2
    assert len(payload["cycles"]) == 2
    assert payload["cycles"][0]["length"] == 2
    assert payload["cycles"][0]["files"] == ["A.cs", "B.cs"]


def test_cmd_cycles_truncates_long_cycles(capsys, monkeypatch):
    """Cycles with more than 6 files get truncated with a '+N' suffix."""
    long_files = [f"/fake/{chr(65 + i)}.cs" for i in range(10)]
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.detect_cycles",
        lambda graph: (
            [{"length": 10, "files": long_files}],
            10,
        ),
    )

    args = _make_args()
    render_cycles_cli(
        args,
        build_dep_graph=_stub_graph_builder({}),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    assert "[10 files]" in out
    assert "+4" in out  # 10 - 6 = 4 extra files


def test_cmd_cycles_respects_top_limit(capsys, monkeypatch):
    """The --top flag limits how many cycles appear in text output."""
    cycles = [
        {"length": 2, "files": [f"/fake/{i}a.cs", f"/fake/{i}b.cs"]}
        for i in range(10)
    ]
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.rel",
        lambda p: p.split("/")[-1],
    )
    monkeypatch.setattr(
        "desloppify.languages.csharp.deps.cli.detect_cycles",
        lambda graph: (cycles, 20),
    )

    args = _make_args(top=3)
    render_cycles_cli(
        args,
        build_dep_graph=_stub_graph_builder({}),
        resolve_roslyn_cmd=_stub_roslyn_resolver(),
    )

    out = capsys.readouterr().out
    # Only first 3 cycles printed; the remaining 7 should not appear
    assert "Import cycles: 10" in out
    count = out.count("[2 files]")
    assert count == 3


# ---------------------------------------------------------------------------
# render_deps_cli / render_cycles_cli — graph builder delegation
# ---------------------------------------------------------------------------

def test_cmd_deps_passes_path_and_roslyn_to_builder():
    """render_deps_cli delegates to build_dep_graph with the right path and roslyn_cmd."""
    captured = {}

    def fake_build(path, *, roslyn_cmd=None):
        captured["path"] = path
        captured["roslyn_cmd"] = roslyn_cmd
        return {}

    args = _make_args(path="/my/project")
    render_deps_cli(
        args,
        build_dep_graph=fake_build,
        resolve_roslyn_cmd=lambda a: "my-roslyn",
    )

    assert captured["path"] == Path("/my/project")
    assert captured["roslyn_cmd"] == "my-roslyn"
