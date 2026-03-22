"""Catalog metadata for Rust smell checks."""

from __future__ import annotations

RUST_SMELL_CHECKS = [
    {
        "id": "undocumented_unsafe",
        "label": "Unsafe block or impl without nearby rationale",
        "pattern": None,
        "severity": "high",
    },
    {
        "id": "static_mut",
        "label": "Mutable static item",
        "pattern": r"(?m)^\s*(?:pub\s+)?static\s+mut\s+",
        "severity": "high",
    },
    {
        "id": "result_unit_err",
        "label": "Result with unit error type",
        "pattern": r"\bResult\s*<[^>\n]*,\s*\(\s*\)\s*>",
        "severity": "medium",
    },
    {
        "id": "string_error",
        "label": "Result with String error type",
        "pattern": r"\bResult\s*<[^>\n]*,\s*(?:String|&'static\s+str)\s*>",
        "severity": "medium",
    },
    {
        "id": "pub_use_glob",
        "label": "Public glob re-export",
        "pattern": r"(?m)^\s*pub\s+use\s+[^;]*::\*\s*;",
        "severity": "medium",
    },
    {
        "id": "todo_macro",
        "label": "todo! macro left in code",
        "pattern": r"\btodo!\s*\(",
        "severity": "medium",
    },
    {
        "id": "unimplemented_macro",
        "label": "unimplemented! macro left in code",
        "pattern": r"\bunimplemented!\s*\(",
        "severity": "medium",
    },
    {
        "id": "mem_forget",
        "label": "mem::forget used",
        "pattern": r"\b(?:std::mem|core::mem|mem)::forget\s*\(",
        "severity": "medium",
    },
    {
        "id": "box_leak",
        "label": "Box::leak used",
        "pattern": r"\bBox::leak\s*\(",
        "severity": "medium",
    },
    {
        "id": "process_exit",
        "label": "Process termination via std::process::exit",
        "pattern": r"\b(?:std::process|process)::exit\s*\(",
        "severity": "medium",
    },
    {
        "id": "allow_attr",
        "label": "Allow attribute in production code",
        "pattern": None,
        "severity": "low",
    },
    {
        "id": "dbg_macro",
        "label": "dbg! macro left in code",
        "pattern": r"\bdbg!\s*\(",
        "severity": "low",
    },
    {
        "id": "thread_sleep",
        "label": "Blocking thread::sleep call",
        "pattern": r"\b(?:std::thread|thread)::sleep\s*\(",
        "severity": "low",
    },
]

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}

__all__ = ["RUST_SMELL_CHECKS", "SEVERITY_ORDER"]
