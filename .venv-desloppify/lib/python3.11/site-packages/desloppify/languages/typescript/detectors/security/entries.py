"""Shared security-entry factory for TypeScript security detectors."""

from __future__ import annotations

from desloppify.engine.detectors.security import rules as security_detector_mod


def _make_security_entry(
    filepath: str,
    line_num: int,
    line: str,
    *,
    check_id: str,
    summary: str,
    severity: str,
    confidence: str,
    remediation: str,
) -> dict[str, object]:
    return security_detector_mod.make_security_entry(
        filepath,
        line_num,
        line,
        security_detector_mod.SecurityRule(
            check_id=check_id,
            summary=summary,
            severity=severity,
            confidence=confidence,
            remediation=remediation,
        ),
    )


__all__ = ["_make_security_entry"]
