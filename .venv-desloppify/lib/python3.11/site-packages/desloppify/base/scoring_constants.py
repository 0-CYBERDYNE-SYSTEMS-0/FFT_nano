"""Scoring constants shared across core and engine layers."""

from __future__ import annotations

from desloppify.base.enums import Confidence

CONFIDENCE_WEIGHTS = {Confidence.HIGH: 1.0, Confidence.MEDIUM: 0.7, Confidence.LOW: 0.3}

# Holistic review weight: issues with file="." and detail.holistic=True
# get a 10x weight multiplier for display/priority purposes (issues list,
# remediation engine).  NOT used in score computation -- review issues are
# excluded from the detection scoring pipeline (scored via assessments only).
HOLISTIC_MULTIPLIER = 10.0

__all__ = [
    "CONFIDENCE_WEIGHTS",
    "HOLISTIC_MULTIPLIER",
]
