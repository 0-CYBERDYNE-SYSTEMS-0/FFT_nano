"""File-level TypeScript/SQL security checks."""

from __future__ import annotations

import re

from desloppify.languages.typescript.detectors.security.entries import _make_security_entry
from desloppify.languages.typescript.detectors.security.patterns import (
    _AUTH_CHECK_RE,
    _CREATE_VIEW_RE,
    _EDGE_ENTRYPOINT_RE,
    _JSON_DEEP_CLONE_RE,
    _JSON_PARSE_RE,
    _SECURITY_INVOKER_RE,
    _SERVE_ASYNC_RE,
)
from desloppify.base.signal_patterns import AUTH_LOOKUP_TOKEN_RE

_AUTH_DENIAL_RE = re.compile(
    r"\b(?:401|403|unauthori[sz]ed|forbidden)\b"
    r"|NextResponse\.redirect\b|\bredirect\s*\("
    r"|new\s+Response\s*\([^)]*status\s*:\s*(?:401|403)",
    re.IGNORECASE,
)
_NEGATED_AUTH_BRANCH_RE = re.compile(
    r"\bif\s*\(\s*!\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*\)",
    re.IGNORECASE,
)


def _file_level_security_issues(
    *,
    filepath: str,
    normalized_path: str,
    lines: list[str],
    content: str,
) -> list[dict[str, object]]:
    """Detect file-level security patterns and return issues."""
    file_issues: list[dict[str, object]] = []

    if _looks_like_edge_handler(normalized_path, content):
        if not _handler_has_auth_check(content):
            file_issues.append(
                _make_security_entry(
                    filepath,
                    1,
                    content.splitlines()[0] if lines else "",
                    check_id="edge_function_missing_auth",
                    summary="Edge function serves requests without authentication check",
                    severity="high",
                    confidence="medium",
                    remediation="Add authentication check (e.g., requireAuth, getServerSession, authenticateRequest, auth.getUser, verifyToken)",
                )
            )

    _check_json_parse_unguarded(filepath, lines, file_issues)
    if filepath.endswith(".sql"):
        _check_rls_bypass(filepath, content, lines, file_issues)
    return file_issues


def _looks_like_edge_handler(normalized_path: str, content: str) -> bool:
    """Detect edge-function style handlers without relying on index.ts naming."""
    in_edge_tree = "/functions/" in normalized_path.replace("\\", "/")
    has_edge_entrypoint = bool(
        _SERVE_ASYNC_RE.search(content) or _EDGE_ENTRYPOINT_RE.search(content)
    )
    return in_edge_tree and has_edge_entrypoint


def _extract_handler_body(content: str) -> str | None:
    """Extract body of first serve() or exported handler function."""
    match = _SERVE_ASYNC_RE.search(content) or _EDGE_ENTRYPOINT_RE.search(content)
    if not match:
        return None

    start = match.end()
    brace_pos = content.find("{", start)
    if brace_pos == -1:
        return None

    depth = 0
    for i in range(brace_pos, len(content)):
        ch = content[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return content[brace_pos : i + 1]
    return None


def _handler_has_auth_check(content: str) -> bool:
    """Check if auth patterns exist inside handler body, not just file-level."""
    handler_body = _extract_handler_body(content)
    if handler_body is None:
        return _has_auth_enforcement(content)
    return _has_auth_enforcement(handler_body)


def _has_auth_enforcement(content: str) -> bool:
    """Return True when handler code actually enforces auth, not just looks it up."""
    if _AUTH_CHECK_RE.search(content):
        return True
    return bool(
        AUTH_LOOKUP_TOKEN_RE.search(content)
        and _NEGATED_AUTH_BRANCH_RE.search(content)
        and _AUTH_DENIAL_RE.search(content)
    )


def _is_in_try_scope(lines: list[str], target_line: int) -> bool:
    """Check if target_line (1-indexed) is inside a try block by scanning backwards."""
    depth = 0
    for i in range(target_line - 2, -1, -1):
        stripped = lines[i].strip()
        if re.match(r"(?:async\s+)?function\b", stripped):
            return False
        depth += stripped.count("}") - stripped.count("{")
        if depth <= 0 and re.search(r"\btry\b", stripped):
            return True
    return False


def _check_json_parse_unguarded(
    filepath: str,
    lines: list[str],
    entries: list[dict[str, object]],
) -> None:
    """Check for JSON.parse not inside a try block."""
    for line_num, line in enumerate(lines, 1):
        if not _JSON_PARSE_RE.search(line):
            continue
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        if _JSON_DEEP_CLONE_RE.search(line):
            continue
        if _is_in_try_scope(lines, line_num):
            continue
        entries.append(
            _make_security_entry(
                filepath,
                line_num,
                line,
                check_id="json_parse_unguarded",
                summary="JSON.parse() without try/catch - may throw on malformed input",
                severity="low",
                confidence="low",
                remediation="Wrap JSON.parse() in a try/catch block",
            )
        )


def _check_rls_bypass(
    filepath: str,
    content: str,
    lines: list[str],
    entries: list[dict[str, object]],
) -> None:
    """Check for CREATE VIEW without security_invoker in SQL files."""
    for match in _CREATE_VIEW_RE.finditer(content):
        line_num = content[: match.start()].count("\n") + 1
        view_block = content[match.start() : match.start() + 500]
        if _SECURITY_INVOKER_RE.search(view_block):
            continue
        entries.append(
            _make_security_entry(
                filepath,
                line_num,
                lines[line_num - 1] if 0 < line_num <= len(lines) else "",
                check_id="rls_bypass_views",
                summary="SQL VIEW without security_invoker=true may bypass RLS",
                severity="high",
                confidence="medium",
                remediation="Add 'WITH (security_invoker = true)' to the view definition",
            )
        )


__all__ = [
    "_check_json_parse_unguarded",
    "_check_rls_bypass",
    "_extract_handler_body",
    "_file_level_security_issues",
    "_handler_has_auth_check",
    "_is_in_try_scope",
    "_looks_like_edge_handler",
]
