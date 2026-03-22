"""Zone/path classification rules for Python."""

from __future__ import annotations

from desloppify.engine.policy.zones import COMMON_ZONE_RULES, Zone, ZoneRule

PY_ZONE_RULES = [
    ZoneRule(Zone.GENERATED, ["/migrations/", "_pb2.py", "_pb2_grpc.py"]),
    ZoneRule(Zone.TEST, ["test_", "_test.py", "conftest.py", "/factories/"]),
    ZoneRule(
        Zone.CONFIG,
        [
            "setup.py",
            "setup.cfg",
            "pyproject.toml",
            "manage.py",
            "wsgi.py",
            "asgi.py",
            "settings.py",
            "config.py",
        ],
    ),
    ZoneRule(Zone.SCRIPT, ["__main__.py", "/commands/"]),
] + COMMON_ZONE_RULES

__all__ = ["PY_ZONE_RULES"]
