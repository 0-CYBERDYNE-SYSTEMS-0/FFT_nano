"""Import resolvers for functional-leaning languages."""

from __future__ import annotations

import os
import re


def _camel_to_snake(name: str) -> str:
    """Convert CamelCase to snake_case."""
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def resolve_elixir_import(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve Elixir aliases to local files.

    Maps ``MyApp.Module.Sub`` → ``lib/my_app/module/sub.ex``.
    Handles standard Mix projects, umbrella apps (``apps/*/lib/``),
    and Phoenix ``Web`` suffix conventions.
    """
    del source_file
    parts = import_text.split(".")
    if len(parts) < 2:
        return None

    # Convert CamelCase parts to snake_case for file path.
    snake_parts = [_camel_to_snake(part) for part in parts]

    # 1. Direct path: lib/my_app/module/sub.ex
    rel_path = os.path.join(*snake_parts) + ".ex"
    candidate = os.path.join(scan_path, "lib", rel_path)
    if os.path.isfile(candidate):
        return candidate

    # 2. Without the app-level prefix: lib/my_app/module/sub.ex
    if len(snake_parts) > 1:
        rel_path = os.path.join(*snake_parts[1:]) + ".ex"
        candidate = os.path.join(scan_path, "lib", snake_parts[0], rel_path)
        if os.path.isfile(candidate):
            return candidate

    # 3. Phoenix Web convention: MyAppWeb.FooController → lib/my_app_web/controllers/foo_controller.ex
    #    (handled by the snake_case conversion above in most cases)

    # 4. Umbrella apps: apps/<app>/lib/<app>/module.ex
    apps_dir = os.path.join(scan_path, "apps")
    if os.path.isdir(apps_dir):
        # Try each umbrella app
        rel_path = os.path.join(*snake_parts) + ".ex"
        try:
            for app in os.listdir(apps_dir):
                candidate = os.path.join(apps_dir, app, "lib", rel_path)
                if os.path.isfile(candidate):
                    return candidate
                # Also try without top-level prefix inside app
                if len(snake_parts) > 1:
                    inner_rel = os.path.join(*snake_parts[1:]) + ".ex"
                    candidate = os.path.join(
                        apps_dir, app, "lib", snake_parts[0], inner_rel
                    )
                    if os.path.isfile(candidate):
                        return candidate
        except OSError:
            return None

    return None


def resolve_zig_import(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve Zig @import(\"...\") to local files."""
    del scan_path
    if not import_text:
        return None

    text = import_text.strip('"')
    if text in ("std", "builtin"):
        return None

    base = os.path.dirname(source_file)
    candidate = os.path.normpath(os.path.join(base, text))
    if os.path.isfile(candidate):
        return candidate
    if not candidate.endswith(".zig") and os.path.isfile(candidate + ".zig"):
        return candidate + ".zig"
    return None


_HASKELL_STDLIB_PREFIXES = (
    "Data.",
    "Control.",
    "System.",
    "GHC.",
    "Text.",
    "Network.",
    "Foreign.",
    "Numeric.",
    "Debug.",
)


def resolve_haskell_import(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve Haskell imports to local modules."""
    del source_file
    if not import_text:
        return None
    if any(import_text.startswith(prefix) for prefix in _HASKELL_STDLIB_PREFIXES):
        return None
    if import_text in ("Prelude", "Main"):
        return None

    rel_path = import_text.replace(".", os.sep) + ".hs"
    for base_dir in ["src", "lib", "app", "."]:
        candidate = os.path.join(scan_path, base_dir, rel_path)
        if os.path.isfile(candidate):
            return candidate
    return None


def resolve_erlang_include(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve Erlang -include(\"...\") to local files."""
    if not import_text:
        return None

    text = import_text.strip('"')
    base = os.path.dirname(source_file)
    candidate = os.path.normpath(os.path.join(base, text))
    if os.path.isfile(candidate):
        return candidate

    candidate = os.path.join(scan_path, "include", text)
    if os.path.isfile(candidate):
        return candidate

    candidate = os.path.join(scan_path, text)
    return candidate if os.path.isfile(candidate) else None


_OCAML_STDLIB_MODULES = frozenset(
    {
        "Stdlib",
        "List",
        "Array",
        "String",
        "Bytes",
        "Char",
        "Int",
        "Float",
        "Bool",
        "Unit",
        "Option",
        "Result",
        "Fun",
        "Seq",
        "Map",
        "Set",
        "Hashtbl",
        "Buffer",
        "Printf",
        "Format",
        "Scanf",
        "Sys",
        "Arg",
        "Filename",
        "Printexc",
        "Gc",
        "Lazy",
        "Stream",
        "Queue",
        "Stack",
        "Lexing",
        "Parsing",
        "Complex",
        "In_channel",
        "Out_channel",
    }
)


def resolve_ocaml_import(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve OCaml open/import module paths to local files."""
    del source_file
    if not import_text:
        return None

    top_module = import_text.split(".")[0]
    if top_module in _OCAML_STDLIB_MODULES:
        return None

    filename = import_text.split(".")[-1].lower() + ".ml"
    for base_dir in ["lib", "src", "."]:
        candidate = os.path.join(scan_path, base_dir, filename)
        if os.path.isfile(candidate):
            return candidate
    return None


def resolve_julia_include(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve Julia ``include("...")`` to local files.

    Resolves relative to the directory of the *including* file first,
    then falls back to ``src/`` and the scan root.
    """
    if not import_text:
        return None

    text = import_text.strip('"').strip("'")
    if not text.endswith(".jl"):
        return None

    # 1. Relative to the source file's directory.
    base = os.path.dirname(source_file)
    candidate = os.path.normpath(os.path.join(base, text))
    if os.path.isfile(candidate):
        return candidate

    # 2. Relative to src/.
    candidate = os.path.join(scan_path, "src", text)
    if os.path.isfile(candidate):
        return candidate

    # 3. Relative to scan root.
    candidate = os.path.join(scan_path, text)
    return candidate if os.path.isfile(candidate) else None


_FSHARP_STDLIB_PREFIXES = ("System", "Microsoft", "FSharp")


def resolve_fsharp_import(import_text: str, source_file: str, scan_path: str) -> str | None:
    """Resolve F# open/import statements to local files."""
    del source_file
    if not import_text:
        return None
    if any(import_text.startswith(prefix) for prefix in _FSHARP_STDLIB_PREFIXES):
        return None

    parts = import_text.split(".")
    if not parts:
        return None

    filename = parts[-1] + ".fs"
    for base_dir in ["src", ".", "lib"]:
        if len(parts) > 1:
            rel_path = os.path.join(*parts[:-1], filename)
            candidate = os.path.join(scan_path, base_dir, rel_path)
            if os.path.isfile(candidate):
                return candidate
        candidate = os.path.join(scan_path, base_dir, filename)
        if os.path.isfile(candidate):
            return candidate
    return None
