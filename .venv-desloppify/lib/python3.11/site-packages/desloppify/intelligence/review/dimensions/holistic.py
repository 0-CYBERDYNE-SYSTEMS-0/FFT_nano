"""Review dimension definitions and system prompt (single source of truth)."""

from __future__ import annotations

from desloppify.intelligence.review.dimensions.data import load_dimensions

DIMENSIONS, DIMENSION_PROMPTS, REVIEW_SYSTEM_PROMPT = load_dimensions()
