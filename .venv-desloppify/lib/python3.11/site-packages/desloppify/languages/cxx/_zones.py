"""Zone rules and entry patterns for C/C++."""

from __future__ import annotations

from desloppify.engine.policy.zones import COMMON_ZONE_RULES, Zone, ZoneRule

CXX_ENTRY_PATTERNS = [
    "/main.c",
    "/main.cc",
    "/main.cpp",
    "/main.cxx",
]

CXX_ZONE_RULES = [
    ZoneRule(
        Zone.TEST,
        [
            "/tests/",
            "/test/",
            "_test.c",
            "_test.cc",
            "_test.cpp",
            "_test.cxx",
        ],
    ),
    ZoneRule(Zone.CONFIG, ["CMakeLists.txt", "Makefile"]),
    ZoneRule(
        Zone.GENERATED,
        [
            "/cmake-build-debug/",
            "/cmake-build-release/",
            "/build/",
        ],
    ),
] + COMMON_ZONE_RULES
