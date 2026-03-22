"""Tests for Python uncalled-function detector."""

from __future__ import annotations

from pathlib import Path

from desloppify.languages.python.detectors.deps import build_dep_graph
from desloppify.languages.python.detectors.uncalled import detect_uncalled_functions


def _graph_entry(*, imports: set[str] | None = None) -> dict:
    return {
        "imports": imports or set(),
        "importers": set(),
        "importer_count": 0,
        "import_count": 0,
    }


def _write(path: Path, content: str) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return str(path)


def test_detects_uncalled_private_function(tmp_path: Path):
    """A _private function with zero callers should be detected."""
    f = _write(
        tmp_path / "module.py",
        """\
def public():
    pass

def _dead_function():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, total = detect_uncalled_functions(tmp_path, graph)

    assert len(entries) == 1
    assert entries[0]["name"] == "_dead_function"
    assert entries[0]["loc"] >= 4


def test_called_within_same_file_not_detected(tmp_path: Path):
    """A _private function called within the same file should NOT be detected."""
    f = _write(
        tmp_path / "module.py",
        """\
def _helper():
    x = 1
    y = 2
    z = 3
    return x + y + z

def main():
    return _helper()
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_imported_by_another_file_not_detected(tmp_path: Path):
    """A _private function imported by another file should NOT be detected."""
    target = _write(
        tmp_path / "helpers.py",
        """\
def _useful_helper():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    consumer = _write(
        tmp_path / "service.py",
        """\
from helpers import _useful_helper

def run():
    return _useful_helper()
""",
    )
    graph = {
        target: _graph_entry(),
        consumer: _graph_entry(imports={target}),
    }
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_attribute_reference_not_detected(tmp_path: Path):
    """A _private function referenced via module._private_func should NOT be detected."""
    target = _write(
        tmp_path / "helpers.py",
        """\
def _internal_impl():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    consumer = _write(
        tmp_path / "service.py",
        """\
import helpers

def run():
    return helpers._internal_impl()
""",
    )
    graph = {
        target: _graph_entry(),
        consumer: _graph_entry(imports={target}),
    }
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_dunder_not_detected(tmp_path: Path):
    """__dunder__ methods should NOT be detected even with zero callers."""
    f = _write(
        tmp_path / "module.py",
        """\
def __custom_dunder__():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_public_function_not_detected(tmp_path: Path):
    """Public functions (no underscore prefix) should NOT be detected — out of scope for MVP."""
    f = _write(
        tmp_path / "module.py",
        """\
def orphan_public():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_decorated_function_not_detected(tmp_path: Path):
    """Decorated functions should NOT be detected (could be registered via framework)."""
    f = _write(
        tmp_path / "module.py",
        """\
import pytest

@pytest.fixture
def _helper():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_test_file_skipped(tmp_path: Path):
    """Functions in test files should NOT be detected."""
    f = _write(
        tmp_path / "tests" / "test_module.py",
        """\
def _test_helper():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_entry_point_file_skipped(tmp_path: Path):
    """Functions in entry-point files (cli.py, __main__.py, etc.) should NOT be detected."""
    f = _write(
        tmp_path / "cli.py",
        """\
def _setup():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_trivial_function_not_detected(tmp_path: Path):
    """Functions with body <= 3 lines should NOT be detected (too trivial to flag)."""
    f = _write(
        tmp_path / "module.py",
        """\
def _tiny():
    return 42
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_method_inside_class_not_detected(tmp_path: Path):
    """Methods inside classes should NOT be detected (top-level only)."""
    f = _write(
        tmp_path / "module.py",
        """\
class MyClass:
    def _private_method(self):
        x = 1
        y = 2
        z = 3
        return x + y + z
""",
    )
    graph = {f: _graph_entry()}
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_multiple_files_cross_reference(tmp_path: Path):
    """A dead _private in file A should be detected even when file B has its own _privates."""
    file_a = _write(
        tmp_path / "a.py",
        """\
def _dead_in_a():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    file_b = _write(
        tmp_path / "b.py",
        """\
def _alive_in_b():
    x = 1
    y = 2
    z = 3
    return x + y + z

def caller():
    return _alive_in_b()
""",
    )
    graph = {
        file_a: _graph_entry(),
        file_b: _graph_entry(),
    }
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert len(entries) == 1
    assert entries[0]["name"] == "_dead_in_a"


def test_reexported_via_alias_not_detected(tmp_path: Path):
    """A _private function re-exported via `from mod import _foo as foo` should NOT be detected."""
    impl = _write(
        tmp_path / "internal.py",
        """\
def _real_implementation():
    x = 1
    y = 2
    z = 3
    return x + y + z
""",
    )
    barrel = _write(
        tmp_path / "__init__.py",
        """\
from internal import _real_implementation as real_implementation
""",
    )
    graph = {
        impl: _graph_entry(),
        barrel: _graph_entry(imports={impl}),
    }
    entries, _ = detect_uncalled_functions(tmp_path, graph)

    assert entries == []


def test_self_scan_no_false_positives():
    """Run detector on the desloppify codebase — known-used functions must not appear."""
    scan_root = Path(__file__).resolve().parents[3]  # desloppify/
    graph = build_dep_graph(scan_root)
    entries, _ = detect_uncalled_functions(scan_root, graph)

    flagged_names = {e["name"] for e in entries}

    # Known-used private functions that must NOT be flagged
    known_used = {
        # Called within file_discovery.py
        "_safe_relpath",
        "_is_excluded_dir",
        "_find_source_files_cached",
        # Re-exported via smells_ast/__init__.py alias
        "collect_module_constants",
        "detect_star_import_no_all",
    }
    false_positives = flagged_names & known_used
    assert not false_positives, f"False positives on known-used functions: {false_positives}"
