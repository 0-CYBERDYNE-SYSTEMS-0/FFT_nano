"""Import-statement rewriting helpers for TypeScript fixers."""

from __future__ import annotations

import re


def _normalize_binding_name(token: str) -> str:
    normalized = token.strip().rstrip(",")
    if normalized.startswith("type "):
        normalized = normalized[len("type "):].strip()
    return normalized


def _binding_symbol_names(binding: str) -> set[str]:
    binding = binding.strip().rstrip(",")
    if not binding:
        return set()
    parts = re.split(r"\s+as\s+", binding, maxsplit=1)
    names = {_normalize_binding_name(parts[0])}
    if len(parts) == 2:
        names.add(_normalize_binding_name(parts[1]))
    return {name for name in names if name and name != "*"}


def remove_symbols_from_import_stmt(
    import_stmt: str,
    symbols_to_remove: set[str],
) -> tuple[str | None, set[str]]:
    """Remove specific symbols from an import statement."""
    stmt = import_stmt.strip()
    from_match = re.search(
        r"""from\s+(?P<module>['"][^'"]+['"])(?P<attrs>\s+(?:assert|with)\s*\{.*?\})?\s*;?(?P<trailing>\s*(?://.*|/\*.*?\*/\s*)?)$""",
        stmt,
        re.DOTALL,
    )
    if not from_match:
        return import_stmt, set()

    module_part = from_match.group("module")
    attrs = from_match.group("attrs") or ""
    trailing = (from_match.group("trailing") or "").strip()
    from_clause = f"from {module_part}{attrs};"
    if trailing:
        from_clause += f" {trailing}"
    before_from = stmt[:from_match.start()].strip()

    type_prefix = ""
    if before_from.startswith("import type"):
        type_prefix = "type "
        before_from = before_from[len("import type"):].strip()
    elif before_from.startswith("import"):
        before_from = before_from[len("import"):].strip()
    else:
        return import_stmt, set()

    default_import = None
    namespace_import = None
    named_imports = []
    brace_match = re.search(r"\{([^}]*)\}", before_from, re.DOTALL)
    if brace_match:
        named_str = brace_match.group(1)
        named_imports = [name.strip() for name in named_str.split(",") if name.strip()]
        before_brace = before_from[:brace_match.start()].strip().rstrip(",").strip()
        if before_brace:
            default_import = before_brace
    else:
        bare_import = before_from.strip().rstrip(",").strip()
        if "," in bare_import:
            first, second = [part.strip() for part in bare_import.split(",", 1)]
            default_import = first or None
            namespace_import = second or None
        elif bare_import.startswith("* as "):
            namespace_import = bare_import
        else:
            default_import = bare_import or None

    removed_symbols: set[str] = set()

    default_names = _binding_symbol_names(default_import or "")
    remove_default = bool(default_names & symbols_to_remove)
    if remove_default:
        removed_symbols.update(default_names & symbols_to_remove)

    namespace_names = _binding_symbol_names(namespace_import or "")
    remove_namespace = bool(namespace_names & symbols_to_remove)
    if remove_namespace:
        removed_symbols.update(namespace_names & symbols_to_remove)

    remaining_named = []
    for named in named_imports:
        named_names = _binding_symbol_names(named)
        matched = named_names & symbols_to_remove
        if matched:
            removed_symbols.update(matched)
            continue
        remaining_named.append(named)

    if not removed_symbols:
        return import_stmt, set()

    new_default = None if remove_default else default_import
    new_namespace = None if remove_namespace else namespace_import
    if not new_default and not new_namespace and not remaining_named:
        return None, removed_symbols

    parts = []
    if new_default:
        parts.append(new_default)
    if new_namespace:
        parts.append(new_namespace)
    if remaining_named:
        if len(remaining_named) <= 3:
            parts.append("{ " + ", ".join(remaining_named) + " }")
        else:
            inner = ",\n  ".join(remaining_named)
            parts.append("{\n  " + inner + "\n}")

    indent = ""
    for ch in import_stmt:
        if ch in " \t":
            indent += ch
        else:
            break
    return f"{indent}import {type_prefix}{', '.join(parts)} {from_clause}\n", removed_symbols


def process_unused_import_lines(
    lines: list[str],
    unused_symbols: set[str],
    unused_by_line: dict[int, list[str]],
) -> tuple[list[str], set[str]]:
    """Process TS lines and remove/import-trim unused import statements."""
    result: list[str] = []
    removed_symbols: set[str] = set()
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip().startswith("import "):
            result.append(line)
            index += 1
            continue

        next_idx, replacement = _process_import_statement(
            lines=lines,
            start=index,
            unused_symbols=unused_symbols,
            unused_by_line=unused_by_line,
            prior_output=result,
        )
        if replacement.removed_symbols:
            removed_symbols.update(replacement.removed_symbols)
        if replacement:
            result.extend(replacement.lines)
        index = next_idx
    return result, removed_symbols


class _ImportReplacement:
    """Container for optional import replacement lines and removed symbols."""

    def __init__(self, lines: list[str], removed_symbols: set[str] | None = None):
        self.lines = lines
        self.removed_symbols = removed_symbols or set()

    def __bool__(self):
        return bool(self.lines)


def _process_import_statement(
    *,
    lines: list[str],
    start: int,
    unused_symbols: set[str],
    unused_by_line: dict[int, list[str]],
    prior_output: list[str],
) -> tuple[int, _ImportReplacement]:
    import_lines, import_end = _collect_import_statement(lines, start)
    line_start = start + 1
    line_range = range(line_start, line_start + len(import_lines))
    if _should_remove_entire_import(unused_symbols, unused_by_line, line_range):
        return _advance_after_removed_import(lines, import_end, prior_output), _ImportReplacement(
            [],
            {"(entire import)"},
        )

    symbols_on_import = _symbols_for_line_range(unused_by_line, line_range)
    if not symbols_on_import:
        return import_end + 1, _ImportReplacement(import_lines)

    cleaned, removed = remove_symbols_from_import_stmt("".join(import_lines), symbols_on_import)
    if cleaned is None:
        return _advance_after_removed_import(lines, import_end, prior_output), _ImportReplacement(
            [],
            removed,
        )
    if not removed:
        return import_end + 1, _ImportReplacement(import_lines)
    return import_end + 1, _ImportReplacement([cleaned], removed)


def _collect_import_statement(lines: list[str], start: int) -> tuple[list[str], int]:
    import_lines = [lines[start]]
    idx = start
    while not _is_import_complete("".join(import_lines)):
        idx += 1
        if idx >= len(lines):
            break
        import_lines.append(lines[idx])
    return import_lines, idx


def _should_remove_entire_import(
    unused_symbols: set[str],
    unused_by_line: dict[int, list[str]],
    line_range: range,
) -> bool:
    if "(entire import)" not in unused_symbols:
        return False
    return any("(entire import)" in unused_by_line.get(line_no, []) for line_no in line_range)


def _symbols_for_line_range(unused_by_line: dict[int, list[str]], line_range: range) -> set[str]:
    symbols: set[str] = set()
    for line_no in line_range:
        for symbol in unused_by_line.get(line_no, []):
            if symbol != "(entire import)":
                symbols.add(symbol)
    return symbols


def _advance_after_removed_import(lines: list[str], import_end: int, prior_output: list[str]) -> int:
    next_idx = import_end + 1
    if next_idx < len(lines) and lines[next_idx].strip() == "" and prior_output and prior_output[-1].strip() == "":
        next_idx += 1
    return next_idx


def _is_import_complete(text: str) -> bool:
    stripped = text.strip()
    if stripped.endswith(";"):
        return True
    if "from " not in stripped:
        return False
    trailing = stripped.split("from ", 1)[-1].strip()
    if (trailing.startswith("'") and trailing.count("'") >= 2) or (
        trailing.startswith('"') and trailing.count('"') >= 2
    ):
        return True
    return False


__all__ = [
    "_collect_import_statement",
    "process_unused_import_lines",
    "remove_symbols_from_import_stmt",
]
