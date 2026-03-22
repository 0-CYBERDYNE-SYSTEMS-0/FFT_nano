"""Zone/path classification rules for TypeScript."""

from __future__ import annotations

from desloppify.engine.policy.zones import COMMON_ZONE_RULES, Zone, ZoneRule

TS_ZONE_RULES = [
    ZoneRule(Zone.GENERATED, [".d.ts", "/migrations/"]),
    ZoneRule(
        Zone.TEST,
        ["/__tests__/", ".test.", ".spec.", ".stories.", "/__mocks__/", "setupTests."],
    ),
    ZoneRule(
        Zone.CONFIG,
        [
            "vite.config",
            "tailwind.config",
            "postcss.config",
            "tsconfig",
            "eslint",
            "prettier",
            "jest.config",
            "vitest.config",
            "next.config",
            "webpack.config",
        ],
    ),
] + COMMON_ZONE_RULES

__all__ = ["TS_ZONE_RULES"]
