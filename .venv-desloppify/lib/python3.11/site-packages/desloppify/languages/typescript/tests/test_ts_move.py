"""Tests for TypeScript move helpers."""

from __future__ import annotations

import desloppify.languages.typescript.move as ts_move


def test_move_ts_module_imports():
    assert callable(ts_move.find_replacements)
    assert callable(ts_move.find_self_replacements)


class TestMoveTsHelpers:
    def test_strip_ts_ext(self):
        assert ts_move._strip_ts_ext("foo.ts") == "foo"
        assert ts_move._strip_ts_ext("foo.tsx") == "foo"
        assert ts_move._strip_ts_ext("foo.js") == "foo"
        assert ts_move._strip_ts_ext("foo.jsx") == "foo"
        assert ts_move._strip_ts_ext("foo") == "foo"
        assert ts_move._strip_ts_ext("foo.css") == "foo.css"

    def test_compute_ts_specifiers_relative(self):
        alias, relative = ts_move._compute_ts_specifiers(
            "/project/src/a.ts", "/project/src/b.ts"
        )
        assert relative == "./b"
        assert alias is None

    def test_compute_ts_specifiers_parent(self):
        alias, relative = ts_move._compute_ts_specifiers(
            "/project/src/sub/a.ts", "/project/src/b.ts"
        )
        assert relative == "../b"
        assert alias is None

    def test_strip_index_from_relative(self):
        alias, relative = ts_move._compute_ts_specifiers(
            "/project/src/a.ts",
            "/project/src/utils/index.ts",
        )
        assert relative == "./utils"
        assert not relative.endswith("/index")
        assert alias is None
