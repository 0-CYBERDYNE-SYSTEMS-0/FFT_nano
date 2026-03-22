"""Regex patterns for TypeScript security detectors."""

from __future__ import annotations

import re

from desloppify.base.signal_patterns import AUTH_GUARD_TOKEN_RE

_CREATE_CLIENT_RE = re.compile(r"\bcreateClient\s*\(", re.IGNORECASE)
_EVAL_PATTERNS = re.compile(r"\b(?:eval|new\s+Function)\s*\(")
_DANGEROUS_HTML_RE = re.compile(r"dangerouslySetInnerHTML")
_INNER_HTML_RE = re.compile(r"\.innerHTML\s*=")
_DEV_CRED_RE = re.compile(r"VITE_\w*(?:PASSWORD|SECRET|TOKEN|API_KEY|APIKEY)\b", re.IGNORECASE)
_OPEN_REDIRECT_RE = re.compile(
    r"window\.location(?:\.href)?\s*=\s*(?:data\.|response\.|params\.|query\.|\w+\[)"
)
_JSON_PARSE_RE = re.compile(r"JSON\.parse\s*\(")
_JSON_DEEP_CLONE_RE = re.compile(r"JSON\.parse\s*\(\s*JSON\.stringify\s*\(")
_SERVE_ASYNC_RE = re.compile(r"\b(?:Deno\.)?serve\s*\(\s*(?:async\s*)?")
_EDGE_ENTRYPOINT_RE = re.compile(
    r"\bexport\s+(?:default\s+)?(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b"
)
_AUTH_CHECK_RE = AUTH_GUARD_TOKEN_RE
_ATOB_JWT_RE = re.compile(r"atob\s*\(")
_JWT_PAYLOAD_RE = re.compile(r"(?:payload\.sub|\.split\s*\(\s*['\"]\\?\.['\"])")
_CREATE_VIEW_RE = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b", re.IGNORECASE)
_SECURITY_INVOKER_RE = re.compile(r"security_invoker\s*=\s*true", re.IGNORECASE)


__all__ = [
    "_ATOB_JWT_RE",
    "_AUTH_CHECK_RE",
    "_CREATE_CLIENT_RE",
    "_CREATE_VIEW_RE",
    "_DANGEROUS_HTML_RE",
    "_DEV_CRED_RE",
    "_EDGE_ENTRYPOINT_RE",
    "_EVAL_PATTERNS",
    "_INNER_HTML_RE",
    "_JSON_DEEP_CLONE_RE",
    "_JSON_PARSE_RE",
    "_JWT_PAYLOAD_RE",
    "_OPEN_REDIRECT_RE",
    "_SECURITY_INVOKER_RE",
    "_SERVE_ASYNC_RE",
]
