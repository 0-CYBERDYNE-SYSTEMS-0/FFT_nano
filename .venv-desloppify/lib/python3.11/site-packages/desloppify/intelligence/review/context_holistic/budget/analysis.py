"""Small scoring/parsing helpers for abstractions budget context."""

from __future__ import annotations

import ast
import re


def _count_signature_params(params_blob: str) -> int:
    """Best-effort parameter counting for function signatures."""
    cleaned = params_blob.strip()
    if not cleaned:
        return 0
    parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    filtered = [part for part in parts if part not in {"self", "cls", "this"}]
    return len(filtered)

def _extract_type_names(blob: str) -> list[str]:
    """Extract candidate type names from implements/inherits blobs."""
    names: list[str] = []
    for raw in re.split(r"[,\s()]+", blob):
        token = raw.strip()
        if not token:
            continue
        token = token.split(".")[-1]
        token = token.split("<")[0]
        token = token.strip(":")
        if not token or not re.match(r"^[A-Za-z_]\w*$", token):
            continue
        names.append(token)
    return names

def _score_clamped(raw: float) -> int:
    """Clamp score-like values to [0, 100]."""
    return int(max(0, min(100, round(raw))))

def _strip_docstring(body: list[ast.stmt]) -> list[ast.stmt]:
    """Strip a leading docstring from a function/method body."""
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        return body[1:]
    return body

__all__ = [
    "_count_signature_params",
    "_extract_type_names",
    "_score_clamped",
    "_strip_docstring",
]
