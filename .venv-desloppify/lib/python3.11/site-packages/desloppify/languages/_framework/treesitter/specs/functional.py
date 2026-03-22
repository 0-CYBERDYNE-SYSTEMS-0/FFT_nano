"""Tree-sitter specs for functional language families."""

from __future__ import annotations

from ..imports.resolvers_functional import (
    resolve_elixir_import,
    resolve_erlang_include,
    resolve_fsharp_import,
    resolve_haskell_import,
    resolve_julia_include,
    resolve_ocaml_import,
)
from ..types import TreeSitterLangSpec

ELIXIR_SPEC = TreeSitterLangSpec(
    grammar="elixir",
    function_query="""
        (call
            target: (identifier) @_kind
            (arguments
                (call
                    target: (identifier) @name))
            (do_block) @body) @func
    """,
    comment_node_types=frozenset({"comment"}),
    import_query="""
        (call
            target: (identifier) @_directive
            (arguments
                (alias) @path)) @import
    """,
    resolve_import=resolve_elixir_import,
    class_query="""
        (call
            target: (identifier) @_defmodule
            (arguments
                (alias) @name)
            (do_block) @body) @class
    """,
    log_patterns=(
        r"^\s*(?:IO\.puts|IO\.inspect|IO\.warn|Logger\.|dbg\()",
    ),
)

HASKELL_SPEC = TreeSitterLangSpec(
    grammar="haskell",
    function_query="""
        (function
            name: (variable) @name
            match: (match) @body) @func
    """,
    comment_node_types=frozenset({"comment", "haddock"}),
    import_query="""
        (import module: (module) @path) @import
    """,
    resolve_import=resolve_haskell_import,
    log_patterns=(
        r"^\s*(?:putStrLn |print |hPutStrLn |traceShow)",
    ),
)

ERLANG_SPEC = TreeSitterLangSpec(
    grammar="erlang",
    function_query="""
        (fun_decl
            (function_clause
                (atom) @name
                (clause_body) @body)) @func
    """,
    comment_node_types=frozenset({"comment"}),
    import_query="""
        (pp_include (string) @path) @import
    """,
    resolve_import=resolve_erlang_include,
    log_patterns=(
        r"^\s*(?:io:format|error_logger:)",
    ),
)

OCAML_SPEC = TreeSitterLangSpec(
    grammar="ocaml",
    function_query="""
        (value_definition
            (let_binding
                (value_name) @name)) @func
    """,
    comment_node_types=frozenset({"comment"}),
    import_query="""
        (open_module (module_path) @path) @import
    """,
    resolve_import=resolve_ocaml_import,
    class_query="""
        (module_definition
            (module_binding
                (module_name) @name)) @class
    """,
    log_patterns=(
        r"^\s*(?:Printf\.printf|print_endline|print_string|Format\.printf)",
    ),
)

FSHARP_SPEC = TreeSitterLangSpec(
    grammar="fsharp",
    function_query="""
        (function_or_value_defn
            (function_declaration_left
                (identifier) @name)) @func
    """,
    comment_node_types=frozenset({"comment", "block_comment"}),
    import_query="""
        (import_decl (long_identifier) @path) @import
    """,
    resolve_import=resolve_fsharp_import,
    log_patterns=(
        r"^\s*(?:printfn |printf |eprintfn )",
    ),
)

JULIA_SPEC = TreeSitterLangSpec(
    grammar="julia",
    function_query="""
        (function_definition
            (signature
                (call_expression
                    (identifier) @name))
            (block) @body) @func
    """,
    comment_node_types=frozenset({"comment", "block_comment"}),
    import_query="""
        (call_expression
            (identifier) @_fn
            (#eq? @_fn "include")
            (argument_list
                (string_literal) @path)) @import
    """,
    resolve_import=resolve_julia_include,
    class_query="""
        (struct_definition
            (type_head (identifier) @name)
            (block) @body) @class
    """,
    log_patterns=(
        r"^\s*(?:println\(|print\(|@info |@warn |@error |@debug )",
    ),
)

CLOJURE_SPEC = TreeSitterLangSpec(
    grammar="clojure",
    function_query="""
        (list_lit
            (sym_lit) @_keyword
            (sym_lit) @name) @func
    """,
    comment_node_types=frozenset({"comment"}),
    log_patterns=(
        r"^\s*\(println ",
    ),
)
