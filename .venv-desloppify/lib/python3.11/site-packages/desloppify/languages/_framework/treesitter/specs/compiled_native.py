"""Native compiled-language tree-sitter specs."""

from __future__ import annotations

from ..imports.resolvers_backend import resolve_cxx_include, resolve_scala_import
from ..types import TreeSitterLangSpec


C_SPEC = TreeSitterLangSpec(
    grammar="c",
    function_query="""
        (function_definition
            declarator: (function_declarator
                declarator: (identifier) @name)
            body: (compound_statement) @body) @func
    """,
    comment_node_types=frozenset({"comment"}),
    import_query="""
        (preproc_include
            path: (string_literal) @path) @import
    """,
    resolve_import=resolve_cxx_include,
    class_query="""
        (struct_specifier
            name: (type_identifier) @name
            body: (field_declaration_list) @body) @class
    """,
    log_patterns=(
        r"^\s*(?:printf\(|fprintf\(|perror\()",
    ),
)

CPP_SPEC = TreeSitterLangSpec(
    grammar="cpp",
    function_query="""
        (function_definition
            declarator: (function_declarator
                declarator: (identifier) @name)
            body: (compound_statement) @body) @func
        (function_definition
            declarator: (function_declarator
                declarator: (qualified_identifier) @name)
            body: (compound_statement) @body) @func
    """,
    comment_node_types=frozenset({"comment"}),
    import_query="""
        (preproc_include
            path: (string_literal) @path) @import
    """,
    resolve_import=resolve_cxx_include,
    class_query="""
        (class_specifier
            name: (type_identifier) @name
            body: (field_declaration_list) @body) @class
        (struct_specifier
            name: (type_identifier) @name
            body: (field_declaration_list) @body) @class
    """,
    log_patterns=(
        r"^\s*(?:std::cout|std::cerr|printf\(|fprintf\()",
    ),
)

SCALA_SPEC = TreeSitterLangSpec(
    grammar="scala",
    function_query="""
        (function_definition
            name: (identifier) @name
            body: (_) @body) @func
    """,
    comment_node_types=frozenset({"comment", "block_comment"}),
    import_query="""
        (import_declaration
            path: (identifier) @path) @import
    """,
    resolve_import=resolve_scala_import,
    class_query="""
        (class_definition
            name: (identifier) @name
            body: (template_body) @body) @class
        (object_definition
            name: (identifier) @name
            body: (template_body) @body) @class
        (trait_definition
            name: (identifier) @name
            body: (template_body) @body) @class
    """,
    log_patterns=(
        r"^\s*(?:println\(|print\(|Logger\.|log\.)",
    ),
)


__all__ = ["C_SPEC", "CPP_SPEC", "SCALA_SPEC"]
