"""Shared pytest fixtures for desloppify test suite."""

from __future__ import annotations

from pathlib import Path

import pytest

from desloppify.base.runtime_state import RuntimeContext, runtime_scope
from desloppify.base.discovery.source import clear_source_file_cache_for_tests


@pytest.fixture()
def set_project_root(tmp_path: Path):
    """Set PROJECT_ROOT to tmp_path via RuntimeContext for the duration of a test."""
    ctx = RuntimeContext(project_root=tmp_path)
    with runtime_scope(ctx):
        clear_source_file_cache_for_tests()
        yield tmp_path
        clear_source_file_cache_for_tests()
