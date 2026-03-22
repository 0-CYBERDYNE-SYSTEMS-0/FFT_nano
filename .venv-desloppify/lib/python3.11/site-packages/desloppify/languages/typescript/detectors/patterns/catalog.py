"""Pattern family catalog for TypeScript pattern consistency analysis."""

from __future__ import annotations

PATTERN_FAMILIES = {
    "tool_settings": {
        "type": "competing",
        "description": "Tool settings persistence (auto-save vs interact-guard vs raw)",
        "fragmentation_threshold": 2,
        "patterns": {
            "useAutoSaveSettings": r"\buseAutoSaveSettings\s*[<(]",
            "usePersistentToolState": r"\busePersistentToolState\s*[<(]",
            "useToolSettings": r"\buseToolSettings\s*[<(]",
        },
    },
    "ui_preferences": {
        "type": "complementary",
        "description": "User-scoped UI preferences (different scope from tool settings)",
        "patterns": {
            "useUserUIState": r"\buseUserUIState\s*\(",
        },
    },
    "error_handling": {
        "type": "complementary",
        "description": "Error handling layers (handleError wraps console.error + toast.error)",
        "patterns": {
            "handleError": r"\bhandleError\s*\(",
            "toast.error": r"\btoast\.error\s*\(",
            "console.error": r"\bconsole\.error\s*\(",
        },
    },
    "data_fetching": {
        "type": "complementary",
        "description": "Data fetching layers (useQuery reads, useMutation writes, supabase one-offs)",
        "patterns": {
            "useQuery": r"\buseQuery\s*[<({]",
            "useMutation": r"\buseMutation\s*[<({]",
            "supabase.from": r"\bsupabase\b[^;]*\.from\s*\(",
        },
    },
    "loading_display": {
        "type": "complementary",
        "description": "Loading UI (Loader2 spinners, Skeleton placeholders - different UX)",
        "patterns": {
            "Loader2": r"\bLoader2\b",
            "Skeleton": r"\bSkeleton\b",
        },
    },
}


__all__ = ["PATTERN_FAMILIES"]
